# 13 — Temporal relevance: which decisions still explain this file?

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 01, 04

## Question

A file node accumulates every decision that ever touched it. Six months in, `a.ts` carries 200
decisions, and the rationale from March describes code rewritten in June. "Every decision that
touched this file" is therefore the wrong question — feeding all 200 back (ticket 09) makes the
agent *worse*, handing it confident reasoning about code that no longer exists.

The right question: **which decisions still explain the current state of this file?**

This is two problems. Do not conflate them.

### (a) Segmentation — what supersedes what, deterministically?

Charting ruled out semantic labelling at capture time (no classifier, no second model), so only
signals literally present in the event stream are admissible. Available:

| signal | cost | tells you |
|---|---|---|
| timestamp order | free | B came after A. Nothing more. |
| session boundary | free (ticket 08) | different sitting, possibly different intent |
| git commit boundary | assembly-time git | A's work shipped, B's is new |
| **content overwrite** | free — 01 stores edit text | **B provably replaced the bytes A wrote** |

The last is the one ticket 01 was designed to enable: if decision B's `oldText` overlaps
decision A's `newText` for the same file, B destroyed A's work. Deterministic, derived from
tool args alone.

Settle:

- Is `supersedes` an edge (→ ticket 07's set) or a computed view?
- Overlap rule: exact match, substring containment, or normalised (whitespace, formatting runs
  like `npm run format` rewrite everything and would falsely supersede the entire file)?
- Partial supersession — B overwrites half of what A wrote. Is A dead, alive, or partial?
- What does a `write` (whole-file replace) do? Naively it supersedes every prior decision on
  that file. Correct, or catastrophic?
- Does supersession cross the `renamed_to` edge?

### (b) Windowing — which slice reaches the agent?

Even with `supersedes`, consumption must choose: live decisions only, last N, since last
commit, whole history. That choice is **ticket 09's**, but it cannot be made until (a) exists,
and ticket 11 measures whether the window helped or hurt.

Settle here only what (a) must expose for 09 to have a real choice — e.g. is "live rationale
for file X" a first-class query the store answers, or does 09 assemble it each time?

### Watch for

Bash-driven mutations produce no `touched` edge (accepted hole, ticket 01), so a file rewritten
by `sed -i` or codegen shows no supersession and its stale rationale stays "live" forever. State
whether that is tolerable or whether it forces ticket 01's hole open sooner.

## Resolution

**Supersession is not computed pairwise. It is the shadow of a stronger primitive: per-line
Attribution, derived by reverse-replaying `touched.patch` from the working-tree file backwards
through the Store, in the manner of `git blame` over Decisions instead of commits. It is a
function, not a table and not a SQL view. Capture gains one new subscription
(`tool_execution_start`) and one new column (`touched.old_text`) that snapshots a `write`'s
pre-image, which closes ticket 04's accepted hole 1 and stops a whole-file rewrite from
flattening every prior Decision's ownership. What ticket 09 receives is line ranges in the
*current* file, not counts and not symbols, because line ranges are the join to an AST graph.**

The ticket's own framing of (a) is superseded by this resolution. "If B's `oldText` overlaps A's
`newText`, B destroyed A's work" is position-blind: a `}` deleted at line 900 would supersede a
`}` added at line 40. It also cannot express partial supersession, which is the common case, and
it answers a question adjacent to the one the ticket says it wants. "Which Decisions still
explain the current state of this file" is per-line ownership.

### 1. Three upstream findings that make replay admissible

**1.1 — `touched.patch` is exactly invertible, and Pi's own suite asserts it.** `edit` returns
`details.patch = generateUnifiedPatch(path, baseContent, newContent)` with `contextLines = 4`
(`coding-agent/src/core/tools/edit.ts:357`, `edit-diff.ts:369-373`). The test suite asserts
`applyPatch(originalContent, result.details.patch) === finalContent` at
`coding-agent/test/tools.test.ts:283`, and again at `:1081` and `:1117` in tests explicitly named
for fuzzy multi-edits. So the patch is not merely better evidence than the model's `oldText`
(ticket 04's framing); it is a tested bijection between pre-image and post-image, with upstream
regression coverage behind it. Replay is arithmetic, not heuristic.

**1.2 — Correction to ticket 04: the fuzzy-match damage was overstated.** Ticket 04 said `edit`
"replaces against `normalizeForFuzzyMatch(content)` (`:317-319`)". In fact `baseContent =
normalizedContent`, the true original (`edit-diff.ts:353`), and when any edit matched fuzzily,
`applyReplacementsPreservingUnchangedLines` (`:358`) overlays only the changed line blocks so
untouched lines keep their original bytes. Fuzzy folding is confined to the interior of a
replaced region. The `-` lines of a patch are therefore a faithful pre-image everywhere outside a
fuzzy-matched span. Ticket 04's accepted hole 2 (asymmetry between the Requested Change and the
Applied Change) is unchanged; only the claimed blast radius shrinks.

**1.3 — The patch lives in a normalized space that disk does not.** The patch is computed after
`stripBom` + `normalizeToLF` (`edit.ts:346-349`) while disk receives `bom +
restoreLineEndings(newContent, originalEnding)` (`:352`). `write` stores the model's `content`
argument verbatim with no normalization at all (`write.ts:225`). Assembly must canonicalise all
three sources into one space before comparing. See §4.

Bookkeeping note: the tools exist twice, at `packages/agent/src/harness/tools/` and
`packages/coding-agent/src/core/tools/`. Ticket 04 cited the harness copy's line numbers
(`edit.ts:118-122`, `edit-diff.ts:317-319`, `write.ts:30-34`). The logic is identical in both
(`applyReplacementsPreservingUnchangedLines` at `agent/…/edit-diff.ts:128` and
`coding-agent/…/edit-diff.ts:131`). This resolution cites the coding-agent copy, which is what
the `pi` CLI actually loads.

### 2. Attribution: the primitive

Two inputs, both required, and the second is external to the Store:

1. the `touched` rows for a path, ordered by `(decision.id DESC, tool_invocation.ordinal DESC)`;
2. the working-tree file at `join(cwd, path)`.

`CONTEXT.md`'s "Assembly is deterministic and re-runnable" is amended to *deterministic given the
Store and the working tree*. This is not a weakening. The Store contains no notion of a file's
present contents, so "which Decisions explain the current state" is literally unanswerable
without the second input. Consequence, stated rather than hidden: switching git branches changes
the answer, which is correct under ticket 08's one-store-per-cwd ruling, because the question is
about this directory as it stands.

The walk maintains three parallel structures:

- `lines[]` — the reconstructed file state, mutating as the walk moves backwards in time.
- `origIndex[]` — parallel to `lines[]`; for each position, the index that line occupies in the
  *current* file, or `-1` for a line restored from history that no longer exists on disk.
- `owner[]` — indexed by *current*-file line, written once, never spliced.

Per touch, newest first:

- Parse `touched.patch` with `parsePatch` (`diff@8.0.4`, already a direct dependency at
  `coding-agent/package.json:54`). Walk its hunks in descending `newStart` so earlier indices
  stay valid.
- Verify the window `lines[newStart-1 .. newStart-2+newLines]` equals the hunk's `' '` and `'+'`
  lines. A mismatch is a Break (§6); stop the walk for this path.
- Claim: for every position in that window backed by a `'+'` line, if `origIndex` is not `-1` and
  `owner[origIndex]` is unset, set it to this Decision.
- Reverse-splice: replace the window with the hunk's `' '` and `'-'` lines. Context lines carry
  their `origIndex` through; restored `'-'` lines get `origIndex = -1`.
- `\ No newline at end of file` markers are skipped, not treated as content.

A `write` row has `patch IS NULL` and is handled by §3.

Claim-once ordering is what makes this correct: because the walk runs newest first, the *last*
Decision to write a line is the one that claims it, and every earlier writer of that same line
finds it already owned. Lines that no recorded touch accounts for stay unowned, which is the
honest answer for content that arrived by a route the Store never witnessed.

Cost: one pass per path, linear in that path's touch count times hunk size. The ticket's own
worst case (200 Decisions on `a.ts`) is a few hundred array splices.

**Output shape.** Ordered newest first, one entry per Decision that ever touched the path,
including Decisions with nothing left:

```ts
type AttributedDecision = {
    decisionId: string;
    ranges: Array<[start: number, end: number]>; // 1-based inclusive, CURRENT file coordinates
    survivingLines: number;                      // 0 for a fully superseded Decision
    writtenLines: number;                        // '+' lines this Decision contributed to this path
    attributable: boolean;                       // false once the walk has passed a Break
};

type Attribution = {
    path: string;
    anchor: "worktree" | "absent";
    attributedThrough: string | null; // oldest decision id the walk reached cleanly
    brokeAt: string | null;           // decision id where the walk stopped; null if clean
    decisions: AttributedDecision[];
};
```

Two entry points, both in `packages/decision-graph/src/attribution.ts`:

- `attributePath(path): Attribution`
- `ownerOfLine(path, line): AttributedDecision | null` — a lookup into the same `owner[]`, for
  the stack-trace case (a thrown error names a file and a line; this names the Decision that
  wrote it and, via `decision_why`, why).

`anchor: "absent"` means the file is not on disk. Every Decision that touched it comes back with
`survivingLines: 0`. That is the correct answer, not a failure.

### 3. `touched.old_text`: the write pre-image

The problem, in the terms the ticket poses it: naively a `write` supersedes every prior Decision
on that file. That is *correct* (the bytes really were all replaced) and *catastrophic* (the file
collapses to a single owner, and everything older becomes unattributable). Ticket 04 filed the
second half as accepted hole 1 and named a `tool_call` subscriber as an upgrade path it declined.
This ticket takes the upgrade, because Attribution is the first consumer that actually needs it.

**Verified safe.** `tool_execution_start` carries `toolName` and `args`
(`coding-agent/src/core/extensions/types.ts:762-767`), is exposed to extensions (`:1236`), and is
awaited: `agent-session.ts:788` awaits `this._extensionRunner.emit(...)`, and the loop awaits the
sink at `agent-loop.ts:446` and `:501` *before* `prepareToolCall` and therefore before the write
executes. A handler that reads the target file finishes before the file changes. No race.

**The rule.** On `tool_execution_start` where `toolName === "write"`, read the resolved target
path and hold the content in a `Map<toolCallId, string>` until `turn_end`, which drains and
clears it unconditionally (the map only ever spans one turn, so an aborted or unpaired call
cannot leak). `ToolExecutionStartEvent.args` is `any` (`types.ts:766`) and `AGENTS.md` forbids
`any`, so Capture narrows the same way ticket 04 narrowed `AgentMessage`: check
`typeof args?.path === "string"` and ignore anything else.

```sql
-- touched gains one column (pre-build, no migration owed)
old_text TEXT   -- write only. '' = target did not exist. NULL = no snapshot taken.
```

Three states, and the empty string is load-bearing:

| `old_text` | meaning | effect on Attribution |
|---|---|---|
| `''` | target did not exist (ENOENT) | the write is the file's origin. Not a Break: there is no history to lose. |
| non-empty | real pre-image | Assembly diffs `canon(old_text)` against `canon(new_text)` and the write reverses like any other hunk set. |
| `NULL` | read failed, or the row predates this rule | the write claims every line and is a Break going backward. |

The middle row is the payoff and it is worth stating plainly, because it is not what ticket 04's
hole implied: **with a pre-image, a whole-file rewrite no longer flattens ownership.** Only the
lines it actually changed transfer to it; unchanged lines keep their older owners. The
"catastrophic" reading of a `write` was an artifact of missing evidence, not of the semantics.

Assembly, not Capture, computes that diff. Capture stores the witnessed pre-image and stops,
preserving `CONTEXT.md`'s "Capture never resolves identity, never infers a relation". It also
costs nothing on the turn path and lets the diff improve without recapture.

**Cost, measured where possible.** Across 16 local transcripts of this repo: 22 `Edit`/`MultiEdit`
calls, 3 `Write` calls, all 3 creating new files, 0 overwrites. Pi tells the model the same thing
(`write.ts:22`: "Use write only for new files or complete rewrites"), and `edit` cannot create a
file at all (`edit.ts:331` throws when `ops.access` fails). Two honest caveats: those transcripts
are a different harness, and they are mostly spec-writing sessions rather than heavy coding, so
this is a direction, not a rate. Under it, the common case costs one failed `access`/`readFile`
per `write` and stores nothing; the rare case roughly doubles that row's storage against ticket
04's measured 3 MB per 1000 Decisions.

### 4. Canonical form

All three sources are canonicalised identically before any comparison:

```ts
const canon = (s: string): string =>
    (s.startsWith("\uFEFF") ? s.slice(1) : s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
```

This reproduces `stripBom` (`edit-diff.ts:247-249`) followed by `normalizeToLF` (`:18-20`)
exactly. Both are exported from `edit-diff.ts` but *not* re-exported from the package entry
(`coding-agent/src/index.ts:274` exports only `generateDiffString`, `generateUnifiedPatch`,
`EditDiffResult`). Re-implementing one line beats either a deep import into another package's
internals or an upstream edit to widen the public API for two trivial normalizers. Zero conflict
surface, consistent with ticket 04's reason for copying the migration pattern rather than
importing it.

Comparison is **line-based and verbatim** inside that space. No whitespace folding, no
formatting-insensitive comparator. Two reasons. Verbatim is what makes hunk verification exact,
which is the whole basis of Break detection; and the `npm run format` scenario the ticket worries
about does not arise on the recorded path, because formatters run through `bash` and produce no
`touched` row at all (ticket 01, hole 1). They are invisible, not falsely superseding. A
reindent-only `edit` does transfer ownership, and that is honest: that Decision did write those
bytes. Tuning knob if real stores show reindents distorting Attribution: `jsdiff` accepts a
`compareLine` callback, so it is a one-argument change, not a redesign. Do not add it
speculatively.

### 5. Renames

Attribution crosses `renamed_to`. When a path's touch list is exhausted and Assembly holds a
`renamed_to` edge into it, the walk continues under the previous path with `lines`/`origIndex`
untouched, since a rename changes the path and not the bytes.

`renamed_to` does not exist yet: ticket 01 put it in Assembly with the precedence git history →
witnessed evidence → no edge, and ticket 04 moved its inputs into `tool_invocation.arguments`.
Nothing has been built. So the rule is stated and inert. Until the edge exists the walk stops at
the rename, which costs history and never fabricates it, exactly as ticket 01's "neither → no
edge, graph still valid" already prescribed. The failure mode of a *wrong* `renamed_to` is worse
than a missing one (it grafts one file's history onto another), which is a second reason not to
manufacture the edge from a heuristic here.

### 6. Breaks, and the unwitnessed-mutation hole

Two detectors, both free:

1. **Edit**: a hunk whose `' '`/`'+'` lines do not match the reconstructed state.
2. **Write with a pre-image**: same, via its derived hunks. A write with `old_text` non-empty also
   admits a stronger check than any edit does, because `new_text` is a full post-image: the
   reconstructed state at that moment must equal `canon(new_text)` in its entirety, not merely
   locally around a hunk.

Everything older than a Break is reported with `attributable: false`. It is not reported as dead
and not reported as live.

**Ruling on the ticket's "Watch for" question: tolerable, and it does not force ticket 01's hole
open.** The framing in the question ("its stale rationale stays live forever") does not survive
the change of primitive. Under Attribution anchored at the working tree, a line rewritten by
`sed -i` no longer matches what any Decision recorded writing, so no Decision claims it and it
comes back unowned. Stale rationale cannot be reported as live, because the bytes it wrote are
gone. The residual damage is narrower: an unwitnessed change landing *inside* a region a recorded
hunk covers breaks the chain, and history older than that point becomes unattributable. The
failure mode is "the walk stops and says so", not "the graph confidently reports stale rationale".

This subsumes ticket 08's accepted hole 1 (`git switch`, `checkout`, `stash`, `reset` rewrite the
tree with no `touched` row) under the same mechanism: a tree rewind is just a large unwitnessed
mutation, detected where it intersects recorded hunks and left unowned where it does not.

Promoting bash-driven mutations to real `touched` edges stays rejected for now, and the map's
open item is re-scoped: it is a **post-implementation** goal, not a spec-time one. Parsing shell
strings for file mutations is the same class of heuristic ticket 04 refused for rename detection,
and there is no measurement yet to justify it. Tripwire: revisit once real stores show how often
`brokeAt` is non-null.

### 7. What ticket 09 receives

Ticket 09's dependency on this ticket is satisfied by §2's two entry points, and by four
deliberate refusals:

- **Ranges, not counts.** The consuming design this ticket was grilled against is: an agent in a
  fresh session, or one that just hit an error, asks how a region of the project came to be, gets
  a temporally ordered set of Decisions with their WHY, and joins that against an AST graph
  (graphify) to land on the exact declarations involved, instead of reading whole files to
  reconstruct intent. That join needs *current-file* line ranges. A surviving-line count ranks
  Decisions and cannot point at a function. Attribution already computes the owner of every line,
  so returning ranges costs nothing. (graphify is external: `.gitignore:46-47` ignores
  `graphify-out/`, and no such directory exists in the tree. The interface designed to here is
  path plus line range, not graphify's format.)
- **Stop at ranges; do not resolve symbols.** Ranges are exact, need no parser, and mean
  something in Markdown and JSON where "symbol" does not. Resolving them would make this ticket
  depend on ticket 12, which does not exist yet, and duplicate what an AST graph does better.
- **Include fully superseded Decisions**, annotated with `survivingLines: 0`. Filtering is a
  windowing choice and ticket 09 owns windowing. If this ticket filtered, 09 would lose the
  option and ticket 11 could never measure whether abandoned attempts help or hurt. "How this
  code came to be" is a history, and a Decision that tried something and was overwritten is part
  of it.
- **Return ids and structure, not WHY text.** The `decision_why` view (ticket 04) already encodes
  the rung rule, so joining is one line. Returning full text would silently make 09's
  token-budget decision for it.

### 8. Not stored

**Attribution is a function. No table, no SQL view.** Its answer is a function of the working
tree, so any materialised copy is stale the moment a file changes, and it would need an
invalidation story that buys nothing at these sizes. Ticket 10's viewer computes it once at
export time; ticket 09 computes it per path it cares about.

This also avoids a collision with ticket 07's append-only ruling, and clarifies what that ruling
governs. `CONTEXT.md` gains one line making the split explicit: **Capture's tables are
append-only; Assembly's output is a cache that may be discarded and recomputed.** Ticket 07's
"every table is insert-only" was written about witnessed facts, and stays true of every table in
the schema. `touched.symbol` (ticket 12) remains the one Assembly-written column, and being
recomputable is precisely why overwriting it is not a mutation of the record.

Tripwire, matching ticket 04's stance on indexes: materialise only when Attribution on a real
file is *measured* slow, never when one is imagined slow.

### 9. Vocabulary

`CONTEXT.md`'s existing **Supersession** entry defines the pairwise, position-blind rule this
resolution rejects, so it is rewritten rather than extended. Three terms are added. All four
changes are in `packages/decision-graph/CONTEXT.md`, and **Assembly** is amended to name the
working tree as its second input.

### Accepted holes

1. **A `write` with `old_text IS NULL` is still a wall.** Only reachable for rows captured before
   this rule, or when the pre-image read itself fails. The ENOENT case is not this hole: it is
   recorded as `''` and correctly means the file had no history.
2. **Unwitnessed mutations outside any recorded hunk are undetectable** (§6). They are also
   harmless to correctness: the lines they wrote stay unowned. Only mutations intersecting a
   recorded hunk break the chain, and those are reported.
3. **Attribution depends on mutable external state.** Two runs across a `git switch` legitimately
   disagree. Deterministic given both inputs, not given the Store alone.
4. **Renames are inert until `renamed_to` exists** (§5). Inherited from ticket 01, not new.
5. **Fuzzy-matched spans are compared in folded form.** Inside a region that matched fuzzily, the
   patch's `-` lines carry `normalizeForFuzzyMatch` output rather than original bytes
   (`edit-diff.ts:33`, finding 1.2). Verification against the reconstructed state can therefore
   mismatch on a span the model reached fuzzily, producing a false Break. Bounded to fuzzy edits
   only, and reported honestly as a Break rather than as wrong attribution. `jsdiff`'s
   `compareLine` is the upgrade path if this is ever observed; do not build it first.
6. **Cross-process interleaving (ticket 08, hole 2) can order two touches wrongly**, which
   manifests as a Break rather than as silent misattribution. Inherited, and now detected.

### Consequences for other tickets

- **04 (schema)** — one delta, pre-build, no migration owed: `touched` gains `old_text TEXT`.
  Accepted hole 1 (supersession blind across `write`) is **closed** for the snapshot case and
  narrowed to hole 1 above. The characterisation of `edit`'s fuzzy matching is corrected per
  finding 1.2.
- **03 (capture point)** — subscription list amended a second time (ticket 06 added
  `message_end`): Capture also subscribes `tool_execution_start`, and holds one
  `Map<toolCallId, string>` drained at `turn_end`. This is the per-call state ticket 04 declined
  when nothing required it. It does not reopen the fork-core question: the event is already
  exposed to extensions and already awaited.
- **05 (redaction)** — the surface grows from six columns to seven. `touched.old_text` is a
  whole-file pre-image and is exactly as sensitive as `touched.new_text`, which 05 already
  covers. No new layer, no new policy; add the column to the existing list.
- **07 (edges)** — its constraint is honoured and sharpened: `supersedes` is not merely
  non-mutating, it is not a row at all. "Append-only" is scoped to Capture's tables, with
  Assembly's output declared a discardable cache (§8).
- **08 (lifecycle)** — accepted hole 1 (`git switch` and friends) is now detected rather than
  silent (§6). Its tripwire for `sitting.head_sha` is not triggered: Attribution anchors on file
  content, not on git ancestry, so no git column is needed.
- **09 (consumption)** — receives §7. Its own file is updated with the consuming design this
  ticket was grilled against, so the next session inherits it. Two properties it must preserve:
  ticket 08's rule that "no store" and "empty store" are indistinguishable extends to
  `anchor: "absent"` and to a non-null `brokeAt`; and windowing, filtering and token budget are
  entirely its own, because this ticket deliberately returns everything.
- **10 (viewer)** — can render a File as a partition of its current lines by owning Decision,
  which is a stronger view than the "every Decision that ever touched this file" list ticket 01
  described. Breaks are drawable: a Break is where the spine of a File's history stops being
  reconstructible.
- **11 (metrics)** — gains a measurable that needs no instrumentation: the rate of non-null
  `brokeAt` across real stores is the empirical answer to whether ticket 01's bash-mutation hole
  is worth closing.
- **12 (symbol resolver)** — **its job narrows.** For navigation the stored label is redundant:
  the consuming path resolves a *current* symbol to *current* lines to Decisions via §2, needing
  no label at all. What the edit-time label is still needed for is Decisions with
  `survivingLines: 0`, which own no current line and therefore map to no current symbol. The
  label is the only way to say what an abandoned attempt was about. So 12 is now scoped to
  history and the viewer rather than to the consumption path, which also answers its own "does it
  earn its place before ticket 11" question: after, not before.
- **13 (this)** — when the build starts, one runnable check ships with `attribution.ts`: apply a
  sequence of real `edit` patches to a fixture, assert Attribution recovers the writer of each
  line, then mutate the fixture out-of-band and assert `brokeAt` is set. No framework beyond the
  vitest already in the workspace.

### What this touches

Spec-only, like 01–08. Nothing in Pi is modified and no upstream conflict surface is added; the
only upstream *reads* are `tool_execution_start` (already public to extensions) and the `diff`
package (already a direct dependency at `coding-agent/package.json:54`, new only as a declared
dependency of `packages/decision-graph`). `canon` is re-implemented rather than imported, so the
public API of `coding-agent/src/index.ts` is untouched.

When the build starts: `packages/decision-graph/src/attribution.ts` (new), the `old_text` column
and the `tool_execution_start` handler in `packages/decision-graph/src/store.ts` and its capture
entry point. `packages/decision-graph/CONTEXT.md` is updated by this ticket.
