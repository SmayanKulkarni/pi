# 04 — Decision record schema and SQLite design

Type: domain-modeling
Skill: mattpocock-skills:domain-modeling
Status: open
Blocked by: 01, 02, 03

## Question

Define the record. This is the artifact everything else reads and writes, so it gets a
ubiquitous language, not just a table.

Settle:

- What *is* a "decision"? One per turn? One per tool call? One per assistant message with
  reasoning? Turn boundary (`turn_end`) is the obvious candidate — argue it or beat it.
- Fields: id, session id, turn index, timestamp, model, provider, reasoning text (per the
  degradation ladder from ticket 02), tool calls, results, error state, anchors (per ticket 01),
  token usage.
- SQLite schema: tables, indexes for the queries the viewer and the consumption path need
  ("all decisions in time order", "all decisions touching X", "the decision that caused this error").
- Where the DB file lives, and whether it is gitignored or committed.
- Migration story — the schema *will* change during this project. Pi already has
  `packages/coding-agent/src/migrations.ts`; reuse or not.
- Write path: per-record insert, or batched. Crash safety (WAL?).
- Size per record and projected growth for a long session.

Use `mattpocock-skills:domain-modeling`. Name the terms; they carry through the viewer and
the metrics work.
