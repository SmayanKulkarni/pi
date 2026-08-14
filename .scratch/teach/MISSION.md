# Mission: The temporal decision graph for this Pi fork

> Provisional. Written from the repo, not from an interview. Confirm or correct it.

## Why

Ship a working feature in this fork of `earendil-works/pi`: the agent's decisions get
captured to a project-local SQLite store during normal execution, assembled into a
traversable graph, and fed back so downstream task performance measurably improves or
measurably does not. Every design question has to be settled before any of it is built,
which means understanding the harness well enough to defend each choice under grilling.

## Success looks like

- Being able to state, for any open ticket in `.scratch/decision-graph/issues/`, what it
  must decide and which Pi internals constrain that decision.
- Naming the exact file and line in `packages/agent` or `packages/coding-agent` that makes
  a proposed design possible or impossible, without re-reading the whole harness.
- Distinguishing what Capture may witness from what Assembly may derive, and never
  confusing the two when a new question comes up.
- Predicting where a design will break Pi, ahead of writing code.

## Constraints

- One ticket per session. No batching, no subagents.
- Nothing in Pi may break, and every change must state its upstream rebase cost.
- `AGENTS.md` is binding: no `any`, erasable TS syntax only, `npm run check` after code
  changes, tests via `./test.sh`.
- Explanations are wanted in HTML, kept in this workspace.

## Out of scope

- Upstreaming anything to `earendil-works/pi`.
- Non-code decision domains.
- Making the record format a cross-vendor standard.
