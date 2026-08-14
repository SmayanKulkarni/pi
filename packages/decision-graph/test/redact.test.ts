import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { redactDecision } from "../src/store/redact.ts";
import type { DecisionInput } from "../src/store/types.ts";

function baseDecision(overrides: Partial<DecisionInput> = {}): DecisionInput {
	return {
		id: "dec-1",
		sessionId: "session-1",
		runId: "run-1",
		turnIndex: 0,
		ts: 1000,
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

describe("redactDecision", () => {
	const originalEnv = { ...process.env };
	beforeEach(() => {
		for (const key of Object.keys(process.env)) delete process.env[key];
		Object.assign(process.env, originalEnv);
	});
	afterEach(() => {
		for (const key of Object.keys(process.env)) delete process.env[key];
		Object.assign(process.env, originalEnv);
	});

	it("layer 1: redacts every KEY=VALUE on a credential-shaped path unconditionally", () => {
		const decision = baseDecision({
			touches: [
				{
					callId: "call-1",
					path: ".env",
					kind: "write",
					patch: null,
					newText: "DB_HOST=localhost\nNOT_SECRET_LOOKING=plainvalue",
					oldText: "",
				},
			],
		});
		const redacted = redactDecision(decision);
		expect(redacted.touches[0]!.newText).toBe(
			"DB_HOST=[REDACTED:dotenv-value]\nNOT_SECRET_LOOKING=[REDACTED:dotenv-value]",
		);
	});

	it("does not apply layer 1 to a non-credential path", () => {
		const decision = baseDecision({
			touches: [
				{ callId: "call-1", path: "src/config.ts", kind: "write", patch: null, newText: "PORT=3000", oldText: "" },
			],
		});
		const redacted = redactDecision(decision);
		expect(redacted.touches[0]!.newText).toBe("PORT=3000");
	});

	it("layer 2: substring-matches a known secret-shaped env value across all seven columns", () => {
		process.env.STRIPE_SECRET_KEY = "sk_live_abcdefghijklmnop";
		const decision = baseDecision({
			thinking: "using key sk_live_abcdefghijklmnop to call the API",
			toolInvocations: [
				{
					callId: "call-1",
					ordinal: 0,
					name: "bash",
					arguments: JSON.stringify({ command: "export X=sk_live_abcdefghijklmnop" }),
					resultText: "done sk_live_abcdefghijklmnop",
					isError: false,
				},
			],
		});
		const redacted = redactDecision(decision);
		expect(redacted.thinking).toBe("using key [REDACTED:env:STRIPE_SECRET_KEY] to call the API");
		expect(redacted.toolInvocations[0]!.arguments).toContain("[REDACTED:env:STRIPE_SECRET_KEY]");
		expect(redacted.toolInvocations[0]!.resultText).toContain("[REDACTED:env:STRIPE_SECRET_KEY]");
	});

	it("layer 2 ignores short env values to avoid false positives on trivial values", () => {
		process.env.AUTH_MODE = "on";
		const decision = baseDecision({ text: "auth mode is on" });
		const redacted = redactDecision(decision);
		expect(redacted.text).toBe("auth mode is on");
	});

	it("layer 3: redacts a vendor token shape in free text", () => {
		const decision = baseDecision({ text: "token AKIAABCDEFGHIJKLMNOP leaked" });
		const redacted = redactDecision(decision);
		expect(redacted.text).toBe("token [REDACTED:vendor-token:aws] leaked");
	});

	it("layer 3: redacts a generic key/value assignment", () => {
		const decision = baseDecision({ text: 'apiSecret: "abcdef123456"' });
		const redacted = redactDecision(decision);
		expect(redacted.text).toContain("[REDACTED:generic-assignment]");
		expect(redacted.text).not.toContain("abcdef123456");
	});

	it("names the category rather than blanking", () => {
		const decision = baseDecision({ text: "token AKIAABCDEFGHIJKLMNOP" });
		const redacted = redactDecision(decision);
		expect(redacted.text).toMatch(/\[REDACTED:vendor-token:aws\]/);
	});

	it("a redaction failure sentinels only that column, leaving the rest of the Decision intact", () => {
		const decision = baseDecision({
			// Not a real string at runtime: forces `.replace` to throw inside the redaction step.
			text: 12345 as unknown as string,
			thinking: "ordinary rationale",
			toolInvocations: [
				{ callId: "call-1", ordinal: 0, name: "bash", arguments: "{}", resultText: "ok", isError: false },
			],
		});
		const redacted = redactDecision(decision);
		expect(redacted.text).toBe("[REDACTION_FAILED]");
		expect(redacted.thinking).toBe("ordinary rationale");
		expect(redacted.toolInvocations[0]!.arguments).toBe("{}");
		expect(redacted.toolInvocations[0]!.resultText).toBe("ok");
	});
});
