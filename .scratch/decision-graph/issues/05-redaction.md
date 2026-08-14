# 05 — Secret redaction policy for captured records

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: closed
Blocked by: 04

## Question

Thinking text and tool arguments routinely contain API keys, env values, tokens, and file
contents. Captured verbatim to a project-local SQLite file, that store becomes a credential
dump — and a worse one than the session log, because it is long-lived and designed to be shared
and visualised.

**Scope widened by ticket 01.** Every `touched` edge now stores the applied `oldText`/`newText`
verbatim — required to make supersession deterministically derivable (ticket 13). So raw file
content is a first-class secrets surface here, not just thinking and tool args. A `.env` edit
puts the literal secret on an edge. Any answer that redacts only thinking and args is incomplete.

Settle:

- What does Pi already do here? Check `packages/agent/src/harness/telemetry.ts` and
  `packages/telemetry` for an existing redaction path, and reuse it rather than writing one.
- What is redacted: known env var values, key-shaped strings, file contents above a size,
  specific tool args (`bash` command lines? `write` contents?).
- Redact at capture (safe, lossy, irreversible) or at export/view time (complete store, but
  the store itself is now sensitive)?
- Is the DB gitignored by default? Is it opt-in per project (`.pi/` trust model — see
  `packages/coding-agent/src/core/project-trust.ts`)?
- What happens on a repo the agent doesn't own.

This one is not allowed to be deferred to "later" — it gates the first real capture run.

## Resolution

**Redact at capture, into the same six TEXT columns ticket 04 already defined, no migration.
The bar it clears is defense-in-depth against casual and accidental exposure — not a claim
that the store is safe to hand to a stranger.** That distinction was grilled explicitly and
matters: no pattern-matching layer, in this design or in any existing tool (gitleaks,
trufflehog included), can drive false negatives to zero against a secret with no shape (a
password typed in prose, a token with no `KEY=value` structure and no match to a currently-set
env var). Claiming a third-party-safe guarantee here would be a promise the mechanism cannot
keep. If a stronger bar is ever needed — attaching the db to a bug report, feeding it back into
the agent (ticket 09), rendering it for someone outside the project (ticket 10) — that requires
a human-reviewed export gate, which is those tickets' job, not Capture's.

### What Pi already has: nothing reusable

`packages/agent/src/harness/telemetry.ts` is a span/attribute schema for OpenTelemetry-shaped
tracing, unrelated to secret handling. The only `redacted` field anywhere in the codebase is
`ThinkingContent.redacted` (`packages/ai/src/types.ts:351`) — a provider safety-filter flag set
by Anthropic when *it* withholds reasoning, not a mechanism for scrubbing secrets from captured
text. No `package.json` in the monorepo depends on `secretlint`, `detect-secrets`, `gitleaks`,
or similar. This ticket builds the only redaction path that will exist, from three small,
dependency-free layers.

### The three layers

Applied in order, on capture, to exactly the six columns ticket 04 enumerated as the secrets
surface: `decision.thinking`, `decision.text`, `tool_invocation.arguments`,
`tool_invocation.result_text`, `touched.patch`, `touched.new_text`.

