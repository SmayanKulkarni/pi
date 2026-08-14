# 14 — Build spec: temporal Decision graph

Type: spec
Labels: ready-for-agent
Status: open
Assignee: Smayan Kulkarni
Blocked by: 01–13 (all closed)

## Problem Statement

Every non-trivial line in this repo was written for a reason, and that reason is destroyed within
minutes of being produced. The agent generates a rationale for each thing it does, the harness shows
it once in the terminal, and it then survives only inside a session transcript that nobody reads and
that no query can reach. A week later the code remains and the WHY is gone.

This costs the human and the agent in the same way. Coming back to a file, neither can tell whether a
strange-looking guard is load-bearing or leftover, whether an approach was chosen or merely settled
for, or whether the obvious simplification was already tried and reverted. The only recovery routes
are re-reading whole files to infer intent, or grepping design notes that may not exist. A fresh
Session starts with no memory of the project at all, so the agent reconstructs structure and
constraints from scratch — expensively, in tokens, and often wrongly, re-making a mistake the record
would have shown it.

Existing tools answer a nearby question and not this one. `git blame` names a commit, which is a batch
of work with a message written after the fact; it cannot name the reasoning that produced one hunk,
and it says nothing about attempts that were abandoned before a commit. Session transcripts hold the
rationale but are unindexed, per-Session, and not addressable by file or by line.

## Solution

A Decision graph, recorded by the harness as it works and queryable afterwards by both the agent and
the human.

While the agent runs, Capture writes down what it witnessed — each Decision (one assistant message:
its WHY, its prose, the tool calls it issued), which Files it Touched and what actually landed in
them, and the surrounding lifecycle facts (Sessions, Sittings, Steers, Compaction Boundaries). This
costs no model calls and no tokens: the WHY has already been generated and paid for, and Capture
merely stops throwing it away. Everything lands in a project-local Store that appears on its own the
first time there is something to record.

Afterwards, Attribution answers the question the human and the agent both actually ask. Instead of
listing every Decision that ever touched a File, it replays the recorded Applied Changes backwards
from the File as it stands on disk and claims each current line for the last Decision that wrote it —
`git blame` over Decisions instead of commits. So a Decision's Standing is a measured quantity, not a
guess, Supersession is simply the absence of it, and where the record can no longer account for a
File's contents the answer says so rather than presenting a partial history as a complete one.

The agent reaches it through one tool, `query_decisions`, which takes a path and optionally a line and
returns a temporally ordered set of Decisions with their WHY and the current-file line ranges each
still owns. It is pulled on demand, so it costs nothing on turns where it is not asked. The single
exception is the Nudge: after a Compaction Boundary the agent is told which Files the discarded span
had Decisions about, because that is the one moment it cannot know it has forgotten something.

The human reaches it through a standalone viewer that renders a File partitioned by owning Decision,
with a scrubber that moves "now" backwards and re-derives the partition at each stop, so Supersession
is visible as a Decision's colour shrinking. Hovering a line answers "why is this line here" in under
ten seconds.

Whether any of this actually helps is then measured rather than asserted, through three experiments in
`packages/evals` against a seeded fixture Store.

## User Stories

### Recording

1. As a developer, I want the agent's rationale recorded as it works, so that the reasoning behind my
   codebase outlives the terminal scrollback it was printed to.
2. As a developer, I want recording to cost no extra model calls and no extra tokens, so that keeping
   the history is never a thing I have to weigh against my bill.
3. As a developer, I want recording to add no perceptible latency to a turn, so that I never notice it
   is on.
4. As a developer, I want no init step, so that the feature has no "you forgot to set it up" failure
   mode and no command to remember.
5. As a developer, I want a `pi` invocation that produces no Decision to leave no Store behind, so that
   asking the agent one question does not litter my project with a database.
6. As a developer, I want one Store per project covering every Session and every branch, so that the
   history follows the code rather than the conversation.
7. As a developer, I want a Decision recorded even when the model produced no WHY at all, so that the
   majority of the agent's history is representable rather than silently missing.
8. As a developer, I want to know which rung a WHY came from — the model's own reasoning, a provider
   summary, an acknowledged-but-unreadable block, the assistant's prose, or nothing — so that I can
   tell "reasoned, not shown" apart from "did not reason".
9. As a developer, I want failed, aborted and retried Decisions recorded like any other, so that the
   record shows what the agent tried and not only what worked.
10. As a developer, I want a tool call that the model issued but that never executed to still be
    recorded, so that an abort mid-batch does not silently erase the tail of what was attempted.
11. As a developer, I want what actually landed in a File recorded rather than what the model asked
    for, so that "the model asked for X but Y landed" stays an answerable question.
12. As a developer, I want a whole-file rewrite to record what it destroyed, so that it claims only
    the lines it changed instead of flattening every earlier Decision's ownership.
13. As a developer, I want a mid-Run interruption recorded as a Steer, so that the graph can show
    where a human redirected the agent rather than inferring it from timing.
14. As a developer, I want Compaction Boundaries recorded, so that the record knows where context was
    discarded even though it never lost anything itself.
15. As a developer, I want each Decision stamped with the branch of the Session tree it was actually
    on, so that a `/tree` jump does not make the graph assert a succession that never happened.
16. As a developer, I want the record to distinguish a Sitting from a Session, so that "the same work,
    months apart" and "one continuous stretch" are not the same fact.
17. As a developer, I want the agent's own account of what it did stored verbatim rather than
    truncated, so that I never find the interesting part of a rationale cut off by a size knob.

### Not recording

18. As a developer, I want nothing captured on a project I have not trusted, so that opening someone
    else's repo never starts a database of their code in their directory.
19. As a developer, I want nothing captured when I explicitly asked for no session, so that "do not
    save this conversation" is honoured everywhere and not only where it was convenient.
