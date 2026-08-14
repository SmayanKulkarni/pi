/** Where a Decision's WHY came from. Mirrors `decision.why_source`'s CHECK constraint. */
export type WhySource = "raw" | "summary" | "redacted" | "omitted" | "text_only" | "none";

export interface SessionInput {
	id: string;
	cwd: string;
	sessionFile: string | null;
	parentSessionFile: string | null;
}

export interface SittingInput {
	id: string;
	sessionId: string;
	ts: number;
	reason: "startup" | "reload" | "new" | "resume" | "fork";
	prevSessionFile: string | null;
}

export interface ToolInvocationInput {
	callId: string;
	ordinal: number;
	name: string;
	arguments: string;
	resultText: string | null;
	isError: boolean | null;
}

export interface TouchedInput {
	callId: string;
	path: string;
	kind: "edit" | "write";
	patch: string | null;
	newText: string | null;
	oldText: string | null;
}

export interface DecisionInput {
	id: string;
	sessionId: string;
	runId: string;
	turnIndex: number;
	ts: number;
	leafEntryId: string | null;

	api: string;
	provider: string;
	model: string;
	responseModel: string | null;

	thinking: string | null;
	text: string | null;
	whySource: WhySource;

	stopReason: string;
	errorMessage: string | null;

	tokInput: number;
	tokOutput: number;
	tokReasoning: number | null;
	tokCacheRead: number;
	tokCacheWrite: number;
	costTotal: number;

	toolInvocations: ToolInvocationInput[];
	touches: TouchedInput[];
}

export interface SteerInput {
	id: string;
	sessionId: string;
	ts: number;
}

export interface CompactionInput {
	id: string;
	sessionId: string;
	ts: number;
	reason: string;
	willRetry: boolean;
	entryId: string | null;
}

/** The three gates a Decision write is checked against before any file is opened. */
export interface WriteGates {
	projectTrusted: boolean;
	sessionPersisted: boolean;
}

export interface WriteDecisionInput {
	session: SessionInput;
	sittings: SittingInput[];
	decision: DecisionInput;
}
