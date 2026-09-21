import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { type ActionAudit, evaluatePolicy, type PolicyContext } from "../src/policy.ts";
import {
	buildSandboxPolicy,
	canonicalHostPath,
	probeSandboxBackend,
	resolveSandboxBackend,
	runSandboxedCheck,
	SRT_VERSION,
	sandboxBackendFingerprint,
	validateSandboxBackend,
} from "../src/sandbox.ts";
import { RegisteredVerifier } from "../src/verification.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
const audit: ActionAudit = {
	prepare: vi.fn(async () => {}),
	finish: vi.fn(async () => {}),
	assertWritable: vi.fn(async () => {}),
};

function configOf(mode: "disabled" | "required", trusted: string[] = []) {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "coding" },
				},
			},
			files: { allowed_paths: ["src", "test"] },
			verification: {
				sandbox: { mode },
				...(trusted.length ? { trust: { mode: "strict" as const } } : {}),
				checks: [
					{
						id: "acceptance",
						kind: "test",
						executable: process.execPath,
						args: ["test/acceptance.test.mjs"],
						required: true,
						...(trusted.length ? { trust: { files: trusted } } : {}),
					},
				],
			},
		}),
	);
}

const policyOf = (config: RuntimeConfig): PolicyContext => ({
	executionMode: "EDIT",
	executionRunId: "run-1",
	tools: [],
	allowedPaths: [...config.files.allowed_paths],
	// Production-shaped: worker protection includes the trusted oracle; the sandbox read boundary must not.
	protectedPaths: [...config.verification.checks.flatMap((check) => check.trust.files), ".env", ".git", ".ai"],
	configDigest: "frozen-config",
});

async function verifierOf(config: RuntimeConfig) {
	const policy = policyOf(config);
	const workspace = await GitWorkspace.open(cwd, policy);
	return await RegisteredVerifier.create(config, policy, audit, workspace);
}

function requestOf(verifier: RegisteredVerifier) {
	return {
		runId: "run-1",
		revision: 0,
		step: { stepId: "self-check" as const, attempt: 1 },
		task: testContract("Fix", { taskId: "task-1" }),
		handoff: { role: "Developer" } as never,
		checks: verifier.trustRequirements.map((requirement) => ({
			id: requirement.id,
			kind: requirement.kind,
			required: requirement.required,
			...(requirement.trustRequired
				? { trustRequired: true, trustRegistrationDigest: requirement.trustRegistrationDigest }
				: {}),
			...(requirement.sandboxRequired
				? { sandboxRequired: true, sandboxPolicyDigest: requirement.sandboxPolicyDigest }
				: {}),
		})),
	};
}

const ORACLE = "test/acceptance.test.mjs";

// Real backend availability: the OS boundary tests run wherever the frozen SRT backend actually works
// (macOS Seatbelt today). Platforms where bubblewrap/SRT cannot initialize are reported as NOT VERIFIED
// instead of PASS — the deterministic contract tests above still run everywhere.
const probeWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "weavra-sandbox-readiness-")));
let sandboxBackendReady = false;
let sandboxBackendReason = "unknown";
try {
	const readiness = await probeSandboxBackend(
		buildSandboxPolicy({ workspace: probeWorkspace, trustedSources: [], protectedPaths: [] }),
	);
	sandboxBackendReady = readiness.ok;
	sandboxBackendReason = readiness.reason ?? "ok";
} catch (error) {
	sandboxBackendReason = error instanceof Error ? error.message : "probe failed";
}
rmSync(probeWorkspace, { recursive: true, force: true });
if (!sandboxBackendReady)
	console.log(
		`[sandbox] OS backend unavailable on ${process.platform}: actual boundary NOT VERIFIED (${sandboxBackendReason})`,
	);
let outsideSentinel: string;
let outsideWrite: string;
let requests = 0;
let server: ReturnType<typeof createServer> | undefined;

beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-sandbox-")));
	mkdirSync(join(cwd, "test"));
	mkdirSync(join(cwd, "src"));
	const outside = realpathSync(mkdtempSync(join(tmpdir(), "weavra-outside-")));
	outsideSentinel = join(outside, "secret.txt");
	outsideWrite = join(outside, "evil.txt");
	writeFileSync(outsideSentinel, "TOP_SECRET_SENTINEL\n");
	writeFileSync(join(cwd, ".env"), "TOKEN=secret\n");
	writeFileSync(join(cwd, "src/app.ts"), "export const app = 1;\n");
	writeFileSync(
		join(cwd, ORACLE),
		`import { writeFileSync, readFileSync } from "node:fs";
import net from "node:net";
import { execFileSync as runChild } from "node:child_process";
const out = [];
const probe = (name, fn) => { try { out.push(name + ": OK(" + fn() + ")"); } catch (e) { out.push(name + ": BLOCKED(" + (e.code ?? e.name) + ")"); } };
probe("wsRead", () => readFileSync("src/app.ts", "utf8").trim());
probe("envRead", () => readFileSync(".env", "utf8").trim());
probe("hostRead", () => readFileSync(${JSON.stringify(outsideSentinel)}, "utf8").trim());
probe("symlinkRead", () => readFileSync("src/link.txt", "utf8").trim());
probe("oracleWrite", () => { writeFileSync(${JSON.stringify(ORACLE)}, "HACKED\\n"); return "WROTE"; });
probe("hostWrite", () => { writeFileSync(${JSON.stringify(outsideWrite)}, "x"); return "WROTE"; });
try { const r = await fetch("http://127.0.0.1:" + process.env.PROBE_PORT + "/"); out.push("netFetch: HTTP " + r.status); } catch (e) { out.push("netFetch: BLOCKED(" + (e.cause?.code ?? e.message) + ")"); }
try { const { promise, resolve, reject } = Promise.withResolvers(); const s = net.connect(Number(process.env.PROBE_PORT), "127.0.0.1"); s.on("connect", () => { s.destroy(); resolve(); }); s.on("error", reject); await promise; out.push("rawSocket: CONNECTED"); } catch (e) { out.push("rawSocket: BLOCKED(" + e.code + ")"); }
try { const r = runChild(process.execPath, ["-e", "fetch('http://127.0.0.1:'+process.env.PROBE_PORT+'/').then(()=>console.log('CHILD_CONNECTED')).catch(e=>console.log('CHILD_BLOCKED:'+(e.cause?.code??e.message)))"], { timeout: 5000, encoding: "utf8" }); out.push("childNet: " + r.trim()); } catch (e) { out.push("childNet: BLOCKED(" + e.code + ")"); }
console.log(out.join("\\n"));
`,
	);
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["add", "--", "."], { cwd });
	execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "init"], { cwd });
	requests = 0;
	server = createServer((_request, response) => {
		requests += 1;
		response.end("ok");
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	rmSync(cwd, { recursive: true, force: true });
});