20. As a developer, I want secrets scrubbed as they are recorded rather than as they are read, so that
    the file on my disk is not itself the liability.
21. As a developer, I want an edit to a credential file redacted on the strength of the file's identity
    alone, so that a value that looks like nothing still does not land in the Store.
22. As a developer, I want a redaction to say what class of thing it removed, so that I can triage a
    false positive without recapturing anything.
23. As a developer, I want a redaction failure to cost me one field and not the whole Decision, so
    that a bug in the scrubber does not silently drop history.
24. As a developer, I want to be told once if the Store is not covered by an ignore rule, so that I
    find out before I commit it and not after.
25. As a developer, I want the feature to never edit my project's own files to protect itself, so that
    a background recorder is not also an uninvited author.

### Surviving failure

26. As a developer, I want a broken or corrupt Store to disable recording for the rest of the process
    and nothing else, so that a database problem is never an agent problem.
27. As a developer, I want the failure reported once rather than every turn, so that a bad Store does
    not turn into a wall of noise.
28. As a developer, I want the feature to never delete or rebuild my Store to recover from an error,
    so that my history is never the price of a transient fault.
29. As a developer, I want two `pi` processes in the same project to be safe against each other, so
    that I can run more than one without thinking about it.

### Consulting as the agent

30. As the agent, I want to ask what the record says about a File, so that I can learn why it is the
    way it is without reading it end to end.
31. As the agent, I want to ask about one line, so that a stack trace lands me on the Decision that
    wrote the failing line and its WHY.
32. As the agent, I want the answer to name current-file line ranges, so that I can join it to a code
    graph and land on the declarations involved rather than on a file.
33. As the agent, I want the answer ordered so that Decisions still standing come before those that do
    not, so that the most load-bearing history arrives first when the budget is tight.
34. As the agent, I want abandoned attempts included rather than filtered out, so that "this was tried
    and it broke Y" is available to me and not only "this is what survived".
35. As the agent, I want the answer to cost a fraction of the context I have left rather than a fixed
    amount, so that it is generous in a fresh Session and self-limiting in a full one.
36. As the agent, I want the answer to degrade to a header and counts under context pressure, so that
    consulting the record can never itself trigger the compaction it was meant to survive.
37. As the agent, I want to be told when the record cannot account for a File past some point, so that
    I do not read a partial history as a complete one.
38. As the agent, I want to be told when a File is no longer on disk, along with when it was last
    written and why, so that an absent File is an answer rather than an error.
39. As the agent, I want the result to state facts about the record and never instruct me in what to
    do about them, so that the tool informs my method without steering it.
40. As the agent, I want dates stated absolutely, so that a result persisted into a Session and re-read
    a week later is still true.
41. As the agent, I want to be told after a compaction which Files the discarded span had Decisions
    about, so that I know a Consultation is available at the one moment I cannot know I forgot.
42. As the agent, I want that Nudge to carry names and no rationale, so that it restores my awareness
    without answering a question I did not ask.
43. As the agent, I want no such tool to exist at all when there is nothing recorded, so that an empty
    project and an unrecorded one behave identically.
44. As the agent, I want the tool to keep answering emptily rather than vanish if the Store fails
    mid-Session, so that my available tools do not change under me.

### Inspecting as a human

45. As a developer, I want to see a File partitioned by which Decision owns each of its current lines,
    so that ownership is falsifiable against the file on disk rather than asserted.
46. As a developer, I want to hover a line and be told the owning Decision, its date and its WHY, so
    that "why is this line here" costs one gesture.
47. As a developer, I want to scrub time backwards and see ownership re-derived at each stop, so that
    I watch a Decision's Standing shrink as later Decisions take its lines.
48. As a developer, I want lines that no Decision is known to have written rendered plainly as
    unowned, so that the view degrades to "we do not know" and never to a confident wrong owner.
49. As a developer, I want to click a Decision and have every line it does not own recede, so that I
    can isolate one Decision without losing the partition that gives it meaning.
50. As a developer, I want a Decision that owns no current line to still say what it was about, so
    that an abandoned attempt reads as "was about `bar` in `Foo`" rather than as a blank row.
51. As a developer, I want redactions rendered as visibly cut rather than as ordinary text, so that a
    placeholder never reads as file content.
52. As a developer, I want the viewer to be one self-contained file with no external hosts, so that I
    can open it anywhere and it works.

### Measuring

53. As the maintainer, I want to measure that Capture adds no tokens and no meaningful latency, so
    that the central claim of the design is checked rather than assumed.
54. As the maintainer, I want to measure whether consulting the record reduces the tokens spent
    reaching a correct answer, so that the context-economy claim is falsifiable.
55. As the maintainer, I want a placebo arm that is equally instructional and not merely equal in
    tokens, so that I do not mistake the effect of telling the agent to consult for the effect of the
    information it consults.
56. As the maintainer, I want tasks judged by deterministic code, so that the result carries no
    LLM-judge variance and no LLM-judge cost.
57. As the maintainer, I want the arms to differ in exactly one thing, so that a seeded fixture is
    used rather than a first phase whose output varies per run.
58. As the maintainer, I want to know how often the record fails to account for a File, so that
    whether unwitnessed mutations are worth witnessing becomes a measurement rather than an argument.
59. As the maintainer, I want to know whether the agent asks when it has a path and stays silent when
    it does not, so that a missing project-wide query mode is detected rather than guessed at.

## Implementation Decisions

### Shape and placement

- The whole feature is a new workspace package, `packages/decision-graph`, loaded into the fork as a
  pi extension. It is inside the repo's typecheck, lint and test configuration, and being a new
  directory it adds no upstream rebase conflict surface.
