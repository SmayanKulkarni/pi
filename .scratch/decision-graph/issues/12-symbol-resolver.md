# 12 — Sub-file symbol resolver

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
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
