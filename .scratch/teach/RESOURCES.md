# Decision graph resources

The highest-trust source for this topic is the repo itself. Nothing about how Pi's loop,
compaction or extension surface behaves should be taken from memory when the file is
sitting right there.

## Knowledge

- `packages/coding-agent/docs/extensions.md`
  The documented extension surface, with a lifecycle diagram showing exactly when each
  event fires. Use for: what a Pi extension may observe or change, and in what order.
- `packages/coding-agent/src/core/extensions/types.ts`
  The event and result types behind that doc. Use for: whether a given hook can actually
  mutate what it sees. `ContextEventResult` and `BeforeAgentStartEventResult` are the two
  that matter for injecting anything.
- `packages/agent/src/harness/compaction/compaction.ts`
  How Pi decides to compact, where it cuts, what it summarizes, and what it keeps. Use for:
  any question about what the agent forgets and when.
- `packages/agent/src/agent-loop.ts`
  The loop that emits every event Capture depends on. Use for: ordering questions.
- `packages/decision-graph/CONTEXT.md`
  The project's own glossary. Binding on the schema, the viewer and the metrics work. Use
  for: vocabulary, before writing anything down.
- `.scratch/decision-graph/map.md`
  Running record of what is settled and what is still open. Use for: checking whether a
  question was already answered by an earlier ticket.

## Wisdom (communities)

None recorded yet. This is a personal fork with a private design record, so there is no
obvious external community for the design questions themselves. The nearest thing is the
upstream `earendil-works/pi` repo for questions about harness behaviour. Ask before
proposing anything further.

## Gaps

- No external source on feeding a decision history back into an agent's context. The
  design questions in ticket 09 are being settled from first principles against this
  codebase, which is why the evidence for each option has to be a file and a line number.
