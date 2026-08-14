import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The full package barrel pulls in the CLI/TUI dependency graph, which is unbuilt in a fresh
// checkout. Tests only need `CONFIG_DIR_NAME`, which lives in this lightweight leaf module.
const codingAgentConfig = fileURLToPath(new URL("../coding-agent/src/config.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
	},
	resolve: {
		alias: [{ find: /^@earendil-works\/pi-coding-agent$/, replacement: codingAgentConfig }],
	},
});
