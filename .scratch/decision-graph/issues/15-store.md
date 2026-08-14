# 15 — Store: schema, migrations, write path, redaction

**What to build:** a project-local SQLite Store that the rest of the feature reads and writes.
It is created lazily by the *first* Decision write — no init command, no file appearing before
there is something to say. Every write is gated behind three checks (project trust, a persisted
session, not-already-disabled), migrates forward using the pattern already used by the repo's
SQLite session backend, and lands a whole Decision — its tool invocations and its Touches — as
one all-or-nothing transaction. Before anything is written, the seven sensitive columns (WHY
thinking/text, invocation arguments/result, and a Touch's patch/new_text/old_text) pass through
three redaction layers: unconditional path-driven redaction for credential-shaped files,
known-secret-shaped env-literal matching, and vendor-token/generic pattern matching. A redaction
failure sentinels one column rather than losing the row. Five relations between Decisions
(Follows, Redirected-by, Caused-by-error, Retry-of, Forked-from) are exposed as read-time
views/functions over the tables above — no edge tables, nothing materialised.

The full schema, migration pattern, gate list and redaction rules are already specified in
`.scratch/decision-graph/issues/14-build-spec.md` under "The Store" and "Redaction" — this
ticket is that spec, built and tested.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The Store file appears at the configured project directory the first time a Decision is
      written, and not before.
- [ ] Migrations apply once and are idempotent across reopen.
- [ ] Writing the same Decision twice (same `content_hash`) produces one row.
- [ ] A Decision and its `tool_invocation`/`touched` rows are written all-or-nothing.
- [ ] A Touch on a dotenv/credential-shaped path is redacted unconditionally; a known
      secret-shaped env literal is redacted across all seven columns by substring match; a
      vendor-token or generic-assignment shape is redacted by pattern.
- [ ] Redacted values are replaced by a placeholder naming the category, not blanked.
- [ ] A redaction failure replaces only that one column with a sentinel; the other six columns
      of the same Decision are written normally.
- [ ] The three write gates (project trust, session is persisted, Store not already disabled)
      are checked before any file is opened; failing any one records nothing.
- [ ] A write failure disables the Store for the rest of the process (one-strike), logs once,
      and never auto-repairs or auto-deletes the file.
- [ ] Each derived relation returns the correct pairs over a hand-built fixture, including the
      two narrowings: a Steer suppresses Caused-by-error, and Retry-of requires the same tool
      and (where the tool is anchored to one) the same File.
- [ ] A single warning fires once, at Store creation, if the Store's path is not covered by the
      project's ignore rules. The project's own ignore file is never written to.