- Exactly one existing Pi file is modified across the entire build: the eval harness in
  `packages/evals`, which asserts that an eval Session starts with zero extensions and pins thinking
  off. Both are relaxed there, about ten lines. Nothing in `packages/agent` or
  `packages/coding-agent` is forked. Every interception point the design needs — registering a tool,
  observing turns, observing tool execution before it runs, observing compaction, sending a message —
  is already public extension surface.
- Five modules, in dependency order: the **Store** (schema, migrations, write path, redaction), the
  **Capture** extension entry point, **Attribution** (the replay walk and the Symbol Label scan), the
  **Consultation** tool (the tool definition, the renderer, the budget rule, the Nudge), and the
  **viewer**. Then the eval work in `packages/evals`.
- The vocabulary in the package's `CONTEXT.md` is binding on all of them and is not re-litigated
  during the build. Every term used in this spec is defined there.

### The Store

- Project-local SQLite, one file per cwd, inside the project's configured pi config directory — which
  is read from configuration rather than hardcoded, because this is a fork and that directory is
  overridable. Scoped to cwd with no upward search and no git-root resolution, matching what the rest
  of the harness does. Worktrees therefore get separate Stores with no code.
- Synchronous writes through the standard-library SQLite binding, already used elsewhere in the repo,
  so no new runtime dependency. One transaction per Decision, WAL, full synchronous, a five-second
  busy timeout. Batching is rejected: a buffer loses the tail of a Session on a hard kill and needs
  its own ordering discipline.
- No init step. The Store is created by the first Decision write in a process, not at Session start.
  The Session and Sitting rows are buffered in memory and inserted in that same transaction, so rows
  exist only for Sessions that produced something to explain.
- Three gates evaluated before any file is opened: the project must be trusted; the Session must be
  persisted (an explicitly unsaved conversation is not durably recorded); and the Store must not
  already be disabled by an earlier error.
- Migrations follow the pattern of the repo's existing SQLite session backend — a table of applied
  migration ids, an ordered list, each applied in a transaction — but the SQL is inlined in
  TypeScript rather than read from `.sql` files, so there is no packaging obligation and no file IO.
  The pattern is copied, not imported; the existing implementation hardcodes its own migration list
  and cannot be pointed elsewhere.
- Every table is Capture-written and insert-only. There is no Assembly-written column anywhere. All
  derived relations are read-time views or functions.

The schema, which encodes several rulings more precisely than prose can. It is the ticket-04 design
with the corrections from tickets 08, 09, 12 and 13 already folded in, so it is buildable as written:

```sql
CREATE TABLE session (
    id                   TEXT PRIMARY KEY,
    cwd                  TEXT NOT NULL,
    session_file         TEXT,
    parent_session_file  TEXT              -- a path, not an id; only ever set by fork/clone
);

CREATE TABLE sitting (                     -- one continuous period of work on a Session
    id                 TEXT PRIMARY KEY,   -- uuidv7, interleaves with decision.id
    session_id         TEXT NOT NULL REFERENCES session(id),
    ts                 INTEGER NOT NULL,
    reason             TEXT NOT NULL
        CHECK (reason IN ('startup','reload','new','resume','fork')),
    prev_session_file  TEXT
);
CREATE INDEX sitting_session ON sitting(session_id, ts);

CREATE TABLE decision (
    id              TEXT PRIMARY KEY,      -- uuidv7; lexicographic order == temporal order
    content_hash    TEXT NOT NULL UNIQUE,  -- idempotency only, never an addressing key
    session_id      TEXT NOT NULL REFERENCES session(id),
    run_id          TEXT NOT NULL,         -- diagnostic only, never used for ordering or grouping
    turn_index      INTEGER NOT NULL,      -- position within the Run. NOT identity.
    ts              INTEGER NOT NULL,
    leaf_entry_id   TEXT,                  -- the Session-tree entry, so /tree branches are visible

    api             TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    response_model  TEXT,

    thinking        TEXT,
    text            TEXT,
    why_source      TEXT NOT NULL
        CHECK (why_source IN ('raw','summary','redacted','omitted','text_only','none')),

    stop_reason     TEXT NOT NULL,
    error_message   TEXT,

    tok_input       INTEGER NOT NULL,
    tok_output      INTEGER NOT NULL,
    tok_reasoning   INTEGER,
    tok_cache_read  INTEGER NOT NULL,
    tok_cache_write INTEGER NOT NULL,
    cost_total      REAL NOT NULL
);
CREATE INDEX decision_session ON decision(session_id, id);

CREATE TABLE tool_invocation (             -- every tool, no interpretation
    decision_id  TEXT NOT NULL REFERENCES decision(id) ON DELETE CASCADE,
    call_id      TEXT NOT NULL,
    ordinal      INTEGER NOT NULL,         -- index into the model's own toolCalls array
    name         TEXT NOT NULL,
    arguments    TEXT NOT NULL,            -- the Requested Change, verbatim
    result_text  TEXT,                     -- NULL when no result arrived
    is_error     INTEGER,                  -- NULL when no result arrived
    PRIMARY KEY (decision_id, call_id)
);

CREATE TABLE touched (                     -- the only edge Capture creates
    decision_id  TEXT NOT NULL,
    call_id      TEXT NOT NULL,
    path         TEXT NOT NULL,            -- cwd-relative, as the harness itself resolved it
    kind         TEXT NOT NULL CHECK (kind IN ('edit','write')),
    patch        TEXT,                     -- the Applied Change, unified. NULL for write.
    new_text     TEXT,                     -- write only: the content that landed
    old_text     TEXT,                     -- write only: '' = did not exist, NULL = no snapshot
    PRIMARY KEY (decision_id, call_id),
    FOREIGN KEY (decision_id, call_id)
        REFERENCES tool_invocation(decision_id, call_id) ON DELETE CASCADE
);
CREATE INDEX touched_path ON touched(path);

CREATE TABLE steer (                       -- a user message arrived mid-Run
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL
);
CREATE INDEX steer_session ON steer(session_id, ts);

CREATE TABLE compaction (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    will_retry  INTEGER NOT NULL,
    entry_id    TEXT
);

CREATE VIEW decision_why AS                -- the WHY rung rule, written once
SELECT id, session_id, run_id, turn_index, ts, why_source,
       CASE why_source
           WHEN 'raw'       THEN thinking
           WHEN 'summary'   THEN thinking
           WHEN 'text_only' THEN text
           ELSE NULL
       END AS why
FROM decision;
```

