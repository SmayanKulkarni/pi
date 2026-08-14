# 16 — Capture: recording Decisions as the agent works

**What to build:** the extension that turns a live agent Session into Store rows, at zero added
model calls and no perceptible added latency. One Decision per assistant message — its WHY, its
prose, the tool calls it issued (sourced from the model's own call array, not the results array,
so an abort mid-batch doesn't silently drop the tail) and what actually landed on disk for each
`edit`/`write` that succeeded. Alongside Decisions: Sittings (one per process attaching to a
Session), Steers (a user message that arrived after the Run's first turn), and Compaction
Boundaries. A `write`'s pre-image is snapshotted before the tool runs, so a whole-file rewrite
claims only the lines it actually changed instead of flattening every earlier Decision's
ownership.

Because both of the repo's existing test harnesses build an in-memory session manager with no
session file — which is Capture's own persisted-session gate — this ticket first builds a small
Session test harness, owned by `packages/decision-graph`, that composes a real Session against
the faux provider with a persisted session file and the extension loaded in-process. Everything
below is verified through it.

**Blocked by:** 15 (Store)

**Status:** ready-for-agent

- [ ] A scripted Session run through the new harness produces Decision rows a later read
      confirms: WHY, prose, and tool calls with their paired results.
- [ ] A Decision is recorded even when the model produced no WHY at all, with `why_source`
      reflecting the correct rung.
- [ ] A tool call the model issued but that never executed (an abort mid-batch) is still
      recorded as an invocation.
- [ ] Only `edit`/`write` calls that succeeded produce a Touch; a failed call is recorded as an
      invocation with no Touch.
- [ ] `touched.path` is the cwd-relative path the harness itself resolved, not the model's raw
      string.
- [ ] A `write`'s pre-image is captured correctly in all three states: `''` when the target
      didn't exist, the prior content when it did, `NULL` only when no snapshot was possible.
- [ ] A user message arriving after a Run's first turn is recorded as a Steer; one arriving
      before it is not.
- [ ] A Compaction Boundary is recorded with its reason, retry flag and entry id.
- [ ] Total tokens spent in a Session are identical whether the extension is loaded or not.
- [ ] Nothing is captured on an untrusted project, and nothing is captured on a Session that was
      explicitly not persisted.
- [ ] A Store made unwritable mid-Session disables recording for the rest of the process without
      ending or otherwise disrupting the Session.
