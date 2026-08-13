# 08 — Lifecycle: init, sessions, branches, resume

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
Blocked by: 04

## Question

The original idea said "the system should be initialized at the start of the project." Settle
what initialization means and what identity spans what.

- Is there an explicit init step, or does the store appear on first run? (Lazy creation is
  the lazier answer — argue against it if there is a reason.)
- One store per project, or per session? Sessions already have their own identity in Pi
  (`packages/coding-agent/docs/sessions.md`, `docs/session-format.md`) — reuse those ids.
- Git branches and worktrees: does a decision graph fork with the branch? What happens on
  merge? What happens when the agent works in a `git worktree`?
- Session resume: `agentLoopContinue` and Pi's session restore both re-enter an existing
  history. Does the graph continue, or start a new component with a `resumed-from` edge?
- Multiple concurrent Pi sessions in the same repo writing the same SQLite file — locking,
  or per-session files merged on read?
- What happens if the store is deleted or corrupted mid-project. Must degrade to "no graph",
  never to "agent broken".
