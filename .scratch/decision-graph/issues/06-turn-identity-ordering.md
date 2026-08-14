# 06 — Turn identity and ordering under the loop's messy paths

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Blocked by: 03

## Question

A temporal graph is only as good as its ordering. The loop has several paths that break naive
"append in the order events arrive":

- **Parallel tool execution** (`executeToolCallsParallel`, `agent-loop.ts:489`) — `tool_execution_start`
  events fire in call order but completions interleave arbitrarily. Results are re-ordered
  before becoming messages.
- **Steering messages** injected mid-loop (`getSteeringMessages`, `:167`, `:259`) — the user
  interrupts between turns. Is that a node? It is arguably the highest-value edge in the graph:
  a human redirected the agent.
- **Follow-up messages** re-entering the inner loop (`getFollowUpMessages`, `:263`).
- **Retries** via `agentLoopContinue` (`:64`) — the context already holds the prior turn.
- **Aborts** (`signal?.aborted`) and truncated-output tool failures
  (`failToolCallsFromTruncatedMessage`, `:381`) — half-finished decisions.
- **Model/thinking-level switches mid-run** via `prepareNextTurn` (`:232`).

Settle: what is the stable identity of a turn, how are concurrent tool calls ordered
deterministically, and how are interrupted/aborted/retried turns represented — dropped,
or recorded as first-class "abandoned decision" nodes (they are arguably the interesting ones).

## Resolution

**Most of this ticket was already answered by tickets 01/04, once checked against the real
code rather than assumed. What's left, genuinely new, is the tool-invocation source (a small
correctness fix), the steer-detection rule, and naming exactly one accepted hole.**

### Turn identity — nothing new, confirmed against the code

`decision.id` (uuidv7 + `content_hash` for idempotency, ticket 01/04) remains the *only*
identity. `(run_id, turn_index)` is diagnostic metadata, never identity, and this ticket
sharpens *why*: tracing `agent-session.ts:729` and `agent.ts:361-388` shows `run_id` boundaries
(a fresh `agent_start`, `_turnIndex` reset to 0) fire on *every* re-entry into
`runAgentLoop`/`runAgentLoopContinue` — not just retries. `agent.continue()`'s drain of queued
steering/follow-up messages, once the prior Run has already ended, replays them through
`runPromptMessages` → `runAgentLoop`, exactly like a brand-new top-level prompt. So the same
user action (typing mid-stream) can land as a same-Run turn or a new Run, depending purely on
whether it beat the loop's own internal poll (`agent-loop.ts:167`/`:259`). This cannot corrupt
a Decision — `run_id`/`turn_index` are already excluded from `content_hash` — but it does mean
**`run_id`/`turn_index` must never be used by Assembly or the viewer to define a "user turn" or
conversation boundary.** All ordering and grouping uses `decision.id` (already globally,
lexicographically time-ordered) plus the `redirected-by` signal below. This closes the open
item ticket 04 left ("06 owns whether anything else needs one"): nothing else needs one.

### Ordering under parallel tool calls — already correct by construction

Read `executeToolCallsParallel` in full (`agent-loop.ts:489-554`). `tool_execution_start` fires
in call order; `tool_execution_end` fires in interleaved completion order — but Capture (ticket
03) never subscribes to either. It taps `turn_end`, whose `toolResults` array is built by
`Promise.all(finalizedCalls.map(entry => entry()))` followed by a `for` loop over the result
(`:540-548`): `Promise.all` always returns results indexed by *submission* order regardless of
completion order. So the only ordering Capture ever observes is already deterministic call
order. **No re-ordering logic is needed in Capture or Assembly.**

The one real fix: `tool_invocation.ordinal` (and the row set itself) must be sourced from
`message.content.filter(c => c.type === "toolCall")` — the exact array both
`executeToolCallsParallel` and `executeToolCallsSequential` iterate (`:203`, `:418`) — using
its index as `ordinal`, left-joined against `toolResults` by `call_id` for outcome. This is a
correction to how ticket 04's schema gets populated (not a new column): sourcing rows from
`toolResults` instead would silently drop any tool call whose execution never started (see
next section), and would make `ordinal` depend on which array happened to be iterated rather
than the model's own emission order.

### Aborted, errored, and retried turns — already first-class, plus one gap closed