- Two indexes, not five. Errors are a scan; a heavy year on one project is on the order of 1e5
  Decisions and SQLite scans that in milliseconds. Add an index when a query is *measured* slow.
- Records are stored verbatim. Measured against 289 real assistant messages: median 1.8 KB per
  Decision, about 3 MB per thousand. Capping results saves 0.7 MB per thousand in exchange for a
  tunable and permanently lost evidence. Retention is revisited if a real Store passes ~1 GB.
- `content_hash` covers the Session, the timestamp, the WHY text and each call's id, name and
  canonical arguments — deliberately not a serialisation of the message object, whose key order is a
  property of the harness version that parsed it. With insert-or-ignore, replay and crash-retry
  cannot duplicate a Decision.

### Capture

- A Decision is one assistant message, taken at the turn boundary, which carries the WHY, the prose,
  the tool calls with their arguments and the paired results in one payload. Alternatives were
  rejected: one per tool call copies one WHY across five rows or leaves four without one; one per
  message *with reasoning* makes the common WHY-less case unrepresentable; one per Run loses the
  ordering the graph exists to show.
- The turn event's message type is a union that includes user and tool-result messages. Capture
  guards on the assistant role and silently ignores anything else rather than casting.
- Tool invocation rows are sourced from the model's own tool-call array, not from the results array,
  with the array index as the ordinal. Sourcing from results silently drops calls that never executed
  after an abort mid-batch, and makes the ordinal depend on which array happened to be iterated.
  Ordering under parallel execution needs no work: results are collected in submission order, so the
  only ordering Capture ever observes is already deterministic.
- Only `edit` and `write` produce a Touch, and only when they succeeded — a call that threw changed
  nothing. Failed calls remain fully recorded as invocations, so nothing is lost and the edge stays
  honest.
- `touched.path` stores the cwd-relative form of the path the harness itself resolved, with posix
  separators, falling back to absolute when the target is outside cwd. This is a correction to the
  earlier "verbatim from tool args" rule: the tools resolve the path to touch the disk but echo the
  model's raw string, so one File would otherwise accumulate four identities and a lookup would miss
  most of its own history. Recording a path the harness computed and used is witnessing, not
  inferring. The model's raw string remains verbatim in the invocation arguments.
- A `write`'s pre-image is snapshotted at tool-execution-start, which is awaited before the tool runs,
  and held in a per-turn map keyed by call id that is drained unconditionally at the turn boundary.
  Three states matter and the empty string is load-bearing: `''` means the target did not exist, so
  the write is the File's origin; a non-empty value is a real pre-image; `NULL` means no snapshot and
  is a Break going backwards.
- A Steer is detected by a capture-time rule, not by inferring position in the Session file: Capture
  holds one boolean per active Run — has a turn fired yet — and a user message is a Steer if and only
  if that flag is already set. Only the Session and timestamp are stored; the text is already in the
  Session file.
- Each Decision stores the Session-tree entry id that was the leaf when it ended, so Assembly can walk
  the tree and derive an exact predecessor. This is what stops `follows` asserting a succession across
  an abandoned `/tree` branch. Walking is Assembly's job; timestamp order is the fallback when the
  Session file is gone.
- Resuming a Session is not a boundary — it reuses the Session id. Forking is, and it records a parent
  *path* because that is what the harness stores. The boundary that does exist on every reopen is the
  Sitting.
- Store failure is one-strike: log once, disable for the life of the process, make every later handler
  an immediate return. No auto-repair, no auto-delete, no re-create over a corrupt file. Recovery is a
  human deleting the file; the next process creates a fresh one lazily.

### Redaction

- Applied at Capture, to seven columns: the WHY thinking and text, the invocation arguments and result
  text, and the Touch's patch, new text and old text. No separate export-time pass and no migration —
  placeholders are ordinary strings in columns that already exist.
- Three layers. Path-driven and unconditional: for a Touch on a dotenv or credential-shaped path,
  every key-value-shaped value is redacted regardless of whether the value looks secret. Known-env
  literal: any environment entry whose *name* is secret-shaped and whose value is long enough to not
  false-positive is substring-matched across all seven columns. Pattern-based: vendor token shapes and
  a generic assignment heuristic over both free text and structured content.
- Placeholders name the category rather than blanking, so a false positive can be triaged without
  recapture.
- The bar is defense-in-depth against casual exposure, explicitly **not** a claim that the Store is
  safe to hand to a stranger. No pattern layer can drive false negatives to zero against a shapeless
  secret. Anything needing the stronger bar needs a human-reviewed export gate, which is not built.
- A redaction failure replaces that one column with a sentinel and writes the rest of the Decision
  normally. Failing open was rejected: it fails exactly when the safeguard is least trustworthy.
  Dropping the Decision was rejected: it destroys six clean columns to protect one.
- The Store's ignore coverage is checked once at creation and a single warning is emitted if it is not
  covered. The project's own ignore file is never written to — a background recorder editing files it
  does not own is an overreach.

### Attribution

- Supersession is not computed pairwise. The pairwise overlap rule the original ticket proposed is
  position-blind — a closing brace deleted at line 900 would supersede one added at line 40 — and
  cannot express partial supersession, which is the common case.
