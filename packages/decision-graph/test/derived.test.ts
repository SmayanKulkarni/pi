import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DecisionGraphStore } from "../src/store/store.ts";
import type { DecisionInput, SessionInput, WriteDecisionInput, WriteGates } from "../src/store/types.ts";

const GATES: WriteGates = { projectTrusted: true, sessionPersisted: true };

function session(id: string, overrides: Partial<SessionInput> = {}): SessionInput {
	return {
		id,
		cwd: "/repo",
		sessionFile: `/repo/.pi/agent/sessions/${id}.jsonl`,
		parentSessionFile: null,
		...overrides,
	};
}

function decision(id: string, sessionId: string, ts: number, overrides: Partial<DecisionInput> = {}): DecisionInput {
	return {
		id,
		sessionId,
		runId: "run-1",
		turnIndex: 0,
		ts,
		leafEntryId: null,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude",
		responseModel: null,
		thinking: null,
		text: null,
		whySource: "none",
		stopReason: "end_turn",
		errorMessage: null,
		tokInput: 1,
		tokOutput: 1,
		tokReasoning: null,
		tokCacheRead: 0,
		tokCacheWrite: 0,
		costTotal: 0,
		toolInvocations: [],
		touches: [],
		...overrides,
	};
}

let tempDir: string;
let store: DecisionGraphStore;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "decision-graph-derived-"));
	store = new DecisionGraphStore(join(tempDir, ".pi", "decision-graph.db"), tempDir);
});

afterEach(() => {
	store.close();
	rmSync(tempDir, { recursive: true, force: true });
});

function write(sessionInput: SessionInput, dec: DecisionInput): boolean {
	const input: WriteDecisionInput = { session: sessionInput, sittings: [], decision: dec };
	return store.writeDecision(GATES, input);
}

describe("derived relations", () => {
	it("follows: chains Decisions within a Session by id order, never across Sessions", () => {
		// Ids sort lexicographically in the intended temporal order (mimicking uuidv7).
		write(session("s1"), decision("d1", "s1", 100));
		write(session("s1"), decision("d2", "s1", 200));
		write(session("s2"), decision("d3", "s2", 300));

		expect(store.follows()).toEqual([{ decisionId: "d2", followsId: "d1" }]);
	});

	it("redirected-by: the first Decision to arrive after a Steer in its Session", () => {
		write(session("s1"), decision("d1", "s1", 100));
		store.writeSteer(GATES, { id: "steer-1", sessionId: "s1", ts: 150 });
		write(session("s1"), decision("d2", "s1", 200));

		expect(store.redirectedBy()).toEqual([{ decisionId: "d2", steerId: "steer-1" }]);
	});

	it("caused-by-error: successor after a failed tool call, unless it is redirected-by a Steer", () => {
		write(
			session("s1"),
			decision("d1", "s1", 100, {
				toolInvocations: [
					{ callId: "c1", ordinal: 0, name: "bash", arguments: "{}", resultText: "boom", isError: true },
				],
			}),
		);
		write(session("s1"), decision("d2", "s1", 200));

		expect(store.causedByError()).toEqual([{ decisionId: "d2", causedByDecisionId: "d1" }]);
	});

	it("caused-by-error is suppressed when the successor is also redirected-by a Steer", () => {
		write(
			session("s1"),
			decision("d1", "s1", 100, {
				toolInvocations: [
					{ callId: "c1", ordinal: 0, name: "bash", arguments: "{}", resultText: "boom", isError: true },
				],
			}),
		);
		store.writeSteer(GATES, { id: "steer-1", sessionId: "s1", ts: 150 });
		write(session("s1"), decision("d2", "s1", 200));

		expect(store.causedByError()).toEqual([]);
		expect(store.redirectedBy()).toEqual([{ decisionId: "d2", steerId: "steer-1" }]);
	});

	it("retry-of: same tool, same File for a File-anchored tool", () => {
		write(
			session("s1"),
			decision("d1", "s1", 100, {
				toolInvocations: [
					{
						callId: "c1",
						ordinal: 0,
						name: "edit",
						arguments: JSON.stringify({ path: "a.ts" }),
						resultText: "boom",
						isError: true,
					},
				],
			}),
		);
		write(
			session("s1"),
			decision("d2", "s1", 200, {
				toolInvocations: [
					{
						callId: "c2",
						ordinal: 0,
						name: "edit",
						arguments: JSON.stringify({ path: "a.ts" }),
						resultText: "ok",
						isError: false,
					},
				],
			}),
		);

		expect(store.retryOf()).toEqual([{ decisionId: "d2", retryOfDecisionId: "d1" }]);
	});

	it("retry-of does not fire for a File-anchored tool retried against a different File", () => {
		write(
			session("s1"),
			decision("d1", "s1", 100, {
				toolInvocations: [
					{
						callId: "c1",
						ordinal: 0,
						name: "edit",
						arguments: JSON.stringify({ path: "a.ts" }),
						resultText: "boom",
						isError: true,
					},
				],
			}),
		);
		write(
			session("s1"),
			decision("d2", "s1", 200, {
				toolInvocations: [
					{
						callId: "c2",
						ordinal: 0,
						name: "edit",
						arguments: JSON.stringify({ path: "b.ts" }),
						resultText: "ok",
						isError: false,
					},
				],
			}),
		);

		expect(store.retryOf()).toEqual([]);
		// Still caused-by-error: a different File is a narrower relation, not the same one.
		expect(store.causedByError()).toEqual([{ decisionId: "d2", causedByDecisionId: "d1" }]);
	});

	it("retry-of matches on tool name alone for an unanchored tool", () => {
		write(
			session("s1"),
			decision("d1", "s1", 100, {
				toolInvocations: [
					{
						callId: "c1",
						ordinal: 0,
						name: "bash",
						arguments: JSON.stringify({ command: "ls a" }),
						resultText: "boom",
						isError: true,
					},
				],
			}),
		);
		write(
			session("s1"),
			decision("d2", "s1", 200, {
				toolInvocations: [
					{
						callId: "c2",
						ordinal: 0,
						name: "bash",
						arguments: JSON.stringify({ command: "ls b" }),
						resultText: "ok",
						isError: false,
					},
				],
			}),
		);

		expect(store.retryOf()).toEqual([{ decisionId: "d2", retryOfDecisionId: "d1" }]);
	});

	it("forked-from: a forked Session's first Decision back to its parent's last", () => {
		const parent = session("parent");
		write(parent, decision("p1", "parent", 100));
		write(parent, decision("p2", "parent", 200));

		const child = session("child", { parentSessionFile: parent.sessionFile });
		write(child, decision("c1", "child", 300));

		expect(store.forkedFrom()).toEqual([{ fromDecisionId: "p2", toDecisionId: "c1" }]);
	});

	it("forked-from degrades to no edge when the parent Session was never captured", () => {
		const child = session("child", { parentSessionFile: "/repo/.pi/agent/sessions/never-captured.jsonl" });
		write(child, decision("c1", "child", 300));

		expect(store.forkedFrom()).toEqual([]);
	});

	it("returns empty relations for a Store that was never created", () => {
		expect(existsSync(store.path)).toBe(false);
		expect(store.follows()).toEqual([]);
		expect(store.redirectedBy()).toEqual([]);
		expect(store.causedByError()).toEqual([]);
		expect(store.retryOf()).toEqual([]);
		expect(store.forkedFrom()).toEqual([]);
	});
});