Traced the full retry path: on an assistant error, `runLoop` emits `turn_end` with
`stopReason: "error"` **synchronously**, before returning control up the stack
(`agent-loop.ts:196-199`). Only afterward does `agent-session.ts:2710-2714` pop that failed
message out of live context ("Remove error message from agent state, keep in session for
history") so the retry doesn't replay the failure to the model. **Capture has already written
the row by the time the pop happens.** `stop_reason`/`error_message` (ticket 04) already
represent this correctly — retries and aborts are ordinary Decisions, not a special
"abandoned decision" node type. Same reasoning covers `signal?.aborted`.

The gap this ticket does find: in both `executeToolCallsParallel` and
`executeToolCallsSequential`, an abort mid-batch `break`s the scheduling loop
(`:516-518`, `:478-480`) *after* the current call's `tool_execution_start` but before any calls
further along in the model's original list. Those trailing calls never execute and never
appear in `toolResults` — if `tool_invocation` were sourced from `toolResults` they'd vanish
entirely (worse than "unpaired": absent). The `message.content`-sourced row set from the
previous section fixes this for free: an unexecuted call still gets a row, with
`result_text = NULL, is_error = NULL` (already legal per ticket 04's
`-- NULL when no result arrived`).

Model/thinking-level switches via `prepareNextTurn` (`:232`) need nothing new: `decision.model`
/`api`/`provider` are already per-row (ticket 04), so a mid-run switch is just a visible change
between two consecutive rows.

### Steering messages — a capture-time rule, not a viewer-time guess

Rejected a first pass at this (inferring "steer" from a message's position in the session
file — not session-first, therefore mid-run) as too fragile: it's coupled to session-file
format stability and, worse, provably ambiguous for messages that race past the loop's first
poll (see the accepted hole below).

**Rule: Capture tracks one boolean per active Run — has a `turn_end` fired yet since this
Run's `agent_start`? A `message_end` for a `role: "user"` message is a steer iff that flag is
already true.** This is state Capture needs anyway to mint `run_id`/`turn_index`, so the check
costs nothing new except the subscription itself. It gives ticket 07's `redirected-by` edge an
exact, non-heuristic input instead of an inferred one.

This amends ticket 03's subscription list (`turn_end` + session lifecycle + compaction) to add
**`message_end`** — the same category of move as ticket 03 preemptively subscribing to
compaction boundaries: cheap now, unrecoverable later. Capture emits one minimal raw fact per
detected steer — `(session_id, ts)` is sufficient; the message text itself is not duplicated,
since Pi's own `SessionManager` already persists it in the session file
(`session.session_file`, ticket 04), and Assembly can look it up by `ts` if a consumer needs
the text. The exact table/migration is left to whichever ticket next touches `store.ts` (07,
since it's the edge that consumes this signal) — 06's job is the rule and the raw data shape,
not the DDL.

### Accepted holes

1. **Steers that race past a Run boundary are indistinguishable from a fresh prompt.** When
   `agent.continue()` drains a queued steering/follow-up message *after* its Run has already
   ended, it replays it through `runPromptMessages` → `runAgentLoop` — the identical event
   shape as a brand-new top-level prompt (`agent_start`, then `message_end` *before* any
   `turn_end` exists in that Run). Capture's in-Run flag cannot catch this, because from
   Capture's perspective no turn has happened yet in "this" Run. Fixing it needs either a
   fork-core edit carrying provenance on replayed messages (contradicts ticket 03's zero-edit
   conclusion) or a heuristic fallback for just this slice — rejected, since it would mean
   degrading the common case's precision to cover a rare race. Silent until a real fork-core
   edit is justified for other reasons.
2. **Supersession-by-redirect is not designed here.** A steer can make prior tool calls on the
   same file(s) moot without any byte-level overwrite — that's staleness, and staleness is
   ticket 13's explicitly scoped job ("which decisions still explain the current state of this
   file"), blocked on 01+04, not 06. This ticket only hands 13 a sharper input (see below); it
   does not decide how 13 should weigh it.

### Consequences for other tickets

- **03 (capture point)** — subscription list amended: add `message_end`, needed for the steer
  rule above. `turn_end` handling is unchanged.
- **04 (schema)** — `tool_invocation` population corrected: source rows from
  `message.content` toolCalls, not `toolResults`, with `ordinal` as index into that array.
  No column changes.
- **07 (deterministic edges)** — `redirected-by`'s exact rule and raw data pointer are now
  settled: `(session_id, ts)` per detected steer, paired against the next `decision.id` in that
  session by ordering. 07 owns the table/migration and the pairing query.
- **13 (temporal relevance)** — gets a new candidate signal for its segmentation table: a
  `redirected-by` boundary is free (no git, no assembly-time work) and stronger evidence of
  intent-change than a bare session boundary, but weaker than content-overwrite — a hint, not
  proof. 13 decides whether and how to use it; not resolved here.
- **08 (lifecycle identity)** — inherits the sharpened fact that `run_id` boundaries are more
  frequent, and less semantically meaningful, than "one Run per retry."

### What this touches

Nothing yet — still spec-only, like 01–05. The correction to `tool_invocation` sourcing and the
new `message_end` subscription land in `packages/decision-graph/src/extension.ts` and
`store.ts` when the build starts (ticket 03's territory).
