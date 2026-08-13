# 05 — Secret redaction policy for captured records

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
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
