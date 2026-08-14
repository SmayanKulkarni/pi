# 12 — Sub-file symbol resolver

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 04

## Question

Ticket 01 settled that symbols are **not nodes** — sub-file locality is an optional derived
label on the `touched` edge, computed at assembly from `path` + `oldText`, nullable until a
resolver exists. This ticket picks the resolver.

Established at 01 (do not relitigate):

- The label has no identity across time. It records what was true at edit time; a later
  rename cannot corrupt it.
- Computed at assembly, never at capture. Recomputable, so building this **backfills the
  entire existing store** with no recapture.
- Verified: default `git diff` on `.ts` already emits enclosing declarations in hunk headers
  with no diff driver configured. The heuristic scans back for the nearest line starting with
  a non-whitespace identifier char.

Settle:

- **Which resolver.** Reimplement git's backward-scan (~10 lines, zero deps, proven on this
  repo's TypeScript) versus tree-sitter (accurate methods, `kind`, exact ranges, but a new
  dependency plus a grammar per language and slower assembly).
- **The method ceiling.** Git's heuristic resolves an indented `bar()` to its enclosing
  `class Foo`, not to `bar`. Is class-level granularity enough, or is that the whole point?
- **Label shape.** Bare string (`"runLoop"`), or structured (`{name, kind, container}`)?
  Structured costs nothing now and cannot be added retroactively to already-computed labels
  without a rebuild — though rebuild is cheap here.
- **Non-code files.** Markdown, JSON, YAML — does the label resolve, stay null, or mean
  something else (heading, key path)?
- **Backfill trigger.** Does assembly recompute labels every run, or only where null?
  Recomputing every run means a resolver upgrade applies itself; recomputing only nulls is
  faster but leaves stale labels from an older resolver.
- **Cost against the destination.** This is an enrichment, not a blocker. State plainly
  whether it earns its place before the first eval run (ticket 11) or after.

## Narrowed by ticket 13 (closed) — read before answering the above

Ticket 13 removed this ticket from the consumption path, which changes what the label is *for*
and shrinks several of the questions above.