- Instead: replay the Applied Changes for a path backwards from the working-tree file, newest first,
  claiming each current line for the first Decision found to have written it. Because the walk runs
  newest first, the last writer claims the line and every earlier writer finds it already owned. Lines
  no recorded Touch accounts for stay unowned, which is the honest answer for content that arrived by
  an unwitnessed route.
- This is admissible because the harness's own test suite asserts that applying a recorded patch to
  the original content reproduces the final content, including for fuzzy multi-edits. Replay is
  arithmetic, not heuristic.
- Two required inputs, and the second is external to the Store: the Touch rows, and the File on disk.
  "Which Decisions explain the current state" is unanswerable without the second. The consequence is
  stated rather than hidden: switching branches legitimately changes the answer.
- It is a function, not a table and not a view. Anything materialised is stale on the next edit.
  Assembly's output is a discardable cache; only Capture's tables are the record.
- The walk maintains the reconstructed file, a parallel map from each reconstructed position to its
  index in the current file, and a claim-once owner array indexed by current line. Hunks are walked in
  descending order so earlier indices stay valid; the window is verified before claiming; the
  reverse-splice restores the pre-image.
- All three content sources (patch, stored new text, disk) are canonicalised identically — BOM
  stripped, line endings normalised — before any comparison, because the patch is computed in a
  normalised space that disk does not share. Comparison inside that space is line-based and verbatim.
  No whitespace folding: verbatim is what makes hunk verification exact, and formatter runs go through
  the shell and produce no Touch at all, so they are invisible rather than falsely superseding.
- A window that fails to verify is a **Break**. The walk stops for that path and everything older is
  returned as unattributable — neither surviving nor superseded. A write with a pre-image admits a
  stronger check than any edit, because its stored content is a full post-image.
- The Symbol Label is produced *inside* this walk, because the walk already holds the File
  reconstructed exactly as each Decision left it. A backward scan for the nearest declaration-like
  line yields the name; the nearest column-zero line yields the container. Git's own rule requires
  column zero and therefore resolves an indented method to its enclosing class; dropping that
  constraint gives method granularity for the same line count. Markdown resolves to its enclosing
  heading; structured data resolves to null. Nothing is stored, which dissolves the backfill question
  entirely: a better resolver applies itself retroactively.
- Tree-sitter is rejected — no parser exists anywhere in the repo, and it would be a new runtime
  dependency plus a grammar per language for precision that is no longer needed. The already-installed
  TypeScript compiler is recorded as the paid-for upgrade path for `.ts` and `.js` if labels prove
  misleading, and is not taken now.
- Renames are crossed when a rename edge exists. It does not exist yet; the rule is stated and inert,
  and until then the walk stops at a rename, which costs history and never fabricates it. A wrong
  rename edge is worse than a missing one, since it grafts one File's history onto another.

The output shape, which fixes the contract between Attribution and both of its consumers:

```ts
type AttributedDecision = {
    decisionId: string;
    ranges: Array<[start: number, end: number]>; // 1-based inclusive, CURRENT file coordinates
    survivingLines: number;                      // 0 for a fully superseded Decision
    writtenLines: number;
    attributable: boolean;                       // false once the walk has passed a Break
    label: { name: string; container: string | null } | null;
};

type Attribution = {
    path: string;
    anchor: "worktree" | "absent";
    attributedThrough: string | null; // oldest Decision the walk reached cleanly
    brokeAt: string | null;           // where the walk stopped; null if clean
    decisions: AttributedDecision[];  // newest first, including fully superseded ones
};
```

- Two entry points: attribute a whole path, and look up the owner of one line. The viewer needs one
  extension the tool does not — owner as of an earlier point in the Decision list — which is an
  optional upper bound on the same walk, not a second implementation.
- Nothing is filtered and no WHY text is returned. Filtering is a windowing choice that belongs to the
  consumer, and returning WHY would silently make the consumer's token-budget decision for it.

### Consultation

- One registered tool taking a path and an optional line, advertised through the tool definition's own
  prompt snippet and guidelines. No system-prompt override, no per-Run injection, no per-call context
  transform.
- The decider is prompt caching, not token volume. The harness marks cache breakpoints on the system
  prompt, the last tool definition and the last user block, in that prefix order. A tool's snippet is
  folded into the base prompt once at registration, so the prefix stays byte-identical for the life of
  the Session. A per-Run system-prompt injection changes the first element of the prefix every Run,
  re-reading the tools and the entire conversation at write price — and it gets worse as the Session
  grows, which is exactly when the graph becomes useful.
- Per-Run and per-call pushes are additionally rejected because both require the extension to *guess*
  which paths matter. A tool moves relevance to the only party that knows it.
- The answer is rendered as plain text, not JSON: it is going into a model's context, and braces and
  keys are pure overhead against the same information. Per Decision it carries the absolute date, the
  current-file line ranges, surviving-of-written counts, and the WHY. Not the patch, not the
  arguments, not model or provider or cost. Dates are absolute because a result gets persisted into a
  Session and re-read on a later day.
- Decision ids are not rendered into the text — a uuid is 36 characters that no tool consumes. They go
  into the result's structured details, which reach the renderer, the Session file and other
  extensions but never the provider payload, so the viewer and the human get them free.
- Ordering is one sort filled to budget, not a drop cascade. Decisions with no WHY are never rendered
  as entries and become one count line, because rationale is the entire product. The rest sort by
  attributable first, then standing, then newest. A cascade was written and discarded: for an absent
  File every Decision is at zero standing, so "drop zero-standing first" empties the answer.
