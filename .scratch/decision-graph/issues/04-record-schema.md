# 04 — Decision record schema and SQLite design

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 01, 02, 03

## Question

Define the record. This is the artifact everything else reads and writes, so it gets a
ubiquitous language, not just a table.

Settle:

- What *is* a "decision"? One per turn? One per tool call? One per assistant message with
  reasoning? Turn boundary (`turn_end`) is the obvious candidate — argue it or beat it.
- Fields: id, session id, turn index, timestamp, model, provider, reasoning text (per the
  degradation ladder from ticket 02), tool calls, results, error state, anchors (per ticket 01),
  token usage.
- SQLite schema: tables, indexes for the queries the viewer and the consumption path need
  ("all decisions in time order", "all decisions touching X", "the decision that caused this error").
- Where the DB file lives, and whether it is gitignored or committed.
- Migration story — the schema *will* change during this project. Pi already has
  `packages/coding-agent/src/migrations.ts`; reuse or not.
- Write path: per-record insert, or batched. Crash safety (WAL?).
- Size per record and projected growth for a long session.

Use `mattpocock-skills:domain-modeling`. Name the terms; they carry through the viewer and
the metrics work.

## Resolution

**A Decision is one assistant message, and the record is six tables that separate what was
witnessed from what was derived.** The ubiquitous language lives in
`packages/decision-graph/CONTEXT.md` and is binding on the viewer, the consumption path and
the metrics work.

Two upstream facts found while writing this schema break assumptions ticket 01 made, and
both change the record: **Pi's `edit` tool fuzzy-matches**, so the model's `oldText` is not
what was applied; and **Pi's `write` tool never reads the file it overwrites**, so a `write`
destroys content while leaving no evidence of what it destroyed. Both are handled below.

### What a Decision is

**One per assistant message, 1:1 with `turn_end`.** Ticket 01 already settled this; the work
here was to test it against the event's real type, and it survives with one correction and
one new column.

Alternatives were re-checked and stay rejected:

| Candidate atom | Why not |
|---|---|
| One per tool call | Thinking and text belong to the message, not to any one call. Five calls would copy one WHY five times, or four of them would have none. |
| One per assistant message *with reasoning* | Ticket 02 measured WHY-less turns as the common case. Keying the atom on an optional field makes the majority of the agent's history unrepresentable. |
| One per Run | Loses the ordering the graph exists to show. |

**Correction to ticket 01: `turn_index` is per Run, not per Session.**
`agent-session.ts:729` resets `this._turnIndex = 0` on every `agent_start`, and `:748`
increments it after each `turn_end`. So `(session_id, turn_index)` collides on the second
prompt of any session. Ticket 01 was right to refuse turn numbering as identity, but its
"ticket 06 may renumber turns" framing understated it: **the numbering is already ambiguous
today.** The schema therefore carries a `run_id` minted at `agent_start`, without which
`turn_index` cannot be interpreted at all.

**Capture must narrow the message type.** `TurnEndEvent.message` is `AgentMessage`
(`extensions/types.ts:735`), which is `Message | CustomAgentMessages[…]`
(`packages/agent/src/types.ts:325`) — a union including `UserMessage` and
`ToolResultMessage`. The loop only ever passes the assistant message (`agent-loop.ts:224`),
but the *type* does not say so, and `AGENTS.md` forbids `any`. Capture guards on
`message.role === "assistant"` and silently ignores anything else.

### The shape of the store

Six tables. The split that matters is **Capture writes, Assembly derives** — every column is
one or the other, and no column is both.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = FULL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- ─── bookkeeping ────────────────────────────────────────────────────────────
CREATE TABLE migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
);

-- ─── Session ────────────────────────────────────────────────────────────────
CREATE TABLE session (
    id                 TEXT PRIMARY KEY,   -- sessionManager.getSessionId()
    cwd                TEXT NOT NULL,
    session_file       TEXT,
    parent_session_id  TEXT,               -- SessionHeader.parentSession; fork lineage
    start_reason       TEXT NOT NULL,      -- startup|reload|new|resume|fork
    started_at         INTEGER NOT NULL    -- epoch ms
);

