# 11 — Metrics and eval design

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Assignee: Smayan Kulkarni
Blocked by: 09

## Question

Chosen metric axis: downstream task benefit. Design the experiment before building the thing
it measures, so the build is shaped by what has to be measurable.

- What runs it: `packages/evals` (see `npm run eval`). Read what that harness actually does
  and what task sets exist before designing on top of it.
- Arms: graph-off vs graph-on, same tasks, same model, same seed. Anything else?
- Which models, via OpenRouter, and why those. Reasoning-visible vs reasoning-absent models
  are a natural second axis given ticket 02.
- Outcome measures: task success rate, turns to completion, total tokens, wall clock,
  repeated-mistake rate (does the agent re-make a decision the graph already records?).
- The confound: graph-on burns context on injected decisions, which alone can change behaviour.
  How is that controlled — a placebo arm injecting equal-token irrelevant text?
- Sample size for anything believable, and the cost of running it.
- Overhead measurement as a prerequisite: per-turn latency added by capture, and confirmation
  that capture token cost really is zero.

Answer is an experiment design, not results.

## Inherited from ticket 09 (closed) — treat as settled input

Consumption is one extension-registered tool, `query_decisions(path, line?)`, pulled on demand,
plus one paths-only Nudge injected after a compaction. That gives this ticket five things.

**1. The arms define themselves.** Graph-off is literally "do not register the tool", so the two
arms differ by nothing else: no system prompt delta, no extra messages, byte-identical prefixes.

**2. But the placebo arm has to match the *instruction*, not only the token count.** The tool
advertises itself through `ToolDefinition.promptSnippet` and `promptGuidelines`
(`extensions/types.ts:456-459`), which are folded into the base system prompt
(`agent-session.ts:1023-1056`). So the graph-on arm changes two variables at once: the data the
agent can fetch, and a sentence telling it to fetch it. The ticket's own "placebo arm injecting
equal-token irrelevant text" is therefore under-specified — the placebo needs an equally
instructional snippet for a tool that returns nothing useful, or the comparison confounds
instruction with information. This is ticket 09's accepted hole 2 and it is this ticket's to close.

**3. The `promptGuidelines` string is a frozen experimental variable.** It is the single largest
lever on whether the model calls the tool at all, so it must be written down verbatim in this
ticket's design, fixed before the first run, and never tuned between arms.

**4. Two measurables come free, both already in the event stream.**
- `query_decisions` call rate, split by whether the task prompt named a path. Ticket 09 skipped a
  pathless "recent decisions in this project" mode and made this the tripwire: near-zero calls on
  pathless tasks with a healthy rate on path-bearing ones means the agent wanted to ask and had
  nothing to ask with.
- Task outcomes split by whether `brokeAt` was non-null for the files involved. That is ticket 13's
  open question about whether bash-driven mutations are worth witnessing, answerable with no
  instrumentation, and also ticket 09's tripwire for whether pre-Break Decisions should be named
  rather than merely counted.

**5. The two constants this ticket may move.** Ticket 09 §5 sets the answer budget as
`min(200_000, remainingTokens * 4 * 0.25)` characters with a `12_000` fallback when
`ctx.getContextUsage()` cannot report (`tokens` is `null` right after a compaction,
`agent-session.ts:3181-3205`). Both numbers are source constants precisely so this ticket can move
them on evidence. Note that Pi's own token estimate is `Math.ceil(chars / 4)`
(`core/compaction/compaction.ts:266-274`), so characters and tokens are the same currency here.

Still this ticket's, unchanged: the `packages/evals/src/pi-harness.ts` edit (relax the zero-extension
assert at `:166`, thread the extension path through) and the `thinkingLevel: "off"` unpin from ticket
02. Ticket 03 confirmed capture is live under evals because `pi-harness.ts:141` persists sessions,
and ticket 09 confirmed the same for consumption: ticket 08's gate 2 is ruled a write gate that does
not bind a read, and evals satisfies it on both sides regardless.

