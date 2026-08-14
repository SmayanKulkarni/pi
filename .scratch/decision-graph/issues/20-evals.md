# 20 — Evals: measuring whether the graph actually helps

**What to build:** three experiments against a seeded fixture Store and fixture working tree,
plus the one upstream edit the whole build needs — `packages/evals/src/pi-harness.ts`, which
today runs every task in a fresh *empty* temp directory (so a graph-on arm would consult an
empty Store by construction) and hardcodes `thinkingLevel: "off"`. A fixture builder writes both
the Store rows and the source files, going through the real Capture insert path so the fixture
generation exercises the real writer; its scripted history is checked in as reviewable JSON, not
a binary database. **E1 (overhead):** capture on vs. off, asserting total tokens are unchanged
and added per-turn latency is negligible, with thinking unpinned. **E2 (benefit):** three arms —
off, placebo, on — over twelve tasks in three classes (rationale recovery, repeated mistake,
location), three repetitions each, all judged by deterministic code. The placebo's tool is
equally *instructional* (same prompt-guidelines shape) but returns nothing useful, isolating the
effect of the instruction from the effect of the information. Primary outcome is tokens spent
reaching a correct answer, paired by the harness's existing grouping key; success rate is a
guard, not the headline. **E3 (observational):** rides on E2's runs for free — how often the
record fails to account for a File, and whether the agent asks when it has a path and stays
silent when it doesn't.

**Blocked by:** 16 (Capture), 17 (Attribution), 18 (Consultation)

**Status:** ready-for-agent

- [ ] The eval harness accepts a seeded fixture Store and fixture working tree per task, instead
      of an empty temp directory.
- [ ] The fixture builder produces both the Store rows and the source files through the real
      Capture insert path, and its scripted history is checked into the repo as JSON.
- [ ] E1 asserts total tokens are unchanged and added latency is negligible with the extension
      loaded vs. not, with thinking unpinned for the run.
- [ ] E2 runs three arms (off / placebo / on) over the twelve tasks, three repetitions each,
      judged entirely by deterministic code — no LLM judge.
- [ ] E2's primary outcome is tokens spent reaching a correct answer, paired by the harness's
      grouping key across arms that solved the same task.
- [ ] The placebo arm's tool prompt guidelines are equally instructional in shape to the real
      tool's, while the tool itself returns no useful information.
- [ ] E3 reports, from E2's own runs, the Break rate and whether tool calls correlate with tasks
      whose prompt names a path.
- [ ] The only file outside `packages/decision-graph` and `packages/evals` touched anywhere in
      this build is `packages/evals/src/pi-harness.ts`, and the diff is limited to extension
      loading, fixture seeding, and unpinning thinking.
