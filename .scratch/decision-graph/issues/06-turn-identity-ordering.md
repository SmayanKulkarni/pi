# 06 — Turn identity and ordering under the loop's messy paths

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
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
