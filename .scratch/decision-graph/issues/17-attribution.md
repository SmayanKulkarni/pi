# 17 — Attribution: which Decision owns each line now

**What to build:** the reverse-replay walk that answers, for a File and its recorded Touches,
which Decision last wrote each of its current lines — `git blame` over Decisions instead of
commits. Walk the Applied Changes backwards from the working-tree file, newest first, claiming
each current line for the first Decision found to have written it; a line no recorded Touch
accounts for stays unowned. A window that fails to verify against the reconstructed file is a
Break: the walk stops for that path and everything older comes back unattributable rather than
confidently wrong. The Symbol Label (declaration name + container) is read off the reconstructed
File at the moment each Touch is passed, inside the same walk — no separate parser, no second
pass. A second entry point, owner-as-of-k, is the same walk truncated to an earlier point in the
Decision list, for the viewer's scrubber.

This is a pure function over the `touched` table shape plus a working tree — it needs Store's
schema, not a live Capture — so it's tested entirely against hand-built fixture Stores and
fixture files, not a scripted agent Session.

**Blocked by:** 15 (Store)

**Status:** ready-for-agent

- [ ] Applying a scripted sequence of real patches to a fixture recovers the correct writer of
      every line in the resulting file.
- [ ] A whole-file rewrite with a pre-image transfers only the lines it actually changed and
      leaves older owners of untouched lines intact.
- [ ] A rewrite with no pre-image (`NULL old_text`) produces a Break at that point.
- [ ] Mutating a fixture file out of band (simulating an unwitnessed edit that intersects a
      recorded hunk) sets a Break rather than reporting stale rationale as live.
- [ ] A File that no longer exists on disk returns every Decision at zero standing, not an
      error.
- [ ] A fully superseded Decision still reports the Symbol Label of the declaration it was
      written inside.
- [ ] The sum of every Decision's surviving lines equals the count of lines any Decision ever
      wrote, for a fixture with no Break.
- [ ] owner-as-of-k, truncated to an earlier point, matches what a full walk stopped at that
      same point would report.
