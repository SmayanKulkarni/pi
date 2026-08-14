# 19 — Viewer: a File partitioned by owning Decision

**What to build:** a standalone, self-contained HTML file — no server, no build step, no
external host — that renders a real File's current lines tinted by owning Decision. Two panes:
Decisions newest-first with date, standing bar, counts, ranges and WHY; the File itself
line-numbered and coloured by owner. A scrubber moves "now" backwards and *re-derives* ownership
at each stop (via Attribution's owner-as-of-k), so Supersession is visible as a Decision's colour
shrinking — it never merely filters to what existed then. Hovering a line shows its owning
Decision's date and WHY. Clicking a Decision desaturates every line it doesn't own without
hiding them. Lines no Decision is known to have written render flat with a marked gutter. A
Decision that owns no current line still shows its Symbol Label ("was about `bar` in `Foo`")
instead of a blank row. Redaction placeholders render as visibly cut, never as ordinary text.
This replaces `packages/decision-graph/prototype/viewer-prototype.html`, which used fabricated
data; that file is deleted once the real viewer lands.

**Blocked by:** 16 (Capture), 17 (Attribution) — needs real captured history in this repo to be
genuinely demoable against, and Attribution's owner-as-of-k for the scrubber.

**Status:** ready-for-agent

- [ ] Opening the viewer against this repo's own Store and a real touched File shows every
      current line tinted by its owning Decision.
- [ ] Hovering a line shows its owning Decision's date and WHY.
- [ ] Scrubbing backwards re-derives ownership at each stop and visibly shrinks a superseded
      Decision's colour.
- [ ] Clicking a Decision desaturates every line it doesn't own, without hiding them.
- [ ] Lines no Decision is known to have written render flat with a marked gutter, never a
      guessed owner.
- [ ] A Decision that owns no current line still shows its Symbol Label instead of a blank row.
- [ ] Redaction placeholders render as visibly cut.
- [ ] The file opens directly in a browser from disk, with no server, build step or external
      host.
- [ ] `prototype/viewer-prototype.html` is deleted.
