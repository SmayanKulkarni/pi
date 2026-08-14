import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { computeContentHash } from "./content-hash.ts";
import * as derived from "./derived.ts";
import { isPathIgnored } from "./ignore-check.ts";
import { applyMigrations } from "./migrations.ts";
import { redactDecision } from "./redact.ts";
import { MIGRATIONS } from "./schema.ts";
import type {
	CompactionInput,
	SessionInput,
	SittingInput,
	SteerInput,
	WriteDecisionInput,
	WriteGates,
} from "./types.ts";

/**
 * `join(cwd, CONFIG_DIR_NAME, "decision-graph.db")` — read from configuration rather than
 * hardcoded `.pi`, since this is a fork and that directory is overridable. Scoped to cwd with
 * no upward search and no git-root resolution, matching the rest of the harness.
 */
export function decisionGraphDbPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "decision-graph.db");
}

export interface StoreOptions {
	/** Fires once, at Store creation, if the db path is not covered by an ignore rule. */
	warnNotIgnored?: (dbPath: string) => void;
	/** Fires once, on the write that disables the Store for the rest of the process. */
	logDisabled?: (error: unknown) => void;
}

/**
 * The project-local SQLite Store. Created lazily by the first Decision write — no init step,
 * no file appearing before there is something to say. One-strike: a write failure disables the
 * Store for the rest of the process; it never auto-repairs or auto-deletes the file.
 */
export class DecisionGraphStore {
	private readonly dbPath: string;
	private readonly cwd: string;
	private readonly options: StoreOptions;
	private db: DatabaseSync | undefined;
	private disabledFlag = false;
	private warnedIgnore = false;

	constructor(dbPath: string, cwd: string, options: StoreOptions = {}) {
		this.dbPath = dbPath;
		this.cwd = cwd;
		this.options = options;
	}

	get path(): string {
		return this.dbPath;
	}

	get disabled(): boolean {
		return this.disabledFlag;
	}

	private disable(error: unknown): void {
		if (this.disabledFlag) return;
		this.disabledFlag = true;
		this.options.logDisabled?.(error);
	}

	private ensureOpen(): DatabaseSync {
		if (this.db) return this.db;

		const isNew = !existsSync(this.dbPath);
		mkdirSync(dirname(this.dbPath), { recursive: true });
		const db = new DatabaseSync(this.dbPath);
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA synchronous = FULL");
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA foreign_keys = ON");
		applyMigrations(db, MIGRATIONS);
		this.db = db;

		if (isNew && !this.warnedIgnore) {
			this.warnedIgnore = true;
			const ignored = isPathIgnored(this.cwd, this.dbPath);
			if (ignored === false) this.options.warnNotIgnored?.(this.dbPath);
		}

		return db;
	}

	private insertSession(db: DatabaseSync, session: SessionInput): void {
		db.prepare(`INSERT OR IGNORE INTO session (id, cwd, session_file, parent_session_file) VALUES (?, ?, ?, ?)`).run(
			session.id,
			session.cwd,
			session.sessionFile,
			session.parentSessionFile,
		);
	}

	private insertSitting(db: DatabaseSync, sitting: SittingInput): void {
		db.prepare(
			`INSERT OR IGNORE INTO sitting (id, session_id, ts, reason, prev_session_file) VALUES (?, ?, ?, ?, ?)`,
		).run(sitting.id, sitting.sessionId, sitting.ts, sitting.reason, sitting.prevSessionFile);
	}

