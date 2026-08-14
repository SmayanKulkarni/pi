import { createHash } from "node:crypto";
import type { DecisionInput } from "./types.ts";

/** Stringifies with sorted object keys, so key order from a parser is never part of the hash. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const entries = keys.map(
		(key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
	);
	return `{${entries.join(",")}}`;
}

function canonicalArguments(raw: string): string {
	try {
		return canonicalJson(JSON.parse(raw));
	} catch {
		return raw;
	}
}

/**
 * Idempotency key only, never an addressing key. Deliberately not a serialisation of the raw
 * message object, whose key order is a property of the harness version that parsed it. Covers
 * the Session, the timestamp, the WHY text and each call's id, name and canonical arguments.
 */
export function computeContentHash(decision: DecisionInput): string {
	const hash = createHash("sha256");
	hash.update(decision.sessionId);
	hash.update(String(decision.ts));
	hash.update(decision.thinking ?? "");
	hash.update(decision.text ?? "");
	for (const invocation of decision.toolInvocations) {
		hash.update(invocation.callId);
		hash.update(invocation.name);
		hash.update(canonicalArguments(invocation.arguments));
	}
	return hash.digest("hex");
}
