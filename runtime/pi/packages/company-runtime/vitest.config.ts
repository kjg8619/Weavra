import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(baseConfig, defineConfig({
	test: {
		environment: "node",
		testTimeout: 30_000,
		env: { PI_OFFLINE: "1", PI_NO_LOCAL_LLM: "1" },
	},
	resolve: {
		alias: [{ find: /^@earendil-works\/pi-coding-agent$/, replacement: workspaceSourcePaths.codingAgentIndex }],
	},
}));
