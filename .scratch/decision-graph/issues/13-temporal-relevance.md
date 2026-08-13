# 13 — Temporal relevance: which decisions still explain this file?

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: open
Blocked by: 01, 04

## Question

A file node accumulates every decision that ever touched it. Six months in, `a.ts` carries 200
decisions, and the rationale from March describes code rewritten in June. "Every decision that
touched this file" is therefore the wrong question — feeding all 200 back (ticket 09) makes the
agent *worse*, handing it confident reasoning about code that no longer exists.

The right question: **which decisions still explain the current state of this file?**

This is two problems. Do not conflate them.

### (a) Segmentation — what supersedes what, deterministically?

Charting ruled out semantic labelling at capture time (no classifier, no second model), so only
signals literally present in the event stream are admissible. Available:

| signal | cost | tells you |
|---|---|---|
| timestamp order | free | B came after A. Nothing more. |
| session boundary | free (ticket 08) | different sitting, possibly different intent |
| git commit boundary | assembly-time git | A's work shipped, B's is new |
| **content overwrite** | free — 01 stores edit text | **B provably replaced the bytes A wrote** |

The last is the one ticket 01 was designed to enable: if decision B's `oldText` overlaps
decision A's `newText` for the same file, B destroyed A's work. Deterministic, derived from
tool args alone.

Settle:

- Is `supersedes` an edge (→ ticket 07's set) or a computed view?
- Overlap rule: exact match, substring containment, or normalised (whitespace, formatting runs
  like `npm run format` rewrite everything and would falsely supersede the entire file)?
- Partial supersession — B overwrites half of what A wrote. Is A dead, alive, or partial?
- What does a `write` (whole-file replace) do? Naively it supersedes every prior decision on
  that file. Correct, or catastrophic?
- Does supersession cross the `renamed_to` edge?

### (b) Windowing — which slice reaches the agent?

Even with `supersedes`, consumption must choose: live decisions only, last N, since last
commit, whole history. That choice is **ticket 09's**, but it cannot be made until (a) exists,
and ticket 11 measures whether the window helped or hurt.

Settle here only what (a) must expose for 09 to have a real choice — e.g. is "live rationale
for file X" a first-class query the store answers, or does 09 assemble it each time?

### Watch for

Bash-driven mutations produce no `touched` edge (accepted hole, ticket 01), so a file rewritten
by `sed -i` or codegen shows no supersession and its stale rationale stays "live" forever. State
whether that is tolerable or whether it forces ticket 01's hole open sooner.