- The budget is proportional to *remaining* context — a quarter of it, capped at roughly 50k tokens,
  with a small fixed fallback when usage cannot be reported. Both fallbacks are real: usage is
  unreportable with no known context window, and is null right after a compaction, which is exactly
  when the Nudge fires. Characters are the unit because the harness's own token estimate is literally
  characters over four. Below a small floor the tool returns the header and count lines only, so it
  degrades to a summary rather than to nothing, and never to something that forces a compaction.
- Repository size is irrelevant to one answer; the scaling variable is one path's touch count. The
  realistic worst case — 200 Decisions on one file — is about 30k tokens, which sits under the cap, so
  on real files the budget does not bind at all.
- The limits of the record are reported as facts on a result the agent asked for: a Break names the
  date past which the record cannot account for the File and counts the earlier Decisions without
  naming them; an absent File names the last recorded write. Pre-Break Decisions are counted and never
  named, because they describe bytes the record cannot account for. A binding phrasing rule applies to
  every line the tool emits: state a fact about the record, never an instruction about what to do with
  it.
- The tool is not registered at all when the project is untrusted, when there is no Store, or when the
  Store holds no Decisions — which satisfies the indistinguishability requirement more strongly than
  asked. It is re-checked when Capture writes the first Decision of a fresh Store, which costs one
  cache invalidation, once in the life of a Store. On Store failure mid-Session the tool stays
  registered and answers emptily, because unregistering would invalidate the cache again for nothing.
- The unsaved-Session gate is a write gate and does not bind a read; the trust and disabled gates do.
- One push exists in the whole design: after a Compaction Boundary, a single message naming the paths
  the discarded span had Decisions about, capped at 40, with no WHY and no ranges. Replacing the
  harness's compaction summary was available and rejected as a quality bar this feature cannot meet.
  Doing nothing was rejected on one point that could not be argued away: after a compaction the agent
  does not know it forgot, so a pull-only tool is not a recovery path. If a future change wants a
  second push, it is changing the shape of the design, not adding a feature.

### Derived relations

All are read-time views over columns the Store already ships. No edge tables.

- **Follows** — the nearest ancestor in the Session's own entry tree, read from that tree when the
  Session file is readable and from Decision id ordering when it is not.
- **Redirected-by** — the first Decision to arrive after a Steer in its Session, paired by timestamp.
- **Caused-by-error** — the predecessor issued a failed call *and* this Decision is not also
  Redirected-by a Steer. Witnessed human redirection outranks inferred error-adjacency; without that
  narrowing, every Steer landing after a failure misreports as autonomous error recovery.
- **Retry-of** — Caused-by-error narrowed to the same tool and, where the tool is anchored to one, the
  same File. Accepted coarseness: for unanchored tools the match is name-only, so two unrelated
  consecutive shell calls read as a retry pair. Tighten only if false positives are observed.
- **Forked-from** — a forked Session's first Decision back to its parent's last, joined on the parent
  path. Degrades to no edge rather than a wrong edge if the parent was never captured or moved.
- **Same-turn** is rejected as nonexistent under a one-Decision-per-turn model. **Co-touched** is
  rejected as a stored pairwise relation: it is already the bipartite Decision-Touch-File structure,
  and materialising pairs is quadratic on a hot file for zero new information.

### Viewer

- The primary view is a File partitioned by owning Decision, not a Decision timeline with code hanging
  off it. The File is the subject; the Decision list is the index. Two panes: Decisions newest-first
  with date, standing bar, counts, ranges and WHY; the File itself line-numbered and tinted by owner.
- Time is a scrubber that **re-derives** ownership at each stop rather than filtering to what existed
  then. The interesting fact is who owned each line then, and that difference is what makes
  Supersession visible as a Decision's colour shrinking. Implemented as owner-as-of-k over a per-line
  writer history, which is the same claim-once rule evaluated at a prefix — so the viewer and the tool
  share one semantics rather than approximating each other. Animated replay is a strictly worse
  scrubber; a layout axis competes with the file's own line order for vertical space.
- Hover a line for the owning Decision, its date and its WHY — this is the ten-second question, and it
  is the same lookup the agent's stack-trace case uses. Click a Decision to expand its WHY in place
  and desaturate every line it does not own. Never a drill-down: that would replace the partition that
  gives one Decision meaning.
- Diffs are deliberately omitted. The line ranges are a better representation of the Applied Change; a
  raw diff is what you look at when you cannot compute ownership.
- Unowned lines render flat with a marked gutter. In the prototype eight of eighty-eight lines are
  unowned and almost all are blank lines, which is what a formatter run through the shell does to a
  file — the view degrading to "we do not know" rather than to a confident wrong owner is the point.
- Legibility is proven at 14 Decisions on one file and honestly not at 500. The File pane does not
  degrade with Decision count; colour is the binding constraint at roughly 20 concurrent owners. A
  density strip above the scrubber is the navigation control the real viewer grows into, and colouring
  by recency band instead of identity is designed and deliberately unbuilt, triggered by a real Store
  rather than a thought experiment.
- Self-contained single HTML file, no external hosts, no build step, no dependency. Redaction
  placeholders render as visibly cut. The existing prototype is deleted when the real viewer lands.
- A graveyard view of recorded paths that no longer exist on disk is available deterministically and is
  the viewer's if it wants it. Its hard limit is stated: the harness has no delete tool and no move
  tool, so the set says which Files died and never why.

### Measurement

- Three experiments, not one, because they have different prerequisites and only one is expensive.
  **E1 overhead**: capture on versus off, asserting that total tokens are unchanged and that added
  per-turn latency is negligible; this is where thinking gets unpinned and the fork's own WHY-rung
  distribution is measured for the first time. **E2 benefit**: three arms over a seeded fixture.
  **E3 observational**: rides on E2 for free.