describe("V0.4C sandbox config and policy", () => {
	it("defaults to disabled and accepts only two modes", () => {
		const base = {
			schemaVersion: 1,
			models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
		};
		expect(configOf("disabled").verification.sandbox).toEqual({ mode: "disabled" });
		expect(configOf("required").verification.sandbox).toEqual({ mode: "required" });
		expect(parseRuntimeConfig(JSON.stringify(base)).verification.sandbox).toEqual({ mode: "disabled" });
		expect(() =>
			parseRuntimeConfig(JSON.stringify({ ...base, verification: { sandbox: { mode: "weak" } } })),
		).toThrow();
		expect(() =>
			parseRuntimeConfig(
				JSON.stringify({
					...base,
					verification: { sandbox: { mode: "required", allowedDomains: ["evil.example"] } },
				}),
			),
		).toThrow();
	});

	it("resolves the pinned SRT CLI with a real identity digest", () => {
		const backend = resolveSandboxBackend();
		expect(backend.version).toBe(SRT_VERSION);
		expect(backend.cliPath).toMatch(/sandbox-runtime.*cli\.js$/);
		expect(backend.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("freezes a canonical Host-owned policy with a stable digest", () => {
		const snapshot = buildSandboxPolicy({
			workspace: cwd,
			trustedSources: [ORACLE],
			protectedPaths: [".env", ".git", ".ai"],
		});
		expect(snapshot.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(snapshot.networkMode).toBe("deny-all");
		expect(snapshot.settings.network).toEqual({ allowedDomains: [], deniedDomains: [] });
		expect(snapshot.settings.filesystem.allowRead).toContain(canonicalHostPath(cwd));
		// Canonical paths only: the realpath form must match, a textual symlinked root must not be stored raw.
		expect(snapshot.settings.filesystem.allowRead[0]).toBe(realpathSync(cwd));
		expect(snapshot.settings.filesystem.denyWrite).toContain(join(canonicalHostPath(cwd), ORACLE));
		const sameDigest = buildSandboxPolicy({
			workspace: cwd,
			trustedSources: [ORACLE],
			protectedPaths: [".ai", ".git", ".env"],
		});
		expect(sameDigest.policyDigest).toBe(snapshot.policyDigest);
		const otherDigest = buildSandboxPolicy({
			workspace: cwd,
			trustedSources: [ORACLE],
			protectedPaths: [".env"],
		});
		expect(otherDigest.policyDigest).not.toBe(snapshot.policyDigest);
	});
});

describe.runIf(sandboxBackendReady)("V0.4C actual sandbox boundary", () => {
	it("enforces network deny, oracle write deny and protected read deny for a real check", async () => {
		const config = configOf("required", [ORACLE]);
		const verifier = await verifierOf(config);
		const oracleBefore = readFileSync(join(cwd, ORACLE), "utf8");
		const result = await verifier.verify(requestOf(verifier) as never);
		const check = result.checks[0];
		expect(check.sandbox?.status).toBe("ENFORCED");
		expect(verifier.trustRequirements[0].sandboxPolicyDigest).toBe(check.sandbox?.policyDigest);
		const stdout = check.stdout ?? "";
		expect(stdout).toContain("wsRead: OK(export const app = 1;)");
		expect(stdout).toContain("envRead: BLOCKED");
		expect(stdout).toContain("hostRead: BLOCKED");
		expect(stdout).toContain("symlinkRead: BLOCKED");

		expect(stdout).toContain("oracleWrite: BLOCKED");
		expect(stdout).toContain("hostWrite: BLOCKED");
		expect(stdout).toMatch(/netFetch: BLOCKED/);
		expect(stdout).toMatch(/rawSocket: BLOCKED/);
		expect(stdout).toMatch(/childNet: CHILD_BLOCKED|childNet: BLOCKED/);
		expect(stdout).not.toContain("TOP_SECRET_SENTINEL");
		expect(requests).toBe(0);
		expect(readFileSync(join(cwd, ORACLE), "utf8")).toBe(oracleBefore);
		expect(existsSync(outsideWrite)).toBe(false);
	}, 60000);
});

describe.runIf(sandboxBackendReady)("V0.4C symlink escape", () => {
	it("does not leak an outside secret through a workspace symlink", async () => {
		const workspace = realpathSync(mkdtempSync(join(tmpdir(), "weavra-escape-ws-")));
		const link = join(workspace, "escape-link.txt");
		execFileSync("ln", ["-sf", outsideSentinel, link]);
		writeFileSync(
			join(workspace, "probe.mjs"),
			`import { readFileSync } from "node:fs";\ntry { console.log("LEAK:" + readFileSync("escape-link.txt", "utf8").trim()); } catch (e) { console.log("BLOCKED:" + (e.code ?? e.name)); }\n`,
		);
		const snapshot = buildSandboxPolicy({ workspace, trustedSources: [], protectedPaths: [] });
		const { result, status } = await runSandboxedCheck({
			snapshot,
			executable: process.execPath,
			argv: ["probe.mjs"],
			cwd: workspace,
			env: { PATH: "/usr/bin:/bin" },
			timeoutMs: 20000,
		});
		expect(status).toBe("ENFORCED");
		expect(result.stdout).toContain("BLOCKED");
		expect(result.stdout).not.toContain("TOP_SECRET_SENTINEL");
		rmSync(workspace, { recursive: true, force: true });
	}, 60000);
});

describe("V0.4C kernel sandbox guard", () => {
	const TRUST = `sha256:${"a".repeat(64)}`;
	const POLICY = `sha256:${"b".repeat(64)}`;

	async function runWithSandbox(sandbox: unknown): Promise<string> {
		const checks = [
			{
				id: "acceptance",
				kind: "test" as const,
				required: true,
				trustRequired: true,
				trustRegistrationDigest: TRUST,
				sandboxRequired: true,
				sandboxPolicyDigest: POLICY,
			},
		];
		const ports = {
			agents: {
				execute: async (input: { runId: string; revision: number; task: { id: string } }) => ({
					role: "Developer",
					handoff: {
						runId: input.runId,
						revision: input.revision,
						role: "Developer",
						task: input.task.id,
						changed_files: [],
						summary: "fixture",
						assumptions: [],
						tests_run: [],
						known_risks: [],
						unresolved: [],
					},
				}),
			},
			verifier: {
				verify: async (input: { runId: string; revision: number; step: unknown }) =>
					({
						runId: input.runId,
						revision: input.revision,
						step: input.step,
						diffDigest: "digest",
						evidenceRefs: ["diff:digest"],
						changedFiles: [],
						checks: checks.map((check) => ({
							id: check.id,
							kind: check.kind,
							required: check.required,
							runId: input.runId,
							revision: input.revision,
							step: input.step,
							status: "PASS" as const,
							exitCode: 0,
							reason: "forged pass",
							evidenceRefs: [`check:${check.id}`],
							diffDigest: "digest",
							trust: {
								mode: "strict",
								status: "VERIFIED",
								registrationDigest: TRUST,
								executableDigest: `sha256:${"c".repeat(64)}`,
								sources: [],
							},
							...(sandbox === undefined ? {} : { sandbox }),
						})),
					}) as never,
				inspect: async () => ({
					diffDigest: "digest",
					changedFiles: [],
					evidenceRefs: ["diff:digest"],
					safe: true,
				}),
			},
			store: { load: async () => undefined, save: async () => {} },
		};
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "sandbox-run",
				task: testContract("Fix", { taskId: "task-1", checkIds: ["acceptance"] }),
				classification: classifyRequest("Fix").classification,
				checks,
			},
			ports as never,
		);
		await kernel.start();
		for (let guard = 0; guard < 16 && kernel.snapshot.status === "RUNNING"; guard += 1) {
			const step = kernel.snapshot.currentStep?.stepId;
			if (!step) break;
			await kernel.advance(step);
		}
		return kernel.snapshot.lastError ?? "";
	}

	it("rejects a required check without sandbox evidence", async () => {
		expect(await runWithSandbox(undefined)).toContain("not sandbox enforced");
	});

	it("rejects ENFORCED evidence whose policy digest is not the Host-frozen one", async () => {
		const error = await runWithSandbox({
			mode: "required",
			status: "ENFORCED",
			backend: "srt",
			backendVersion: "0.0.76",
			policyDigest: `sha256:${"d".repeat(64)}`,
		});
		expect(error).toContain("frozen verifier sandbox policy");
	});

	it("admits ENFORCED evidence with the exact frozen policy digest", async () => {
		const error = await runWithSandbox({
			mode: "required",
			status: "ENFORCED",
			backend: "srt",
			backendVersion: "0.0.76",
			policyDigest: POLICY,
		});
		expect(error).not.toContain("sandbox");
	});

	it("rejects a malformed sandbox policy digest at the contract boundary", async () => {
		const error = await runWithSandbox({
			mode: "required",
			status: "ENFORCED",
			backend: "srt",
			backendVersion: "0.0.76",
			policyDigest: "sha256:not-a-hash",
		});
		expect(error).toContain("Invalid runtime contract");
	});
});

describe("V0.4C closure: oracle read boundary, digest contract and freshness", () => {
	it.runIf(sandboxBackendReady)(
		"keeps the trusted oracle readable for the verifier while the worker is denied",
		async () => {
			const config = configOf("required", [ORACLE]);
			const policy = policyOf(config);
			expect(policy.protectedPaths).toContain(ORACLE);
			const readDecision = evaluatePolicy(
				{
					runId: "run-1",
					actionId: "a1",
					role: "Developer",
					tool: "runtime_read",
					risk: "R0",
					paths: [ORACLE],
					actionDigest: "digest",
				},
				policy,
				[{ path: ORACLE, safe: true, kind: "file" }],
				Date.now(),
			);
			expect(readDecision.decision).toBe("DENY");
			const verifier = await verifierOf(config);
			const result = await verifier.verify(requestOf(verifier) as never);
			expect(result.checks[0].status).toBe("PASS");
			expect(result.checks[0].sandbox?.status).toBe("ENFORCED");
			expect(result.checks[0].stdout).toContain("oracleWrite: BLOCKED");
		},
	);

	it("fails closed when a trusted source sits under a protected read boundary", async () => {
		const config = configOf("required", [ORACLE]);
		const policy = { ...policyOf(config), protectedPaths: ["test", ".env"] };
		const workspace = await GitWorkspace.open(cwd, policy);
		await expect(RegisteredVerifier.create(config, policy, audit, workspace)).rejects.toThrow(
			"conflicts with sandbox protected read boundary",
		);
	});

	it("binds the exact canonical settings and backend identity in the policy digest", () => {
		const base = {
			workspace: cwd,
			trustedSources: [ORACLE],
			protectedPaths: [".env", ".git"],
		};
		const a = buildSandboxPolicy(base);
		const b = buildSandboxPolicy({ ...base, protectedPaths: [".git", ".env"] });
		expect(a.policyDigest).toBe(b.policyDigest);
		const otherWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "weavra-other-")));
		expect(buildSandboxPolicy({ ...base, workspace: otherWorkspace }).policyDigest).not.toBe(a.policyDigest);
		expect(buildSandboxPolicy({ ...base, protectedPaths: [".env"] }).policyDigest).not.toBe(a.policyDigest);
		expect(buildSandboxPolicy({ ...base, trustedSources: [] }).policyDigest).not.toBe(a.policyDigest);
		expect(
			buildSandboxPolicy({ ...base, identityOverrideForTest: `sha256:${"e".repeat(64)}` } as never).policyDigest,
		).not.toBe(a.policyDigest);
		rmSync(otherWorkspace, { recursive: true, force: true });
	});

	it("treats a replaced or recreated backend CLI as stale", () => {
		const backend = resolveSandboxBackend();
		expect(validateSandboxBackend(backend).ok).toBe(true);
		const copyDir = realpathSync(mkdtempSync(join(tmpdir(), "weavra-backend-")));
		const copy = join(copyDir, "cli.js");
		writeFileSync(copy, readFileSync(backend.cliPath));
		const fake = { ...backend, cliPath: copy, ...sandboxBackendFingerprint(copy) };
		expect(validateSandboxBackend(fake).ok).toBe(true);
		rmSync(copy);
		writeFileSync(copy, readFileSync(backend.cliPath));
		expect(validateSandboxBackend(fake).ok).toBe(false);
		rmSync(copyDir, { recursive: true, force: true });
	});

	it("rejects ENFORCED evidence whose mode is not required", async () => {
		const TRUST = `sha256:${"a".repeat(64)}`;
		const POLICY = `sha256:${"b".repeat(64)}`;
		const checks = [
			{
				id: "acceptance",
				kind: "test" as const,
				required: true,
				trustRequired: true,
				trustRegistrationDigest: TRUST,
				sandboxRequired: true,
				sandboxPolicyDigest: POLICY,
			},
		];
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "mode-run",
				task: testContract("Fix", { taskId: "task-1", checkIds: ["acceptance"] }),
				classification: classifyRequest("Fix").classification,
				checks,
			},
			{
				agents: {
					execute: async (input: { runId: string; revision: number; task: { id: string } }) => ({
						role: "Developer",
						handoff: {
							runId: input.runId,
							revision: input.revision,
							role: "Developer",
							task: input.task.id,
							changed_files: [],
							summary: "fixture",
							assumptions: [],
							tests_run: [],
							known_risks: [],
							unresolved: [],
						},
					}),
				},
				verifier: {
					verify: async (input: { runId: string; revision: number; step: unknown }) =>
						({
							runId: input.runId,
							revision: input.revision,
							step: input.step,
							diffDigest: "digest",
							evidenceRefs: ["diff:digest"],
							changedFiles: [],
							checks: checks.map((check) => ({
								id: check.id,
								kind: check.kind,
								required: check.required,
								runId: input.runId,
								revision: input.revision,
								step: input.step,
								status: "PASS" as const,
								exitCode: 0,
								reason: "forged",
								evidenceRefs: [`check:${check.id}`],
								diffDigest: "digest",
								trust: {
									mode: "strict",
									status: "VERIFIED",
									registrationDigest: TRUST,
									executableDigest: `sha256:${"c".repeat(64)}`,
									sources: [],
								},
								sandbox: {
									mode: "disabled",
									status: "ENFORCED",
									backend: "srt",
									backendVersion: "0.0.76",
									policyDigest: POLICY,
								},
							})),
						}) as never,
					inspect: async () => ({
						diffDigest: "digest",
						changedFiles: [],
						evidenceRefs: ["diff:digest"],
						safe: true,
					}),
				},
				store: { load: async () => undefined, save: async () => {} },
			} as never,
		);
		await kernel.start();
		for (let guard = 0; guard < 16 && kernel.snapshot.status === "RUNNING"; guard += 1) {
			const step = kernel.snapshot.currentStep?.stepId;
			if (!step) break;
			await kernel.advance(step);
		}
		expect(kernel.snapshot.lastError ?? "").toContain("not sandbox enforced");
	});
});

