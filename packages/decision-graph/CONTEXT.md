# Decision Graph

The temporal decision graph for this Pi fork: what the agent decided, why, and what it
changed — recorded during normal execution and assembled into a traversable history.
This is the vocabulary every part of the feature uses. Terms here are binding on the
schema, the viewer, the metrics work, and anything that reads the store.

## Language

### The record

**Decision**:
One assistant message — the model's rationale, its prose, and the tool calls it issued,
taken together as a single act. The atom of the graph.
_Avoid_: turn, step, action, node

**Run**:
One agent invocation, from the user's prompt until the agent settles. Contains one or
more Decisions.
_Avoid_: conversation, exchange, request

**Turn**:
Pi's own counter for loop iterations inside a Run. It restarts at zero every Run, so it
names a position, never an identity. A Decision has a Turn; a Decision is not a Turn.
_Avoid_: using "turn" as a synonym for Decision

**Session**:
One Pi session, identified by the session id in its session file. Contains one or more
Runs, and may span months. Forking a Session creates a new one with a recorded parent;
resuming does not — it reopens the same Session.
_Avoid_: chat, thread, transcript

**Sitting**:
One continuous period of work on a Session, from the moment Pi starts or reloads it until
that process lets it go. A Session has many Sittings; the gap between two of them is the
strongest free hint that intent changed.
_Avoid_: session start, run, visit

### Rationale

**WHY**:
The model-generated rationale for a Decision. It is read, never inferred — no second
model is ever called to produce or improve it.
_Avoid_: reasoning, explanation, justification, rationale (as a field name)

**WHY Source**:
Where a Decision's WHY came from, and therefore how much to trust it: model-authored
chain of thought, a provider-generated summary, an acknowledged-but-unreadable block,
the assistant's own prose, or nothing at all. Recorded at capture because it cannot be
recovered afterwards.
_Avoid_: fidelity, confidence, quality

**WHY-less Decision**:
A Decision whose model produced no rationale of any kind. A normal, expected state, not
a defect or a gap to be filled.
_Avoid_: empty decision, incomplete record

### Change

**File**:
A repo-relative path, in the form the harness itself resolved it to, not the form the
model typed. Its identity is that canonical string. The model's own wording is kept
verbatim elsewhere, as part of the Requested Change.
_Avoid_: document, artifact, source file

**Touch**:
The relation created when a Decision changes a File. Only a change counts — reading,
searching and listing a File are recorded but never Touch it.
_Avoid_: access, visit, reference, modify

**Applied Change**:
What actually landed in a File, as reported by the tool after execution. The only
admissible evidence of a change.
_Avoid_: diff, edit, change

**Requested Change**:
What the model asked to happen, as it appears in the tool arguments. May differ from the
Applied Change, and is never substituted for it.
_Avoid_: intent, proposed edit

**Attribution**:
The relation between a line of a File as it stands now and the Decision that last wrote it.
Every line has at most one; a line no Decision is known to have written has none. Derived
from the record and the File itself, never observed.
_Avoid_: blame, ownership, authorship

**Standing**:
How much of what a Decision wrote to a File still survives in it, counted in the lines the
Decision is still Attributed. A matter of degree, not a flag. A Decision with no Standing is
still part of how the File came to be: it is history, not an error.
_Avoid_: live, active, stale, relevant

**Supersession**:
The condition of a Decision whose written lines have been taken over by later Decisions. It
is the absence of Standing, so it is partial in the ordinary case and total only at the
limit. Derived, never observed, and never a change to the superseded Decision.
_Avoid_: overwrite, conflict, invalidation

**Break**:
The point in a File's history past which the record can no longer account for its contents,
because something changed the File that was never witnessed. Everything older than a Break
is unattributable: neither surviving nor superseded, simply unknown. A Break is always
reported when the history it interrupts is handed to anyone, since a history that hides
where it stops reads as a complete one.
_Avoid_: gap, corruption, missing history

**Symbol Label**:
An optional note of which declaration a Touch fell inside, as the File stood when the Touch
happened. It has no identity, so a later rename cannot corrupt it, it can never be a node,
and it is not stored — it is read off the reconstructed File at the moment Attribution passes
that Touch. Absent is an ordinary answer, not a gap.
_Avoid_: symbol node, code entity, declaration node

**Rename Evidence**:
An observation that a File may have moved, drawn from what the agent was seen to do. It
is testimony, not a ruling: it may be absent, but it cannot be authoritatively wrong.
_Avoid_: rename, move (as a recorded fact)

### Relations between Decisions

**Follows**:
The relation between a Decision and the one it actually continues from — its nearest
ancestor in the Session's own entry tree. Read from that tree when the Session file is
readable, and from `decision.id`'s ordering when it is not. Never a stored row.
_Avoid_: next, previous, precedes

**Steer**:
The raw witnessed fact that a user message arrived mid-Run — after this Run's first
`turn_end`. Capture writes only `(session_id, ts)`; the message text itself is not
duplicated, since the Session file already holds it.
_Avoid_: interruption, redirect (as the stored fact — that's the derived relation below)

**Redirected-by**:
The relation holding when a Decision is the first to arrive after a Steer in its Session.
Paired by timestamp at read time, never stored as its own row.
_Avoid_: interrupted-by, steered-by

**Caused-by-error**:
The relation holding when a Decision's immediate predecessor (via Follows) issued a
failed tool call, *and* the Decision is not also Redirected-by a Steer. Witnessed evidence
(a Steer) always outranks inferred adjacency.
_Avoid_: recovers-from, follows-error

**Retry-of**:
Caused-by-error, narrowed to a predecessor and successor that named the same tool (and
the same File, when the tool is anchored to one).
_Avoid_: repeats, retries (as a noun on the earlier Decision)

**Forked-from**:
The relation holding across a Session boundary, from a forked Session's first Decision
back to its parent Session's last. Backed by `session.parent_session_file`; not a new
fact. Resuming a Session creates no boundary and therefore no such relation.
_Avoid_: resumed-from, continues, branched-from

### The two passes

**Capture**:
The online pass. Watches execution, writes down what it witnessed, and stops there. It
never resolves identity, never infers a relation, and never rewrites a record.
_Avoid_: logging, tracing, instrumentation, hooking

**Assembly**:
The offline pass. Reads what Capture wrote, and the working tree itself, and derives
everything that required a judgement — File identity across renames, Attribution,
Supersession, Symbol Labels. Deterministic given both of those inputs, and re-runnable, so a
better Assembly retroactively improves the whole history. Its output is a cache: it may be
discarded and recomputed, which is why overwriting it is not a change to the record.
_Avoid_: processing, enrichment, indexing, post-processing

**Store**:
The project-local database Capture writes and Assembly reads. One per project, covering
every Session in it.
_Avoid_: log, database, cache, index

**Compaction Boundary**:
A marker of where Pi discarded context mid-Session. It never affects what was Captured;
it constrains what may be fed back to the agent later, and it is the one moment that
warrants a Nudge, because it is the one moment the agent cannot tell it has forgotten
something.
_Avoid_: truncation, summarization point

### Reaching the agent

**Consultation**:
The agent asking what the record says about a region of a File, and the answer it gets
back. Always asked for, never volunteered, and always an answer about the File as it
stands now.
_Avoid_: injection, retrieval, context feed, query (as the name of the act)

**Nudge**:
The one thing the record says to the agent unbidden: after a Compaction Boundary, which
Files the discarded span had Decisions about. It carries names and no rationale, because
its purpose is to restore the agent's awareness that a Consultation is available, not to
answer a question nobody asked.
_Avoid_: reminder, prompt, hint, re-injection