-- ─── Decision ───────────────────────────────────────────────────────────────
CREATE TABLE decision (
    id              TEXT PRIMARY KEY,      -- uuidv7; lexicographic order == temporal order
    content_hash    TEXT NOT NULL UNIQUE,  -- idempotency only, never an addressing key
    session_id      TEXT NOT NULL REFERENCES session(id),
    run_id          TEXT NOT NULL,         -- uuidv7 minted at agent_start
    turn_index      INTEGER NOT NULL,      -- position within the Run. NOT identity.
    ts              INTEGER NOT NULL,      -- AssistantMessage.timestamp, epoch ms

    -- provenance: which stack produced this WHY (ticket 02)
    api             TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    response_model  TEXT,                  -- OpenRouter's concrete pick, when it differs

    -- WHY
    thinking        TEXT,                  -- concatenated ThinkingContent blocks
    text            TEXT,                  -- concatenated TextContent blocks
    why_source      TEXT NOT NULL
        CHECK (why_source IN ('raw','summary','redacted','omitted','text_only','none')),

    -- outcome
    stop_reason     TEXT NOT NULL,
    error_message   TEXT,

    -- accounting
    tok_input       INTEGER NOT NULL,
    tok_output      INTEGER NOT NULL,
    tok_reasoning   INTEGER,               -- NULL when the provider reports no breakdown
    tok_cache_read  INTEGER NOT NULL,
    tok_cache_write INTEGER NOT NULL,
    cost_total      REAL NOT NULL
);
CREATE INDEX decision_session ON decision(session_id, id);

-- ─── raw witnessed tool activity (every tool, no interpretation) ────────────
CREATE TABLE tool_invocation (
    decision_id  TEXT NOT NULL REFERENCES decision(id) ON DELETE CASCADE,
    call_id      TEXT NOT NULL,            -- ToolCall.id
    ordinal      INTEGER NOT NULL,         -- position within the message
    name         TEXT NOT NULL,
    arguments    TEXT NOT NULL,            -- JSON, verbatim as the model emitted it
    result_text  TEXT,                     -- text blocks of the paired result; NULL if unpaired
    is_error     INTEGER,                  -- 0|1; NULL when no result arrived
    PRIMARY KEY (decision_id, call_id)
);

-- ─── Touch: the only edge Capture creates ───────────────────────────────────
CREATE TABLE touched (
    decision_id  TEXT NOT NULL,
    call_id      TEXT NOT NULL,
    path         TEXT NOT NULL,            -- verbatim from tool args; never resolved
    kind         TEXT NOT NULL CHECK (kind IN ('edit','write')),
    patch        TEXT,                     -- APPLIED change, unified. NULL for write.
    new_text     TEXT,                     -- write only: the content that landed
    symbol       TEXT,                     -- Assembly (ticket 12). NULL until a resolver exists.
    PRIMARY KEY (decision_id, call_id),
    FOREIGN KEY (decision_id, call_id)
        REFERENCES tool_invocation(decision_id, call_id) ON DELETE CASCADE
);
CREATE INDEX touched_path ON touched(path);

-- ─── Compaction Boundary ────────────────────────────────────────────────────
CREATE TABLE compaction (
    id          TEXT PRIMARY KEY,          -- uuidv7, so it interleaves with decision.id
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL,
    reason      TEXT NOT NULL,             -- manual|threshold|overflow
    will_retry  INTEGER NOT NULL,
    entry_id    TEXT                       -- CompactionEntry id, to locate it in the session file
);

-- ─── the domain rule for WHY, written once ──────────────────────────────────
CREATE VIEW decision_why AS
SELECT id, session_id, run_id, turn_index, ts, why_source,
       CASE why_source
           WHEN 'raw'       THEN thinking
           WHEN 'summary'   THEN thinking
           WHEN 'text_only' THEN text
           ELSE NULL
       END AS why
