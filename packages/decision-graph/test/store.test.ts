import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DecisionGraphStore, decisionGraphDbPath } from "../src/store/store.ts";
import type { DecisionInput, SessionInput, WriteDecisionInput, WriteGates } from "../src/store/types.ts";

const GATES: WriteGates = { projectTrusted: true, sessionPersisted: true };

function session(overrides: Partial<SessionInput> = {}): SessionInput {
	return {
		id: "session-1",
		cwd: "/repo",
		sessionFile: "/repo/.pi/agent/sessions/s1.jsonl",
		parentSessionFile: null,
		...overrides,
	};
}

function decisionInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
	return {
		id: "dec-1",
		sessionId: "session-1",
		runId: "run-1",
		turnIndex: 0,
		ts: 1000,
		leafEntryId: "entry-1",
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude",
		responseModel: null,
		thinking: "because",
		text: "did it",
		whySource: "summary",
		stopReason: "end_turn",
		errorMessage: null,
		tokInput: 10,
		tokOutput: 5,
		tokReasoning: null,
		tokCacheRead: 0,
		tokCacheWrite: 0,
		costTotal: 0.01,
		toolInvocations: [],
		touches: [],
		...overrides,
	};
}

function writeInput(overrides: Partial<WriteDecisionInput> = {}): WriteDecisionInput {
	return { session: session(), sittings: [], decision: decisionInput(), ...overrides };
}

let tempDir: string;
let dbPath: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "decision-graph-test-"));
	dbPath = join(tempDir, ".pi", "decision-graph.db");
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("DecisionGraphStore", () => {
	it("does not create the file until the first Decision is written", () => {
		const store = new DecisionGraphStore(dbPath, tempDir);
		expect(existsSync(dbPath)).toBe(false);
		store.writeDecision(GATES, writeInput());
		expect(existsSync(dbPath)).toBe(true);
		store.close();
	});

	it("computes the canonical path from CONFIG_DIR_NAME under cwd", () => {
		expect(decisionGraphDbPath("/some/project")).toMatch(/[/\\]\.pi[/\\]decision-graph\.db$/);
	});

	it("applies migrations once and is idempotent across reopen", () => {
		const store1 = new DecisionGraphStore(dbPath, tempDir);
		store1.writeDecision(GATES, writeInput());
		store1.close();

		// Reopening and writing again must not fail or redo the migration.
		const store2 = new DecisionGraphStore(dbPath, tempDir);
		const wrote = store2.writeDecision(
			GATES,
			writeInput({ decision: decisionInput({ id: "dec-2", ts: 2000, thinking: "second" }) }),
		);
		expect(wrote).toBe(true);
		store2.close();
	});

	it("writing the same Decision twice (same content_hash) produces one row", () => {
		const store = new DecisionGraphStore(dbPath, tempDir);
		const first = store.writeDecision(GATES, writeInput());
		const second = store.writeDecision(GATES, writeInput({ decision: decisionInput({ id: "dec-1-retry" }) }));
		expect(first).toBe(true);
		expect(second).toBe(false);
		store.close();

		const verify = new DecisionGraphStore(dbPath, tempDir);
		expect(verify.follows()).toEqual([]); // only one decision exists, so no `follows` edge
		verify.close();
	});

	it("writes a Decision and its tool_invocation/touched rows all-or-nothing", () => {
		const store = new DecisionGraphStore(dbPath, tempDir);
		store.writeDecision(
			GATES,
			writeInput({
				decision: decisionInput({
					toolInvocations: [
						{
							callId: "call-1",
							ordinal: 0,
							name: "edit",
							arguments: '{"path":"a.ts"}',
							resultText: "ok",
							isError: false,
						},
					],
					touches: [
						{
							callId: "call-1",
							path: "a.ts",
							kind: "edit",
							patch: "@@ -1 +1 @@\n-a\n+b",
							newText: null,
							oldText: null,
						},
					],
				}),
			}),
		);
		store.close();

		const raw = new DatabaseSync(dbPath);
		try {
			const invocations = raw.prepare("SELECT * FROM tool_invocation").all();
			const touched = raw.prepare("SELECT * FROM touched").all();
			expect(invocations).toHaveLength(1);
			expect(touched).toHaveLength(1);
		} finally {
			raw.close();
		}
	});

	it("gates: fails all three checks before opening any file, and records nothing", () => {
		const untrusted = new DecisionGraphStore(dbPath, tempDir);
		untrusted.writeDecision({ projectTrusted: false, sessionPersisted: true }, writeInput());
		expect(existsSync(dbPath)).toBe(false);

		untrusted.writeDecision({ projectTrusted: true, sessionPersisted: false }, writeInput());
		expect(existsSync(dbPath)).toBe(false);
		untrusted.close();
	});

	it("one-strike disable: a write failure disables the Store for the rest of the process", () => {
		const store = new DecisionGraphStore(dbPath, tempDir);
		store.writeDecision(GATES, writeInput());
		expect(store.disabled).toBe(false);

		// Corrupt the schema so the next write throws inside the transaction.
		const raw = new DatabaseSync(dbPath);
		raw.exec("DROP TABLE tool_invocation");
		raw.close();

		const wrote = store.writeDecision(
			GATES,
			writeInput({
				decision: decisionInput({
					id: "dec-2",
					toolInvocations: [
						{ callId: "c", ordinal: 0, name: "bash", arguments: "{}", resultText: null, isError: null },
					],
				}),
			}),
		);
		expect(wrote).toBe(false);
		expect(store.disabled).toBe(true);

		// Further writes are an immediate no-op, never re-attempting the broken file.
		const secondAttempt = store.writeDecision(GATES, writeInput({ decision: decisionInput({ id: "dec-3" }) }));
		expect(secondAttempt).toBe(false);
		store.close();
	});

	it("logs the disable exactly once", () => {
		let calls = 0;
		const store = new DecisionGraphStore(dbPath, tempDir, { logDisabled: () => calls++ });
		store.writeDecision(GATES, writeInput());
		const raw = new DatabaseSync(dbPath);
		raw.exec("DROP TABLE decision");
		raw.close();

		store.writeDecision(GATES, writeInput({ decision: decisionInput({ id: "dec-2" }) }));
		store.writeDecision(GATES, writeInput({ decision: decisionInput({ id: "dec-3" }) }));
		expect(calls).toBe(1);
		store.close();
	});

	it("warns once at Store creation if the path is not covered by an ignore rule", () => {
		execFileSync("git", ["init", "-q"], { cwd: tempDir });
		const warnings: string[] = [];
		const store = new DecisionGraphStore(dbPath, tempDir, { warnNotIgnored: (path) => warnings.push(path) });
		store.writeDecision(GATES, writeInput());
		store.writeDecision(GATES, writeInput({ decision: decisionInput({ id: "dec-2" }) }));
		expect(warnings).toEqual([dbPath]);
		expect(existsSync(join(tempDir, ".gitignore"))).toBe(false);
		store.close();
	});

	it("does not warn when the path is already covered by an ignore rule", () => {
		execFileSync("git", ["init", "-q"], { cwd: tempDir });
		writeFileSync(join(tempDir, ".gitignore"), ".pi/\n");
		const warnings: string[] = [];
		const store = new DecisionGraphStore(dbPath, tempDir, { warnNotIgnored: (path) => warnings.push(path) });
		store.writeDecision(GATES, writeInput());
		expect(warnings).toEqual([]);
		store.close();
	});
});