## Resolution

**The ticket's single experiment is split into three, because they have different prerequisites and
only one of them is expensive. The blocking discovery is that `packages/evals` runs every task in a
freshly created empty temp directory (`pi-harness.ts:122-124`), so there is no repository, no file
history and no Store — the graph-on arm as the ticket imagines it would consult an empty database and
be identical to graph-off by construction. The fix is a seeded fixture Store rather than a two-phase
task, which is also better science: it removes phase-one variance and makes the arms byte-identical
except for the thing under test. The second correction is to the outcome measure. The claim being
tested is context economy, so the primary outcome is tokens spent reaching a correct answer, not
success rate — a paired continuous measure needs about 30 pairs where a binary one needs 91 for the
same confidence, which is the difference between an affordable experiment and an unaffordable one.**

### 1. What `packages/evals` actually is

Read in full before designing, as the ticket instructed. Findings, several of which contradict what
earlier tickets assumed.

**1.1 — There is no task set. At all.** The package contains exactly two eval files:
`smoke.eval.ts` (one trivia question, run with `noTools: "all"`) and `extensions.eval.ts` (one
multi-step task about authoring a Pi extension). There is no SWE-bench-style suite, no repository
fixtures, no task corpus. Every task this ticket needs must be authored by this ticket. That is the
single largest cost item and the map never priced it.

**1.2 — The workspace is empty.** `runPiCodingAgent` does `mkdtemp` then `mkdir(cwd)`
(`pi-harness.ts:122-124`) and hands the agent a directory with nothing in it. This is why the ticket's
arms cannot work unmodified: ticket 08 §1 creates the Store on the first Decision *in that cwd*, so a
graph-on arm starts with an empty Store, and ticket 09 §8 does not even register the tool when the
Store holds no Decisions. Graph-on and graph-off would be the same session.

**1.3 — The A/B runner already exists and does not need building.** `evalHarnessTable(evalSet,
{ baseline, candidate | candidates, repetitions })` (`vitest-evals/harness-table.ts:157-193`) emits
one row per harness per repetition, and stamps each run with a `groupKey` derived from the input and
the repetition number (`:110-112`). That group key is exactly the pairing key a paired analysis needs,
already present in the artifacts. `extensions.eval.ts:100-103` is a working two-arm example.
**Ticket 11 writes tasks and judges, not an experiment harness.**

**1.4 — Judges can be pure code.** `ExtensionAuthoringJudge` (`extensions.eval.ts:53-98`) returns a
0/1 score with a rationale and makes no model call. So there is no LLM-judge cost and no LLM-judge
variance, provided the tasks are written to be checkable deterministically. They will be.

**1.5 — Project trust is not a blocker.** Ticket 08's gate 1 is `settingsManager.isProjectTrusted()`,
and `pi-harness.ts:135` builds `SettingsManager.inMemory()` whose `projectTrusted` defaults to `true`
(`settings-manager.ts:304`, `:328`). Corroborated behaviourally: `extensions.eval.ts` has the model
write `.pi/extensions/hello.ts` into the temp cwd and calls its tool after a reload, which project
trust would otherwise prevent (`extensions.md:113`). Gate 2 is satisfied by the persisted
`SessionManager.create(...)` at `:141`, as ticket 08 already established. So both gates pass and
neither needs an edit.

**1.6 — The `:166` assert is a start-of-session check, not an invariant.** It runs once before any
prompt, and `extensions.eval.ts` then loads a project-local extension mid-run. So the assert forbids
*pre-loaded* extensions specifically. Ticket 03's characterisation stands.

**1.7 — Everything the ticket wants to measure is already reported.** `getSessionStats()` supplies
input/output/cacheRead/cacheWrite/total tokens, tool-call count and cost (`pi-harness.ts:180-200`);
`timings.totalMs` gives wall clock (`:242`); `toTranscriptEvents` (`:58-88`) emits every tool call
with its arguments, so counting `query_decisions` calls is free; and the full session JSONL is saved
as an artifact (`:217`). No new instrumentation is needed for any outcome measure below.

