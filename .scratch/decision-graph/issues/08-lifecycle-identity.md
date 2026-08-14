# 08 — Lifecycle: init, sessions, branches, resume

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Assignee: Smayan Kulkarni
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

## Resolution

**No init step — the Store is created by the first Decision. One Store per cwd, spanning every
Session and every git branch in it. `/resume` is not a Session boundary (it reuses the Session
id), so the boundary that actually exists is a *Sitting*, which gets one new Capture-written
table. The real branching risk is Pi's own session tree, not git, and it costs one witnessed
column. Any store error disables Capture for the rest of the process, once, silently.**

### 1. Initialization: lazy, at the first Decision

**No init command.** An explicit `pi decision-graph init` is a command surface, a doc
obligation and a failure mode ("you forgot to init") that buys nothing: the schema *is* the
migration list (ticket 04), applied on open, and there is no user choice to collect.

**Not at `session_start` either.** A `pi` invocation that asks one question and quits should
leave no database behind. The store opens — and migrations run — on the **first Decision write
in a process**; the `session` and `sitting` rows are buffered in memory and inserted in that
same transaction. So `session` rows exist only for Sessions that produced at least one
Decision, which is the honest set: a Session with no Decisions has nothing to explain.

Ticket 05's "warn if the db path isn't gitignored" therefore fires on the first Decision rather
than at startup. Still visible, still once.

Three gates, all cheap, all evaluated before any file is opened:

1. `ctx.isProjectTrusted() === false` → no capture. Ticket 05 leaned on "ticket 03's existing
   extension-trust gate"; `ExtensionContext.isProjectTrusted()` (`extensions/types.ts:332`) is
   that gate, callable directly, so Capture does not depend on load-time behaviour alone.
2. `sessionManager.getSessionFile() === undefined` → no capture. `pi --no-session` and
   `SessionManager.inMemory()` mean *do not save*; writing a durable record of the same
   conversation into the project directory violates that instruction in the one place the user
   was explicit about it. **Verified this does not blind the benchmark:**
   `packages/evals/src/pi-harness.ts:141` builds `SessionManager.create(cwd, join(root,
   "sessions"))` — a persisted session, not an in-memory one.
3. Store already disabled by an earlier error → no capture (§6).

### 2. Store scope: one per cwd — and the directory is `CONFIG_DIR_NAME`, not `.pi`

