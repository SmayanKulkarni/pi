import { execFileSync } from "node:child_process";

/**
 * Whether `absolutePath` is covered by an ignore rule, git-check-ignore-equivalent.
 * Returns `undefined` when this cannot be determined (no git, not a repository) rather than
 * guessing, since a false warning is worse than a skipped one.
 */
export function isPathIgnored(cwd: string, absolutePath: string): boolean | undefined {
	try {
		execFileSync("git", ["check-ignore", "-q", absolutePath], { cwd, stdio: "ignore" });
		return true;
	} catch (error) {
		const status = (error as { status?: number }).status;
		if (status === 1) return false;
		return undefined;
	}
}