**1.8 — Model selection is per-harness, not only per-process.** `--provider/--model` set
`PI_PROVIDER`/`PI_MODEL` for the whole invocation (`scripts/run-evals.mjs`), but
`createPiCodingAgentHarness({ model: { provider, id } })` overrides per harness
(`pi-harness.ts:37`, `:117`). So the model axis can be a table axis rather than a loop of
invocations.

**1.9 — A caveat on ticket 09's caching argument under OpenRouter.** Anthropic-style `cache_control`
is applied for OpenRouter only when the model id starts with `anthropic/`
(`openai-completions.ts:1493`). On any other OpenRouter model there are no cache breakpoints, so
ticket 09 §2's caching argument does not bite there. Its conclusion is unaffected — the tool route
also wins on not having to guess relevance — but a benchmark run on a non-Anthropic OpenRouter model
cannot reproduce the caching difference, and should not be cited as evidence about it.

### 2. Three experiments, not one

| | question | needs | cost |
|---|---|---|---|
| **E1 overhead** | does Capture cost anything on the turn path, and is its token cost really zero? | extension loading in evals; thinking unpinned | cheap, ~20 runs |
| **E2 benefit** | does consulting the graph reduce the tokens spent reaching a correct answer? | seeded fixture Store and workspace; three arms | the expensive one |
| **E3 observational** | how often does the record break, and does the agent ask when it should? | nothing; rides along on E2 | free |

Splitting them matters because ticket 02's `thinkingLevel: "off"` unpin is a prerequisite for E1 only.
E2 reads a **fixture** Store, so what the model would have generated at eval time is irrelevant to it.
That de-risks the expensive experiment by removing its dependency on the one change most likely to
destabilise other evals.

### 3. E2: the design

**3.1 — Seeded fixture, not a two-phase task.** The obvious way to give the arms a history is to have
phase one build something and phase two consult it. Rejected. Phase one's output varies per run and
per arm, so phase two would be consulting a different Store each time and the comparison would measure
phase-one luck. A fixture Store is identical across arms and across repetitions, costs no model calls,
and makes the only difference between arms the thing under test.

The fixture is a checked-in JSON description of a scripted history, written into a real Store by a
small builder that goes through the same insert path `store.ts` uses. Binary `.db` files are not
checked in: they are unreviewable, and generating through the real writer exercises it. The same
builder writes the fixture source files, so the working tree and the Store agree, which Attribution
requires (ticket 13 §2 takes the working tree as its second input).

**3.2 — Three arms, because two would confound.** Ticket 09 accepted hole 2: the graph-on arm changes
both the data available and the system prompt, since `promptSnippet`/`promptGuidelines` are folded
into the base prompt (`agent-session.ts:1023-1056`).

| arm | tool registered | prompt snippet | returns |
|---|---|---|---|
| **off** | no | none | — |
| **placebo** | yes, same schema | same shape, same length | equal-token irrelevant text |
| **on** | yes | real | real Attribution |

off-vs-placebo isolates the cost of the instruction and the schema. placebo-vs-on isolates the value
of the information. The ticket asked for "a placebo arm injecting equal-token irrelevant text"; equal
tokens is not enough, because the instruction to consult is itself a behaviour change. The placebo
must be equally instructional.

**3.3 — Outcome measures, primary first. This is a correction to the ticket.**

1. **Primary: tokens spent reaching a correct answer**, on tasks solved in both arms, paired by
   `groupKey`. This is the claim under test — ticket 09's design intent is context economy, and
   ticket 04's supporting number is that WHY plus arguments is 357 B median, so twenty Decisions cost
   less than one source file. If the graph works, the agent reads fewer files.
2. **Guard: success rate.** The graph must not make the agent worse. Reported, not powered for.
3. Turns to completion, wall clock, cost. Free from `getSessionStats()` and `timings`.
4. **Repeated-mistake rate**, as its own task class rather than a global metric — see 3.4.

