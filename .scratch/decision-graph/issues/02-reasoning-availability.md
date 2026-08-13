# 02 — What reasoning do providers actually give us?

Type: research
Skill: mattpocock-skills:research
Status: closed
Blocked by: —

## Question

The whole no-extra-tokens design rests on reasoning already being present in the assistant
message. Establish, factually, how much is actually there.

Work this **inline** — no subagents (map Notes).

Investigate, against `packages/ai` in this repo and primary provider docs:

- Which providers surface reasoning/thinking content through Pi's unified message type, and
  under what field. Start from `packages/ai/src` and the `AssistantMessage` content union.
- Anthropic redacted/encrypted thinking: what arrives, is it readable, is it storable.
- OpenAI reasoning models: is reasoning content returned at all or only summarised.
- **OpenRouter specifically** (the intended test path): what comes back per underlying model,
  and whether it is normalised by Pi or passed through raw.
- Models that emit tool calls with no accompanying text: how common, and what's left to
  capture when that happens.

Deliver: a table of provider → reasoning fidelity (full / summarised / redacted / none),
and a stated **degradation ladder** — what the record contains when the best source is
missing, all the way down to "tool calls only, no WHY".

## Resolution

**No provider returns raw chain of thought. The realistic ceiling is a provider-generated
summary, and it is not guaranteed on any single turn.** The record must therefore carry its
own provenance, and the WHY-less rung is a design floor, not an edge case.

### Where reasoning lives in Pi's unified type

`AssistantMessage.content` is `(TextContent | ThinkingContent | ToolCall)[]`
(`packages/ai/src/types.ts:417`). Nothing in the union is required — a message may legally be
tool calls alone. `ThinkingContent` (`types.ts:344-352`) is:

```ts
{ type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }
```

`thinkingSignature` is **not** WHY. It is a provider round-trip token, and its contents differ
per API (crypto signature, opaque blob, or — on OpenAI Responses — the entire serialised
reasoning item). `redacted: true` marks safety-redacted Anthropic blocks.

Reasoning token *counts* are separate: `Usage.reasoning` (`types.ts:382`), a subset of `output`,
left undefined by providers that do not report a breakdown.

Nothing strips thinking before persistence — capture at `turn_end`
(`packages/agent/src/agent-loop.ts:224`) sees the blocks intact.

### Provider → reasoning fidelity

Fidelity is a property of the **API module**, not the vendor name, because Pi routes many
vendors through one module.

| API module (`packages/ai/src/api/`) | Providers | What arrives | Fidelity |
|---|---|---|---|
| `anthropic-messages.ts` | anthropic, vertex-anthropic | `thinking` block → `{thinking, signature}` (`:596-604`); `redacted_thinking` → literal `"[Reasoning redacted]"` + opaque `data` as signature, `redacted: true` (`:605-614`) | **summarised**, degrading to **redacted** |
| `openai-responses-shared.ts` | openai, azure, openai-codex, xai (responses) | text from `response.reasoning_summary_text.delta` (`:602`) / `response.reasoning_text.delta` (`:622`); finalised from `item.summary` else `item.content` (`:686-688`) | **summarised**, often **none** |
| `openai-completions.ts` | **openrouter**, deepseek, xai, zai, groq, together, cerebras, moonshot, nvidia, baseten, local/vLLM | first non-empty of `reasoning_content` / `reasoning` / `reasoning_text` (`:493-520`) | **passthrough of upstream** — anything from raw to none |
| `google-generative-ai.ts`, `google-vertex.ts` | google, google-vertex | parts with `thought === true` (`google-shared.ts:35`); `includeThoughts: true` requested (`google-generative-ai.ts:387`) | **summarised** |
| `bedrock-converse-stream.ts` | amazon-bedrock | `delta.reasoningContent.text` → thinking, `.signature` → signature (`:560-584`); signature field is Anthropic-models-only (`:759-762`) | **summarised** |
| `mistral-conversations.ts` | mistral | `thinking` items as arrays of text parts, concatenated (`:639-656`) | **summarised** |
| `pi-messages.ts` | pi | passthrough of the same event stream (`:223`) | inherits upstream |
| `faux.ts` | tests | synthetic (`:57`, `:367`) | whatever the fixture says |

Primary sources for the "never raw" claim:

- Anthropic: *"the text in a thinking block is a summary of Claude's reasoning… No `display`
  setting returns the raw chain of thought."* Summaries are produced **by a different model**
  than the one you targeted, and the behaviour is *"subject to change."*
  ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking))
