# 03 — Where exactly does capture tap in, and is forking core justified?

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Blocked by: —

## Question

You chose fork-core. This ticket tests that choice against what capture actually needs, and
locks the exact tap point.

Known facts (from reading `packages/agent/src/agent-loop.ts` in full):

- The loop emits an `AgentEvent` stream through an `AgentEventSink`. `message_end` (`:357`)
  carries the finished `AssistantMessage`; `tool_execution_start` (`:445`) and
  `tool_execution_end` (`:767`) carry name/args/result/isError; `turn_end` (`:224`) pairs
  `{message, toolResults}`.
- `AgentLoopConfig` already exposes `beforeToolCall` (`:619`) and `afterToolCall` (`:724`).
- `packages/coding-agent/docs/extensions.md` documents Session / Agent / Model / Tool /
  Input events as a public extension surface.

So capture is achievable with **zero core edits**. Settle:

- What, concretely, is *not* observable from the event stream that we need? Candidate gaps:
  compaction boundaries (`packages/agent/src/harness/compaction/`), context transforms
  (`config.transformContext`), sub-agent / nested-loop runs, session resume.
- If the gap list is empty, is fork-core still wanted, and why?
- If a core edit is needed, what is the smallest possible one, and what is the rebase cost
  against upstream on every future pull?
- Does capture live in `packages/agent` (runtime, sees everything, no TUI) or
  `packages/coding-agent` (has session/project context, misses raw runtime detail)?
- Does capture run synchronously in the emit path (blocks the loop, guarantees ordering)
  or async (never blocks, may lose records on crash)?

Answer must name the file(s) touched and the diff shape.

## Resolution

**Fork-core is not justified for capture. Capture ships as a Pi extension backed by a new
workspace package, with zero edits to any existing file.** A core edit stays pre-authorized
for ticket 09 alone, if feeding the graph back needs an interception point the extension
surface cannot reach.

### The gap list is empty

Every candidate gap in the question is observable from the documented extension surface
(`packages/coding-agent/src/core/extensions/types.ts`,
`packages/coding-agent/docs/extensions.md`):

| Needed | Event | Evidence |
|---|---|---|
| thinking + text + tool calls **with arguments** + paired results | `turn_end` | `TurnEndEvent { turnIndex, message, toolResults }` (`types.ts:735-740`), forwarded verbatim from the loop's `turn_end` (`agent-session.ts:740-747`) |
| compaction boundaries | `session_before_compact` / `session_compact` | `extensions.md:388+`; carries `reason`, `willRetry`, `compactionEntry` |
| session resume / new / fork | `session_start { reason, previousSessionFile }` | `extensions.md:388+` |
| context transforms | `context` (can modify messages) | lifecycle diagram, `extensions.md:275` |
| sub-agent / nested loop runs | — | **No sub-agents exist in this repo.** Only `packages/agent/src/agent.ts:414,427` calls `runAgentLoop`/`runAgentLoopContinue`. |

`turn_end` alone carries a whole decision. `message.content` holds `ThinkingContent` (ticket 02's
`why_source`) and every `ToolCall` with its `arguments` — and `edit` takes `edits[]` of
`{oldText, newText}` (`packages/agent/src/harness/tools/edit.ts:19-23`), which is exactly the
payload ticket 01 puts on a `touched` edge. `toolResults` pair by `toolCallId` in the same
payload, so success/failure needs no cross-event state. One event in, one decision row out;
ticket 01's one-decision-per-assistant-message rule falls out with no pairing logic for
ticket 06 to own.

**Nothing in Pi may break is structural here, not disciplinary.** Handler throws are caught,
turned into an `ExtensionError` and reported (`extensions/runner.ts:810-828`); the loop keeps
running. The error reaches `AgentSession`'s error listener (`agent-session.ts:2254`) and
surfaces in interactive mode, so a broken capture is visible without extra plumbing.

### Where the code lives

**New workspace package `packages/decision-graph/`, entry `src/extension.ts`.**

`.pi/extensions/*.ts` was rejected as the code's home: `tsconfig.json` `include` is
`packages/*/src` + `packages/*/test`, so an extension file there gets no `tsgo --noEmit`, no
biome, no vitest — against `AGENTS.md`. A new package is inside the checks, is the natural home
for ticket 04 (schema), 07 (edges) and 10 (viewer), and — being a new directory — adds zero
upstream conflict surface. It is loaded through the `extensions` path list in `settings.json`
(`extensions.md:122-127`) or a one-line `.pi/extensions` re-export.

