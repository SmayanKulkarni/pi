# Map: Temporal Decision Graph for Pi

Label: `wayfinder:map`

## Destination

A working feature in this Pi fork: the agent's decisions are captured to a project-local
SQLite store during normal execution (no extra model calls, no extra tokens), assembled
deterministically into a temporally traversable graph, rendered in a standalone
self-contained HTML viewer, and shown to measurably help or not help downstream task
performance when the graph is fed back to the agent, benchmarked via `packages/evals`
against OpenRouter-served models.

The map is done when nothing remains to decide before building it.

## Status: specced and broken into build tickets. Build not started.

The build spec synthesising all 13 research tickets is [14 — Build spec](issues/14-build-spec.md),
labelled `ready-for-agent`. It carries one addition the tickets did not: both existing test
harnesses build an in-memory Session manager, whose Session file is undefined — which is
Capture's own gate 2 — so capture is inert under every harness in the repo today. The spec
resolves that with a small Session harness owned by `packages/decision-graph`, keeping the
upstream edit count at one eval-only file.

That spec is now six tracer-bullet build tickets, one per module, in dependency order:

- [15 — Store](issues/15-store.md) — schema, migrations, write path, redaction, derived views.
  No blockers.
- [16 — Capture](issues/16-capture.md) — the extension entry point, plus the new Session test
  harness. Blocked by 15.
- [17 — Attribution](issues/17-attribution.md) — the reverse-replay walk and Symbol Label scan.
  Blocked by 15 only — it's a pure function over fixtures, not a live Capture, so it can build in
  parallel with 16.
- [18 — Consultation](issues/18-consultation.md) — `query_decisions` and the compaction Nudge.
  Blocked by 16, 17.
- [19 — Viewer](issues/19-viewer.md) — replaces the fabricated-data prototype. Blocked by 16, 17.
- [20 — Evals](issues/20-evals.md) — the three experiments and the one upstream edit. Blocked by
  16, 17, 18.

Nothing on the critical path remains to decide. The remaining items under "Not yet specified" are
all post-implementation, each with a stated tripwire, and none blocks a first build.

**What the whole map costs upstream, totalled:** one file, `packages/evals/src/pi-harness.ts`,
about ten lines, owned by ticket 11. Ticket 03's pre-authorized fork-core edit was released unused
by ticket 09. Everything else is new files in `packages/decision-graph/`, which cannot conflict on
rebase.

**Build order, derived from what each piece needs rather than from ticket numbers:**

1. `store.ts` — DDL from 04, corrected by 08 (`sitting`, `leaf_entry_id`, `CONFIG_DIR_NAME`),
   09 §9 (canonical `touched.path`), 13 §3 (`touched.old_text`) and 12 §4 (no `touched.symbol`).
   Migration pattern copied from `session-backends/sqlite-node`, SQL inlined in TS.
2. `extension.ts` — Capture. Subscribes `turn_end`, `message_end` (06), `tool_execution_start` (13),
   session lifecycle and compaction. Three gates from 08 §1, one-strike disable from 08 §6,
   redaction from 05 applied to seven columns.
3. `attribution.ts` — 13's reverse-replay walk, plus 12's label scan inside it, plus 10's
   owner-as-of-k upper bound. This is the piece everything downstream reads.
4. `query-tool.ts` — 09's `query_decisions`, its renderer, its context-proportional budget, and the
   `session_compact` Nudge.
5. Viewer — 10's decisions, replacing `prototype/viewer-prototype.html`, which is then deleted.
6. `packages/evals` — 11's three experiments, the fixture builder, twelve tasks, three judges, and
   the one upstream edit.

Ticket 07's edges are read-time views over columns shipped in step 1, so they never get a step of
their own. Steps 1 to 4 are the feature; 5 and 6 are what make it inspectable and falsifiable.

## Notes

Domain: the Pi agent harness monorepo (this repo, a fork of `earendil-works/pi`).

Standing constraints for this effort:

- **Zero subagents.** Research tickets are worked inline in their own session, not dispatched.
- Long-horizon effort. One ticket per session. Do not batch.
- Nothing in Pi may break. Every ticket must state what it touches and what upstream
  rebase cost it incurs.