- OpenAI: *"While reasoning tokens are not visible via the API, they still occupy space in the
  model's context window and are billed as output tokens."* Summaries are opt-in only.
  ([Reasoning](https://developers.openai.com/api/docs/guides/reasoning))
- Google: thought summaries only; a thought block *"may contain only a signature with no
  summary."* ([Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking))
- OpenRouter: reasoning is *"included in the response by default if the model decides to output
  them"*, exposed as a flat `reasoning` string plus a structured `reasoning_details` array whose
  entry types are `reasoning.text`, `reasoning.summary`, `reasoning.encrypted`.
  ([Reasoning tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens))

### Anthropic specifics

- Pi **forces `display: "summarized"`** (`anthropic-messages.ts:1032`). This matters: the API
  default is `"omitted"` on Opus 5, Sonnet 5, Fable 5, Opus 4.8, Opus 4.7 and Mythos Preview,
  which returns `thinking` blocks with an **empty** `thinking` field and the signature only.
  Pi's override is the single line keeping WHY non-empty on the newest Claude models. It is a
  default (`?? "summarized"`), so any caller passing `thinkingDisplay: "omitted"` silently
  drops the graph to the opaque rung.
- `redacted_thinking` carries an opaque encrypted `data` field and **no readable text**. Pi
  substitutes the string `"[Reasoning redacted]"` — Pi-invented text, not model output. Storing
  it as WHY would be a fabrication; it must map to the opaque rung via `redacted: true`.
- Adaptive-thinking models **may skip thinking entirely** on a simple request, producing no
  thinking block at all regardless of `display`. Uneven coverage is the documented normal case.

### OpenRouter specifics (the intended benchmark path)

OpenRouter is **not** a normalisation win here. `openrouterProvider()`
(`providers/openrouter.ts:21`) routes to `openai-completions`, so:

- Request side: `compat.thinkingFormat === "openrouter"` sends `reasoning: { effort }`
  (`openai-completions.ts:807-816`), or `{ effort: "none" }` when thinking is off. Pi never
  sends `exclude: true`.
- Response side: Pi reads the **flat `reasoning` string only**. The structured
  `reasoning_details` array is parsed exclusively for `reasoning.encrypted` entries, which are
  stashed as `thoughtSignature` on the matching tool call (`:552-565`). **`reasoning.text` and
  `reasoning.summary` entries in `reasoning_details` are discarded.**
- Consequence: fidelity through OpenRouter is whatever the underlying vendor emits, flattened
  to a string, with no marker of which kind it was. Anthropic-via-OpenRouter yields summaries;
  OpenAI-via-OpenRouter yields a summary if the model emits one and nothing readable otherwise;
  DeepSeek-style models yield near-raw `reasoning_content`. **The record cannot tell these apart
  from the string alone** — it must record `responseModel` (`types.ts:421`), which Pi already
  populates for OpenRouter routing.

### Availability gates before fidelity even applies

Four independent switches can zero out WHY regardless of provider:

1. `model.reasoning === false` (`types.ts:800`) — every request builder gates on it. No thinking, ever.
2. **Thinking level defaults diverge by entry point**:
   - `Agent` library / `AgentHarness`: **`"off"`** (`packages/agent/src/agent.ts:77`, `harness/agent-harness.ts:329`)
   - coding-agent CLI: **`"medium"`** (`packages/coding-agent/src/core/defaults.ts:3`)
   - **`packages/evals` hardcodes `thinkingLevel: "off"`** (`packages/evals/src/pi-harness.ts:148`)
3. `clampThinkingLevel` (`models.ts:913`) silently remaps an unsupported level to the nearest
   supported one, possibly `"off"`.
4. Per-request model discretion (Anthropic adaptive, Gemini `thinking_level: minimal`).

**Gate 2 is a live problem for the map's destination.** The benchmark axis (ticket 11) runs
through `packages/evals`, which currently produces **zero thinking on every turn**. As it
stands, benchmarking the graph would measure a graph built entirely on the L3/L4 rungs below.
Ticket 11 must either flip that flag or state explicitly that it measures a WHY-less graph.

### Degradation ladder

Each record declares the rung it was built on. Rung is decided at capture, costs nothing, and
is the input every downstream consumer needs.

| Rung | Condition | WHY content | Realistic sources |
|---|---|---|---|
| **L0 raw** | thinking text is model-authored CoT | full reasoning | DeepSeek `reasoning_content`, open-weight models via OpenRouter/vLLM. Uncommon and unverifiable from the wire. |
| **L1 summary** | `ThinkingContent.thinking` non-empty, `redacted !== true` | provider-generated summary | Anthropic (Pi forces summarised), OpenAI summary, Gemini thought summaries, Bedrock, Mistral. **The realistic ceiling.** |
| **L2 opaque** | thinking block present, no usable text | *nothing* — only "the model reasoned here" | `redacted: true`; `display: "omitted"`; Gemini signature-without-summary; OpenAI encrypted-content-only |
| **L3 text-only** | no thinking block, assistant text present | the assistant's own prose | non-reasoning models, thinking off, adaptive skip. **Most common rung in practice.** |
| **L4 none** | tool calls only | no generated WHY at all | terse tool-loop turns |

At **L4** the record is not empty — it is the deterministic evidence ticket 01 already
guarantees: tool name, arguments, `oldText`/`newText` on each `touched` edge, and position in
the turn sequence. That is *what happened*, never *why*. Nothing is inferred and no model is
called to fill the gap.

L0 and L1 are not distinguishable from the wire; the record labels both from what Pi surfaced
and records `provider`, `model` and `responseModel` so the distinction can be re-derived later
from the model identity rather than guessed at capture time.

### Consequences for other tickets

- **04 (schema)** — the decision row needs a `why_source` enum (`raw | summary | redacted |
  omitted | text_only | none`) plus `provider` / `model` / `responseModel`. Not derivable after
  the fact: `redacted` and `omitted` both present as "thinking block with no useful text", and
  OpenRouter erases the upstream distinction.
- **05 (redaction)** — **do not persist `thinkingSignature`.** On OpenAI Responses it is
  `JSON.stringify` of the whole reasoning item including `encrypted_content`
  (`openai-responses-shared.ts:689`): kilobytes per turn, zero human value, and a payload the
  store has no use for. Signatures exist for API replay; the graph is not a replay buffer.
  Dropping them shrinks both the store and the secrets surface.
- **09 (consumption)** — cannot assume a WHY exists. Feeding the graph back must handle L3/L4
  records, which will be the majority under current defaults.
- **11 (metrics)** — must set a thinking level explicitly. `packages/evals/src/pi-harness.ts:148`
  currently pins `"off"`. Reporting rung distribution alongside task scores is the only way to
  tell "the graph didn't help" apart from "the graph had no WHY in it".
- **Viewer (10)** — needs a visual distinction between "reasoned, not shown" (L2) and "did not
  reason" (L4). Collapsing them misrepresents the model.

### What this touches

Nothing. Research only — no code changed, no upstream rebase cost.
