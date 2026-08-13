# 09 — How does the graph get back into the agent?

Type: grilling
Skill: mattpocock-skills:grill-with-docs
Status: open
Blocked by: 04, 13

## Question

Capture is free. Consumption is where the token cost the original idea worried about actually
lives — and downstream task benefit (the chosen metric, ticket 11) is impossible to measure
without a consumption path.

Settle:

- What does the agent receive: injected system-prompt context, a queryable tool
  (`query_decisions`), or a compaction-time summary?
- Selection: the graph will be far larger than any context window. What subset is surfaced,
  and by what rule? ("decisions touching files in this turn", "last N", "decisions on the
  failing path".) Selection must itself be deterministic — no model. **Ticket 13 supplies the
  relevance primitive (`supersedes` / live-rationale); this ticket picks the window over it.**
- Token budget: a hard cap, and what gets dropped first.
- **Compaction interaction.** Compaction (`packages/agent/src/harness/compaction/`) is where
  the agent forgets. Is the graph a *replacement* for what compaction drops — re-injected
  after a compaction event — or independent of it? This is the strongest version of the
  original idea and the most likely place to break something.
- Does consumption default to off? (A capture-only build is measurable for overhead and
  usable by a human without ever touching the agent's context.)