1. **Path-driven, unconditional.** When `touched.path` matches a dotenv/credential-file glob
   (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.netrc`, `credentials*`), every
   `KEY=VALUE`-shaped value in that row's `patch`/`new_text` is redacted regardless of whether
   the value itself looks secret-shaped. This is the direct fix for the scenario the ticket
   opens with: a `.env` edit landing verbatim in `touched.new_text`, where the value could be
   anything and the file identity alone is the signal.
2. **Known-env-value, literal.** Any `process.env` entry whose *name* matches a secret-shaped
   pattern (`KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH`, case-insensitive) and whose value is
   long enough not to false-positive on trivial values (`>= 8` chars) is substring-matched and
   redacted across all six columns, not just `touched`.
3. **Pattern-based.** Vendor token shapes (AWS `AKIA[0-9A-Z]{16}`, GitHub `gh[pousr]_…`,
   `sk-`/`sk-ant-`-style API keys, JWTs, PEM private-key blocks) plus a generic
   `key\s*[:=]\s*["'\`]value["'\`]` assignment heuristic, run over free text (`thinking`,
   `text`, `result_text`) as well as structured content (`arguments`, `patch`, `new_text`).

Each match is replaced with a placeholder that names what was cut, not blanked outright —
`[REDACTED:env:STRIPE_SECRET_KEY]`, `[REDACTED:dotenv-value]`, `[REDACTED:vendor-token:github]`.
Given the defense-in-depth bar (not third-party-safe), the debuggability of knowing *what class*
of thing was redacted — for triaging false positives without recapture — outweighs the marginal
extra shape leaked by a variable name. **No schema migration is needed**: placeholders are just
different string content in the TEXT columns ticket 04 already shipped, resolving that ticket's
open question of whether 05 would need one.

### Accepted hole, stated rather than solved

A secret with no shape and no path signal — typed inline in prose, or returned by a tool with
no `KEY=value` structure and no match to a live env value — is not caught by any of the three
layers. This is not an implementation gap to close later; it is what pattern-matching can never
guarantee, against any input. Stated explicitly rather than left implicit, per this project's
established style (ticket 04's `write`-blind-supersession hole; ticket 01's bash-mutation hole).
**Tripwire: revisit if real leakage through this path is observed, not before.**

A second, narrower accepted hole: a secret embedded in **bash command text** (`export
API_KEY=sk-…`, `cat .env`) has no `touched.path` for layer 1 to key on — a raw bash call isn't
an `edit`/`write`. Catching it would mean parsing shell syntax in Capture to recognize
dotenv-shaped commands, which is the exact class of heuristic ticket 04 already refused for
rename detection ("a heuristic in Capture makes its mistakes permanent"). Layers 2 and 3 still
apply to `tool_invocation.arguments` for bash calls, so a value that matches a known env value
or a vendor token shape is still caught — only the path-driven layer's unconditional coverage
is unavailable here.

### Failure mode

If a redaction layer itself throws, the row is not lost: only the failing column's value is
replaced with a `[REDACTION_FAILED]` sentinel, and the rest of the Decision — tokens, tool
calls, every other column — is written normally. This matches ticket 03's "handler throws are
caught, the loop keeps running" posture and ticket 04's stance that a broken capture must not
silently drop history. Failing open (storing the raw value when redaction breaks) was rejected:
it fails exactly when the safeguard is least trustworthy. Dropping the whole Decision was
rejected: it destroys five clean columns to protect one that failed.

### The store's exposure in the target project

`<cwd>/.pi/decision-graph.db` is not self-added to the target project's `.gitignore`. Precedent
exists for a Pi extension to self-write a scoped, append-only `.gitignore`
(`packages/coding-agent/src/core/package-manager.ts:1988-1996`, `ensureGitIgnore`), but editing
a file the project owns without being asked was judged an overreach for a background capture
extension specifically — unlike `package-manager.ts`, which owns the directory it's writing
into, `.pi/` in a target project is not decision-graph's directory alone.

Instead: **at store creation, Capture checks once whether the db path is actually covered by an
existing ignore rule (`git check-ignore`-equivalent) and, if not, emits a single interactive-mode
warning** telling the user to add `.pi/decision-graph.db*` themselves. Purely informational,
never touches the project's files, and — because it fires once per store rather than per
turn — does not nag on every session once the user has fixed it or dismissed it. This closes the
gap a docs-only answer would leave: someone can run a full session, and several more, without
ever reading a README section that mentions gitignoring.

### Trust model: no new gate

Ticket 03 (closed) already settled this. Capture is a project-local Pi extension loaded through
the same path that requires project-trust resolution
(`packages/coding-agent/src/core/trust-manager.ts`,
`TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES` includes `"extensions"`); an untrusted project never
loads it. Ticket 03 states this as accepted hole 2, "Untrusted project → no capture." That
directly answers this ticket's "what happens on a repo the agent doesn't own": nothing is
captured there, structurally, before any redaction question can even arise. 05 adds no
additional opt-in flag — the existing trust gate already makes the whole secrets surface
per-project and inert by default on repos the agent doesn't own.

### Consequences for other tickets

- **09 (consumption)** — if feeding the graph back to the agent, or exporting it, is ever meant
  to be safe for a party outside the project, that safety has to be built there as an explicit,
  human-reviewed step. It cannot be inherited from capture-time redaction, which this ticket
  deliberately does not claim clears that bar.
- **10 (viewer)** — should render `[REDACTED:…]` placeholders distinctly (e.g. visually marked,
  not styled as ordinary code/text), so a redaction reads as "something was cut here," not as
  literal file content.
- **04 (schema)** — its open question ("05 owns the policy and gets a migration if it needs
  columns") is resolved: no migration. Placeholders are ordinary strings in the columns already
  shipped.

### What this touches

New files only: `packages/decision-graph/src/redact.ts` (the three layers plus the failure-mode
wrapper) and its test file, called from the `turn_end` write path ticket 04 specified in
`packages/decision-graph/src/store.ts` before each `INSERT`. The one-time gitignore-coverage
warning lands in the same package's store-init path. No existing file is modified; zero upstream
conflict surface, consistent with every ticket in this map so far.
