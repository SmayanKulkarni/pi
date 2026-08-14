/**
 * Schema DDL, inlined rather than loaded from `.sql` files (no packaging obligation, no file
 * IO). Migration pattern copied from `@earendil-works/pi-session-backend-sqlite-node`'s
 * `sqlite/migrations.ts`, not imported: that implementation hardcodes its own migration list
 * and cannot be pointed elsewhere.
 */
export interface Migration {
	id: string;
	sql: string;
}

const INITIAL_SQL = `
CREATE TABLE session (
    id                   TEXT PRIMARY KEY,
    cwd                  TEXT NOT NULL,
    session_file         TEXT,
    parent_session_file  TEXT
);

CREATE TABLE sitting (
    id                 TEXT PRIMARY KEY,
    session_id         TEXT NOT NULL REFERENCES session(id),
    ts                 INTEGER NOT NULL,
    reason             TEXT NOT NULL
        CHECK (reason IN ('startup','reload','new','resume','fork')),
    prev_session_file  TEXT
);
CREATE INDEX sitting_session ON sitting(session_id, ts);

CREATE TABLE decision (
    id              TEXT PRIMARY KEY,
    content_hash    TEXT NOT NULL UNIQUE,
    session_id      TEXT NOT NULL REFERENCES session(id),
    run_id          TEXT NOT NULL,
    turn_index      INTEGER NOT NULL,
    ts              INTEGER NOT NULL,
    leaf_entry_id   TEXT,

    api             TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    response_model  TEXT,

    thinking        TEXT,
    text            TEXT,
    why_source      TEXT NOT NULL
        CHECK (why_source IN ('raw','summary','redacted','omitted','text_only','none')),

    stop_reason     TEXT NOT NULL,
    error_message   TEXT,

    tok_input       INTEGER NOT NULL,
    tok_output      INTEGER NOT NULL,
    tok_reasoning   INTEGER,
    tok_cache_read  INTEGER NOT NULL,
    tok_cache_write INTEGER NOT NULL,
    cost_total      REAL NOT NULL
);
CREATE INDEX decision_session ON decision(session_id, id);

CREATE TABLE tool_invocation (
    decision_id  TEXT NOT NULL REFERENCES decision(id) ON DELETE CASCADE,
    call_id      TEXT NOT NULL,
    ordinal      INTEGER NOT NULL,
    name         TEXT NOT NULL,
    arguments    TEXT NOT NULL,
    result_text  TEXT,
    is_error     INTEGER,
    PRIMARY KEY (decision_id, call_id)
);

CREATE TABLE touched (
    decision_id  TEXT NOT NULL,
    call_id      TEXT NOT NULL,
    path         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('edit','write')),
    patch        TEXT,
    new_text     TEXT,
    old_text     TEXT,
    PRIMARY KEY (decision_id, call_id),
    FOREIGN KEY (decision_id, call_id)
        REFERENCES tool_invocation(decision_id, call_id) ON DELETE CASCADE
);
CREATE INDEX touched_path ON touched(path);

CREATE TABLE steer (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL
);
CREATE INDEX steer_session ON steer(session_id, ts);

CREATE TABLE compaction (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES session(id),
    ts          INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    will_retry  INTEGER NOT NULL,
    entry_id    TEXT
);

CREATE VIEW decision_why AS
SELECT id, session_id, run_id, turn_index, ts, why_source,
       CASE why_source
           WHEN 'raw'       THEN thinking
           WHEN 'summary'   THEN thinking
           WHEN 'text_only' THEN text
           ELSE NULL
       END AS why
FROM decision;
`;

export const MIGRATIONS: Migration[] = [{ id: "001_initial", sql: INITIAL_SQL }];
