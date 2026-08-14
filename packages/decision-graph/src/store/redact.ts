import type { DecisionInput } from "./types.ts";

const REDACTION_FAILED = "[REDACTION_FAILED]";

const CREDENTIAL_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.env(\.[^/]*)?$/,
	/\.pem$/,
	/\.key$/,
	/(^|\/)id_rsa[^/]*$/,
	/(^|\/)\.npmrc$/,
	/(^|\/)\.netrc$/,
	/(^|\/)credentials[^/]*$/i,
];

function isCredentialShapedPath(path: string): boolean {
	return CREDENTIAL_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** Layer 1: unconditional, path-driven. Every `KEY=VALUE`-shaped value on a credential path is cut. */
function redactDotenvValues(value: string): string {
	return value.replace(/^([+\- ]?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm, "$1$2=[REDACTED:dotenv-value]");
}

const SECRET_ENV_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i;

function knownSecretEnvValues(): Array<{ name: string; value: string }> {
	const found: Array<{ name: string; value: string }> = [];
	for (const [name, value] of Object.entries(process.env)) {
		if (!value || value.length < 8) continue;
		if (!SECRET_ENV_NAME.test(name)) continue;
		found.push({ name, value });
	}
	return found;
}

/** Layer 2: known-env-value literal, substring-matched across all seven columns. */
function redactKnownEnvValues(value: string, envValues: Array<{ name: string; value: string }>): string {
	let result = value;
	for (const { name, value: secret } of envValues) {
		if (!result.includes(secret)) continue;
		result = result.split(secret).join(`[REDACTED:env:${name}]`);
	}
	return result;
}

const VENDOR_TOKEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /AKIA[0-9A-Z]{16}/g, label: "aws" },
	{ pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, label: "github" },
	{ pattern: /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, label: "api-key" },
	{ pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: "jwt" },
	{ pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, label: "pem" },
];

const GENERIC_ASSIGNMENT =
	/(['"`]?\b\w*(?:key|secret|token|password|credential|auth)\w*['"`]?\s*[:=]\s*)(['"`])([^'"`\n]{6,})\2/gi;

/** Layer 3: vendor token shapes plus a generic assignment heuristic. */
function redactPatterns(value: string): string {
	let result = value;
	for (const { pattern, label } of VENDOR_TOKEN_PATTERNS) {
		result = result.replace(pattern, `[REDACTED:vendor-token:${label}]`);
	}
	result = result.replace(GENERIC_ASSIGNMENT, `$1$2[REDACTED:generic-assignment]$2`);
	return result;
}

/** Applies a redaction step to one required column, sentineling it alone on failure. */
function redactRequiredColumn(
	value: string,
	envValues: Array<{ name: string; value: string }>,
	unconditional: boolean,
): string {
	try {
		let result = value;
		if (unconditional) result = redactDotenvValues(result);
		result = redactKnownEnvValues(result, envValues);
		result = redactPatterns(result);
		return result;
	} catch {
		return REDACTION_FAILED;
	}
}

/** Applies a redaction step to one nullable column, sentineling only that column on failure. */
function redactColumn(
	value: string | null,
	envValues: Array<{ name: string; value: string }>,
	unconditional: boolean,
): string | null {
	if (value === null) return null;
	return redactRequiredColumn(value, envValues, unconditional);
}

/**
 * Redacts the seven sensitive columns of a Decision before it is written: WHY thinking/text,
 * invocation arguments/result, and a Touch's patch/new_text/old_text. A failure in one column
 * sentinels only that column; the rest of the Decision is written normally.
 */
export function redactDecision(decision: DecisionInput): DecisionInput {
	const envValues = knownSecretEnvValues();

	return {
		...decision,
		thinking: redactColumn(decision.thinking, envValues, false),
		text: redactColumn(decision.text, envValues, false),
		toolInvocations: decision.toolInvocations.map((invocation) => ({
			...invocation,
			arguments: redactRequiredColumn(invocation.arguments, envValues, false),
			resultText: redactColumn(invocation.resultText, envValues, false),
		})),
		touches: decision.touches.map((touch) => {
			const unconditional = isCredentialShapedPath(touch.path);
			return {
				...touch,
				patch: redactColumn(touch.patch, envValues, unconditional),
				newText: redactColumn(touch.newText, envValues, unconditional),
				oldText: redactColumn(touch.oldText, envValues, unconditional),
			};
		}),
	};
}