**3.4 — Task classes.** Twelve tasks, three classes of four. All judged by deterministic code.

- **Rationale recovery.** The fixture contains a Decision explaining a non-obvious constraint. The
  task requires respecting it. Graph-off must infer it from the code; graph-on can read it.
- **Repeated mistake.** The fixture contains a Decision recording that approach X was tried and broke
  Y, so Z was used instead. The task's obvious solution is X. Score is whether the agent takes X.
  This is the highest-powered class because the effect is designed to be large, and it is the
  cleanest test of the whole premise.
- **Location.** The task names a symptom (a stack trace with a file and a line). The judge checks the
  agent edited the right region. Tests ticket 09's `line` parameter and ticket 13's `ownerOfLine`
  against the alternative of reading whole files.

**3.5 — Sample size, computed rather than asserted.** At α = .05 two-sided and 80% power, a two
-proportion test needs 91 runs per arm to detect 0.5 → 0.7 success, 55 for 0.5 → 0.75, and 36 for
0.5 → 0.8. A paired continuous test on the primary outcome needs about 32 pairs for a moderate effect
(d = 0.5) and 22 for d = 0.6. **Twelve tasks × three repetitions = 36 paired runs per arm**, which is
adequate for the primary outcome at d ≥ 0.5 and adequate for the guard only against a very large
swing. Stated plainly so nobody later reads a null success-rate result as evidence of no effect: at
this size the success-rate arm is descriptive, not inferential. `repetitions` is already a parameter
on `evalHarnessTable` (`:169`), so this costs nothing to configure.

**3.6 — Models: two, on one axis.** One reasoning-visible Anthropic model through OpenRouter (which
also exercises the `cache_control` path per 1.9) and one reasoning-absent cheaper model. Ticket 02's
reasoning-visible-versus-absent axis is the right second dimension because the fixture Store's WHY is
fixed, so this measures whether a *reading* model benefits differently, not whether a *writing* model
produces better WHY. Three arms × 36 runs × 2 models = 216 runs. At roughly 30k tokens a run that is
about 6.5M tokens total, low tens of dollars at current Sonnet-class pricing.
**Assumption flagged, since it was not stated:** the exact model ids depend on what OpenRouter access
exists. Substituting models does not change the design, only the cost line.

### 4. E1: overhead

Two arms on the existing `smoke.eval.ts` and `extensions.eval.ts` plus a handful of edit-heavy tasks:
capture extension loaded versus not. Measures:

- **Added per-turn latency.** Ticket 03 asserted a synchronous `DatabaseSync` insert is sub
  -millisecond against a turn costing seconds of model time. That is a claim, and this is where it
  gets checked. Ticket 08 §5 also allows a 5s `busy_timeout` before a store error, which is the tail
  worth watching.
- **Token cost is zero.** Capture makes no model call and injects nothing, so the assertion is that
  `getSessionStats().tokens.total` is unchanged between arms for the same task and seed. This is
  falsifiable and should be asserted, not assumed.
- **Thinking unpinned.** `thinkingLevel: "off"` (`pi-harness.ts:148`) is changed here, per ticket 02,
  because what Capture writes depends on the rung and the size measurements in ticket 04 were taken
  from a different harness. E1 is where Pi's own rung distribution gets measured for the first time.

### 5. E3: the free observational measures

Both ride along on E2's runs and need no extra instrumentation.

- **`brokeAt` rate.** Ticket 13 §6 and ticket 01's bash-mutation hole both hinge on how often the
  record fails to account for a file. Ticket 09 §6 additionally uses it to decide whether pre-Break
  Decisions should be named rather than counted. Fixture Stores will understate this against real
  use, so it is also worth logging from the author's own daily Store, which is a real store and free.
- **`query_decisions` call rate, split by whether the task prompt named a path.** Ticket 09 §3's
  tripwire for whether a pathless project-wide query mode is needed. Read straight out of
  `toTranscriptEvents`.

