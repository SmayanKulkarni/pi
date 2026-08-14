import type { DatabaseSync } from "node:sqlite";

/**
 * Five relations between Decisions, all read-time over the tables `schema.ts` ships — no edge
 * tables, nothing materialised. `follows` here is the timestamp/id-ordering fallback only:
 * the exact Session-tree walk (via `decision.leaf_entry_id`) needs the live session file and
 * is Assembly's job, outside the Store.
 */

export interface FollowsRow {
	decisionId: string;
	followsId: string;
}

export function follows(db: DatabaseSync): FollowsRow[] {
	const rows = db
		.prepare(
			`SELECT id AS decisionId, LAG(id) OVER (PARTITION BY session_id ORDER BY id) AS followsId
			 FROM decision`,
		)
		.all() as Array<{ decisionId: string; followsId: string | null }>;
	return rows.filter((row): row is FollowsRow => row.followsId !== null);
}

export interface RedirectedByRow {
	decisionId: string;
	steerId: string;
}

export function redirectedBy(db: DatabaseSync): RedirectedByRow[] {
	return db
		.prepare(
			`WITH ordered AS (
			     SELECT id, session_id, ts,
			            LAG(ts) OVER (PARTITION BY session_id ORDER BY id) AS prev_ts
			     FROM decision
			 )
			 SELECT o.id AS decisionId, s.id AS steerId
			 FROM ordered o
			 JOIN steer s
			   ON s.session_id = o.session_id
			  AND s.ts <= o.ts
			  AND (o.prev_ts IS NULL OR s.ts > o.prev_ts)`,
		)
		.all() as unknown as RedirectedByRow[];
}

export interface CausedByErrorRow {
	decisionId: string;
	causedByDecisionId: string;
}

export function causedByError(db: DatabaseSync): CausedByErrorRow[] {
	const redirected = new Set(redirectedBy(db).map((row) => row.decisionId));
	const rows = db
		.prepare(
			`WITH ordered AS (
			     SELECT id, session_id, LAG(id) OVER (PARTITION BY session_id ORDER BY id) AS prev_id
			     FROM decision
			 ),
			 failed AS (
			     SELECT DISTINCT decision_id FROM tool_invocation WHERE is_error = 1
			 )
			 SELECT o.id AS decisionId, o.prev_id AS causedByDecisionId
			 FROM ordered o
			 JOIN failed f ON f.decision_id = o.prev_id
			 WHERE o.prev_id IS NOT NULL`,
		)
		.all() as unknown as CausedByErrorRow[];
	return rows.filter((row) => !redirected.has(row.decisionId));
}

export interface RetryOfRow {
	decisionId: string;
	retryOfDecisionId: string;
}

/** Tools whose call is anchored to a single File, via a `path` argument. */
const FILE_ANCHORED_TOOLS = new Set(["edit", "write", "read"]);

function argumentPath(rawArguments: string): string | undefined {
	try {
		const parsed = JSON.parse(rawArguments) as { path?: unknown };
		return typeof parsed.path === "string" ? parsed.path : undefined;
	} catch {
		return undefined;
	}
}

interface InvocationShape {
	name: string;
	arguments: string;
	isError: number | null;
}

export function retryOf(db: DatabaseSync): RetryOfRow[] {
	const pairs = causedByError(db);
	const invocationsByDecision = db
		.prepare(`SELECT decision_id AS decisionId, name, arguments, is_error AS isError FROM tool_invocation`)
		.all() as unknown as Array<InvocationShape & { decisionId: string }>;

	const byDecision = new Map<string, InvocationShape[]>();
	for (const row of invocationsByDecision) {
		const list = byDecision.get(row.decisionId) ?? [];
		list.push(row);
		byDecision.set(row.decisionId, list);
	}

	const result: RetryOfRow[] = [];
	for (const pair of pairs) {
		const predecessorFailed = (byDecision.get(pair.causedByDecisionId) ?? []).filter((row) => row.isError === 1);
		const successorCalls = byDecision.get(pair.decisionId) ?? [];
		const retried = predecessorFailed.some((failedCall) =>
			successorCalls.some((call) => {
				if (call.name !== failedCall.name) return false;
				if (!FILE_ANCHORED_TOOLS.has(call.name)) return true;
				const failedPath = argumentPath(failedCall.arguments);
				const callPath = argumentPath(call.arguments);
				return failedPath !== undefined && failedPath === callPath;
			}),
		);
		if (retried) result.push({ decisionId: pair.decisionId, retryOfDecisionId: pair.causedByDecisionId });
	}
	return result;
}

export interface ForkedFromRow {
	fromDecisionId: string;
	toDecisionId: string;
}

export function forkedFrom(db: DatabaseSync): ForkedFromRow[] {
	const sessionPairs = db
		.prepare(
			`SELECT p.id AS parentSessionId, c.id AS childSessionId
			 FROM session c
			 JOIN session p ON p.session_file = c.parent_session_file
			 WHERE c.parent_session_file IS NOT NULL`,
		)
		.all() as Array<{ parentSessionId: string; childSessionId: string }>;

	const boundaryOf = (sessionId: string, extreme: "MIN" | "MAX"): string | undefined => {
		const row = db.prepare(`SELECT ${extreme}(id) AS boundaryId FROM decision WHERE session_id = ?`).get(sessionId) as
			| { boundaryId: string | null }
			| undefined;
		return row?.boundaryId ?? undefined;
	};

	const result: ForkedFromRow[] = [];
	for (const pair of sessionPairs) {
		const lastOfParent = boundaryOf(pair.parentSessionId, "MAX");
		const firstOfChild = boundaryOf(pair.childSessionId, "MIN");
		if (lastOfParent !== undefined && firstOfChild !== undefined) {
			result.push({ fromDecisionId: lastOfParent, toDecisionId: firstOfChild });
		}
	}
	return result;
}
