# 18 — Consultation: the agent can ask what the record says

**What to build:** the `query_decisions(path, line?)` tool, registered once through the
extension so its prompt snippet folds into the base system prompt at registration time (not
re-injected per Run or per call — that's what keeps the prompt-caching prefix stable). It's
registered only when there's something to say: not on an untrusted project, not with no Store,
not with a Store holding zero Decisions. The answer is plain text, budgeted proportionally to
remaining context (a quarter, capped near 50k tokens, degrading to a header-plus-counts under a
small floor), ordered attributable-first, then standing, then newest, filled to budget rather
than dropped by a cascade. It states facts about the record — a Break's date and count of
earlier Decisions, an absent File's last recorded write — and never an instruction about what to
do with them. The one push in the whole design lives here too: after a Compaction Boundary, a
single message naming the paths the discarded span had Decisions about, capped at 40, with no
WHY and no ranges.

**Blocked by:** 16 (Capture), 17 (Attribution)

**Status:** ready-for-agent

- [ ] The tool is absent from a fresh Store with zero Decisions, and appears once a Consultation
      would have something to say.
- [ ] Asking about a path returns Decisions ordered attributable-first, then standing, then
      newest, each with an absolute date, current-file line ranges, surviving/written counts and
      WHY.
- [ ] A Decision with no WHY is never rendered as its own entry, only counted.
- [ ] Asking about one line returns the Decision that wrote it.
- [ ] The answer's size scales with remaining context budget and degrades to a header-plus-count
      summary under a small floor, never itself forcing a compaction.
- [ ] A Break is reported as a fact — the date past which the record can't account for the File,
      and a count of the earlier Decisions it can't name — with no instruction to the agent.
- [ ] An absent File reports the last recorded write and that Decision's WHY, rather than an
      error.
- [ ] A Compaction Boundary produces exactly one Nudge naming the paths the discarded span had
      Decisions about (capped at 40), with no WHY and no ranges.
- [ ] The tool keeps answering — emptily if needed — rather than disappearing, if the Store
      fails mid-Session.
