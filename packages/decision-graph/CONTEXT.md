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
Runs. Forks and resumes create new Sessions with a recorded parent.
_Avoid_: chat, thread, transcript

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
A repo-relative path. Its identity is the path string itself, exactly as the tool
received it.
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

**Supersession**:
The relation holding when a later Decision destroyed the work of an earlier one, proven
by their Applied Changes overlapping in the same File. Derived, never observed.
_Avoid_: overwrite, conflict, invalidation

**Symbol Label**:
An optional note of which declaration a Touch fell inside, attached to the Touch. It is a
label with no identity, so a later rename cannot corrupt it and it can never be a node.
_Avoid_: symbol node, code entity, declaration node

**Rename Evidence**:
An observation that a File may have moved, drawn from what the agent was seen to do. It
is testimony, not a ruling: it may be absent, but it cannot be authoritatively wrong.
_Avoid_: rename, move (as a recorded fact)

### The two passes

**Capture**:
The online pass. Watches execution, writes down what it witnessed, and stops there. It
never resolves identity, never infers a relation, and never rewrites a record.
_Avoid_: logging, tracing, instrumentation, hooking

**Assembly**:
The offline pass. Reads what Capture wrote and derives everything that required a
judgement — File identity across renames, Supersession, Symbol Labels. Deterministic and
re-runnable, so a better Assembly retroactively improves the whole history.
_Avoid_: processing, enrichment, indexing, post-processing

**Store**:
The project-local database Capture writes and Assembly reads. One per project, covering
every Session in it.
_Avoid_: log, database, cache, index

**Compaction Boundary**:
A marker of where Pi discarded context mid-Session. It never affects what was Captured;
it constrains what may be fed back to the agent later.
_Avoid_: truncation, summarization point