### What it subscribes to

- `turn_end` — the decision record.
- `session_start` / `session_shutdown` — open and close the store, session identity.
- `session_before_compact` / `session_compact` — boundaries stamped at capture time, ahead of
  ticket 09 needing them. Cheap now, unrecoverable later.

### Sync, not async

**Synchronous `node:sqlite` `DatabaseSync`, one prepared `INSERT OR IGNORE` per `turn_end`.**
Already used in-repo (`packages/session-backends/sqlite-node/src/index.ts:2`), so no new
dependency. A sub-millisecond write against a turn that already cost seconds of model time is
not a stall worth engineering around. Ordering is guaranteed by construction, nothing is lost on
crash, and the runner's try/catch bounds the blast radius. An async queue was rejected: it can
lose a session's tail on SIGKILL and needs its own ordering discipline — reintroducing the exact
problem ticket 06 exists to solve.

### Store location

`<cwd>/.pi/decision-graph.db`, gitignored. Project-local as the map settled, alongside the
project's other pi state, so ticket 05's secrets surface never leaves the repo it came from.
If `.pi` is not writable, capture disables itself for the session instead of throwing per turn.

### Files touched

**Ticket 03 itself touches nothing.** The build is new files only:

```
packages/decision-graph/package.json          new
packages/decision-graph/src/extension.ts      new   pi.on("turn_end" | session events)
packages/decision-graph/src/store.ts          new   DatabaseSync, schema from ticket 04
.gitignore                                    +1    .pi/decision-graph.db
```

The **one** edit to an existing upstream file is named here and applied by **ticket 11**, which
must already touch that file to unpin `thinkingLevel: "off"` (`pi-harness.ts:148`):

```
packages/evals/src/pi-harness.ts
  + captureStore?: string  on PiCodingAgentHarnessOptions
  + pass the extension path through resourceLoaderOptions
  ~ :166 assert relaxed from "zero extension paths"
        to "exactly the injected paths"   (isolation guarantee preserved)
```

Rebase cost: `pi-harness.ts` is ~10 lines in one eval-only file, conflicting only if upstream
edits the same block. Everything else is a new directory, which cannot conflict.

### Why evals needs that edit at all

`packages/evals/src/pi-harness.ts` runs each eval in a `mkdtemp` workspace (`:122-123`) and hard
-asserts the session starts with **no extensions**:

```ts
if (evalSession.extensionRunner.getExtensionPaths().length !== 0) {
    throw new Error("Expected an isolated eval session to start without extensions.");
}
```

So an extension-based capture is invisible to the benchmark axis until that assert is relaxed.
This is the single place the extension route costs something, and it lands on a file ticket 11
opens anyway.

### Accepted holes

1. **Args mutated by another extension are not recorded.** `validateToolArguments`
   `structuredClone`s the arguments (`packages/ai/src/utils/validation.ts:318`), so a `tool_call`
   handler mutating `event.input` changes what executes while `turn_end.message` keeps the
   model's original args. No such extension is installed here. Subscribing to `tool_call` would
   fix it at the cost of per-`toolCallId` state reconciled at `turn_end` — declined until a real
   arg-rewriting extension exists.
2. **Untrusted project → no capture.** Project-local extensions load only after trust resolution
   (`extensions.md:113`).
3. **`packages/agent` library / `AgentHarness` users bypass coding-agent entirely** and are never
   captured. Outside the destination, which is this fork's coding agent.

### Consequences for other tickets

- **04 (schema)** — lands in `packages/decision-graph/src/store.ts`; the row is written from a
  single `turn_end` payload, so every column must be derivable from `{message, toolResults}`
  plus session context.
- **06 (ordering)** — inherits `turnIndex` free from `TurnEndEvent`, and inherits *no* pairing
  problem: parallel tool calls arrive already collected in `toolResults`.
- **09 (consumption)** — sole remaining justification for a core edit. If injection can be done
  with `before_agent_start` / `context`, fork-core is never needed.
- **11 (metrics)** — owns the `pi-harness.ts` diff above **and** the `thinkingLevel` unpin from
  ticket 02. One edit, one session.
- **Packaging** (was "not yet specified") — answered: a workspace package in this fork, loaded as
  a pi extension. Not upstreamed, not published.

### What this touches

Nothing yet. Decision only — the build is new files plus one ~10-line edit deferred to ticket 11.
