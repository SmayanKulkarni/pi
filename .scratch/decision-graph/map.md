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
2. Secrets leak through thinking text and tool args into the store (ticket 05). **Surface
   enumerated by ticket 04**: `decision.thinking`, `decision.text`, `tool_invocation.arguments`,
   `tool_invocation.result_text`, `touched.patch`, `touched.new_text`. Six columns, not "the
   whole record".
3. Ordering under parallel tool calls, steering injection, retries, aborts (ticket 06).
   **Sharpened by ticket 04**: `turn_index` already collides within a Session because it resets
   per agent run (`agent-session.ts:729`). 06 inherits a live ambiguity, not a hypothetical one.
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
