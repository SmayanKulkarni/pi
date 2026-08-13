# 01 — What are graph nodes anchored to?

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Assignee: Smayan Kulkarni
Blocked by: —

## Question

The original idea was "a decision node attached to every function node or class node."
Decide what a node actually is, because everything downstream (schema, edges, viewer,
consumption) inherits this.

Candidates:

- **Decisions only** — nodes are decisions, edges are relations between decisions. No
  static analysis, no rename tracking, nothing to keep in sync with the code.
- **Code symbols (function/class) + decisions** — matches the original framing. Needs
  symbol resolution (tree-sitter or LSP) and, harder, identity across renames, moves, and
  refactors. A function that gets renamed must not become a second node.
- **Files + decisions** — decisions link to paths. Cheap, survives refactors better than
  symbols, coarser ("this decision touched `agent-loop.ts`" not "…touched `runLoop`").

Things to settle, not just the label:

- What is the node's stable identity across time? (A decision is immutable; a symbol is not.)
- If a decision touches five files in one turn, is that one node with five edges, or five nodes?
- Does the anchor need to resolve for tool calls that are not edits (bash, read, search)?
- What does the answer cost us in the viewer — can you still ask "show me every decision
  that ever touched this function"?

Answer must state the chosen anchor *and* the identity rule for it.

## Resolution

**Anchor: files + decisions, both first-class nodes. Symbols are not nodes.**

```
node  decision   id = uuidv7 (PK), content_hash = sha256(session_id, ts, content) UNIQUE
node  file       id = repo-relative path (verbatim from tool args)

edge  decision --touched--> file       { oldText, newText, symbol? }
edge  file     --renamed_to--> file    (assembly-derived)
```

### Decision node

- **One per assistant message**, 1:1 with the existing `turn_end` event
  (`packages/agent/src/agent-loop.ts:224`, carries `{message, toolResults}`). Thinking +
  text stored once, never copied across tool calls. A turn that edits five files is one
  decision with five `touched` edges.
- **Immutable.** Dual key: `uuidv7` as primary key (time-sortable, so temporal ordering for
  the viewer falls out of the id itself), plus `content_hash` as a `UNIQUE` column purely for
  idempotency — `INSERT OR IGNORE` makes crash-retry and session replay incapable of
  duplicating a decision.
- Identity does **not** depend on turn numbering. Ticket 06 may renumber, reorder, or
  re-slice turns without touching decision identity or orphaning a single edge.
- `AssistantMessage.responseId` was rejected as identity: optional and provider-specific
  (`packages/ai/src/types.ts:422`).

### File node

- **Identity is the repo-relative path string.** Capture writes it verbatim from tool args
  (`edit`/`write` both take a required `path`) and performs **no resolution** — it never
  answers "which existing file node is this."
- Capture additionally records **rename evidence** it directly witnessed: a `git mv`/`mv`
  in a bash command, or a write-to-new-path plus delete-of-old-path within one turn.
  Evidence is an observation, never authority, so it can be absent but cannot be
  authoritatively wrong.
- **Assembly owns identity.** Precedence: (1) git history for committed renames,
  (2) capture evidence for uncommitted renames, (3) neither → no `renamed_to` edge, graph
  still valid. Assembly is offline, deterministic and re-runnable, so the enrichment pass can
  be built later and stitches history retroactively.
- Pure-assembly was rejected because `git log` only sees *committed* renames, and `AGENTS.md`
  forbids committing unless asked — so the uncommitted window is the normal working state
  here, not an edge case. Live capture-side resolution was rejected because it is
  authoritative (its mistakes are permanent, unfixable by rebuild) and blind to renames made
  outside Pi.

### What creates a `touched` edge

- **`edit` and `write` only.** `touched` means *changed*.
- `read`, `grep`, `find`, `ls`, `bash` are captured as raw event data but produce no edge.
  `read` was excluded on volume: a turn routinely reads ~20 files to edit one, which would
  bury the signal the viewer and ticket 09 both depend on. `grep`/`find`/`ls` take an
  *optional* path that is usually a directory; their real file hits are in the result, not
  the args. `bash` carries only a command string.
- The edge carries the applied **`oldText`/`newText`**. This is the enabling decision for
  deterministic supersession: if decision B's `oldText` overlaps decision A's `newText` for
  the same file, B provably destroyed A's work — no model, no heuristic, no semantics.
  Hash-only was rejected because hashes support equality but not substring overlap, and
  partial rewrites are the common case.

### Sub-file locality

- Symbols enter as an **optional derived label** on the `touched` edge, never as a node.
  A label has no identity, so the rename/move/refactor identity problem — the entire reason
  symbol nodes were expensive — does not arise. The label records what was true at edit time;
  a later rename cannot corrupt it.
- Computed at **assembly**, from `path` + `oldText`, both already stored. The column is null
  until a resolver exists, and building one **backfills the whole store** with no recapture.
- Verified empirically: default `git diff` on a `.ts` file already emits enclosing
  declarations in hunk headers with no diff driver configured
  (`@@ … @@ export function runLoop(a: number) {`). Setting `diff=typescript` changed nothing.
  Ceiling: the heuristic scans back for the nearest line starting with a non-whitespace
  identifier char, so an indented method resolves to its enclosing **class**, not itself.
- Resolver choice deferred → ticket 12.

### Viewer cost

"Every decision that ever touched this file" is a one-hop walk from the file node, plus
`renamed_to` traversal for pre-rename history. "Every decision that touched this *function*"
is not directly answerable — it degrades to filtering the `symbol` label (coarse, methods
collapse to their class) or grepping stored edit text.

### Accepted holes

1. **bash mutations produce no edge.** `sed -i`, `rm`, `mv`, `npm run format`, codegen — those
   decisions appear to have touched nothing. Raw bash events are stored, so a promotion pass
   can add the edges later without recapture. Silent until built.
2. **Renames outside git and outside Pi** (editor rename, never committed) get neither
   evidence nor a history stitch.
3. **Sub-file granularity is not built**, only reserved. Downgraded from irrecoverable to
   deferred by storing edit text.

### Consequences for other tickets

- **04 (schema)** — inherits both node types, the dual-key decision row, and edit text +
  nullable `symbol` on the edge.
- **05 (redaction)** — **scope grew.** Edit text on every `touched` edge is now a first-class
  secrets surface alongside thinking and tool args.
- **06 (ordering)** — unconstrained; decision identity is independent of turn index.
- **07 (edges)** — `touched` and `renamed_to` are settled inputs; 07 writes the remainder.
- **09 (consumption)** — blocked on ticket 13 for what "relevant" means.
- **New: ticket 12** (symbol resolver), **ticket 13** (temporal relevance).
