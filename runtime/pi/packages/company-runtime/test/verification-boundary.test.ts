import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateRegisteredCheck, type RegisteredCheck } from "../src/policy.ts";
import { runProcess, verificationEnvironment } from "../src/process-runner.ts";

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "company-check-"));
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});
describe("registered check boundary", () => {
	it.each(["executable", "argv", "cwd", "timeoutMs", "env", "id"] as const)(
		"denies changed registration field %s",
		(field) => {
			const registered: RegisteredCheck = {
				id: "check",
				executable: process.execPath,
				argv: ["check.mjs"],
				cwd: ".",
				timeoutMs: 1000,
				env: verificationEnvironment(),
			};
			const request = structuredClone(registered);
			if (field === "argv") request.argv = ["evil.mjs"];
			else if (field === "env") request.env = { ...request.env, NODE_OPTIONS: "evil" };
			else if (field === "timeoutMs") request.timeoutMs = 2000;
			else request[field] = "different";
			expect(
				evaluateRegisteredCheck(
					{ runId: "run", actionId: "action", actionDigest: "digest" },
					request,
					registered,
					{ tools: [], allowedPaths: [], configDigest: "config", executionMode: "EDIT", executionRunId: "run" },
					true,
				).decision,
			).toBe("DENY");
		},
	);
	it("filters credentials and runtime injection variables rather than inheriting process.env", async () => {
		vi.stubEnv("OPENAI_API_KEY", "FAKE_TEST_CREDENTIAL");
		vi.stubEnv("NODE_OPTIONS", "--invalid-option");
		vi.stubEnv("NPM_TOKEN", "FAKE_TEST_TOKEN");
		await writeFile(
			join(cwd, "check.mjs"),
			"if(process.env.OPENAI_API_KEY || process.env.NODE_OPTIONS || process.env.NPM_TOKEN || process.env.HOME) process.exit(9); console.log('FILTERED');",
		);
		const result = await runProcess({
			executable: process.execPath,
			argv: ["check.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 1000,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("FILTERED\n");
		expect(result.cleanupConfirmed).toBe(true);
	});
	it("bounds combined output and does not mark truncation as a clean exit", async () => {
		await writeFile(join(cwd, "check.mjs"), "console.log('x'.repeat(100000)); setInterval(()=>{},1000);");
		const result = await runProcess({
			executable: process.execPath,
			argv: ["check.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 1000,
			maxOutputBytes: 2048,
		});
		expect(result.reason).toBe("output-limit");
		expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(2048);
		expect(result.cleanupConfirmed).toBe(true);
	});
	it("does not execute shell syntax in argv", async () => {
		await writeFile(join(cwd, "check.mjs"), "console.log(process.argv[2]);");
		const result = await runProcess({
			executable: process.execPath,
			argv: ["check.mjs", "literal; touch escaped"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 1000,
		});
		expect(result.stdout).toBe("literal; touch escaped\n");
		expect(existsSync(join(cwd, "escaped"))).toBe(false);
	});
	it("returns unavailable for spawn errors without inventing an exit code", async () => {
		const result = await runProcess({
			executable: "/does/not/exist",
			argv: [],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 1000,
		});
		expect(result.reason).toBe("unavailable");
		expect(result.exitCode).not.toBe(0);
		expect(result.cleanupConfirmed).toBe(true);
	});
	it("terminates descendant processes left behind by an early-exiting check", async () => {
		await writeFile(
			join(cwd, "child.mjs"),
			"import {writeFileSync} from 'node:fs'; setTimeout(()=>writeFileSync('late','NO'),500); setInterval(()=>{},1000);",
		);
		await writeFile(
			join(cwd, "check.mjs"),
			"import {spawn} from 'node:child_process'; const child=spawn(process.execPath,['child.mjs'],{stdio:'ignore'}); child.unref();",
		);
		const result = await runProcess({
			executable: process.execPath,
			argv: ["check.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 1000,
		});
		expect(result.reason).toBe("background-process");
		expect(result.cleanupConfirmed).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(existsSync(join(cwd, "late"))).toBe(false);
	});
});
