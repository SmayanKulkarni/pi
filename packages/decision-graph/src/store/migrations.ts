import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./schema.ts";

/** Applies each migration once, in a transaction, recording it in a `migrations` table. */
export function applyMigrations(db: DatabaseSync, migrations: Migration[]): void {
	db.exec("CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
	const applied = new Set(
		db
			.prepare("SELECT id FROM migrations")
			.all()
			.map((row) => (row as { id: string }).id),
	);

	for (const migration of migrations) {
		if (applied.has(migration.id)) continue;
		db.exec("BEGIN IMMEDIATE");
		try {
			db.exec(migration.sql);
			db.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)").run(
				migration.id,
				new Date().toISOString(),
			);
			db.exec("COMMIT");
		} catch (error) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// Ignore rollback errors to rethrow the original error.
			}
			throw error;
		}
		applied.add(migration.id);
	}
}
