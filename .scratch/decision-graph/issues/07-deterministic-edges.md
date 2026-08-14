# 07 — The deterministic edge set

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: closed
Assignee: Smayan Kulkarni
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

## Resolution

**One new table (`steer`, a genuinely new raw fact with nowhere else to live). Zero new edge
tables. Every candidate resolves to a rejection, an existing edge, or a read-time query over
columns ticket 04 already shipped plus `steer`.** The store's only *materialized* relations
remain `touched` (Capture, ticket 04) and `steer` (Capture, this ticket) — everything else is a
view.

### The rulings

| Candidate | Verdict | Materialized? |
|---|---|---|
| `follows` | accepted | derived on read |
| `same-turn` | **rejected — does not exist** | — |
| `touched` | already settled (01/04) | Capture, unchanged |
| `caused-by-error` | accepted, narrowed | derived on read (view) |
| `retry-of` | accepted, narrowed | derived on read (view) |
| `redirected-by` | accepted | raw fact materialized (`steer`), pairing derived on read |
| `co-touched` | **rejected as a pairwise edge** | already expressed by `touched` itself |
| `resumed-from` | accepted | derived on read, backed by existing `session.parent_session_id` |

#### `follows` — free from the primary key

Ticket 04 already made `decision.id` lexicographically time-ordered. "Temporal successor within
a Session" is `LAG`/`LEAD` over that key, partitioned by `session_id`:

```sql
SELECT id, session_id, LAG(id) OVER (PARTITION BY session_id ORDER BY id) AS follows_id
FROM decision;
```

Storing this as rows would duplicate information the `decision_session` index already encodes
in sort order — a table whose only content is "what already comes after what" carries no
information the index doesn't. Every other edge below that needs "the immediately preceding
Decision" reads through this, not through a stored table.

#### `same-turn` — rejected, does not exist under this model

Ticket 04 fixed Decision as 1:1 with `turn_end`, and `agent-session.ts:748` increments
`turn_index` after every `turn_end`. So within one Run, no two Decisions can carry the same
`turn_index` — there is nothing for `same-turn` to relate. Across two different Runs,
`turn_index` can coincide (both `0`, say), but ticket 06 already ruled that collision
meaningless and forbade using it as a boundary or grouping key. There is no reading of "turn"
under which two distinct Decisions share one — the candidate is dropped, not deferred.

#### `caused-by-error` and `retry-of` — one predecessor check, narrowed by `redirected-by`

Naively, "the immediate predecessor (`follows`) had a failed tool call" is enough:

```sql
CREATE VIEW caused_by_error AS
SELECT d.id AS decision_id, p.id AS error_decision_id
FROM decision d
JOIN decision p ON p.session_id = d.session_id
    AND p.id = (SELECT MAX(id) FROM decision WHERE session_id = d.session_id AND id < d.id)
WHERE EXISTS (SELECT 1 FROM tool_invocation ti WHERE ti.decision_id = p.id AND ti.is_error = 1)
    AND NOT EXISTS (SELECT 1 FROM redirected_by rb WHERE rb.decision_id = d.id);
```

The `NOT EXISTS redirected_by` clause is the one real finding here: adjacency alone can't tell
"the agent recovered from its own error" apart from "a human happened to type the next message
right after an error." `redirected-by` has direct evidence — a witnessed `message_end` — so
where both would fire, the human account wins and `caused-by-error` stays silent. Without this,
every steer that happens to land right after a tool failure would misreport as autonomous error
recovery.

`retry-of` is `caused-by-error` narrowed to "the same tool, on the same anchor when one exists":

```sql
CREATE VIEW retry_of AS
SELECT cbe.decision_id, cbe.error_decision_id
FROM caused_by_error cbe
WHERE EXISTS (
    SELECT 1 FROM tool_invocation cur
    JOIN tool_invocation prev
        ON prev.decision_id = cbe.error_decision_id AND prev.is_error = 1 AND prev.name = cur.name
    LEFT JOIN touched pt ON pt.decision_id = prev.decision_id AND pt.call_id = prev.call_id
    LEFT JOIN touched ct ON ct.decision_id = cur.decision_id AND ct.call_id = cur.call_id
    WHERE cur.decision_id = cbe.decision_id
        AND (pt.path IS NULL OR pt.path = ct.path)
);
```

`retry_of ⊆ caused_by_error` by construction — every retry is also "caused by an error," but not
every error-adjacent Decision is a retry (it might try something else entirely). Both are kept
because they answer different-grained questions.

**Accepted looseness:** the ticket's own wording is "same name," so for tools without a `touched`
row (`bash`, `grep`, `read`, `ls`) the match is name-only — two unrelated consecutive `bash`
calls read as a retry pair. Tightening that means parsing command strings, which is the same
class of heuristic ticket 04 already refused for rename detection. Tripwire: promote if false
positives are actually observed, not before.

#### `redirected-by` — the one new table, plus a read-time pairing

Ticket 06 settled the rule and handed this ticket the table and the pairing query. The raw fact
Capture witnesses (`message_end` for a user message, once the in-Run "has a turn fired" flag is
true) has nowhere else to live, so it gets one small table:

```sql
CREATE TABLE steer (
    id          TEXT PRIMARY KEY,   -- uuidv7, same interleaving reason as `compaction.id`
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL
);
CREATE INDEX steer_session ON steer(session_id, ts);
```