- The blocking discovery: the eval harness runs every task in a freshly created *empty* temp
  directory, so there is no repository, no history and no Store — the graph-on arm would consult an
  empty Store and be identical to graph-off by construction. Fixed with a seeded fixture Store plus a
  fixture working tree, not a two-phase task, which also removes phase-one variance so the arms differ
  only in the thing under test.
- The fixture is a checked-in JSON description of a scripted history, written into a real Store by a
  builder that goes through the same insert path the extension uses. Binary databases are not checked
  in: they are unreviewable, and generating through the real writer exercises it. The same builder
  writes the fixture source files, because Attribution requires the working tree and the Store to
  agree.
- Three arms: off, placebo, on. Two would confound — registering the tool changes the system prompt as
  well as the available data, so the placebo needs an equally *instructional* snippet for a tool that
  returns nothing useful, not merely an equal-token one. Off-versus-placebo isolates the instruction;
  placebo-versus-on isolates the information.
- The prompt guidelines string is a frozen experimental variable: it is the single largest lever on
  whether the model calls the tool at all. Written down verbatim, fixed before the first run, never
  tuned between arms.
- The primary outcome is **tokens spent reaching a correct answer** on tasks solved in both arms,
  paired by the harness's existing grouping key. Success rate is demoted to a guard. This is a
  correction to the original framing: a paired continuous test needs about 32 pairs where a
  two-proportion test needs 91 for the same detection, which is the difference between an affordable
  experiment and an unaffordable one.
- Twelve tasks in three classes — rationale recovery, repeated mistake, location — times three
  repetitions gives 36 paired runs per arm. Adequate for the primary outcome at moderate effect sizes
  and descriptive only for the success-rate guard, which is stated plainly so a null is not misread.
  There is no task set in this repo at all today, only a smoke test and one extension-authoring eval,
  so authoring twelve tasks and three judges is real work the map did not carry.
- All judges are pure code. The existing extension-authoring eval proves deterministic judges work,
  so there is no LLM-judge cost and no LLM-judge variance.
- Two models on one axis: one reasoning-visible and one reasoning-absent. The fixture's WHY is fixed,
  so this measures whether a *reading* model benefits differently, not whether a *writing* model
  produces better WHY.
- Everything measurable is already reported by the harness — token breakdown, tool-call count, cost,
  wall clock, and a transcript of every tool call. No new instrumentation.
- Caveat carried into any write-up: the caching argument that decides the delivery mechanism only
  applies on Anthropic-family models through OpenRouter, so a run on another model cannot reproduce it
  and must not be cited as evidence about it.

## Testing Decisions

**What makes a good test here.** Assert on what a consumer can observe: the text a Consultation
returns, whether a tool exists in a Session, what Attribution says a line's owner is, what the Store
answers when queried. Do not assert on how the walk splices arrays, how many statements a transaction
prepares, or the order in which handlers ran. Every module in this build has an external surface that
is smaller than its internals — that surface is the test target.

Three seams, chosen so each one covers something the others cannot reach cheaply.

**1. The Session seam** — a small harness owned by `packages/decision-graph` that composes a real
agent Session against the faux provider with a persisted Session and the extension loaded in-process,
in a temp cwd. This exists because both existing test harnesses build an *in-memory* Session manager,
whose Session file is undefined — which is exactly Capture's second gate, so capture is inert under
every harness in the repo today. Owning a small harness keeps the upstream edit count at one
eval-only file.

Tested here, all end-to-end and none of it schema-aware: a scripted Session produces Decisions and a
later Consultation returns their WHY; the tool is absent when the Store is empty and appears once
there is something to say; an edit to a credential-shaped file comes back redacted; a Decision with no
WHY is counted rather than rendered; a Compaction Boundary produces exactly one Nudge naming paths and
no rationale; total tokens are identical with the extension loaded and not, which is E1's claim
asserted as a test rather than only measured in a benchmark; a Store made unwritable mid-Session
disables recording and the Session continues; an untrusted project and an unsaved Session both record
nothing.

**2. The Store seam** — the Store's own write and read API against a temp database. Tested here:
migrations apply once and are idempotent across reopen; the same Decision written twice produces one
row; a Decision and its invocations and Touches are all-or-nothing; each redaction layer removes what
it should and leaves what it should, and a failure in one column leaves the other six intact; each
derived relation view returns the right pairs over a fixture — including the two narrowings that are
easy to get wrong, that a Steer suppresses Caused-by-error, and that Retry-of requires the same tool
and File. These are cheap to assert directly and expensive to provoke through a scripted model.

**3. The Attribution seam** — the walk as a pure function over a fixture Store plus fixture files.
This is arithmetic, and reaching Breaks, fuzzy edits, write pre-images and Symbol Labels through a
faux model would be indirect and slow. Tested here: applying a sequence of real patches to a fixture
and asserting the walk recovers the writer of every line; that a whole-file rewrite with a pre-image
transfers only the lines it changed and leaves older owners intact; that a rewrite without a pre-image
is a Break; that mutating a fixture out of band sets the break marker rather than reporting stale
rationale as live; that an absent File returns every Decision at zero standing rather than an error;
that a fully superseded Decision still reports the declaration it was written inside; and the
invariant the prototype already checks — the sum of every Decision's surviving lines equals the count
of lines any Decision ever wrote.

**Prior art.** The Session seam mirrors the suite-style harness tests in `packages/coding-agent`,
which drive a real Session against the faux provider and assert on emitted events; the same rules
apply, including no real provider, no keys and no paid tokens. The Store seam mirrors the SQLite
session backend's own tests. The eval work mirrors the existing extension-authoring eval, which is a
working two-arm example with a pure-code judge.

**Not given a seam, deliberately.** The rendered answer's exact wording is asserted through seam 1
rather than through a renderer unit test, because the wording is a product decision that will move and
a snapshot of it would be a change detector. The viewer has no automated test; its one derivation is
Attribution, which seam 3 already covers, and its layout is checked by looking at it. The evals are a
benchmark, not a test, and never run in the test suite.

