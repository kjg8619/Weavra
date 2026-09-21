import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../src/config.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import type { VerificationRequest } from "../src/ports.ts";
import { RegisteredVerifier } from "../src/verification.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
async function fixture(
	source = "process.exit(7)",
	options: { later?: string; compatible?: boolean; missing?: boolean; inline?: boolean; timeout?: number } = {},
) {
	writeFileSync(join(cwd, "oracle/check.mjs"), source);
	if (options.later) writeFileSync(join(cwd, "oracle/later.mjs"), options.later);
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			files: { allowed_paths: ["src"] },
			verification: {
				repair: { mode: "self-check-once" },
				trust: { mode: options.compatible ? "compatible" : "strict" },
				checks: [
					{
						id: "check",
						kind: "test",
						executable: options.missing ? join(cwd, "not-installed") : process.execPath,
						args: options.inline ? ["-e", "process.exit(7)"] : ["oracle/check.mjs"],
						timeout_ms: options.timeout ?? 2000,
						trust: { files: ["oracle/check.mjs"] },
						repairable_exit_codes: [7],
					},
					...(options.later
						? [
								{
									id: "later",
									kind: "test",
									executable: process.execPath,
									args: ["oracle/later.mjs"],
									trust: { files: ["oracle/later.mjs"] },
								},
							]
						: []),
				],
			},
		}),
	);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd, stdio: "pipe" },
		);
	git("init", "-q");
	git("add", "--", "src", "oracle");
	git("commit", "-qm", "Verifier repair fixture");
	const policy: PolicyContext = {
		executionMode: "EDIT",
		executionRunId: "run",
		tools: [],
		allowedPaths: ["src"],
		protectedPaths: ["oracle"],
		configDigest: "frozen-policy",
	};
	const audit: ActionAudit = { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} };
	const workspace = await GitWorkspace.open(cwd, policy);
	const verifier = await RegisteredVerifier.create(config, policy, audit, workspace);
	const request: VerificationRequest = {
		runId: "run",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		task: testContract("Fix bug", { taskId: "task", checkIds: config.verification.checks.map((check) => check.id) }),
		handoff: { role: "Developer" } as never,
		checks: verifier.trustRequirements.map((check) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			...(check.trustRequired ? { trustRequired: true } : {}),
			...(check.trustRegistrationDigest ? { trustRegistrationDigest: check.trustRegistrationDigest } : {}),
			...(check.repairableExitCodes.length ? { repairableExitCodes: check.repairableExitCodes } : {}),
		})),
	};
	return { verifier, request, audit, workspace };
}
beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-repair-verifier-")));
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, "oracle"));
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("V0.5C actual verifier failure attribution", () => {
	it.each([false, true])("requires positive original trust validation (compatible=%s)", async (compatible) => {
		const { verifier, request } = await fixture(undefined, { compatible });
		const result = await verifier.verify(request);
		expect(result.integrity).toBe("CLEAN");
		expect(result.checks[0]).toMatchObject({ status: "FAIL", exitCode: 7, failureKind: "COMMAND_NONZERO" });
		expect(result.checks[0].trust?.status).toBe(compatible ? "UNVERIFIED" : "VERIFIED");
	});
	// These are real child processes: the platform deadline and process-group cleanup cannot use fake JS timers.
	it.each([
		["signal", "process.kill(process.pid,'SIGTERM')", 2000],
		["timeout", "process.on('SIGTERM',()=>process.exit(7)); setInterval(()=>{},1000)", 300],
		["output limit", "console.log('x'.repeat(100000)); process.exit(7)", 2000],
		[
			"background descendant",
			"import {spawn} from 'node:child_process'; spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref(); process.exit(7)",
			2000,
		],
	] as const)("does not classify %s as a deterministic check failure", async (_name, source, timeout) => {
		const { verifier, request } = await fixture(source, { timeout });
		const result = await verifier.verify(request);
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].failureKind).toBeUndefined();
		expect(verifier.safeToRelease).toBe(true);
	});
	it.each(["missing executable", "policy denied inline command"])("does not offer repair for %s", async (reason) => {
		const { verifier, request } = await fixture(undefined, {
			compatible: true,
			missing: reason === "missing executable",
			inline: reason !== "missing executable",
		});
		const result = await verifier.verify(request);
		expect(result.checks[0].status).toBe("UNAVAILABLE");
		expect(result.checks[0].failureKind).toBeUndefined();
	});
	it("revokes the failed candidate after a later check recreates its oracle with identical bytes", async () => {
		const later =
			"import {readFileSync,unlinkSync,writeFileSync} from 'node:fs'; const p='oracle/check.mjs'; const b=readFileSync(p); unlinkSync(p); writeFileSync(p,b);";
		const { verifier, request } = await fixture("process.exit(7)", { later });
		const result = await verifier.verify(request);
		expect(readFileSync(join(cwd, "oracle/check.mjs"), "utf8")).toBe("process.exit(7)");
		expect(result.checks[0]).toMatchObject({ status: "FAIL", exitCode: 7, trust: { status: "STALE" } });
		expect(result.checks[0].failureKind).toBeUndefined();
		expect(result.integrity).toBe("BLOCKED");
	});
	it.each(["src/app.ts", "outside.txt"])(
		"revokes the failed candidate when a later check mutates %s",
		async (path) => {
			const { verifier, request } = await fixture(undefined, {
				later: `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(path)},'external');`,
			});
			const result = await verifier.verify(request);
			expect(result.integrity).toBe("BLOCKED");
			expect(result.checks[0].failureKind).toBeUndefined();
		},
	);
	it("does not recapture a recreated oracle as trusted on the fresh attempt", async () => {
		const source = "console.log('oracle-executed');process.exit(7)";
		const { verifier, request } = await fixture(source);
		const failed = await verifier.verify(request);
		expect(failed.checks[0].failureKind, JSON.stringify(failed)).toBe("COMMAND_NONZERO");
		expect(failed.checks[0].stdout).toBe("oracle-executed\n");
		rmSync(join(cwd, "oracle/check.mjs"));
		writeFileSync(join(cwd, "oracle/check.mjs"), source);
		const result = await verifier.verify({ ...request, revision: 1, step: { stepId: "self-check", attempt: 2 } });
		expect(result.checks[0]).toMatchObject({ status: "FAIL", exitCode: null, trust: { status: "STALE" } });
		expect(result.integrity).toBe("BLOCKED");
		expect(result.checks[0].stdout).toBe("");
	});
	it("does not classify a normal failure as repairable after cancellation or audit failure", async () => {
		const { verifier, request, audit } = await fixture();
		const controller = new AbortController();
		audit.finish = async () => {
			controller.abort();
		};
		const cancelled = await verifier.verify({ ...request, signal: controller.signal });
		expect(cancelled.integrity).toBe("BLOCKED");
		expect(cancelled.checks[0].failureKind).toBeUndefined();
		audit.finish = async () => {
			throw new Error("audit storage failed");
		};
		await expect(verifier.verify(request)).rejects.toThrow("audit storage failed");
	});
	it("rejects a worker/Host request that widens the frozen failure-code contract", async () => {
		const { verifier, request } = await fixture();
		request.checks[0].repairableExitCodes = [1, 7];
		await expect(verifier.verify(request)).rejects.toThrow("changed registered checks");
	});
});
