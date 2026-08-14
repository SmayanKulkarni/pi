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
  ticket 03, not assumed here.

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
4. Compaction is **not** a capture risk: capture is event-driven and appends at emit time,
   so compaction shrinks context, never the log. It *is* a consumption risk (ticket 09).

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
  blind to capture. Core edit stays pre-authorized for ticket 09 only.
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

## Not yet specified

- Retention and pruning once a store gets large (months of sessions, one repo). Ticket 04
  measured the growth curve (~3 MB per 1000 Decisions) and set an explicit tripwire: revisit
  when a real store passes ~1 GB, not before.
- Performance of graph assembly on very large repos / very long histories. Sharpened by
  ticket 01: assembly now owns rename resolution (git), supersession derivation (text overlap,
  ticket 13) and symbol labelling (ticket 12) — all re-run on rebuild. Whether rebuild stays
  incremental or degrades to full-history is not yet specifiable.
- Promoting bash-driven mutations (`sed -i`, `rm`, `mv`, codegen) to real `touched` edges.
  Ticket 01 accepted the hole and kept raw bash events, so this is a later promotion pass —
  not sharp enough to ticket until 13 shows how badly stale rationale actually hurts. Ticket 04
  gave those same raw rows a second job: rename evidence is now parsed from them at Assembly,
  so one parser serves both.
- Recovering a pre-image for `write`, so supersession is not blind across whole-file
  overwrites (ticket 04, hole 1). Either a `tool_call` subscriber snapshotting content before
  the write, or a git-derived baseline at Assembly. Neither is sharp enough to ticket yet.
- Multi-machine / shared-with-others graphs; whether the store is committed to git.
- TUI surface (any in-terminal affordance at all, e.g. "why is this here?").
- Cross-harness portability of the record format.

## Out of scope

- Upstreaming to `earendil-works/pi`. This is a personal fork project.
- Non-code decision domains (product, design, writing).
- Making the record format a general cross-vendor standard.
