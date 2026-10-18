import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initProjectYaml, trialCheck } from "../src/launcher-project.ts";
import type * as SandboxModule from "../src/sandbox.ts";
import { verifierSandbox } from "../src/sandbox.ts";

vi.mock("../src/sandbox.ts", async (importOriginal) => {
	const original = await importOriginal<typeof SandboxModule>();
	return { ...original, verifierSandbox: vi.fn(original.verifierSandbox) };
});

const yaml = `schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: reasoning }
project:
  instructions: { path: AGENTS.md }
verification:
  sandbox: { mode: disabled }
  checks:
    - id: test
      kind: test
      executable: tools/check.sh
      args: []
      required: true
budget: { max_worker_invocations: 3 }
`;
let root: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "weavra trial sandbox ")));
	expect(spawnSync("git", ["-C", root, "init", "-q"]).status).toBe(0);
	await writeFile(join(root, "AGENTS.md"), "rules\n");
	await mkdir(join(root, "tools"));
	await writeFile(join(root, "tools/check.sh"), "#!/bin/sh\nexit 0\n");
	await chmod(join(root, "tools/check.sh"), 0o755);
	await initProjectYaml(root, yaml);
	vi.mocked(verifierSandbox).mockClear();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("trial check sandbox boundary", () => {
	it("passes the project protected paths and instruction file to the sandbox like a real Run", async () => {
		await expect(trialCheck(root, "test")).resolves.toMatchObject({ kind: "trial-check", exitCode: 0 });
		expect(vi.mocked(verifierSandbox).mock.calls).toEqual([
			[expect.objectContaining({ schemaVersion: 1 }), root, ["tools/check.sh", "AGENTS.md"]],
		]);
	});

	it("refuses a check whose cwd is protected before preparing the sandbox", async () => {
		await writeFile(
			join(root, ".ai/config.yaml"),
			yaml.replace("executable: tools/check.sh", "executable: /usr/bin/true\n      cwd: .ai"),
		);
		await expect(trialCheck(root, "test")).rejects.toMatchObject({ code: "CHECK_POLICY_DENIED" });
		expect(vi.mocked(verifierSandbox)).not.toHaveBeenCalled();
	});
});
