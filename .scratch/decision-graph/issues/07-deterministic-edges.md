# 07 — The deterministic edge set

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: open
Blocked by: 01, 06

## Question

Charting settled that edges are derived deterministically from the event stream, with no live
classifier and no model. This ticket writes the actual list and the derivation rule for each.

Candidates to accept, reject, or add:

- `follows` — temporal successor within a session.
- `same-turn` — decisions sharing a turn.
- `touched` — decision to anchor (per ticket 01).
- `caused-by-error` — a turn whose prior turn produced `isError: true` tool results.
- `retry-of` — a turn re-issuing a tool call with the same name after failure.
- `redirected-by` — a turn preceded by an injected steering message (ticket 06).
- `co-touched` — two decisions touching the same anchor, possibly far apart in time. This is
  the edge that makes the graph a graph rather than a list; decide whether it is stored or
  computed at query time.
- `resumed-from` — across session boundaries.

For each: the exact rule, the data it needs, and whether it is materialised in SQLite or
derived on read.

Also settle the hard one: **is the graph append-only?** A decision made on Tuesday can be
superseded on Friday. Is supersession an edge, or does it mutate the earlier node? Append-only
is the only thing that keeps "temporally traversable" honest — argue it or beat it.
