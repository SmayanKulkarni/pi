# 10 — Viewer: temporal scrubbing UX

Type: prototype
Skill: mattpocock-skills:prototype
Status: open
Blocked by: 07

## Question

"Visualize the graph beautifully" is not a spec. Build a cheap throwaway prototype against
fake data and react to it, before any real renderer exists.

Use `mattpocock-skills:prototype`. Standalone self-contained HTML, no external hosts.

Questions the prototype must answer:

- What does time look like — a scrubber that filters to `t <= now`, an animated replay, or a
  layout axis?
- What is the primary view: the decision timeline, or the code anchors with decisions hanging
  off them? (Depends on ticket 01's anchor.)
- How does it stay legible at 500 decisions? At 5000? What is the default zoom?
- Reading a single decision: reasoning text, tool calls, diff — inline panel or drill-down?
- What question should a user be able to answer in under ten seconds? Name it, then check the
  prototype against it.

Deliverable: an HTML file with fabricated data, linked from the answer. Not wired to SQLite.