One deviation from ticket 06's literal "`(session_id, ts)` is sufficient": that describes the
*information* needed, not the primary key. A composite `(session_id, ts)` key risks collision at
millisecond granularity if a client ever double-fires; `compaction` already solved this by giving
a materialized-fact table its own uuidv7 `id` for exactly this reason, so `steer` copies that,
not a new pattern.

The pairing is a read-time join, not a second stored table — the lookup is a single indexed
range scan per steer, not the quadratic case `co-touched` runs into below:

```sql
CREATE VIEW redirected_by AS
SELECT s.id AS steer_id, s.session_id, s.ts AS steer_ts,
       (SELECT d.id FROM decision d
        WHERE d.session_id = s.session_id AND d.ts >= s.ts
        ORDER BY d.ts, d.id LIMIT 1) AS decision_id
FROM steer s;
```

#### `co-touched` — rejected as a pairwise edge; it already exists

Two Decisions "co-touching" a File are already connected — through the File node itself, via two
`touched` edges. Materializing the pairwise relation directly (`SELECT a.decision_id, b.decision_id
FROM touched a JOIN touched b ON a.path = b.path`) is a quadratic blow-up on any hot file (500
touches to one file is 250,000 pairs of zero additional information over "these 500 Decisions
touched this File"). Ticket 01 already made File a first-class node for exactly this reason —
"the edge that makes the graph a graph" is the bipartite `decision —touched→ file` structure
itself, not a third table layered on top of it. When a consumer needs "everyone who touched what
X touched," it re-queries `touched_path` for each of X's own paths — bounded by X's touch count,
never global.

#### `resumed-from` — already stored, just not at Decision grain yet

`session.parent_session_id` (ticket 04) already is this fact at the Session level. At Decision
grain it's a read-time pairing of the child Session's first Decision to the parent Session's
last:

```sql
CREATE VIEW resumed_from AS
SELECT (SELECT MIN(id) FROM decision WHERE session_id = child.id) AS decision_id,
       (SELECT MAX(id) FROM decision WHERE session_id = child.parent_session_id) AS resumed_from_id
FROM session child
WHERE child.parent_session_id IS NOT NULL;
```

No new column, no new table. Ticket 08 owns *when* a resume creates a new Session with a
`parent_session_id` versus continuing the existing one — that's a lifecycle question, not an
edge-shape question, and stays out of scope here.

### Is the graph append-only?

**Yes, and it already was before this ticket — this just states it as a binding constraint.**
Decision rows are immutable (ticket 01, explicit). `touched` rows are `INSERT OR IGNORE`, never
`UPDATE` (ticket 04's write path). `steer`, following the same pattern, is insert-only. Nothing
in this schema ever rewrites a row.

That settles the Tuesday/Friday question the hard way, not the easy way: **supersession cannot
be a mutation of the earlier Decision**, because Decisions cannot be mutated at all — it can only
ever be an edge or a derived view over immutable rows, exactly as CONTEXT.md already defined it
("Derived, never observed"). This ticket does not design that edge — the overlap rule, partial
supersession, and `write`'s blind spot are ticket 13's explicitly scoped job, blocked on 01 and
04, not on 07. What 07 contributes is the constraint 13 must design inside: whatever `supersedes`
turns out to be, it is additive (a new row referencing two existing, untouched Decisions), never
a rewrite of the Decision or `touched` row it concerns. A superseded Decision stays exactly as
readable, in exactly the same row, as it was the day it was made.

### Accepted holes

1. **`retry-of`'s name-only match for non-anchored tools** (see above) — a known, stated
   coarseness, not a bug to fix speculatively.
2. **`redirected-by` inherits ticket 06's hole unchanged**: a steer that races past a Run
   boundary is event-identical to a fresh prompt and produces no `steer` row at all, so it
   produces no `redirected-by` edge either. `caused-by-error` would then misfire on that
   Decision with no way to know better — this is the same hole, one hop downstream, not a new
   one.
3. **`co-touched` has no global answer.** "Show me every pair of Decisions that ever touched
   the same File as each other, anywhere in the repo" is deliberately not a query this store
   answers cheaply. Scoped to one File, or one Decision's own touches, it's free.

### Consequences for other tickets

- **08 (lifecycle)** — `resumed_from`'s mechanics (view, backed by `parent_session_id`) are
  settled here; 08 decides when a resume actually mints a new Session with that field set, and
  whether `session.started_at`/`start_reason = "resume"` always implies one.
- **09 (consumption)** — `caused_by_error`, `retry_of`, `redirected_by`, and `resumed_from` are
  all plain views over existing columns, so feeding any of them to the agent costs one more
  query, not a new capture or migration path.
- **10 (viewer)** — the graph the viewer draws is smaller than the candidate list implied:
  `follows` gives the temporal spine, `touched` plus File nodes gives the fan-out (rendering
  `co-touched` is "highlight every Decision touching this File," never a precomputed pair list),
  and `caused-by-error`/`retry-of`/`redirected-by` are optional overlay edges, all queried, none
  stored beyond `steer`.
- **13 (temporal relevance)** — inherits the binding constraint above: `supersedes`, however it
  ends up defined, must be an additive edge/view, never a mutation. 13 still owns the entire
  overlap rule, partial-supersession semantics, `write`'s blindness, and whether supersession
  crosses `renamed_to` — none of that is decided here.

### What this touches

Still spec-only, like 01–06. `steer` and the `redirected_by`/`caused_by_error`/`retry_of`/
`resumed_from`/`follows` views land in `packages/decision-graph/src/store.ts` (as a migration
adding one table) when the build starts — ticket 03's territory. No existing file is modified.
