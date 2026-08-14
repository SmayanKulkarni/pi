# 10 — Viewer: temporal scrubbing UX

Type: prototype
Skill: mattpocock-skills:prototype
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 07

## Question

"Visualize the graph beautifully" is not a spec. Build a cheap throwaway prototype against
fake data and react to it, before any real renderer exists.

Use `mattpocock-skills:prototype`. Standalone self-contained HTML, no external hosts.

Questions the prototype must answer:

- What does time look like — a scrubber that filters to `t <= now`, an animated replay, or a
  layout axis?
- What is the primary view: the decision timeline, or the code anchors with decisions hanging
  off them? (Depends on ticket 01's anchor.)
- How does it stay legible at 500 decisions? At 5000? What is the default zoom?
- Reading a single decision: reasoning text, tool calls, diff — inline panel or drill-down?
- What question should a user be able to answer in under ten seconds? Name it, then check the
  prototype against it.

Deliverable: an HTML file with fabricated data, linked from the answer. Not wired to SQLite.

## Inherited from ticket 13 (closed)

- A File can be drawn as a **partition of its current lines by owning Decision**, which is
  stronger than "every Decision that ever touched this file". `attributePath(path)` returns
  `ranges` in current-file coordinates plus `survivingLines` / `writtenLines` per Decision.
- A **Break** is drawable: it is the point where the spine of a File's history stops being
  reconstructible. Everything older is `attributable: false` — neither surviving nor superseded.
- Attribution is computed once at export time, not stored (ticket 13 §8).

## Inherited from ticket 09 (closed)

- **The agent surface is settled and is not this ticket's problem.** Consumption is one pulled
  tool plus one post-compaction Nudge. This ticket is now purely the *human* surface, which is
  also what the map's "TUI surface" open item was narrowed to.
- **Decision ids arrive free of charge.** The `query_decisions` tool result carries ids in its
  `details` field, which reaches the TUI renderer and the session file but never the provider
  payload (verified: `anthropic-messages.ts` builds `params` from content blocks only,
  `:961-1024`). So a viewer or a custom result renderer can key on ids the model was not charged
  for.
- **The dead-file set is deterministic and yours.** `SELECT DISTINCT path FROM touched` stat'ed
  against the working tree gives every recorded path that no longer exists — no heuristic, no git.
  Consumption never needs it (it only ever stats the one path it was asked about), so if a
  graveyard-of-deleted-files view is worth having, it belongs here. Note the hard limit: Pi has no
  delete tool and no move tool (built-ins are exactly `bash`, `edit`, `find`, `grep`, `ls`, `read`,
  `write`), so the set tells you *which* files died and never *why*.
- **`touched.path` is the cwd-relative resolved path**, not the model's raw string (ticket 09 §9).
  Do not build a path-normalising layer in the viewer; the store is already canonical.

## Resolution

**The primary view is a File, partitioned by owning Decision, with time as a scrubber that moves
"now" backwards through the Decisions and re-derives the partition at each stop. Not a decision
timeline with code hanging off it, and not a node-link graph. The ten-second question is "why is
this line here", answered by hovering a line. Prototype at
`packages/decision-graph/prototype/viewer-prototype.html` — one self-contained HTML file, fabricated
data, no external hosts, not wired to SQLite.**

The ticket was written before ticket 13 existed and its question list assumes ticket 01's model,
where a File is a node with every Decision that ever touched it hanging off it. Ticket 13 replaced
that with per-line Attribution, and that changes the answer to nearly every question below.

### 1. What time looks like: a scrubber that re-derives, not one that filters

The ticket offered three options: a scrubber filtering to `t <= now`, an animated replay, or a
layout axis. A filter was the obvious pick and it is the wrong one, because under Attribution the
interesting fact is not *which Decisions existed* at time t but *who owned each line* at time t.
Those differ, and the difference is the whole feature: as the scrubber moves forward, a Decision's
colour visibly shrinks as later Decisions take its lines. That is Supersession made visible, which a
filter cannot show.

Implementation, and it is cheap enough to be the real one rather than a prototype trick: keep a
writer *history* per line rather than a single owner, then owner-as-of-k is the last writer with
index `<= k`. Lines with no writer at or before k did not exist yet and render as an empty gutter,
which makes the file grow as you scrub forward. This is exactly ticket 13's claim-once rule
(`attribution.ts`, §2) evaluated at a prefix instead of at the end, so the viewer and the tool share
one semantics rather than approximating each other.

An animated replay was rejected as a strictly worse scrubber: it removes control and answers no
question the scrubber does not. A layout axis was rejected because the layout dimension is already
spent on the file's own line order, which is the more informative use of vertical space.

### 2. The primary view: the File, not the timeline

Two panes. Left, the Decisions newest-first, each with its date, a standing bar, the surviving-of-
written count, its current line ranges, and its WHY. Right, the file itself, line-numbered, every
line tinted with its owning Decision's colour.

The Decision list is the index; the File is the subject. Ticket 01 imagined the reverse and ticket 13
is why it flipped: a partition of the current lines by owning Decision is a stronger statement than a
list, because it is falsifiable against the file on disk. It also makes three states legible at a
glance that no list can distinguish — a line owned by a Decision, a line no Decision is known to have
written (unowned, rendered flat with a marked gutter), and a line that does not exist yet at the
current scrub position.

**Unowned lines are the surprise the prototype delivered.** In the fabricated data eight of eighty
-eight lines are unowned, and they are almost all blank lines, which is what a formatter run through
`bash` actually does to a file. Seeing them rendered flat and colourless is a better argument for
ticket 01's unwitnessed-mutation hole than any prose in this map, and it is also reassurance: the
viewer degrades to "we do not know" rather than to a confident wrong owner.

### 3. Reading a single Decision: inline, and hover before click

Two levels, because the ticket's inline-versus-drill-down framing missed that the common case needs
neither.

- **Hover a line** → the status bar names the owning Decision, its date and its WHY. This is the
  ten-second question and it costs no interaction state at all. Ticket 13's `ownerOfLine` is exactly
  this query, so the viewer and the stack-trace case in ticket 09 are the same lookup.
- **Click a Decision** → its clamped WHY expands in place and every line it does not own desaturates
  in the File pane. Inline, never a drill-down: a drill-down would replace the partition, and the
  partition is the context that makes one Decision meaningful.

Full tool calls and diffs were deliberately left out of the prototype. The `touched.patch` is already
represented, more usefully, as the line ranges the Decision owns. A raw diff is what you look at when
you cannot compute ownership.

### 4. Legibility, and where this view stops working

**Honest answer: the prototype proves the view at 14 Decisions on one file, and does not prove it at
500 or 5000.** What it does establish is where the pressure lands, which is a more useful result than
a guess would have been.

The File pane does not degrade with Decision count at all — it is bounded by the file's line count,
and a 5000-line file scrolls exactly as a 5000-line file always does. Colour is the first thing to
break: hue rotation is distinguishable to roughly twenty concurrent owners, and a file with two
hundred owning Decisions cannot be coloured. The Decision list is the second, at a few hundred rows.

The prototype includes a **density strip** above the scrubber, one tick per Decision, coloured, hatched
when the Decision has no standing left, as a probe of the compressed representation. At 14 ticks it is
decorative. At 500 it becomes the actual navigation control and the list below it becomes a detail
pane for a selected span. That is the shape the real viewer should grow into, and it is a reason not
to invest in the list.

Deferred with a named trigger rather than designed now: colour by **recency band** instead of by
identity (five or six buckets, oldest to newest) once a file exceeds ~20 owning Decisions, keeping
per-identity colour only for the selected Decision. Trigger is a real store, not a thought
experiment.

### 5. What the prototype answers, and what it does not

Answers: time is a re-deriving scrubber (§1); the File is the subject and the Decision list the index
(§2); hover for the ten-second question and click to isolate (§3); the ten-second question is "why is
this line here" (§3).

Does not answer, and both are now explicitly out of ticket 10's scope:

- **Cross-file navigation.** One file at a time. The multi-file question ("what did this Sitting
  change across the repo") is a different view with a different primary axis, and the map's
  session-tree requirement from ticket 08 §7 lands there too — `/tree` means the real viewer must
  draw a session *tree*, which the single-file partition simply does not touch.
- **Export mechanics.** Ticket 13 §8 says Attribution is computed once at export time. The prototype
  hardcodes its data, so nothing about the size or shape of a real export is tested here.

### 6. Prototype disposition

`packages/decision-graph/prototype/viewer-prototype.html`. Self-contained, inline CSS and JS, no
external hosts, theme-aware via `prefers-color-scheme`, banner-marked as fabricated. Kept in-tree
because it is the only executable artifact this map has produced and it is the reference for the
decisions above; when the real viewer lands, this file goes.

One runnable check, per the working conventions rather than a framework: the derived ownership model
satisfies the invariant that the sum of every Decision's surviving lines equals the count of lines any
Decision ever wrote (80 of 88, with 8 unowned). Verified. That invariant is the same one
`attribution.ts` must satisfy, so the check transfers to the real implementation.

### Accepted holes

1. **Legibility above ~20 owning Decisions per file is unproven** (§4). Colour is the binding
   constraint and the recency-band fallback is designed but not built.
2. **Single file only** (§5). The session-tree requirement from ticket 08 §7 is unaddressed by this
   view and needs its own.
3. **The scrubber steps by Decision, not by wall-clock time.** Even spacing between Decisions that
   are days apart and Decisions that are minutes apart. Correct for reading causality, wrong for
   reading tempo; a time-proportional axis is a second mode, not a fix.
4. **Fabricated data is friendlier than real data will be.** Fourteen Decisions with clean
   non-overlapping ranges. Real stores will have Decisions that wrote one line each, forty times.
5. **No Break rendering inside the File pane.** The Break is shown in the Decision list only. Where a
   Break intersects the file, the lines involved simply come back unowned, which is honest but does
   not distinguish "nobody wrote this" from "the chain snapped here".

### Consequences for other tickets

- **13 (temporal relevance)** — its per-line Attribution is confirmed as the right primitive by the
  only executable thing in this project so far, and the viewer needs one extension of it that the
  tool does not: **owner-as-of-k**, evaluated at a prefix of the Decision list rather than at the end.
  That is a parameter on the existing walk, not a new function, and `attribution.ts` should take an
  optional upper bound rather than have the viewer reimplement the walk.
- **09 (consumption)** — confirmed compatible and unchanged. Hovering a line is `ownerOfLine`, the
  same entry point the stack-trace case uses, so the human and agent surfaces read the same
  primitive. Decision ids ride in the tool result's `details` (09 §4) and are what a future
  viewer-from-a-session would key on.
- **11 (metrics)** — unblocked and unaffected; nothing here changes the eval design.
- **12 (symbol resolver)** — **this is where its remaining job lives.** Ticket 13 narrowed 12 to
  Decisions with zero surviving lines, which own no current line. In this view those Decisions render
  with "owns no current line" and nothing else, which is exactly the gap a stored `touched.symbol`
  would fill: the only way to say what an abandoned attempt was *about*. Confirmed as history-and-
  viewer scope, still after 11.
- **08 (lifecycle)** — its §7 requirement that the viewer render a session tree is acknowledged and
  explicitly deferred to a second view (§5). This ticket does not discharge it.
- **Map** — the "TUI surface" open item stays open and is unchanged by this: the prototype is a
  standalone HTML page, not an in-terminal affordance.

### What this touches

One new file, `packages/decision-graph/prototype/viewer-prototype.html`, in a new directory inside
the fork's own package, so zero upstream conflict surface and nothing in Pi is modified. No
dependency added: no build step, no bundler, no chart library, no external font. The real viewer,
when it is built, is a separate file and this one is deleted.
