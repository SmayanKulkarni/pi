# 11 — Metrics and eval design

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
Blocked by: 09

## Question

Chosen metric axis: downstream task benefit. Design the experiment before building the thing
it measures, so the build is shaped by what has to be measurable.

- What runs it: `packages/evals` (see `npm run eval`). Read what that harness actually does
  and what task sets exist before designing on top of it.
- Arms: graph-off vs graph-on, same tasks, same model, same seed. Anything else?
- Which models, via OpenRouter, and why those. Reasoning-visible vs reasoning-absent models
  are a natural second axis given ticket 02.
- Outcome measures: task success rate, turns to completion, total tokens, wall clock,
  repeated-mistake rate (does the agent re-make a decision the graph already records?).
- The confound: graph-on burns context on injected decisions, which alone can change behaviour.
  How is that controlled — a placebo arm injecting equal-token irrelevant text?
- Sample size for anything believable, and the cost of running it.
- Overhead measurement as a prerequisite: per-turn latency added by capture, and confirmation
  that capture token cost really is zero.

Answer is an experiment design, not results.