FROM decision;
```

### Why these columns and not others

**`thinking` and `text` are separate columns; there is no `why` column.** Ticket 02 made text
a first-class WHY source rather than a fallback, which tempts a single merged `why` column —
but merging duplicates the prose at the `text_only` rung and destroys the ability to ask "did
this model reason *and* speak?". `why_source` is the discriminator and the `decision_why`
view encodes the rule once, so no consumer re-derives it.

**Capture never writes `why_source = 'raw'`.** Ticket 02 established L0 and L1 are
indistinguishable on the wire, so Capture emits `summary` for any non-empty, non-redacted
thinking. `raw` exists in the CHECK so Assembly can re-label from model identity later without
a migration. `redacted` comes from `ThinkingContent.redacted === true`; `omitted` from a
thinking block whose text is empty. Those two are the reason this column cannot be recomputed
after the fact.

**`thinkingSignature` is not stored**, per ticket 02 — kilobytes of provider replay token per
turn, zero human value, and on OpenAI Responses it contains the whole serialised reasoning
item.

**Images are dropped.** `ToolResultMessage.content` is `(TextContent | ImageContent)[]`;
`result_text` keeps the text blocks only. Base64 image payloads would dominate the store and
answer no question the graph asks.

**`content_hash` is idempotency, not identity.** It is `sha256` over `session_id`, `ts`, the
concatenated thinking and text, and each `(call_id, name, canonical args)` — deliberately
*not* over `JSON.stringify(message)`, whose key order is a property of the Pi version that
parsed it and would silently change across an upgrade. It excludes `id` (random), `run_id`
(per-process) and `turn_index` (ambiguous, see above). With `INSERT OR IGNORE`, crash-retry
and session replay cannot duplicate a Decision.

**No `file` table.** Ticket 01 makes File a first-class node whose identity *is* the path
string. A table whose only column is that identity carries no information: the node set is
`SELECT DISTINCT path FROM touched`. When Assembly needs per-File attributes — a canonical id
after rename resolution — that is a new table added by migration, which is exactly what the
migration story is for.

**No `rename_evidence` table — a deliberate refinement of ticket 01.** Ticket 01 asked Capture
to record witnessed renames (a `mv` in a bash command, a write-new plus delete-old pair). But
every input to that judgement is *already* stored verbatim in `tool_invocation.arguments`, and
recognising `mv a b` in a shell string is a heuristic. Putting a heuristic in Capture makes its
mistakes permanent, which is precisely the reason ticket 01 gave for putting identity in
Assembly. Moving the parse to Assembly loses nothing, deletes a table and a parser from the
hot path, and makes the parser improvable without recapture. Ticket 01's *principle* is
preserved and strengthened; only its placement changes.

**Assistant `diagnostics` are not stored.** `stop_reason` plus `error_message` answer the
ticket's "error state". `AssistantMessage.diagnostics` is available if ticket 11 wants
provider-level failure detail; it can be added by migration.

### The `touched` edge, after the two upstream findings

Ticket 01's supersession mechanism rests on comparing one Decision's `oldText` against
another's `newText`. Taking those from the tool **arguments**, as ticket 01 assumed, does not
work:

1. **`edit` fuzzy-matches.** `applyEditsToNormalizedContent` (`edit-diff.ts:301`) runs
   `fuzzyFindText` and, when any edit matched fuzzily, replaces against
   `normalizeForFuzzyMatch(content)` (`:317-319`) — trailing whitespace stripped, Unicode
   quotes and dashes folded to ASCII. Content is also `normalizeToLF`'d and BOM-stripped
   before matching (`edit.ts:105-107`). So the model's `oldText` can be text that never
   existed in the file, and an overlap test against it proves nothing.
2. **`write` is blind.** `write.ts` calls `env.writeFile` without ever reading the existing
   file and returns `details: undefined` (`:30-34`). A `write` over a tracked file destroys
   content and records nothing about what was destroyed.

The fix for (1) is that `edit` already reports the ground truth: its result carries
`details.patch = generateUnifiedPatch(path, baseContent, newContent)` (`edit.ts:118-122`),
computed from the actual pre- and post-images. `details` survives to the extension —
`agent-loop.ts:785` sets `details: finalized.result.details` on the `ToolResultMessage` that
`turn_end` forwards. So `touched.patch` is the **Applied Change**, and supersession compares
removed lines against added lines, which is strictly better evidence than the two texts ticket
01 planned to store, and smaller.

The **Requested Change** is not duplicated into `touched` — it is already in
`tool_invocation.arguments`, verbatim. Keeping both available means "the model asked for X but
Y landed" stays an answerable question.

For (2) there is no fix at capture time: the pre-image is gone by `turn_end`. `write` gets
`patch = NULL` and `new_text` = the content that landed. **Supersession across a `write` is
blind, and this is a new accepted hole.**

**Failed calls create no Touch.** Ticket 01 defined Touch as *changed*; a call that threw
changed nothing. It is still fully recorded in `tool_invocation` with `is_error = 1`, so no
information is lost and the edge stays honest. This removes any need for an `applied` column.

**One Touch per call.** The `edit` tool takes one `path` and an `edits[]` array
(`edit.ts:27-34`), and emits one whole-file patch for the call — so `(decision_id, call_id)`
is a sufficient key and no per-edit ordinal is needed.

### Indexes, and the three queries the ticket named

| Query | Plan | Index |
|---|---|---|
| all Decisions in time order | `ORDER BY id` — uuidv7's first 48 bits are big-endian epoch ms, and Pi's implementation increments a sequence within a millisecond (`packages/ai/src/utils/uuid.ts:20-26`), so lexicographic order *is* generation order | none — it is the PK |
| all Decisions touching X | `touched.path → decision_id` | `touched_path` |
| the Decision that caused this error | `tool_invocation.is_error = 1`, or `decision.error_message IS NOT NULL` | **none, deliberately** |
| all Decisions in one Session, ordered | leading `session_id`, then id | `decision_session` |

**Two indexes, not five.** Errors are a scan: a heavy year on one project is on the order of
1e5 Decisions, and SQLite scans that in single-digit milliseconds against a viewer that is
interactive but not per-keystroke. `touched_path` earns its place because it is the viewer's
hot path and grows with the repo. The tripwire is explicit: **add an index when a query is
measured slow, not when one is imagined slow.**

Cross-process ordering caveat: `uuidv7`'s sequence counter is module-global per process
(`uuid.ts:1-2`), so two Pi processes writing the same store in the same millisecond interleave
arbitrarily. Within a Session — where every Decision costs a model round trip — this cannot
arise.

### Migration story

**Reuse the pattern in `packages/session-backends/sqlite-node/src/sqlite/migrations.ts`, not
`packages/coding-agent/src/migrations.ts`.**

`coding-agent/src/migrations.ts` is not a schema migration system at all: it moves
`oauth.json` into `auth.json` and relocates misplaced session files (`:21`, `:76`). No SQL, no
versioning, no ordering. Wrong problem.

The sqlite-node backend has the right pattern in ~15 lines: a `migrations(id, applied_at)`
table, an ordered list of named migrations, each applied inside a transaction and recorded
(`migrations.ts:35-49`). Two deviations, both deliberate:

- **Pattern reuse, not code reuse.** `applyMigrations` hardcodes its own `loadMigrations()`
  list (`:37`), so it cannot be pointed at another package's migrations. Importing the package
  to re-implement the one function it exports is worse than copying fifteen lines.
- **Migration SQL inlined in TypeScript, not loaded from `.sql` files.** The backend reads its
  SQL with `readFile(fileURLToPath(new URL(…, import.meta.url)))` (`:12-14`), which makes the
  `.sql` files a packaging obligation for every consumer. An exported
  `MIGRATIONS: { id, sql }[]` array has no file IO and no build step.

`PRAGMA user_version` was considered and rejected: an integer is smaller, but named migrations
with an applied-at timestamp cost the same code and the ticket states outright that the schema
*will* change.

### Write path and crash safety

One transaction per `turn_end`, on the calling thread, using prepared statements cached on the
store:

```
BEGIN IMMEDIATE
  INSERT OR IGNORE INTO decision        …   -- if changes == 0, the Decision already exists:
  INSERT OR IGNORE INTO tool_invocation …   -- commit and return, skipping children
  INSERT OR IGNORE INTO touched         …