Attribution (ticket 13) maps a File's **current** lines to the Decisions that wrote them. The
navigation query the whole feature exists to serve — "which Decisions explain this function as it
stands now" — is therefore answered by going *current symbol → current line range → Decisions*,
using an AST of the file as it is today (the user's `graphify`, or any parser). That path never
reads a stored label. A label recorded at edit time describes code that may no longer exist, so
it is the wrong frame for it.

What the stored label is still needed for: **Decisions with zero surviving lines.** They own no
current line, so they map to no current symbol, and the edit-time label is the only way to say
what an abandoned attempt was about. Ticket 13 returns those Decisions rather than filtering them
(they are part of how the code came to be), so they are reachable and unlabelled without this.

Consequences for the questions above:

- **Cost against the destination**: answered. **After ticket 11, not before.** It no longer
  blocks the consumption path, and the eval axis does not depend on it.
- **The method ceiling** (git's backward scan resolving a method to its enclosing class) matters
  much less. The label is now a history annotation for the viewer, not a navigation key, so
  class-level granularity is probably enough — argue it, but the bar dropped.
- **Which resolver**: the case for tree-sitter weakens accordingly. It was strongest when the
  label had to be precise enough to navigate by.
- **Backfill trigger** is unchanged and still real.
- **Non-code files** matters less for the same reason: ticket 13's ranges already work for
  Markdown and JSON, where "symbol" means nothing.

## Resolution

**The resolver is a backward scan for the nearest declaration-like line, about fifteen lines,
running *inside* ticket 13's Attribution walk — because that walk already reconstructs the file
exactly as each Decision left it, so the resolver needs no parser, no git subprocess, no historical
checkout and no second pass. Consequently `touched.symbol` is deleted from the schema. It was ticket
04's only Assembly-written column; the label is derivable at the moment it is wanted, so storing it
would cache a derived value, which ticket 13 §8 already argued against. Deleting it dissolves the
backfill-trigger question outright, makes ticket 07's append-only rule absolute rather than
qualified, and drops the ticket's cost from "new pass plus schema column plus backfill story" to
"one function in a file that already exists".**

### 1. The finding that changes the shape of this ticket

Ticket 04 established that Pi's stored patch cannot help: `generateUnifiedPatch` uses
`FILE_HEADERS_ONLY` (`edit-diff.ts:366-371`), so hunk headers are bare `@@ -2,6 +2,6 @@` with no
declaration. That left two routes, both unattractive: re-run `git diff` at Assembly, which needs the
file's historical content that nobody has; or scan backwards over the patch's own context lines,
which is only four lines deep (`contextLines = 4`, ticket 13 §1.1) and frequently misses the
declaration entirely.

Both are unnecessary. **Ticket 13's Attribution walk holds the whole file, reconstructed, at exactly
the right moment.** Its `lines[]` array mutates as the walk moves backwards, and the order per touch
is: verify the hunk window against `lines[]`, claim the lines, *then* reverse-splice (ticket 13 §2).
So immediately before the splice, `lines[]` is the complete file **as that Decision left it**, which
is precisely the content a backward scan needs and precisely the frame the label is supposed to
record ("what was true at edit time", ticket 01).

The cost is one backward scan per hunk over an array already in memory. No IO, no reconstruction, no
extra traversal.

This also reaches the case ticket 13 narrowed this ticket to. A Decision with zero surviving lines
still has its hunks processed by the walk — that is how the reverse-splice restores older content —
so an abandoned attempt gets its label like any other.

### 2. Which resolver: the backward scan, and it beats git rather than merely copying it

**Rejected: tree-sitter.** No tree-sitter, `web-tree-sitter`, `acorn` or `@babel/parser` exists
anywhere in this repo (checked every `package.json`). It is a new runtime dependency plus a grammar
per language plus a WASM loading story, and the precision it buys is exactly the precision ticket 13
made unnecessary by moving navigation to current-symbol → current-lines → Decisions. The label is a
caption on history now.

**Rejected, more interestingly: `typescript`.** It *is* already installed, as a root devDependency
(5.9.3), so ponytail's "already-installed dependency" rung genuinely applies and `ts.createSourceFile`
would give exact names, kinds and ranges. It loses on scope: it covers `.ts`/`.js` and nothing else,
it parses whole files where the scan reads a handful of lines, and it would make a heavy parser a
runtime dependency of `packages/decision-graph` to produce a viewer caption. Recorded rather than
dismissed, because it is the upgrade path and it is *already paid for*: if the viewer shows labels
misleading often enough to matter, `.ts` and `.js` can switch to `typescript` with no new install.

**Chosen: the backward scan — with git's column-zero constraint removed, which makes it strictly
better than git.** Verified empirically rather than recalled, on a fixture in this repo:

```
@@ -4,5 +4,5 @@ export class Foo {
     bar(): void {
         const a = 1;
-        const b = 2;
```

Git lands on `export class Foo {`, not on `bar`. That is the "method ceiling" the ticket names, and
the cause is git's default funcname pattern requiring the line to begin with a non-whitespace
alphabetic character, which excludes every indented method. Ticket 01 verified that git emits
enclosing declarations; what it did not note is that for indented members it emits the *wrong* one.

A plain nearest-match scan without that constraint hits `    bar(): void {` first and resolves the
method correctly. Same line count, better answer. So the ceiling the ticket worried about is an
artifact of copying git's rule, not of the technique.

### 3. Label shape: `{ name, container }`, and nothing is stored

One backward scan produces both for free: `name` is the nearest declaration-like line at any indent,
`container` is the nearest one at column zero. So `bar` inside `export class Foo` yields
`{ name: "bar", container: "Foo" }` at no extra cost.

No `kind`. Distinguishing a method from a getter from a property needs a parser, and the consumer is
a caption.

The ticket's concern that a structured label "cannot be added retroactively to already-computed
labels without a rebuild" evaporates, because §4 stores nothing. Every read recomputes.

### 4. `touched.symbol` is deleted

Ticket 04 shipped `touched.symbol TEXT` as the schema's single Assembly-written column, and ticket
13 §8 kept it while noting it was "the one Assembly-written column, and being recomputable is
precisely why overwriting it is not a mutation of the record".

Since the label falls out of the Attribution walk at the moment anyone wants it, the column stores a
value that is cheaper to recompute than to invalidate. Four things improve by deleting it:

1. **Ticket 07's append-only rule becomes absolute.** Every table in the schema is Capture-written
   and insert-only, with no exception to explain.
2. **The backfill-trigger question disappears.** The ticket asked whether Assembly recomputes labels
   every run or only where null, and worried about stale labels from an older resolver. With nothing
   stored, a resolver improvement applies itself retroactively and universally, which was the
   *outcome* the "recompute every run" option was reaching for, at none of its cost.
3. **No migration is owed**, because no code exists yet.
4. **One fewer place for Capture and Assembly to disagree**, which is the split ticket 04 built the
   whole schema around.

### 5. Non-code files: Markdown resolves, structured data does not

The scan is pattern-driven, so this is a two-entry table rather than a plugin system.

| file | pattern | label |
|---|---|---|
| `.ts` `.tsx` `.js` `.jsx` `.mjs` `.go` `.rs` `.py` `.java` `.c` `.cpp` | nearest line matching a declaration-like prefix | `{ name, container }` |
| `.md` | nearest line matching `^#{1,6}\s` | the heading, with the nearest `^#\s` as container |
| everything else | — | `null` |

Markdown is worth the one extra pattern: "which section of the design doc did this abandoned attempt
rewrite" is exactly the question the label exists to answer, and headings are the honest analogue of
declarations. JSON and YAML resolve to `null` — a key path is a different mechanism, and ticket 13's
line ranges already serve those files.

`null` is a first-class answer throughout. An unlabelled Decision is not a defect, in the same way a
WHY-less Decision is not (`CONTEXT.md`).

### 6. Cost against the destination: after ticket 11, confirmed, and much cheaper than assumed

Ticket 13 already ruled "after, not before", and nothing here reverses it: the consumption path
(ticket 09 §4) renders line ranges and never reads a label, and ticket 11's eval design does not
depend on one. What changed is the price. The ticket was scoped as a resolver pass with a schema
column and a backfill policy; it is now one function inside `attribution.ts`, no column, no policy,
no dependency.

### Accepted holes

1. **The scan is a heuristic and will sometimes be wrong.** A hunk inside a long argument list, a
   template literal containing something declaration-shaped, or a language whose declarations do not
   look like the pattern. Bounded by the consumer: a wrong caption on an abandoned attempt in a
   viewer is a cosmetic error, not a correctness one. `typescript` is the named upgrade for `.ts` and
   `.js` and is already installed (§2).
2. **The label describes edit-time state and is not comparable across time.** Inherited from ticket
   01 unchanged, and now structurally enforced: it is computed from reconstructed content and never
   persisted, so nothing can accumulate stale labels.
3. **A Decision whose touch lies past a Break gets no label**, because the walk stops there and
   `lines[]` is no longer trustworthy (ticket 13 §6). Correct rather than unfortunate: labelling
   against content the record cannot account for would be inventing.
4. **A `write` with `old_text IS NULL` labels nothing**, for the same reason — ticket 13's accepted
   hole 1, inherited.
5. **Container is the nearest column-zero line**, which is wrong for deeply nested namespaces or
   modules. Not worth a parser.

### Consequences for other tickets

- **04 (schema)** — `touched.symbol TEXT` is **deleted**, pre-build, no migration owed. Its comment
  ("Assembly (ticket 12). NULL until a resolver exists") goes with it. This is the second correction
  ticket 04's `touched` table has taken, after ticket 09 §9's path identity fix.
- **07 (edges)** — its append-only ruling loses its one exception (§4.1). Every table is
  Capture-written and insert-only, with no Assembly-written column anywhere in the schema.
- **13 (temporal relevance)** — gains a small responsibility rather than losing one: the label is
  produced inside `attributePath`'s walk, so `AttributedDecision` gains an optional
  `label: { name: string; container: string | null } | null`. Its §8 "Attribution is a function, not
  a table" now covers the label too, which is a simplification of its own ruling rather than a
  qualification of it.
- **10 (viewer)** — this is the ticket's only consumer. A Decision rendering as "owns no current
  line" (ticket 10 §5) can now render as "owns no current line — was about `bar` in `Foo`", which
  was the exact gap ticket 10 identified.
- **09 (consumption)** — unaffected and deliberately so. The tool renders ranges, not labels
  (09 §4). If a label ever earns a place in the tool result it is additive, and the tripwire is
  ticket 11's per-task token accounting, not a preference.
- **01 (graph anchor)** — its ruling that symbols are labels and never nodes is upheld and
  strengthened: the label is now not even a column.

### What this touches

Spec-only, and it is the last ticket on the map. The build adds one function to
`packages/decision-graph/src/attribution.ts` (ticket 13's file) and one field on
`AttributedDecision`, and removes one column from the DDL in
`packages/decision-graph/src/store.ts`. No new dependency, no new file, nothing in Pi modified.
The runnable check rides on ticket 13's: the same fixture asserts that a Decision whose lines were
all later overwritten still reports the declaration it was written inside.