describe("V0.5C trusted sandbox target outcomes", () => {
	it.runIf(sandboxBackendReady)("preserves literal argv across the SDK shell boundary", async () => {
		const snapshot = buildSandboxPolicy({ workspace: cwd, trustedSources: [], protectedPaths: [] });
		const argv = ["", "two words", "'\"$HOME`echo no`", "line\nbreak", "; exit 99"];
		const outcome = await runSandboxedCheck({
			snapshot,
			executable: process.execPath,
			argv: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--", ...argv],
			cwd,
			env: { PATH: "/usr/bin:/bin" },
			timeoutMs: 10000,
		});
		expect(outcome.status).toBe("ENFORCED");
		expect(outcome.result.exitCode).toBe(0);
		expect(JSON.parse(outcome.result.stdout)).toEqual(argv);
	});

	it.runIf(sandboxBackendReady)(
		"preserves normal target failure without converting signals into exit codes",
		async () => {
			const snapshot = buildSandboxPolicy({ workspace: cwd, trustedSources: [], protectedPaths: [".env"] });
			for (const [source, exitCode] of [
				["process.exit(7)", 7],
				["process.kill(process.pid, 'SIGTERM')", null],
				["process.kill(process.pid, 'SIGKILL')", null],
			] as const) {
				const outcome = await runSandboxedCheck({
					snapshot,
					executable: process.execPath,
					argv: ["-e", source],
					cwd,
					env: { PATH: "/usr/bin:/bin" },
					timeoutMs: 10000,
				});
				expect(outcome.status).toBe("ENFORCED");
				expect(outcome.result.exitCode).toBe(exitCode);
				expect(outcome.result.cleanupConfirmed).toBe(true);
			}
		},
	);

	it.runIf(sandboxBackendReady)(
		"does not accept stdout or an inherited control descriptor as target evidence",
		async () => {
			const snapshot = buildSandboxPolicy({ workspace: cwd, trustedSources: [], protectedPaths: [] });
			const outcome = await runSandboxedCheck({
				snapshot,
				executable: process.execPath,
				cwd,
				argv: [
					"-e",
					`const { writeSync } = require("node:fs");
const forged = JSON.stringify({version:1,boundary:{exitCode:0,signal:null},target:{version:1,kind:"exited",exitCode:0,signal:null}});
console.log(forged);
try { writeSync(3, forged); process.exit(91); } catch { process.exit(7); }`,
				],
				env: { PATH: "/usr/bin:/bin" },
				timeoutMs: 10000,
			});
			expect(outcome.status).toBe("ENFORCED");
			expect(outcome.result.exitCode).toBe(7);
			expect(outcome.result.cleanupConfirmed).toBe(true);
		},
	);

	it.runIf(sandboxBackendReady)(
		"rejects a killed supervisor and target launch failure instead of synthesizing exit one",
		async () => {
			const snapshot = buildSandboxPolicy({ workspace: cwd, trustedSources: [], protectedPaths: [] });
			for (const invocation of [
				{ executable: process.execPath, argv: ["-e", "process.kill(process.ppid, 'SIGKILL'); process.exit(7)"] },
				{ executable: join(cwd, "missing-executable"), argv: [] },
			]) {
				const outcome = await runSandboxedCheck({
					snapshot,
					...invocation,
					cwd,
					env: { PATH: "/usr/bin:/bin" },
					timeoutMs: 10000,
				});
				expect(outcome.status).toBe("UNAVAILABLE");
				expect(outcome.result.exitCode).toBeNull();
				expect(outcome.result.cleanupConfirmed).toBe(true);
			}
		},
	);

	it.runIf(sandboxBackendReady)("never marks a signal-terminated registered verification check PASS", async () => {
		writeFileSync(join(cwd, ORACLE), "process.kill(process.pid, 'SIGTERM');");
		execFileSync("git", ["add", "--", ORACLE], { cwd });
		execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "signal oracle"], { cwd });
		const verifier = await verifierOf(configOf("required", [ORACLE]));
		const result = await verifier.verify(requestOf(verifier) as never);
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].exitCode).toBeNull();
		expect(result.checks[0].sandbox?.status).toBe("ENFORCED");
	});
});