**One Store per project**, as `CONTEXT.md` already binds ("One per project, covering every
Session in it"). This ticket settles what "project" means.

**Refinement to tickets 03 and 04:** the path is `join(cwd, CONFIG_DIR_NAME,
"decision-graph.db")`, not a literal `.pi`. `config.ts:491` defines
`CONFIG_DIR_NAME = pkg.piConfig?.configDir || ".pi"` — and this repo *is* a fork, exactly the
situation where that override gets used. Hardcoding `.pi` would orphan the store from the rest
of the project's config. `CONFIG_DIR_NAME` is already exported from the package entry
(`coding-agent/src/index.ts:7`), so this costs one import.

**Scoped to cwd, with no upward search and no git-root resolution** — because that is what Pi
does everywhere else: `join(this.cwd, CONFIG_DIR_NAME, …)` in `resource-loader.ts:817-822` and
`package-manager.ts:904`, and session storage keyed by cwd in
`~/.pi/agent/sessions/--<path>--/`. Run pi from `packages/foo/` and you get
`packages/foo/<config>/decision-graph.db`. Consistent beats clever; a project-root resolver
would be the only component in Pi with its own idea of where the project starts.

Gitignore glob stays ticket 04's `.pi/decision-graph.db*`, written against `CONFIG_DIR_NAME`.

### 3. Git: branches, worktrees, merge

**The graph does not fork with the branch.** The store lives in the working tree and is
gitignored, so `git switch` never touches it: one store spans every branch. This is correct
rather than merely convenient — the Decisions happened, in that order, in this directory, and
the branch they happened on does not change that.

**No git columns. No `branch`, no `head_sha`.** Nothing in 09, 10, 11 or 13 needs ancestry
today; 13 lists "git commit boundary" as an *assembly-time* signal, which by definition reads
git later rather than recording it now. A per-Decision `git rev-parse` is a subprocess spawn on
the turn path — the one thing ticket 11 must certify as near-zero. Tripwire: if 13's
supersession is measured to need ancestry, add `sitting.head_sha`, which costs one spawn per
sitting instead of one per turn.

**Worktrees: separate stores, by construction, with no code.** `git worktree add ../feature`
is a different cwd, therefore a different config dir, therefore a different store — and a
different session directory in Pi already. They never see each other's history. That is honest:
different directories, different file states. Unifying them is the map's existing
"multi-machine / shared graphs" item, not a lifecycle question.

**Merge: nothing happens**, because there is nothing to merge — the store is not committed. If
it ever were, SQLite is a binary blob with no merge driver, which is a second reason it stays
ignored.

**One thing git costs us, named:** `git switch`, `git checkout`, `git stash` and `git reset`
rewrite the entire working tree with no `touched` edge. This is the largest instance of ticket
01's accepted unwitnessed-mutation hole, not a new one, and it is handed to ticket 13 as a
stated limit on supersession rather than fixed here.

### 4. Resume, fork, and the Sitting

**Finding: `/resume` does not create a Session boundary at all.** `_setSessionFile` adopts the
existing header's id — `session-manager.ts:915`, `this.sessionId = header?.id ??
createSessionId()`. `pi -c`, `pi -r`, `/resume` and `--session <id>` all reopen the *same*
Session id and the *same* file. Therefore:

- No new `session` row (`INSERT OR IGNORE`), no parent pointer, no `resumed_from` edge — and
  none is needed, because `follows` already spans the gap inside one Session.
- `parentSession` is written only by `/fork`, `/clone` and `createBranchedSession`
  (`session-manager.ts:1441`, `:1618`), which each write a *new* file with a new uuidv7 id.

**Correction to ticket 07 and `CONTEXT.md`: `Resumed-from` is not about resuming.** Its backing
column is only ever populated on fork/clone. Renamed **Forked-from**: from a forked Session's
first Decision back to its parent Session's last. Ticket 07's view SQL is unchanged in shape;
only the name and the gloss change.

**Second correction to ticket 04: `SessionHeader.parentSession` is a file path, not an id.**
Resolving it to an id at capture would mean opening and parsing another JSONL file on the turn
path, and Capture does not resolve identity. So the column is `parent_session_file TEXT`,
stored verbatim, and 07's view joins `p.session_file = child.parent_session_file` — both
columns already exist, both hold `resolvePath`'d absolute paths. It degrades correctly: if the
parent Session was never captured, or its file moved, there is no row and therefore no edge,
which is the right answer rather than a wrong one.

**The Sitting.** Ticket 04 put `start_reason` and `started_at` on `session`. That is the wrong
shape: a Session spans days and has many starts, so a single column records one event on an
entity that has many, and under ticket 07's append-only rule it can never be corrected. Ticket
13's segmentation table also asks this ticket for a "different sitting, possibly different
intent" signal — and the honest unit for that is not the Session at all:

```sql
CREATE TABLE sitting (
    id                 TEXT PRIMARY KEY,   -- uuidv7, interleaves with decision.id
    session_id         TEXT NOT NULL REFERENCES session(id),
    ts                 INTEGER NOT NULL,   -- epoch ms
    reason             TEXT NOT NULL
        CHECK (reason IN ('startup','reload','new','resume','fork')),
    prev_session_file  TEXT                -- SessionStartEvent.previousSessionFile
);
CREATE INDEX sitting_session ON sitting(session_id, ts);
```

`reason` is exactly `SessionStartEvent.reason` (`extensions/types.ts:565`) and
`prev_session_file` is its `previousSessionFile` (`:567`), copied rather than interpreted.
Insert-only, uuidv7-keyed, same pattern as `steer` (07) and `compaction` (04) — a witnessed raw
fact with nowhere else to live. `session` correspondingly **loses `start_reason` and
`started_at`**; the latter is `MIN(sitting.ts)`.

Buffered like the `session` row: a `session_start` that never reaches a Decision writes
nothing, consistent with §1. A second `session_start` in one process (`reload`, `new`) buffers
a second Sitting.

**No `decision.sitting_id`.** A Decision's Sitting is the latest `sitting` row with the same
`session_id` and `ts <= decision.ts` — one indexed lookup, and `sitting_session` is the index
that serves it. Storing it would duplicate a derivable fact, which is the same argument ticket
07 used to reject `follows` as a table.

**Fork does not duplicate Decisions.** `/fork` copies historical entries into the new file, but
those messages are not re-generated, so no `turn_end` fires for them and Capture never sees
them. They stay attached to the Session that produced them, which is where the rationale
actually came from.

### 5. Concurrent Pi sessions in one repo

Already answered by ticket 04 and confirmed here: WAL, `synchronous = FULL`,
`busy_timeout = 5000`, one small transaction per turn. Per-session files merged on read is
rejected — it trades a solved problem (SQLite multi-writer at a rate of one transaction per
model round trip) for an unsolved one (N-file merge with cross-file ordering and no primary
key to merge on).

This ticket adds one rule: **if a write still times out after 5s, that is a store error**, and
§6 applies. Waiting longer on the turn path is not an option Capture gets to take.

Ticket 04's cross-process ordering caveat stands, and sharpens: two `pi -c` processes in one
repo *do* continue the same Session file, so they share a `session_id` and their `uuidv7`
sequences can interleave arbitrarily within a millisecond. Both processes are also appending to
the same session JSONL, so this is Pi's own pre-existing footgun; the store inherits it and does
not worsen it. Two Decisions in the same millisecond additionally require two model round trips
to land together. Named, accepted, not defended against.

### 6. Deleted or corrupted store: one-strike disable, never repair

**Capture is fail-open and self-disabling.** Ticket 03 established that `runner.ts:819` catches
handler throws, so a broken extension structurally cannot break a session — that is the
backstop, not the design. Relying on it alone means a corrupt store costs a 5s `busy_timeout`
plus a caught exception *every turn* for the rest of the session.

- Every store touch sits in a try/catch Capture owns. On the first error from open, migration
  or write: log once, set `enabled = false` for the life of the process, and make every later
  handler an immediate return. One boolean.
- **No auto-repair, no auto-delete, no re-create over a corrupt file.** Deleting a user's
  decision history to recover from a transient error is worse than stopping. Recovery is a
  human `rm <config>/decision-graph.db*`; the next process creates a fresh store lazily (§1).
- Deleted mid-session: POSIX keeps the open handle alive and writes land in an unlinked inode
  (silently lost); Windows generally refuses to unlink an open file. Neither breaks the agent,
  and the next process re-creates the store.
- Partial writes are impossible by ticket 04's design — one transaction per turn, so a Decision
  and its `tool_invocation`/`touched` children are all-or-nothing.
- **A missing store is not an error at read time.** "No store" and "empty store" must be
  indistinguishable to the viewer (10) and the consumption path (09), and neither may change
  agent behaviour. 09 inherits this as a hard requirement, not a nicety.

### 7. The real branching problem is Pi's session tree, not git

The ticket's question list asked about git branches. The sharper version, which it did not
anticipate, is Pi's own: **`/tree` moves the leaf to an earlier entry and continues in the same
file with the same Session id** (`docs/sessions.md:69-116`). One `session_id` can therefore
contain several divergent conversational branches — and ticket 07's `follows`,
`LAG(id) OVER (PARTITION BY session_id ORDER BY id)`, will link the last Decision of an
abandoned branch to the first Decision of a new one and assert a succession that never happened.

What is **not** affected: the filesystem. `/tree` does not rewind the working tree, so the bytes
on disk remain the linear result of every edit in wall-clock order. **Supersession (13) is
untouched** — it compares Applied Changes, which really were physically sequential. Only
conversational lineage is wrong.

**Ruling: Capture stores one new witnessed column, `decision.leaf_entry_id`.** At `turn_end`,
`ctx.sessionManager.getLeafId()` is the session-file entry id of the last entry appended for
this Decision.

Ordering verified rather than assumed: `_emitExtensionEvent` runs *before*
`sessionManager.appendMessage` (`agent-session.ts:634` vs `:656`), so at `message_end` the entry
does not exist yet — but every tool-result `message_end` fires inside `executeToolCalls`, which
completes before `turn_end` is emitted (`agent-loop.ts:214-224`). By `turn_end` the assistant
entry and all of this turn's tool-result entries are appended, and the leaf is this Decision's
last entry.

This is a *witnessed* fact — the address Pi itself assigned — not a resolution, so it belongs in
Capture without violating `CONTEXT.md`'s "Capture never resolves identity, never infers a
relation". Walking the tree is Assembly's job: read `session.session_file`, walk `parentId` to
the assistant entry and on to the previous Decision's entry, and derive an exact
`parent_decision_id`. When the session file is gone — deleting sessions is supported and
documented (`session-format.md:13-17`) — Assembly falls back to ticket 07's timestamp `follows`.
The store stays self-sufficient and gets more accurate when the file is present.

Rejected alternatives:

- **Subscribe `session_tree`** (`extensions/types.ts:646`, exposed to extensions at `:1219`)
  and store jump events. One column cheaper, but strictly weaker: it can only *null out* a false
  `follows`, never name the true predecessor, because mapping its `newLeafId` to a Decision
  needs exactly the entry ids we would have declined to store. Nothing else wants the jump
  timestamps yet.
- **Walk up at capture** to find the assistant entry's own id. Bounded and exact, but it is
  inference on the turn path, and the walk needs the same tree Assembly must read anyway.
- **Match Decisions to session entries by timestamp at Assembly**, storing no column. Free, but
  a heuristic in place of an exact key that was also free.

Accepted hole: `leaf_entry_id` names the *last* entry of the Decision, not the assistant entry
itself. The assistant entry is the nearest `role === "assistant"` ancestor, a bounded walk, and
there is no case where the two diverge that Assembly cannot see.

### Accepted holes

1. **`git switch` and friends rewrite the tree unwitnessed** (§3) — the largest instance of
   ticket 01's existing hole, now named. Handed to 13 as a limit, not fixed.
2. **Two concurrent processes on one Session** can interleave `uuidv7` sequences within a
   millisecond (§5). Pi's own footgun, inherited unchanged.
3. **`parent_session_file` breaks if a session file is moved on disk** (§4). Degrades to no
   edge, never to a wrong edge.
4. **`leaf_entry_id` is the Decision's last entry, not its assistant entry** (§7).
5. **A Sitting with no Decision is never recorded** (§1). Deliberate: it is a start with nothing
   to explain, and recording it would mean writing a store file for a `pi` run that did nothing.

### Consequences for other tickets

- **04 (schema)** — deltas, all pre-build so no migration is owed: `session` loses
  `start_reason` and `started_at` and renames `parent_session_id` → `parent_session_file`; new
  `sitting` table; `decision` gains `leaf_entry_id TEXT`; store path becomes
  `join(cwd, CONFIG_DIR_NAME, "decision-graph.db")`.
- **07 (edges)** — `Resumed-from` renamed **Forked-from** with a corrected definition; its view
  joins on `session_file` rather than an id. `follows` gains an exact Assembly-derived form via
  `leaf_entry_id`, with 07's SQL as the fallback when the session file is absent.
- **13 (temporal relevance)** — gets the **Sitting** as its "different sitting" signal, which is
  a better one than the Session boundary its table assumed, since a Session can span months.
  Also inherits accepted hole 1.
- **09 (consumption)** — "no store" and "empty store" must be indistinguishable and must not
  change agent behaviour. Consumption must honour the same three gates as capture (§1), or the
  graph-off and graph-on arms in ticket 11 will not line up.
- **10 (viewer)** — must render a session *tree*, not a session line, wherever `/tree` was used;
  `leaf_entry_id` is what makes that drawable.
- **11 (metrics)** — capture is live under evals (`pi-harness.ts:141` persists sessions), so the
  extension-count assert at `:166` remains the only blocker, unchanged and still 11's.
- **12 (symbol resolver)** — unaffected.

### What this touches

Spec-only, like 01–07. The schema deltas land in `packages/decision-graph/src/store.ts` and the
vocabulary changes in `packages/decision-graph/CONTEXT.md` (updated by this ticket) when the
build starts. The only new runtime coupling named here is an import of `CONFIG_DIR_NAME` from
`@earendil-works/pi-coding-agent` — a workspace dependency inside the fork. No existing file is
modified.
