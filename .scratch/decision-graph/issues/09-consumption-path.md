# 09 — How does the graph get back into the agent?

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 04, 13

## Question

Capture is free. Consumption is where the token cost the original idea worried about actually
lives — and downstream task benefit (the chosen metric, ticket 11) is impossible to measure
without a consumption path.

Settle:

- What does the agent receive: injected system-prompt context, a queryable tool
  (`query_decisions`), or a compaction-time summary?
- Selection: the graph will be far larger than any context window. What subset is surfaced,
  and by what rule? ("decisions touching files in this turn", "last N", "decisions on the
  failing path".) Selection must itself be deterministic — no model. **Ticket 13 supplies the
  relevance primitive (`supersedes` / live-rationale); this ticket picks the window over it.**
- Token budget: a hard cap, and what gets dropped first.
- **Compaction interaction.** Compaction (`packages/agent/src/harness/compaction/`) is where
  the agent forgets. Is the graph a *replacement* for what compaction drops — re-injected
  after a compaction event — or independent of it? This is the strongest version of the
  original idea and the most likely place to break something.
- Does consumption default to off? (A capture-only build is measurable for overhead and
  usable by a human without ever touching the agent's context.)

## Design intent (stated by the user while grilling ticket 13 — do not re-derive)

The shape this ticket is meant to serve, in the user's own framing:

An agent that has just hit an error, or has been told to change a file, or is starting a fresh
session with no memory of the project, queries the temporal graph *first*. It asks how a given
region of the project came to be, and gets back a temporally ordered set of Decisions with their
WHY. Those Decisions point at the exact declarations involved, by joining ticket 13's
current-file line ranges against an AST code graph (the user's `graphify`, whose output is
already gitignored at `.gitignore:46-47` and which does not exist in-tree yet).

The payoff being aimed at is **context economy**: the agent should not have to grep every
`.md` file or read several whole source files to reconstruct the codebase's structure, intent
and constraints. Two graphs — the temporal one (why, when, by whom) and the AST one (where) —
should locate the change site directly. Supporting number from ticket 04: WHY plus tool
arguments is a median of 357 B per Decision, so twenty Decisions of rationale is smaller than one
moderately sized source file.

This is intent, not a settled answer. The mechanism (injected context vs. a queryable tool vs. a
compaction-time hook), the window, and the token budget are all still this ticket's to decide.

## Inherited from ticket 13 (closed)

Ticket 13 supplies the relevance primitive as a **function, not a table**, in
`packages/decision-graph/src/attribution.ts`:

- `attributePath(path): Attribution` — every Decision that ever touched the path, newest first,
  each with `ranges` (1-based inclusive, **current-file** coordinates), `survivingLines`,
  `writtenLines`, `attributable`. Plus `anchor` (`"worktree" | "absent"`), `attributedThrough`,
  and `brokeAt`.
- `ownerOfLine(path, line): AttributedDecision | null` — for the stack-trace case.

Four deliberate refusals by 13, each of which leaves a decision to this ticket:

1. **Nothing is filtered.** Fully superseded Decisions come back with `survivingLines: 0`.
   Windowing is entirely this ticket's job, so that ticket 11 can measure whether abandoned
   attempts help or hurt.
2. **No WHY text.** Ids and structure only; join the `decision_why` view (ticket 04) so this
   ticket owns its own token budget.
3. **No symbol resolution.** Ranges stop at line numbers. Whoever wants declarations joins an
   AST. Ticket 12's stored `symbol` label is only useful here for Decisions with zero surviving
   lines, which map to no current symbol.
4. **Nothing is stored.** Attribution is recomputed per path on demand, so there is no staleness
   or invalidation to handle.

Hard requirements this ticket inherits, extending ticket 08's "no store and empty store must be
indistinguishable, and neither may change agent behaviour":

- `anchor: "absent"` (file not on disk) and a non-null `brokeAt` (the record cannot account for
  the file past some point) must both degrade to *less context*, never to an error, a warning in
  the agent's context, or a behaviour change.
- Consumption honours the same three gates as Capture (ticket 08 §1), or the graph-off and
  graph-on arms in ticket 11 will not line up.

## Resolution

**Consumption is one extension-registered tool, `query_decisions`, taking a path and an optional
line. Nothing is pushed into the agent's context except a single paths-only message after a
compaction, so the graph is pulled on demand and costs nothing on turns where it is not asked.
The fork-core edit ticket 03 pre-authorised for this ticket goes unspent: every mechanism the
question lists is already reachable from the documented extension surface. Prompt caching, not
token count, is what rules out the system-prompt route — Pi marks its cache breakpoint on the
system prompt, so a per-Run injection there re-reads the entire conversation at write price every
Run, while a tool registered once leaves the prefix byte-identical for the life of the session.
The answer's budget is computed from remaining context rather than fixed, so it is generous when
there is room and self-limiting when there is not. One upstream finding breaks a rule ticket 04
and `CONTEXT.md` both state: `touched.path` stored "verbatim from tool args" is not a stable File
identity, because Pi resolves the path for the filesystem but records the model's raw string, so
one file accumulates several identities and a lookup misses most of its own history.**

### 1. Fork-core is not needed. The pre-authorisation goes unspent.

Ticket 03 kept a core edit pre-authorized "for ticket 09 only, if feeding the graph back needs an
interception point the extension surface cannot reach". It does not. Every route the question
names exists and is public:

| Route | Where | Note |
|---|---|---|
| register a tool | `ExtensionAPI.registerTool` (`coding-agent/src/core/extensions/types.ts:1251`), `ToolDefinition` (`:449-498`) | works after load too, via `refreshTools` (`extensions/loader.ts:264-271`) |
| replace the system prompt | `BeforeAgentStartEventResult.systemPrompt` (`types.ts:1104-1105`) | applied at `agent-session.ts:1254-1261`, per Run, reset to base when no extension returns one |
| inject a message per Run | `BeforeAgentStartEventResult.message` (`types.ts:1103`) | pushed after the user message (`agent-session.ts:1240-1252`), converted to a plain `user` message for the model (`agent/src/harness/messages.ts:137-144`) |
| inject per LLM call | `context` event, wired to `AgentLoopConfig.transformContext` at `coding-agent/src/core/sdk.ts:353-356` via `runner.emitContext` (`runner.ts:984-1013`) | fires before every LLM call; the array it returns is a `structuredClone` (`runner.ts:986`) and is never persisted |
| own the compaction | `SessionBeforeCompactResult` `cancel` / `compaction` (`types.ts:1117-1120`), consumed at `agent-session.ts:2083-2123` | `session_compact` fires after with the saved entry (`:2168-2176`) |

So the map's "preferred hook site: fork-core" is now closed for the whole feature, not just for
capture. No file in Pi is modified by this ticket, and the only upstream edit the project still
owes is ticket 11's ~10 lines in `packages/evals/src/pi-harness.ts`.

### 2. Delivery: a registered tool, and why caching decides it

**`query_decisions`, registered by the extension, advertised through the tool's own
`promptSnippet` and `promptGuidelines` (`types.ts:456-459`). No system-prompt override, no
per-Run push, no per-LLM-call push.**

The decisive fact is not token volume, it is where Pi puts its cache breakpoints. The Anthropic
request is assembled in the order `params.system` (`ai/src/api/anthropic-messages.ts:991-999`),
then `params.tools` (`:1007-1024`), then `params.messages` (`:963-970`), and markers land on the
system prompt text (`:997`), the last tool definition (`convertTools`, `:1321`, gated on
`index === tools.length - 1`) and the last content block of the last user message (`:1256-1277`).
The convention is documented at `ai/src/types.ts:595-596`. It is a prefix cache, so changing an
element invalidates everything after it in that order.

- **Tool route.** `promptSnippet` and `promptGuidelines` are folded into `_baseSystemPrompt` by
  `_rebuildSystemPrompt` (`agent-session.ts:1023-1056`) at registration. After that the system
  prompt and the tools array are byte-identical on every request for the session, the prefix stays
  valid, and answers arrive in `messages` at the tail where new content belongs anyway.
- **System-prompt route.** The override is per Run by construction (`agent-session.ts:1254-1261`).
  Carrying Decisions in it changes the first element of the prefix every Run, re-reading the tools
  and the whole conversation. On a 50k-token context that is 1.25x on 50k instead of 0.1x on 50k,
  per Run, and it worsens as the session grows — precisely as the graph becomes more useful.
- **Per-Run and per-LLM-call pushes** were rejected on a second ground that stands independently:
  both require the extension to *guess* which paths matter. At `before_agent_start` the only input
  is the prompt text, which usually names no path. At `context` there is more signal but the tokens
  are re-paid every turn and the injection point invalidates the cache tail on each call. A tool
  moves relevance to the only party that knows it.

**The one cache cost the tool route does carry, stated rather than glossed.** If the Store holds no
Decisions at startup and gains its first one mid-session, registering the tool then runs
`refreshTools` → `_refreshToolRegistry` (`agent-session.ts:2404`, `:2463`) →
`setActiveToolsByName` (`:2553`) → system prompt rebuild (`:941`). That is one cache invalidation,
once in the life of a fresh Store. Every later session starts with the tool already present. Also
verified: a newly registered tool is auto-activated, since `_refreshToolRegistry` pushes every name
absent from `previousRegistryNames` into the active set (`:2545-2551`), so no second call is needed.

**Definition.**

```ts
{
    name: "query_decisions",
    label: "decisions",
    description: /* see §4 for what it returns */,
    promptSnippet: "Look up the recorded rationale for a file or a line, from this project's decision history",
    promptGuidelines: [ /* frozen string, see below */ ],
    parameters: Type.Object({
        path: Type.String(),
        line: Type.Optional(Type.Number()),
    }),
}
```

`ToolDefinition.execute` receives `ctx: ExtensionContext` (`types.ts:480-486`), which carries
`cwd` (`:315`), `isProjectTrusted()` (`:332`) and `getContextUsage()` (`:342`) — everything §5 and
§8 need, with no extra plumbing.

**The `promptGuidelines` string is an experimental variable, not copy.** It is the difference
between a tool the model reaches for and a tool it ignores, so it is the largest single lever on
ticket 11's result. It must be fixed before the first eval run, recorded verbatim in ticket 11's
design, and never tuned between arms. Note the boundary against §6's phrasing rule: a guideline
describes when to use the tool, which is what `promptGuidelines` is for and what Pi's own tools do
(`edit.ts:309`, `write.ts:198`). The rule in §6 governs the *result text*, which must not instruct.

### 3. What can be addressed: a path, and optionally a line

Ticket 13's two entry points map one-to-one, so this costs nothing to support:

- `path` alone → `attributePath(path)`.
- `path` plus `line` → `ownerOfLine(path, line)`.

`line` returns **at most one** Decision, because Attribution's `owner[]` is claim-once (ticket 13
§2): exactly one Decision owns a given current line, and every earlier writer of that line found it
already owned. That is the stack-trace case the design intent names — a thrown error gives a file
and a line, and this names the Decision that wrote it and why. The header still reports the path's
total Decision count, so a re-query without `line` is available when the single answer is not enough.

**A pathless "recent decisions in this project" mode is skipped.** The design intent's fresh-session
agent is framed as asking "how a given region of the project came to be", and an agent with no path
will `ls`, `grep` or `read` within a turn or two and then have one. Tripwire, measurable in ticket 11
at no extra cost because it already sees every tool call: compare the `query_decisions` call rate in
eval tasks whose prompt names no path against the rate in tasks whose prompt names one. A rate near
zero in the first group and healthy in the second means the agent wanted to ask and had nothing to
ask with, and the pathless mode gets built. Comparable rates mean it was never needed.

### 4. The answer: shape, ordering, and what is left out

**Rendered as plain text, not JSON.** The result is going into an LLM context; JSON keys and braces
are pure overhead against the same information, and ticket 04 measured this surface in bytes.

Per Decision: the date, the current-file line ranges, surviving-of-written counts, and the WHY from
the `decision_why` view (ticket 04). Not the patch, not the tool arguments, not model, provider,
tokens or cost. Ticket 04's measurement is what makes this affordable — WHY plus arguments is 357 B
median, and WHY alone is smaller still (thinking p90 169 B, text p90 431 B).

```
decision-graph: packages/agent/src/agent-loop.ts
14 Decisions touched this file. 9 still own lines in it.

2026-03-14  lines 210-224, 357  (16 of 19 written lines still standing)
Sourced tool_invocation from the model's own toolCalls array rather than
toolResults, so an abort mid-batch still records the trailing calls.

2026-03-02  lines 440-451  (12 of 12 written lines still standing)
...

3 Decisions own no surviving lines; omitted for budget.
2 Decisions have no recorded rationale.
```

**Dates are absolute, never relative.** "3 weeks ago" is wrong the moment the tool result is
persisted into the session file and re-read on a later day, and the agent has no reliable clock.

**Decision ids are not rendered.** A uuidv7 is 36 characters, no tool consumes one, and at twenty
entries that is ~180 tokens of unusable text. They go into the tool result's `details` instead,
which is typed on `ToolDefinition` (`types.ts:449`) and reaches the TUI renderer, the session file
and other extensions but **not the provider payload** — verified: `anthropic-messages.ts` builds
`params` from content blocks only (`:961-1024`), and the file's only `details` references are the
unrelated `output_tokens_details` at `:731-735`. So the viewer and a human get the ids for free and
the model is not charged for them.

**Ordering and the budget cut, as one sort rather than a drop cascade.** Partition first: Decisions
whose `decision_why.why` is NULL are never rendered as entries, because rationale is the entire
product and a date with ranges and no prose is noise. They become one count line. The rest sort by,
in order: `attributable` true before false, `survivingLines > 0` before `= 0`, then newest first.
Fill from the top until the budget is spent, then report what was left out, grouped by reason.

A cascade of "drop X first, then Y" was written and discarded because it has a hole: an absent file,
or a file every one of whose Decisions was superseded, has *every* entry at `survivingLines: 0`, so
"drop zero-standing first" empties the answer entirely. A sort plus a fill cannot do that.

### 5. Budget: proportional to remaining context, not a constant

The user's concern was headroom — a long history or a big repository needing many characters to
deliver the reasoning, against the alternative of reading whole files. Three parts to the answer.

**5.1 Repository size is irrelevant to one answer.** `attributePath` returns the Decisions that
touched *one path*. The scaling variable is that path's own touch count, which is what ticket 13's
worst case named: 200 Decisions on `a.ts` after six months. A million-file repo with a
three-Decision file returns three entries.

**5.2 The realistic worst case fits, with room to spare.** At ~150 tokens per rendered entry, ticket
13's 200-Decision file is about 30k tokens for its complete history. The ceiling below sits above
that, so on real files the budget does not bind at all. That is the headroom, and it is arithmetic
rather than a knob.

**5.3 The rule.** Pi's own token estimate is literally `Math.ceil(chars / 4)`
(`coding-agent/src/core/compaction/compaction.ts:266-274`), so a character budget is not a dodge
around a tokenizer, it is exactly Pi's token model.

```ts
const usage = ctx.getContextUsage();                     // ContextUsage | undefined
const remaining =
    usage && usage.tokens !== null ? Math.max(0, usage.contextWindow - usage.tokens) : null;
const budgetChars = remaining === null
    ? 12_000                                             // ~3k tokens
    : Math.min(200_000, Math.floor(remaining * 4 * 0.25));
```

Proportional to what is *left* is the right shape in both directions: generous in a fresh context
where the tool is replacing several file reads, and self-limiting in a full one where a large
injection would itself trigger a compaction and destroy more context than it supplied. The 200_000
ceiling (~50k tokens) stops a fresh million-token window from receiving a 250k-token essay, and sits
above §5.2's worst case. Below ~2_000 characters of budget the tool returns the header and the count
lines only, so under context pressure it degrades to a summary rather than to nothing, and never to
something that forces a compaction.

`ContextUsage` is `{ tokens: number | null; contextWindow: number; percent: number | null }`
(`types.ts:288-294`). Both fallbacks are real, not defensive padding: `getContextUsage()` returns
`undefined` with no model or no known context window (`agent-session.ts:3174-3179`), and `tokens` is
`null` after a compaction until the next assistant response carries usage
(`agent-session.ts:3181-3205`) — which is exactly the moment §7's nudge fires.

**No setting.** Two constants in the source. A setting is a config surface, a documentation
obligation and a default nobody tunes; ticket 11 owns changing either number if it measures a better
one, which is a one-line diff.

### 6. Reporting the limits of the record

**Ticket 13's "never a warning in the agent's context" is narrowed here, on the user's ruling.** The
reasoning that overrode it: a truncated history that does not say it is truncated invites the agent
to treat a partial account as complete, which is worse than no account. Decisions older than a Break
are real ancestors of the ones returned, and hiding their existence distorts what the agent infers
from what it does get.

Ticket 08's requirement — no Store and empty Store must be indistinguishable and must not change
agent behaviour — survives intact under a different split, which is what makes the narrowing safe:

- No Store, empty Store, or untrusted project: **the tool is never registered** (§8). No schema, no
  text, no tool in the list. Indistinguishable at a stronger level than ticket 13 asked for.
- Store present and the agent called the tool: the result states the record's condition as a field.
  That is an answer to a question the agent asked, not an unsolicited warning appearing in context.

Two notes, both factual, both on `Attribution`'s existing fields:

- `brokeAt` non-null → `The record cannot account for this file before <date>. <n> earlier
  Decisions exist and are not shown.`
- `anchor: "absent"` → `<path> is not in the working tree. The last recorded write was <date>.`

**Phrasing rule, binding on every line the tool emits:** state a fact about the record, never an
instruction about what to do with it. "The record cannot account for this file before 2026-01-12" is
a fact. "Read the file before trusting this" is an instruction, and an extension has no business
steering the agent's method. The one permitted exception is descriptive of the tool itself, e.g.
noting that narrowing to a line returns only the Decision that owns it, because that is a statement
about the interface and not about the code.

**The absent case suspends the standing tier of §4's sort.** When `anchor: "absent"` every Decision
has `survivingLines: 0`, so that key discriminates nothing; order by recency alone. The counts still
report honestly.

**Pre-Break Decisions are counted, never named.** They are in hand for free (ticket 13 returns them
with `attributable: false`) and they have WHY, but they describe bytes the record can no longer
account for — confident rationale about code that may not exist, which is the exact failure ticket
13 was written to prevent. The count carries the date and the number, which is what restores the
agent's awareness that history continues past the break. Tripwire: if ticket 11 shows tasks failing
disproportionately on files with a non-null `brokeAt`, promote to naming the most recent few.

### 7. Compaction: one nudge, and nothing else

**On `session_compact`, inject one message listing the paths that Decisions touched inside the
dropped span, capped at 40 paths, with no WHY and no ranges.**

Replacing the compaction was rejected outright. `SessionBeforeCompactResult.compaction`
(`types.ts:1119`) does allow it, and `agent-session.ts:2117-2123` takes the extension's summary
whole, but that puts this feature in the business of writing compaction summaries — a quality bar it
cannot meet and a total loss when it is wrong.

Doing nothing was the ponytail answer and it fails on one point that could not be argued away:
**after a compaction the agent does not know it forgot something, and a tool it does not know to
call is not a recovery path.** The nudge restores awareness rather than content. It guesses no
relevance beyond "these paths were in the part you just lost", it is factual under §6's rule, and
compaction is rare, so the cost is a few hundred tokens at a moment when tens of thousands were just
discarded.

Mechanics. `session_compact` carries the saved `CompactionEntry` (`agent-session.ts:2168-2176`),
whose `firstKeptEntryId` bounds the dropped span; the paths are
`SELECT DISTINCT path FROM touched` joined to Decisions before that boundary. The message goes in
through `ctx.sendMessage`-class runtime, not through `before_agent_start`, because the compaction is
not a Run boundary. The 40-path cap is fixed rather than budget-derived on purpose: §5's rule needs
`usage.tokens`, which is exactly `null` at this moment (`agent-session.ts:3181-3205`), and a list of
40 paths is small enough that the question does not arise.

**This is the design's only push.** Everything else is pull. That boundary is worth keeping visible:
if a future ticket wants a second push, it is changing the shape of the design, not adding a feature.

### 8. Gates, default, and store failure

**Gates 1 and 3 of ticket 08 §1 apply. Gate 2 does not.** Gate 2 is
`sessionManager.getSessionFile() !== undefined`, and it exists because `--no-session` means *do not
persist this conversation*. Reading Decisions recorded earlier writes nothing, so applying gate 2 to
consumption would be copying a write rule onto a read. This cannot desynchronise ticket 11's arms:
`packages/evals/src/pi-harness.ts:141` builds a persisted `SessionManager.create(...)`, verified by
ticket 08 §1, so under evals gate 2 is satisfied on both sides regardless.

**Consumption defaults on, and registration is conditional on the Store holding at least one
Decision.** One `SELECT EXISTS(SELECT 1 FROM decision)` at `session_start`, and a re-check when
Capture writes the first Decision of a fresh Store, at which point `registerTool` is still legal
(`loader.ts:264-271`) and the tool auto-activates (`agent-session.ts:2545-2551`). No Store, empty
Store and untrusted project therefore all produce a session with no such tool in it, which is the
strongest possible reading of ticket 08's indistinguishability rule.

**On store failure the tool stays registered and returns nothing.** Ticket 08 §6's one-strike
disable governs Capture; unregistering the tool mid-session would rebuild the system prompt and
invalidate the cache a second time (§2) to no benefit. The tool answers with the empty result, which
is what "no records" already looks like.

### 9. Correction: `touched.path` is not a File identity

Found while working out how the tool looks a path up, which is the first thing in the whole project
that has to *match* a path rather than merely record one.

`CONTEXT.md` defines **File** as "a repo-relative path. Its identity is the path string itself,
exactly as the tool received it", and ticket 04's schema comments `touched.path` as "verbatim from
tool args; never resolved". Those two clauses disagree with each other, and the second one does not
survive contact with the tools:

- `edit` computes `absolutePath = resolveToCwd(path, cwd)` for every filesystem operation
  (`coding-agent/src/core/tools/edit.ts:316`) but passes the model's **raw** `path` string to
  `generateUnifiedPatch` (`:357`) and echoes it in the result text (`:362`).
- `write` does the same (`write.ts:208` resolves, `:229` echoes the raw string).
- `resolveToCwd` (`core/tools/path-utils.ts:48-50`) delegates to `resolvePath`
  (`utils/paths.ts:102-106`), which expands `~`, strips a leading `@`, normalises Windows shell
  paths and `file://` URLs, and resolves against cwd.

So `src/foo.ts`, `./src/foo.ts`, `C:\pi harness\pi\src\foo.ts` and `~/pi/src/foo.ts` are four
distinct File identities for one file. Capture would scatter one file's history across them, and
`query_decisions("src/foo.ts")` would return whichever slice happened to share the model's phrasing
that day. It also breaks ticket 13 §2 directly: `join(cwd, path)` on an already-absolute stored path
concatenates rather than resolves.

**Ruling: `touched.path` stores the cwd-relative form of the path Pi itself resolved.** Concretely
`relative(cwd, resolvePath(rawArg, cwd))` with posix separators, falling back to the absolute path
when the target lies outside cwd. Three reasons this is the right correction rather than a widening
of the rule:

1. It makes the schema match `CONTEXT.md`'s existing words ("a repo-relative path") instead of
   changing the vocabulary to match a buggy column.
2. It is not a resolution in the sense `CONTEXT.md` forbids Capture from performing. Pi computed
   this path itself and used it to touch the disk; recording it is witnessing, not inferring. The
   distinction is the same one ticket 08 used to justify `decision.leaf_entry_id`.
3. Nothing is lost. The model's raw string stays verbatim in `tool_invocation.arguments`, which is
   precisely the argument ticket 04 used for not duplicating the Requested Change into `touched`.

Pi already has this function twice — `getCwdRelativePath` (`utils/paths.ts:108-117`) and
`formatPathRelativeToCwdOrAbsolute` (`:119-122`), the latter being exactly the desired behaviour
including the posix-slash pass. Neither is exported from `coding-agent/src/index.ts` (checked). Per
ticket 13 §4's precedent with `stripBom`/`normalizeToLF`, re-implement the six lines inside
`packages/decision-graph` rather than deep-import another package's internals or widen the upstream
public API for it.

**One related trap, checked and dismissed so a future agent does not "fix" it speculatively.** Three
files in Pi read tool arguments as `args.file_path ?? args.path` (`edit.ts:186`, `:207`, `:218`;
`write.ts:144`, `:236`; `read.ts:81`, `:127`, `:183`), which suggests Capture needs the same
fallback. It does not. Only the renderers are tolerant; execution reads `path` alone
(`validateEditInput`, `edit.ts:131-136`; `write.ts:203`), and `prepareEditArguments` (`:105-129`)
normalises a stringified `edits` array and the legacy `oldText`/`newText` pair but never maps
`file_path` to `path`. A call carrying only `file_path` cannot produce an Applied Change, and failed
calls create no Touch (ticket 04). So `touched.path` is only ever sourced from a call where
`args.path` was a string.

### 10. Vocabulary

Two terms added to `packages/decision-graph/CONTEXT.md`, **Consultation** and **Nudge**, and three
existing entries amended: **File** (§9's identity correction), **Break** (it is reported, not
hidden, per §6), and **Compaction Boundary** (it now triggers something).

### Accepted holes

1. **A tool arm partly measures tool adoption, not graph value.** If the model does not call
   `query_decisions`, ticket 11 measures indifference rather than the graph. §2 freezes the
   `promptGuidelines` string to make this a controlled variable rather than a confound, and a push
   arm remains additive if 11 shows low call rates. Not fixable from inside this ticket.
2. **The graph-on arm changes two things at once.** The tool's `promptSnippet` and
   `promptGuidelines` alter the system prompt, so the arm differs by instruction as well as by data.
   Ticket 11's placebo arm must therefore inject an equal-token, equally-instructional snippet for a
   tool that returns nothing useful, or the arms are not comparable.
3. **First Decision of a fresh Store costs one cache invalidation** (§2). Once per Store, never
   again.
4. **`line` returns exactly one Decision** (§3), which is thin for a stack trace whose interesting
   context is the surrounding block. Widening it to a line range was rejected as inventing a window
   ticket 13 did not define. The re-query without `line` is the escape hatch.
5. **Nothing detects a stale answer inside one turn.** Attribution is computed at call time against
   the working tree; if the agent then edits the file, the ranges in its context are wrong. Bounded
   because the tool is cheap to re-call, and the alternative (invalidating tool results on `edit`)
   requires rewriting the agent's own history.
6. **The nudge names paths from the dropped span, not paths the agent still cares about.** It is
   deliberately not a relevance judgement, so on a long compaction it may list 40 paths of which two
   matter. Cheap enough that filtering would cost more in guessed relevance than it saves in tokens.
7. **§9's correction does not recover history already scattered across path forms**, because no
   store exists yet. Free now, a migration later. This is the ticket's argument for landing the
   correction pre-build.

### Consequences for other tickets

- **04 (schema)** — one correction, pre-build, no migration owed: `touched.path` stores the
  cwd-relative resolved path (§9), not the raw argument, and the schema comment "verbatim from tool
  args; never resolved" is wrong and must not be copied into `store.ts`. The `decision_why` view is
  confirmed as the only WHY source consumption reads.
- **03 (capture point)** — **its pre-authorised fork-core edit is released unused** (§1). The
  subscription list gains nothing for capture; consumption adds `session_compact` as a *consumer*
  event, which ticket 03 already listed as subscribed for boundary stamping.
- **08 (lifecycle)** — its "consumption honours the same three gates" instruction is narrowed:
  gates 1 and 3 apply, gate 2 does not, because it forbids writing and not reading (§8). Its
  indistinguishability rule is satisfied more strongly than asked, by not registering the tool at
  all.
- **13 (temporal relevance)** — its refusal to surface `brokeAt` and `anchor: "absent"` in the
  agent's context is **narrowed** (§6): both are reported as facts on a result the agent asked for,
  never as unsolicited warnings. Its §2 `join(cwd, path)` is corrected to work against the
  cwd-relative identity §9 establishes. Its four refusals otherwise stand and are all consumed as
  specified: windowing, filtering, WHY joining and the token budget are settled here.
- **10 (viewer)** — inherits two things. `details` carries decision ids out of the tool result
  without charging the model (§4), which the viewer can key on. And the user's whole-tree idea from
  the deletion discussion lands here rather than in consumption: `SELECT DISTINCT path FROM touched`
  stat'ed against the working tree yields the set of recorded paths that no longer exist, which is
  deterministic, needs no heuristic, and is a viewer affordance (a graveyard of dead files).
  Consumption never needs it, because it only ever stats the one path it was asked about.
- **11 (metrics)** — gains its arm definition for free: graph-off is "do not register the tool".
  Also inherits three obligations. The `promptGuidelines` string is a frozen experimental variable
  (§2). The placebo arm must match the instruction, not only the token count (hole 2). And two
  measurables come at no cost: `query_decisions` call rate split by whether the prompt named a path
  (§3's tripwire), and task outcomes split by whether `brokeAt` was non-null (§6's tripwire). It
  still owns the `pi-harness.ts` edit and the `thinkingLevel` unpin.
- **12 (symbol resolver)** — unaffected and still deferred past 11. §4 confirms ticket 13's
  narrowing: the rendered answer carries line ranges and no symbols, so nothing on the consumption
  path wants `touched.symbol`.
- **Deletion rationale, partially declined and routed** — the user asked for a note explaining *why*
  a file was deleted. Pi has no delete tool and no move tool: the built-in set is exactly `bash`,
  `edit`, `find`, `grep`, `ls`, `read`, `write` (`core/tools/`, names at `bash.ts:331`,
  `edit.ts:304`, `find.ts:129`, `grep.ts:134`, `ls.ts:106`, `read.ts:216`, `write.ts:193`). Every
  deletion and every rename therefore goes through `bash` and produces no `touched` row, so a
  deletion is never witnessed and its rationale is only recoverable by parsing shell strings — the
  heuristic ticket 04 refused for rename evidence and ticket 13 re-scoped to post-implementation.
  What ships instead: §6's absent-file note names the last recorded write and its date, and the
  Decisions are returned with their WHY, so the last agent to touch the file usually explains the
  story. The stronger version is folded into the map's existing bash-mutation item as a second named
  beneficiary, under the same tripwire.

### What this touches

Spec-only, like 01–08 and 13. **Ticket 03's pre-authorized core edit is not spent**, so across the
whole map no file in Pi is modified by any ticket except the ~10 lines ticket 11 owes
`packages/evals/src/pi-harness.ts`.

When the build starts: `packages/decision-graph/src/query-tool.ts` (new — the `ToolDefinition`, the
renderer, the budget rule), the `session_compact` handler and the conditional `registerTool` in
`packages/decision-graph/src/extension.ts`, the path canonicaliser and the corrected `touched.path`
write in `packages/decision-graph/src/store.ts`, and the corrected `join` in
`packages/decision-graph/src/attribution.ts` (ticket 13). One runnable check ships with the tool:
assert that a fixture Store plus a fixture working tree renders a known answer, that the same query
with a full context returns header-and-counts only, and that an absent file returns its note with
every Decision still listed. `packages/decision-graph/CONTEXT.md` is updated by this ticket.