	/**
	 * Writes a Decision and its tool invocations and Touches as one all-or-nothing transaction,
	 * behind the three write gates. Returns whether a new row was written: `false` on a gate
	 * failure, a disabled Store, or a `content_hash` that was already recorded.
	 */
	writeDecision(gates: WriteGates, input: WriteDecisionInput): boolean {
		if (this.disabledFlag) return false;
		if (!gates.projectTrusted || !gates.sessionPersisted) return false;

		try {
			const db = this.ensureOpen();
			const redacted = redactDecision(input.decision);
			const contentHash = computeContentHash(input.decision);

			db.exec("BEGIN IMMEDIATE");
			try {
				this.insertSession(db, input.session);
				for (const sitting of input.sittings) this.insertSitting(db, sitting);

				const result = db
					.prepare(
						`INSERT OR IGNORE INTO decision (
						     id, content_hash, session_id, run_id, turn_index, ts, leaf_entry_id,
						     api, provider, model, response_model,
						     thinking, text, why_source,
						     stop_reason, error_message,
						     tok_input, tok_output, tok_reasoning, tok_cache_read, tok_cache_write, cost_total
						 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						redacted.id,
						contentHash,
						redacted.sessionId,
						redacted.runId,
						redacted.turnIndex,
						redacted.ts,
						redacted.leafEntryId,
						redacted.api,
						redacted.provider,
						redacted.model,
						redacted.responseModel,
						redacted.thinking,
						redacted.text,
						redacted.whySource,
						redacted.stopReason,
						redacted.errorMessage,
						redacted.tokInput,
						redacted.tokOutput,
						redacted.tokReasoning,
						redacted.tokCacheRead,
						redacted.tokCacheWrite,
						redacted.costTotal,
					);

				if (result.changes === 0) {
					db.exec("COMMIT");
					return false;
				}

				const insertInvocation = db.prepare(
					`INSERT INTO tool_invocation (decision_id, call_id, ordinal, name, arguments, result_text, is_error)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				);
				for (const invocation of redacted.toolInvocations) {
					insertInvocation.run(
						redacted.id,
						invocation.callId,
						invocation.ordinal,
						invocation.name,
						invocation.arguments,
						invocation.resultText,
						invocation.isError === null ? null : invocation.isError ? 1 : 0,
					);
				}

				const insertTouch = db.prepare(
					`INSERT INTO touched (decision_id, call_id, path, kind, patch, new_text, old_text)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				);
				for (const touch of redacted.touches) {
					insertTouch.run(
						redacted.id,
						touch.callId,
						touch.path,
						touch.kind,
						touch.patch,
						touch.newText,
						touch.oldText,
					);
				}

				db.exec("COMMIT");
				return true;
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch {
					// Ignore rollback errors to rethrow the original error.
				}
				throw error;
			}
		} catch (error) {
			this.disable(error);
			return false;
		}
	}

	writeSteer(gates: WriteGates, steer: SteerInput): boolean {
		if (this.disabledFlag || !gates.projectTrusted || !gates.sessionPersisted) return false;
		try {
			const db = this.ensureOpen();
			db.prepare(`INSERT OR IGNORE INTO steer (id, session_id, ts) VALUES (?, ?, ?)`).run(
				steer.id,
				steer.sessionId,
				steer.ts,
			);
			return true;
		} catch (error) {
			this.disable(error);
			return false;
		}
	}

	writeCompaction(gates: WriteGates, compaction: CompactionInput): boolean {
		if (this.disabledFlag || !gates.projectTrusted || !gates.sessionPersisted) return false;
		try {
			const db = this.ensureOpen();
			db.prepare(
				`INSERT OR IGNORE INTO compaction (id, session_id, ts, reason, will_retry, entry_id) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				compaction.id,
				compaction.sessionId,
				compaction.ts,
				compaction.reason,
				compaction.willRetry ? 1 : 0,
				compaction.entryId,
			);
			return true;
		} catch (error) {
			this.disable(error);
			return false;
		}
	}

	/** A missing Store reads as empty, never as an error: the file is never opened for a read. */
	private withReadDb<T>(fallback: T, fn: (db: DatabaseSync) => T): T {
		if (!existsSync(this.dbPath)) return fallback;
		try {
			return fn(this.ensureOpen());
		} catch {
			return fallback;
		}
	}

	follows(): derived.FollowsRow[] {
		return this.withReadDb([], derived.follows);
	}

	redirectedBy(): derived.RedirectedByRow[] {
		return this.withReadDb([], derived.redirectedBy);
	}

	causedByError(): derived.CausedByErrorRow[] {
		return this.withReadDb([], derived.causedByError);
	}

	retryOf(): derived.RetryOfRow[] {
		return this.withReadDb([], derived.retryOf);
	}

	forkedFrom(): derived.ForkedFromRow[] {
		return this.withReadDb([], derived.forkedFrom);
	}

	close(): void {
		this.db?.close();
		this.db = undefined;
	}
}

/** Constructs a Store at the project's canonical path for `cwd`. */
export function createStore(cwd: string, options: StoreOptions = {}): DecisionGraphStore {
	return new DecisionGraphStore(decisionGraphDbPath(cwd), cwd, options);
}