- Skills to consult: `mattpocock-skills:grill-with-docs`, `mattpocock-skills:domain-modeling`,
  `mattpocock-skills:prototype`, `mattpocock-skills:research`, `ponytail` (laziest thing
  that works), `superpowers:test-driven-development` for anything built.
- Each ticket carries a `Skill:` field — the resolving session should invoke that skill
  directly instead of re-deciding per ticket.
- Repo rules in `AGENTS.md` are binding: no `any`, erasable TS syntax only, `npm run check`
  after code changes, tests via `./test.sh`, never commit unless asked.

### Settled at charting (not tickets — inputs)

- **Destination shape**: working feature in this fork, not a spec handoff.
- **Record source**: in-execution capture only. No second model, no agent-authored
  `log_decision` tool. Feasibility confirmed against `packages/agent/src/agent-loop.ts` —
  `message_end` (`:357`) carries thinking + text + toolCalls, `tool_execution_end` (`:767`)
  carries args/result/isError, `turn_end` (`:224`) pairs them. WHY is already generated
  and already paid for.
- **Edge typing**: deterministic edges only. No live heuristic classifier, no semantic
  labelling at capture time. Semantic typing is deferred, not designed in.
- **Storage**: SQLite, project-local.
- **Viewer**: standalone self-contained HTML with temporal scrubbing.
- **Metrics axis**: downstream task benefit via `packages/evals`.
- **Preferred hook site**: user chose fork-core. Flagged: capture alone needs no core edit;
  fork-core is only justified if compaction/context interception is required. Resolved by
  ticket 03 for capture, and **closed entirely by ticket 09** — the consumption path,
  including the compaction interaction, is fully served by the documented extension surface,
  so 03's pre-authorized core edit was released unused. No ticket on this map modifies a Pi
  source file except ticket 11's ~10 lines in `packages/evals/src/pi-harness.ts`.

### Known risks carried into the map

1. ~~Reasoning availability is provider-dependent~~ — **confirmed and quantified by ticket 02.**
   Ceiling is a summary, never raw CoT. Ladder is designed; `why_source` is a required schema
   column (ticket 04). Residual risk moved to ticket 11: the eval harness pins thinking `"off"`.
2. ~~Secrets leak through thinking text and tool args into the store~~ — **resolved by ticket
   05.** Surface enumerated by ticket 04 (six columns, not "the whole record") is redacted at
   capture via three layers (path-driven, known-env-value, pattern-based). Residual risk is
   explicit and permanent, not deferred: a shapeless secret with no path signal defeats all
   three layers, so the store clears a defense-in-depth bar, not a safe-for-third-party one.
3. ~~Ordering under parallel tool calls, steering injection, retries, aborts~~ — **resolved by
   ticket 06.** Parallel-call ordering was already correct by construction (`Promise.all`
   preserves call order regardless of completion order, and Capture never sees the raw
   interleaved events); the real fix was sourcing `tool_invocation` from the model's own
   `toolCalls` array instead of `toolResults`, which also closes an abort-tail gap where
   trailing unexecuted calls vanished entirely. Retries/aborts were already first-class
   Decisions via `stop_reason`, captured before `agent-session.ts` pops the failed message for
   retry. `run_id`/`turn_index` boundaries are confirmed more frequent and less meaningful than
   assumed — declared diagnostic-only, never used for ordering or grouping. Steering messages
   get a capture-time rule (an in-Run boolean, not position-inference from the session file),
   amending ticket 03's subscription list to add `message_end`. One accepted hole: a steer that
   races past a Run boundary replays identically to a fresh prompt and is undetectable without
   a fork-core edit.
4. ~~Compaction is a consumption risk~~ — **resolved by ticket 09.** It was never a capture
   risk (capture is event-driven and appends at emit time, so compaction shrinks context and
   never the log). As a consumption risk it is answered by a *Nudge*: on `session_compact`,
   one message naming the paths the discarded span had Decisions about, capped at 40, with no
   rationale. Replacing Pi's compaction summary was available (`SessionBeforeCompactResult`)
   and rejected as a quality bar the feature cannot meet. Doing nothing was rejected on one
   point: after a compaction the agent does not know it forgot, so a pull-only tool is not a
   recovery path. This is the design's only push; everything else is pulled on demand.

## Decisions so far

<!-- one line per resolved ticket: gist + link -->