### 6. The upstream edit, final shape

One file, `packages/evals/src/pi-harness.ts`, and it is the only Pi source file any ticket on this map
modifies.

```ts
type PiCodingAgentHarnessOptions = {
    // ...existing
    extensionPaths?: string[];                       // → resourceLoaderOptions.additionalExtensionPaths
    seedWorkspace?: (cwd: string) => Promise<void>;   // runs after mkdir(cwd), before the session
};
```

- `additionalExtensionPaths` is the documented threading point (`resource-loader.ts:163`, used by
  `main.ts:769`). `resourceLoaderOptions.extensionFactories` is the in-process alternative already
  used by `coding-agent/test/suite/harness.ts`, and is preferable if the fixture extension never needs
  to exist as a file.
- `:166` relaxes from `getExtensionPaths().length !== 0` to comparing against the injected count, so
  the isolation guarantee is preserved rather than removed.
- `seedWorkspace` is one callback rather than separate fixture-files and fixture-store options,
  because both are just "write things into cwd first".
- Plus ticket 02's `thinkingLevel` unpin at `:148`, for E1.

Rebase cost is unchanged from ticket 03's estimate: about ten lines in one eval-only file, conflicting
only if upstream edits the same block.

### Accepted holes

1. **A fixture Store is not a real Store.** It is hand-authored, clean, and sized to the task. Real
   histories are messier, noisier and longer, so E2 measures the graph under favourable conditions.
   The honest reading of a positive E2 is "this can help", not "this does help in practice". §5's
   daily-store logging is the partial mitigation.
2. **Twelve tasks written by the same author who designed the mechanism.** Task design can smuggle in
   the answer, especially in the repeated-mistake class where the effect is deliberately large. The
   guard is that all three classes must move together; a result driven only by the class designed to
   show a large effect is not a result.
3. **Success rate is under-powered at n = 36** (§3.5). Named so a null is not misread.
4. **E2 says nothing about capture overhead and E1 says nothing about benefit.** Deliberate, and the
   reason the split exists, but it does mean no single run produces the headline number.
5. **No cross-model generalisation from two models.** Two points on the reasoning axis is a direction,
   not a curve.
6. **The caching difference ticket 09 turns on is unmeasurable on non-Anthropic OpenRouter models**
   (§1.9). If the caching claim itself is ever to be benchmarked rather than reasoned about, the model
   choice is constrained.

### Consequences for other tickets

- **02 (reasoning availability)** — its `thinkingLevel: "off"` finding is discharged here, in E1 only.
  E2 deliberately does not depend on it, which is what lets the expensive experiment proceed
  independently of a change that touches every other eval.
- **03 (capture point)** — the `pi-harness.ts` edit it named is now specified in full (§6) and grows
  by one option, `seedWorkspace`, that ticket 03 could not have anticipated because it did not know
  the eval workspace was empty.
- **09 (consumption)** — both of its tripwires are now assigned a measurement (§5), and its accepted
  hole 2 is closed by the three-arm design (§3.2). Its budget constants are the two numbers this
  ticket may move on evidence.
- **13 (temporal relevance)** — its `brokeAt` question gets a measurement route, with the caveat that
  a fixture Store will understate the rate.
- **01 (graph anchor)** — the bash-mutation hole's "revisit post-implementation" tripwire is now
  concrete: it is E3's `brokeAt` rate, measured on a real store rather than a fixture.
- **12 (symbol resolver)** — remains after this ticket, as ticket 13 ruled. Nothing here needs it.
- **Map** — "what task sets exist" is answered: none. Authoring twelve tasks and three judges is a
  work item the map did not carry and now does.

### What this touches

Spec-only. The build adds `packages/evals/src/decision-graph.eval.ts`, a fixture directory under
`packages/evals/src/fixtures/decision-graph/` (JSON history plus source files plus the builder), and
the ~10-line edit to `packages/evals/src/pi-harness.ts` described in §6 — which remains the only
modification to an existing Pi file in this entire effort.