**Repo conventions apply unchanged**: no `any`, erasable TypeScript syntax only, `npm run check` after
code changes, tests run through the repo's test script rather than vitest directly, and no commits
unless asked.

## Out of Scope

- **Forking any core Pi file.** The entire build modifies exactly one existing file, in
  `packages/evals`. Every earlier pre-authorisation to edit core is released unused. Reopening it
  requires its own decision.
- **Upstreaming.** This is a personal fork project. Nothing here is contributed to the upstream
  repository, published, or designed as a cross-vendor record format.
- **Promoting shell-driven mutations to real Touches.** Deletions, renames and in-place rewrites go
  through the shell and are unwitnessed. Ruled tolerable because under Attribution their lines come
  back unowned rather than falsely attributed, and re-scoped to post-implementation: revisit once real
  Stores show how often the record actually breaks.
- **Rename resolution.** The rule for crossing a rename is stated and inert; the edge that would feed
  it is not built. Until it exists the walk stops at a rename.
- **Semantic edge typing.** No classifier, no second model, no labelling of what a Decision *meant*.
  Only relations derivable from witnessed facts.
- **A project-wide "recent decisions" query with no path.** Skipped with a measurable tripwire: if the
  call rate is near zero on tasks whose prompt names no path and healthy on tasks that do, the agent
  wanted to ask and had nothing to ask with, and it gets built.
- **An export gate that makes a Store safe to hand to a third party.** Capture-time redaction is
  defense-in-depth and explicitly does not clear that bar.
- **Retention and pruning.** Growth is measured, the tripwire is a real Store passing roughly 1 GB.
- **Multi-machine or shared graphs, and committing the Store to git.** Worktrees get separate Stores by
  construction and never see each other.
- **A second viewer for the Session tree**, and cross-file navigation generally. The single-File
  partition does not address them and they need their own primary axis.
- **A TUI affordance for the human.** The agent surface is settled; the in-terminal human one is not
  designed.
- **Non-code decision domains** — product, design, writing.
- **Any configuration surface.** The budget constants live in source. A setting is a config surface, a
  documentation obligation and a default nobody tunes; the measurement work owns moving either number
  on evidence, which is a one-line change.

## Further Notes

**Build order, derived from what each piece needs rather than from ticket numbers.** Store, then
Capture, then Attribution, then Consultation — those four are the feature. Then the viewer and the
evals, which are what make it inspectable and falsifiable. The derived relations never get a step of
their own: they are read-time views over columns the first step ships.

**Accepted holes, carried in deliberately.** They are stated here so nobody rediscovers them as bugs.

1. A shapeless secret with no path signal defeats all three redaction layers. This is what pattern
   matching can never guarantee, not an implementation gap.
2. A secret in a shell command has no Touch for the path-driven layer to key on; only the env-value
   and pattern layers apply.
3. A Steer that races past a Run boundary is event-identical to a fresh prompt and is undetectable
   short of a core edit. The relation it would have suppressed then misfires with no way to know.
4. Retry-of matches on tool name alone for unanchored tools.
5. Two concurrent processes on one Session can interleave their id sequences within a millisecond.
   This is the harness's own pre-existing footgun, inherited and not worsened.
6. A stored parent Session path breaks if the file is moved, degrading to no edge rather than a wrong
   one.
7. The stored Session-tree entry is the Decision's last entry, not its assistant entry; the assistant
   entry is a bounded walk away.
8. A Sitting that produces no Decision is never recorded — deliberate, since recording it means writing
   a database for a run that did nothing.
9. A write whose pre-image could not be read is still a wall going backwards.
10. Unwitnessed mutations *outside* any recorded hunk are undetectable — and harmless, because the
    lines they wrote stay unowned. Only mutations intersecting a recorded hunk break the chain, and
    those are reported.
11. Attribution depends on mutable external state, so two runs across a branch switch legitimately
    disagree.
12. Inside a span the model matched fuzzily, the patch's removed lines carry folded text rather than
    original bytes, so verification can mismatch and produce a false Break. Bounded to fuzzy edits and
    reported honestly as a Break rather than as wrong attribution.
13. The Symbol Label scan is a heuristic and will sometimes caption the wrong declaration. The
    consumer is a viewer caption, so the error is cosmetic.
14. A line lookup returns exactly one Decision, which is thin for a stack trace whose interesting
    context is the surrounding block. The re-query without a line is the escape hatch.
15. Nothing detects a stale answer inside one turn: if the agent edits the File after consulting, the
    ranges in its context are wrong. Bounded because the tool is cheap to re-call.
16. The Nudge names paths from the discarded span, not paths the agent still cares about. It is
    deliberately not a relevance judgement.
17. A fixture Store is not a real Store — hand-authored, clean, sized to the task. The honest reading
    of a positive result is "this can help", not "this does help in practice".
18. Twelve tasks written by the same author who designed the mechanism can smuggle in the answer. The
    guard is that all three classes must move together; a result driven only by the class designed to
    show a large effect is not a result.

**Two numbers worth remembering during the build.** A Decision is a median of 1.8 KB stored verbatim,
about 3 MB per thousand — small enough that truncation buys nothing. And a WHY plus its arguments is a
median of 357 bytes, so twenty Decisions of rationale is smaller than one moderately sized source
file. That second number is the entire economic argument for the feature, and it is measured rather
than assumed.

**The one deliberate asymmetry between what the agent gets and what the human gets.** The agent
receives a Consultation only when it asks, because relevance is knowable only by the party doing the
work. The human receives a whole-File partition, because a human scanning a file is already doing the
selection the agent cannot. The two read the same primitive, so they can never drift into disagreeing
about who wrote a line.