- [01 — What are graph nodes anchored to?](issues/01-graph-anchor.md) — Files + decisions are
  both nodes; symbols are not. Decision = one per assistant message (1:1 with `turn_end`),
  keyed `uuidv7` + `content_hash UNIQUE` for replay-safe dedupe, independent of turn numbering.
  File = repo-relative path; capture never resolves identity, only leaves rename evidence, and
  assembly decides via git → evidence → no edge. `touched` edges come from `edit`/`write` only
  and carry the applied `oldText`/`newText`, which is what makes deterministic supersession
  possible. Sub-file locality is a nullable derived label, backfillable, never a node.
- [02 — What reasoning do providers actually give us?](issues/02-reasoning-availability.md) — No
  provider returns raw CoT; a provider-generated *summary* is the ceiling, and it is not guaranteed
  on any turn. Five-rung degradation ladder (raw → summary → opaque → text-only → none), with a
  `why_source` enum stamped per decision at capture. Text is a first-class WHY source, not a
  fallback. `thinkingSignature` is explicitly **not** WHY and should not be persisted. Two live
  problems found: Pi's forced `display: "summarized"` (`anthropic-messages.ts:1032`) is the only
  thing keeping Claude 5-era thinking non-empty, and `packages/evals` hardcodes
  `thinkingLevel: "off"` — the benchmark axis currently generates zero reasoning.
- [03 — Where exactly does capture tap in?](issues/03-capture-point.md) — **Fork-core dropped for
  capture.** Gap list is empty: `turn_end` (`extensions/types.ts:735`) carries thinking, text, tool
  calls *with args* and paired results in one payload; compaction, resume and context transforms all
  have events; no sub-agents exist in this repo. Capture is a new workspace package
  `packages/decision-graph/` loaded as a pi extension — inside `tsconfig`/vitest, zero conflict
  surface. Subscribes `turn_end` + session lifecycle + compaction. Synchronous `node:sqlite`
  `DatabaseSync` insert per turn (stdlib, no new dep, crash-safe, ordering by construction). Store at
  `<cwd>/.pi/decision-graph.db`. Handler throws are caught by the runner (`runner.ts:819`), so a
  broken capture structurally cannot break a session. One upstream edit named but deferred to ticket
  11: `packages/evals/src/pi-harness.ts:166` asserts zero extensions, making the benchmark axis
  blind to capture. ~~Core edit stays pre-authorized for ticket 09 only.~~ **Released unused by
  ticket 09** — consumption and the compaction interaction are both fully served by the public
  extension surface, so no ticket on this map forks core.
- [04 — Decision record schema and SQLite design](issues/04-record-schema.md) — A Decision is
  one assistant message; six tables split strictly into *Capture writes* vs *Assembly derives*.
  Ubiquitous language now lives in `packages/decision-graph/CONTEXT.md`. Two upstream findings
  broke ticket 01's plan: `edit` **fuzzy-matches** (`edit-diff.ts:317-319`), so the model's
  `oldText` can name text that never existed — the `touched` edge therefore stores the tool's
  own applied `details.patch` (`edit.ts:118-122`, survives to the extension via
  `agent-loop.ts:785`); and `write` **never reads the file it overwrites** (`write.ts:30-34`),
  so supersession across a `write` is blind — a new accepted hole. Also found: `turn_index`
  resets per *Run*, not per Session (`agent-session.ts:729`), so it was already ambiguous
  today, not merely renumberable later; the schema ships a `run_id` minted at `agent_start`.
  `rename_evidence` dropped from Capture and moved to Assembly — every input is already in the
  raw tool rows, and a heuristic in Capture would be permanently wrong. Migration pattern copied
  (not imported) from the sqlite-node backend; `coding-agent/src/migrations.ts` is file moves,
  not SQL. Size measured rather than guessed against 289 real assistant messages: median 1.8 KB
  per Decision, ~3 MB per 1000 — so store verbatim, no truncation, no size knob.