COMMIT
```

Batching across turns was rejected for the reason ticket 03 rejected an async queue: a buffer
loses the tail of a session on `SIGKILL` and needs its own ordering discipline. The whole
write is sub-millisecond against a turn that already cost seconds of model time.

`journal_mode = WAL` with `synchronous = FULL` and `busy_timeout = 5000` matches the settings
Pi's own SQLite session backend uses (`sqlite/repo.ts:173-175`), which also makes concurrent
Pi processes on one repo safe. `FULL` costs one fsync per turn — irrelevant here, and it is
what makes ticket 03's "nothing is lost on crash" true rather than aspirational.

**Refinement to ticket 03's store location.** `<cwd>/.pi/decision-graph.db` stands, but WAL
creates `-wal` and `-shm` siblings, so the gitignore line must be a glob:

```
.pi/decision-graph.db*
```

### Size, measured

Projected from 289 real assistant messages across 17 local agent transcripts of *this repo*,
regrouped by message id so one row is one Decision. Different harness, same content shape
(thinking + text + tool calls with arguments + paired results).

| Variant | median | p90 | p99 | max | mean | 1000 Decisions |
|---|---|---|---|---|---|---|
| store results verbatim | 1.8 KB | 6.2 KB | 28.0 KB | 68.2 KB | 3.1 KB | **3.0 MB** |
| cap each result at 4 KB | 1.8 KB | 5.2 KB | 11.1 KB | 11.6 KB | 2.3 KB | 2.3 MB |
| WHY + arguments only | 357 B | 2.5 KB | 11.0 KB | 11.4 KB | 1012 B | 989 KB |

Components: thinking p90 169 B; text p90 431 B; arguments median 269 B / p90 2.0 KB; results
median 463 B / p90 5.1 KB / max 67.7 KB. Tool calls per Decision: median 1, p90 2, max 6.
Edit-or-write payload appeared in 29 of 289 Decisions (10%), median 1.1 KB, p90 9.0 KB.

**Verdict: store verbatim. No truncation, no pruning, no size knob.** The capped variant was
measured rather than assumed, and it saves 0.7 MB per thousand Decisions in exchange for a
tunable and permanently lost evidence. A year of heavy single-project use lands in the low
hundreds of megabytes. Retention stays in the map's "not yet specified" bucket with a stated
tripwire: **revisit when a real store passes ~1 GB**, not before.

Two honest caveats on the numbers: the transcripts come from a different harness, so the rung
mix they show (19% thinking / 28% text-only / 53% none) is *not* a prediction for Pi — Pi's
coding-agent defaults thinking to `"medium"` (`defaults.ts:3`) while `packages/evals` pins it
`"off"` (ticket 02). And the `edit` patch is approximated by argument size; a unified patch
with 4 lines of context is the same order of magnitude as the edits that produced it.

### Accepted holes

1. **Supersession is blind across `write`.** No pre-image exists at `turn_end`. Upgrade paths,
   neither built: a `tool_call` subscriber snapshotting content before the write (which ticket
   03 declined for arg-rewriting, and which reintroduces per-`toolCallId` state), or Assembly
   reconstructing a baseline from git — the same class of evidence ticket 01 already accepts
   for renames.
2. **Fuzzy-matched edits are recorded honestly but asymmetrically.** `touched.patch` is exact;
   the model's request in `tool_invocation.arguments` may not correspond to any text that ever
   existed. Nothing detects the divergence yet.
3. **Bash mutations still produce no Touch** — inherited unchanged from ticket 01, and now
   with a second beneficiary: the same raw `tool_invocation` rows also feed the rename
   evidence that moved to Assembly.
4. **`raw` is an unwritten enum value** until a model-identity table exists to justify
   re-labelling.

### Consequences for other tickets

- **05 (redaction)** — the secrets surface is now enumerable and slightly *smaller* than ticket
  01 implied: `decision.thinking`, `decision.text`, `tool_invocation.arguments`,
  `tool_invocation.result_text`, `touched.patch`, `touched.new_text`. Ticket 01 warned that
  edit text is a first-class secrets surface; it is `patch` and `new_text` specifically.
  Nothing is reserved for redaction in this schema — 05 owns the policy and gets a migration
  if it needs columns.
- **06 (ordering)** — inherits a sharper fact than "turn numbering may change": `turn_index`
  is already per-Run and already ambiguous within a Session (`agent-session.ts:729`).
  `run_id` is the fix this schema ships; 06 owns whether anything else needs one.
- **07 (edges)** — `touched` is the only edge Capture writes. Everything 07 adds is an
  Assembly-derived table, and `renamed_to` now lands there too rather than being fed by a
  capture-side evidence table.
- **09 (consumption)** — `decision_why` view plus `why_source` gives it the L3/L4 handling
  ticket 02 demanded, and `compaction` rows tell it where context was dropped.
- **10 (viewer)** — `why_source` distinguishes "reasoned, not shown" (`redacted`, `omitted`)
  from "did not reason" (`none`), which ticket 02 required it not collapse.
- **11 (metrics)** — token and cost columns are per-Decision, so rung distribution and spend
  are reportable alongside task scores with no extra instrumentation.
- **12 (symbol resolver)** — **its cheap path just got more expensive.** Ticket 01's empirical
  finding was that `git diff` emits the enclosing declaration in hunk headers. Pi's stored
  patch does not: `generateUnifiedPatch` uses `Diff.createTwoFilesPatch` with
  `FILE_HEADERS_ONLY` (`edit-diff.ts:366-371`), which emits bare `@@ -2,6 +2,6 @@`. Verified
  empirically. The four lines of context around each hunk often include the declaration but
  never label it, so 12 must resolve from `path` + patch content, or re-run `git diff` at
  Assembly.
- **13 (temporal relevance)** — supersession runs on `touched.patch`, and must treat a
  `patch IS NULL` row (`write`) as unprovable rather than as no-overlap.

### What this touches

One new file, `packages/decision-graph/CONTEXT.md` — the glossary. It is a new directory, so
it adds no upstream conflict surface, and `npm install` was verified to tolerate a workspace
directory matching `packages/*` that has no `package.json`. No existing file is modified. The
DDL above is specified, not built; it lands in `packages/decision-graph/src/store.ts` when the
build starts.