- [05 — Secret redaction policy for captured records](issues/05-redaction.md) — Pi has no
  reusable redaction path (`telemetry.ts` is unrelated; the only `redacted` field is a provider
  safety-filter flag). Redact at capture, into the same six columns ticket 04 named, no
  migration. Three layers: unconditional dotenv/credential-path redaction, known-env-value
  literal match, vendor-token/generic pattern match — placeholders name the category
  (`[REDACTED:env:X]`) rather than going opaque, since the bar is explicitly defense-in-depth
  against casual exposure, not a third-party-safe guarantee (grilled and downgraded from the
  stronger bar — no pattern layer can promise zero false negatives against a shapeless secret).
  Redaction failures fail closed on the column, not the row. `.gitignore` is not self-written
  (judged an overreach on a project the extension doesn't own); instead one warning fires at
  store creation if the db path isn't already ignored. No new trust gate — ticket 03's existing
  extension-trust gate already makes capture, and this whole secrets surface, inert on repos the
  agent doesn't own.
- [06 — Turn identity and ordering under the loop's messy paths](issues/06-turn-identity-ordering.md)
  — Decision identity stays `decision.id` alone; `run_id`/`turn_index` confirmed to reset on
  *every* re-entry into the loop (not just retries) and declared diagnostic-only, never used for
  ordering. Parallel tool-call ordering was already deterministic where Capture taps in
  (`turn_end.toolResults`, via `Promise.all`'s order-preserving semantics) — the actual fix is
  sourcing `tool_invocation` rows from the model's `toolCalls` array rather than `toolResults`,
  which also closes a gap where an abort mid-batch silently dropped trailing unexecuted calls.
  Retries/aborts are already first-class Decisions (`stop_reason`), captured before context
  surgery removes the failed message. Steering messages get a precise capture-time rule (an
  in-Run "has a turn fired yet" boolean, amending ticket 03 to also subscribe to `message_end`)
  instead of position-inference from the session file, feeding ticket 07's `redirected-by` edge
  a raw `(session_id, ts)` pointer with no text duplication. One accepted hole: a steer that
  races past a Run boundary is event-identical to a fresh prompt and stays undetectable short of
  a fork-core edit. Also hands ticket 13 a new free signal (redirect boundary) for its
  segmentation table, without deciding how 13 should use it.
- [07 — The deterministic edge set](issues/07-deterministic-edges.md) — One new table
  (`steer`, Capture-written), zero new edge tables. `follows`, `caused-by-error`, `retry-of`,
  `redirected-by`'s pairing, and `resumed-from` are all read-time views over columns already
  shipped; `same-turn` is rejected as nonexistent under the 1:1 Decision:Turn model, and
  `co-touched` is rejected as a stored pairwise edge — it's already the bipartite
  `decision→touched→file` structure, materializing pairs would be quadratic on a hot file for
  zero new information. `caused-by-error`/`retry-of` are narrowed to exclude Decisions that are
  also `redirected-by` a Steer: witnessed human redirection outranks inferred error-adjacency.
  Settles the append-only question directly: every table is insert-only, Decisions are already
  immutable (ticket 01), so supersession (ticket 13's job, not designed here) is constrained to
  be an additive edge/view, never a mutation of the Decision or `touched` row it concerns.

- [08 — Lifecycle: init, sessions, branches, resume](issues/08-lifecycle-identity.md) — No init
  step; the Store is created by the *first Decision*, not at session start, behind three gates
  (project trust, `getSessionFile() !== undefined` so `--no-session` captures nothing, and a
  not-already-disabled flag). Path corrected to `join(cwd, CONFIG_DIR_NAME, …)` — this is a fork,
  and `.pi` is configurable (`config.ts:491`). One store per cwd, spanning every branch; worktrees
  get separate stores by construction; no git columns at all (rung-1 skip, tripwire named).
  Two corrections to earlier tickets: **`/resume` is not a Session boundary** — it reuses the
  Session id (`session-manager.ts:915`) — so 07's `Resumed-from` is renamed **Forked-from**, and
  `parent_session_id` becomes `parent_session_file` because `SessionHeader.parentSession` is a
  *path*. The boundary that does exist is the **Sitting** (one new insert-only table), which also
  hands ticket 13 a better segmentation signal than "session boundary". The unanticipated finding:
  **Pi's own session tree, not git, is the branching risk** — `/tree` branches inside one Session
  id, so 07's `follows` would assert successions that never happened. Fixed by one witnessed
  column, `decision.leaf_entry_id` (`getLeafId()` at `turn_end`, ordering verified against
  `agent-session.ts:634/656` and `agent-loop.ts:214-224`), with tree-walking left to Assembly and
  timestamp order as the fallback. Store failure is one-strike: log once, disable for the process,
  never auto-repair or auto-delete.

- [13 — Temporal relevance: which decisions still explain this file?](issues/13-temporal-relevance.md)
  — the ticket's own pairwise overlap rule is **rejected as position-blind** and replaced by
  per-line **Attribution**: reverse-replay `touched.patch` from the working-tree file backwards
  through the Store, claiming each line for the last Decision that wrote it. `git blame` over
  Decisions instead of commits. Supersession becomes the *absence* of Standing, partial by
  default. It is a function (`attributePath`, `ownerOfLine`), not a table and not a view — its
  answer depends on the working tree, so anything stored is stale on the next edit; this also
  scopes ticket 07's append-only rule to Capture's tables and declares Assembly output a
  discardable cache. The enabling upstream fact: **Pi's own suite asserts
  `applyPatch(original, details.patch) === final`** (`coding-agent/test/tools.test.ts:283`,
  `:1081`, `:1117`), including for fuzzy edits, so replay is arithmetic rather than heuristic —
  and ticket 04's account of fuzzy matching was pessimistic (`baseContent` is the true original,
  `edit-diff.ts:353`, and untouched lines keep original bytes, `:358`). **Ticket 04's accepted
  hole 1 is closed**: `tool_execution_start` is awaited before the tool runs
  (`agent-loop.ts:446`/`:501`, `agent-session.ts:788`), so Capture snapshots a `write`'s
  pre-image into a new `touched.old_text` — with it, a whole-file rewrite no longer flattens
  ownership, it claims only the lines it changed (`''` = file did not exist, `NULL` = no
  snapshot, still a wall). Unwitnessed mutation (`sed -i`, `git switch`) stops being silent:
  rewritten lines match nothing and come back unowned, and a mutation inside a recorded hunk
  surfaces as a `brokeAt` Break rather than as confidently stale rationale. Output for ticket 09
  is **current-file line ranges** (the join to an AST graph such as graphify), every Decision
  including fully superseded ones, ids not WHY text, and no symbol resolution. Four terms added
  to `CONTEXT.md` (Attribution, Standing, Break, Supersession rewritten) and **Assembly** amended
  to name the working tree as its second input.

- [09 — How does the graph get back into the agent?](issues/09-consumption-path.md) — One
  extension-registered tool, `query_decisions(path, line?)`, pulled on demand; the only push in the
  whole design is a paths-only Nudge after a compaction. **Ticket 03's pre-authorized fork-core edit
  is released unused** — every route the ticket asked about (tool, system prompt, per-Run message,
  per-call context transform, owning the compaction) is public extension surface. The decider was
  not token count but **prompt caching**: Pi marks its breakpoints on the system prompt
  (`anthropic-messages.ts:997`), the last tool definition (`:1321`) and the last user block
  (`:1256-1277`), so a per-Run system-prompt injection re-reads the whole conversation at write
  price every Run, while a tool folded into the base prompt once
  (`_rebuildSystemPrompt`, `agent-session.ts:1023-1056`) leaves the prefix byte-identical for the
  session. Budget is proportional to *remaining* context (`ctx.getContextUsage()`), capped at ~50k
  tokens and degrading to header-plus-counts under pressure, rather than a constant — and Pi's own
  token estimate is literally `chars / 4` (`compaction.ts:266-274`), so a character budget is Pi's
  token model, not an approximation of it. Repo size is irrelevant to one answer: the scaling
  variable is one path's touch count, and ticket 13's 200-Decision worst case fits inside the cap
  with room to spare. Ordering is one sort (attributable, then standing, then newest) filled to
  budget, not a drop cascade, because a cascade empties the answer for an absent file where every
  Decision is at zero standing. **Ticket 13's "never warn in the agent's context" is narrowed**: a
  Break and an absent file are reported as facts on a result the agent asked for, under a phrasing
  rule that forbids instructions; ticket 08's indistinguishability rule is met more strongly instead,
  by not registering the tool at all when the Store has no Decisions. Ticket 08's gate 2
  (`--no-session`) is ruled a write gate that does not bind a read. The unanticipated finding, which
  breaks a rule ticket 04 and `CONTEXT.md` both stated: **`touched.path` "verbatim from tool args"
  is not a File identity** — `edit`/`write` resolve the path for the filesystem
  (`edit.ts:316`, `write.ts:208`) but record the model's raw string (`edit.ts:357`, `write.ts:229`),
  so one file splits into four identities and a lookup misses most of its own history, and ticket
  13's `join(cwd, path)` is wrong for an absolute one. Fixed pre-build by storing the cwd-relative
  resolved path, which also makes the schema agree with `CONTEXT.md`'s existing wording. Two terms
  added (Consultation, Nudge) and three amended (File, Break, Compaction Boundary).

- [10 — Viewer: temporal scrubbing UX](issues/10-viewer.md) — The primary view is a **File
  partitioned by owning Decision**, not a Decision timeline with code hanging off it, so ticket 01's
  imagined shape is inverted: the File is the subject, the Decision list is the index. Time is a
  scrubber that **re-derives** ownership at each stop rather than filtering to `t <= now`, because the
  interesting fact is who owned each line then, not which Decisions existed then — that difference is
  what makes Supersession visible as a Decision's colour shrinking. Costs ticket 13 one parameter
  (`attribution.ts` takes an optional upper bound so owner-as-of-k is the same walk, not a
  reimplementation). The ten-second question is "why is this line here", answered on hover via
  `ownerOfLine`, which is the same entry point ticket 09's stack-trace case uses, so the human and
  agent surfaces read one primitive. Click isolates a Decision inline; drill-down rejected because it
  replaces the partition that gives one Decision meaning. Diffs are omitted on purpose: line ranges
  are the better representation of `touched.patch`. The prototype's own finding: **unowned lines are
  mostly blank lines**, because formatters run through `bash`, and seeing them render flat and
  colourless argues ticket 01's unwitnessed-mutation hole better than prose does. Legibility is proven
  at 14 Decisions and honestly not at 500 — colour is the binding constraint at ~20 owners per file,
  with recency-band colouring designed and deliberately unbuilt, and the density strip named as the
  navigation control the real viewer grows into. Two things pushed out of scope and stated: cross-file
  navigation, and ticket 08 §7's session-tree requirement, which needs its own view.
  Artifact: `packages/decision-graph/prototype/viewer-prototype.html` (self-contained, fabricated
  data, no dependency, deleted when the real viewer lands).

- [11 — Metrics and eval design](issues/11-metrics-eval.md) — One experiment split into three, because
  they have different prerequisites and only one is expensive: **E1 overhead** (capture on/off, needs
  ticket 02's `thinkingLevel` unpin), **E2 benefit** (three arms, needs a seeded fixture), **E3
  observational** (free, rides on E2). The blocking discovery: `packages/evals` runs every task in a
  freshly created *empty* temp directory (`pi-harness.ts:122-124`), so there is no repo, no history and
  no Store — the graph-on arm would consult an empty database and be identical to graph-off by
  construction. Fixed with a **seeded fixture Store plus fixture working tree** rather than a two-phase
  task, which also removes phase-one variance so the arms differ only in the thing under test. Second
  correction, to the ticket's own outcome measure: the claim is context economy, so the primary outcome
  is **tokens spent reaching a correct answer**, paired by `groupKey`, with success rate demoted to a
  guard — a paired continuous test needs ~32 pairs where a two-proportion test needs 91 for the same
  0.5→0.7 detection, which is the difference between an affordable experiment and an unaffordable one.
  Three arms not two (off / **placebo** / on), because ticket 09's `promptSnippet` changes the system
  prompt as well as the data, so the placebo must be equally *instructional* and not merely
  equal-token. Twelve tasks in three classes (rationale recovery, repeated mistake, location), all
  judged by pure code — no LLM judge, since `extensions.eval.ts:53-98` proves deterministic judges
  work. Also found: **there is no task set in this repo at all**, only a smoke test and one extension
  -authoring eval, so authoring tasks is a work item the map did not carry; the A/B runner conversely
  *does* already exist (`evalHarnessTable`, `harness-table.ts:157-193`, with repetitions and a pairing
  key); project trust defaults to `true` so ticket 08's gate 1 needs no edit
  (`settings-manager.ts:304`); and every outcome measure is already reported by `getSessionStats()`
  and `timings`. Final upstream diff: `extensionPaths` plus a `seedWorkspace` callback on the harness
  options, the `:166` assert relaxed to compare against the injected count, and the `:148` unpin.
- [12 — Sub-file symbol resolver](issues/12-symbol-resolver.md) — A backward scan for the nearest
  declaration-like line, ~15 lines, running **inside ticket 13's Attribution walk**, because that walk
  already reconstructs each File exactly as each Decision left it — so no parser, no `git diff`
  subprocess, no historical checkout, no second pass. Consequently **`touched.symbol` is deleted**:
  the label is cheaper to recompute than to invalidate, which dissolves the backfill-trigger question
  entirely (a resolver improvement now applies itself retroactively, which is what "recompute every
  run" was reaching for, at none of its cost) and makes ticket 07's append-only rule absolute — every
  table in the schema is Capture-written with no Assembly column anywhere. Tree-sitter rejected (no
  parser exists anywhere in the repo; a new runtime dep plus a grammar per language, for precision
  ticket 13 already made unnecessary). `typescript` rejected but *recorded*: it is already a root
  devDependency, so it is the paid-for upgrade path for `.ts`/`.js` if labels prove misleading.
  Verified empirically, correcting ticket 01: git's hunk header resolves an indented `bar()` to
  `export class Foo {`, not to `bar`, because its funcname pattern requires column zero — dropping
  that constraint gives method-level granularity for the same line count, so **the "method ceiling"
  was an artifact of copying git's rule**, not of the technique. Label is `{ name, container }`, both
  from one scan. Markdown resolves to its enclosing heading (one extra pattern, and the honest
  analogue); JSON and YAML resolve to null. Its only consumer is ticket 10, which can now render an
  abandoned attempt as "owns no current line — was about `bar` in `Foo`".

## Not yet specified

- Retention and pruning once a store gets large (months of sessions, one repo). Ticket 04
  measured the growth curve (~3 MB per 1000 Decisions) and set an explicit tripwire: revisit
  when a real store passes ~1 GB, not before.
- Performance of graph assembly on very large repos / very long histories. Sharpened by
  ticket 01: assembly now owns rename resolution (git), Attribution (patch replay, ticket 13)
  and symbol labelling (ticket 12) — all re-run on rebuild. Ticket 13 made Attribution per-path
  and linear, computed on demand rather than stored, which removes it from the rebuild question
  entirely; rename resolution and symbol labelling still sit inside it. Whether rebuild stays
  incremental or degrades to full-history is not yet specifiable.
- Promoting bash-driven mutations (`sed -i`, `rm`, `mv`, codegen) to real `touched` edges.
  Ticket 01 accepted the hole; ticket 13 ruled it **tolerable** — under Attribution a
  bash-rewritten line matches nothing and comes back unowned, so stale rationale can no longer
  be reported as live, and the residual damage surfaces as a Break. Re-scoped by the user's
  decision to a **post-implementation** goal: revisit once code exists and real stores show how
  often `brokeAt` is non-null (ticket 11 can measure this for free). Ticket 04 gave those same
  raw rows a second job: rename evidence is now parsed from them at Assembly, so one parser
  serves both. Ticket 09 adds a third beneficiary and names why it matters: **Pi has no delete
  tool and no move tool** — the built-in set is exactly `bash`, `edit`, `find`, `grep`, `ls`,
  `read`, `write` — so every deletion and every rename passes through `bash` unwitnessed, which
  makes *why a file was deleted* unanswerable from the record. Asked for by the user during
  ticket 09 and partially declined there: until this item is taken, an absent File reports the
  date of the last recorded write plus that Decision's rationale, which is usually where the
  story is.
- Multi-machine / shared-with-others graphs; whether the store is committed to git.
- TUI surface for a human (any in-terminal affordance, e.g. "why is this here?"). The *agent*
  surface is settled by ticket 09; this item is now only about the human one, and ticket 10
  inherits the deterministic input for it: `SELECT DISTINCT path FROM touched` stat'ed against
  the working tree is the set of recorded paths that no longer exist.
- Cross-harness portability of the record format.

## Out of scope

- Upstreaming to `earendil-works/pi`. This is a personal fork project.
- Non-code decision domains (product, design, writing).
- Making the record format a general cross-vendor standard.
