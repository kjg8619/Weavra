import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import type { KernelPorts, VerificationRequest } from "../src/ports.ts";
import { RegisteredVerifier } from "../src/verification.ts";
import {
	canonicalEnvironment,
	executableIdentityDigest,
	registrationDigestOf,
	resolveVerifierTrustSources,
	snapshotVerifierExecutable,
	snapshotVerifierSources,
	validateVerifierTrust,
} from "../src/verifier-trust.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";
import { graphRun } from "./graph-fixtures.ts";

let cwd: string;
let marker: string;
const audit: ActionAudit = {
	prepare: vi.fn(async () => {}),
	finish: vi.fn(async () => {}),
	assertWritable: vi.fn(async () => {}),
};

function configOf(mode: "compatible" | "strict", trustFiles: string[] = []) {
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
				trust: { mode },
				checks: [
					{
						id: "acceptance",
						kind: "test",
						executable: process.execPath,
						args: ["--test", "test/acceptance.test.mjs"],
						required: true,
						...(trustFiles.length ? { trust: { files: trustFiles } } : {}),
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
	protectedPaths: ["test/acceptance.test.mjs"],
	configDigest: "frozen-config",
});

async function verifierOf(config: RuntimeConfig) {
	const policy = policyOf(config);
	const workspace = await GitWorkspace.open(cwd, policy);
	return await RegisteredVerifier.create(config, policy, audit, workspace);
}

function requestOf(
	config: RuntimeConfig,
	requirements: Array<{
		id: string;
		kind: VerificationRequest["checks"][number]["kind"];
		required: boolean;
		trustRequired: boolean;
		trustRegistrationDigest: string;
	}> = config.verification.checks.map((check) => ({
		id: check.id,
		kind: check.kind,
		required: check.required,
		trustRequired: config.verification.trust.mode === "strict",
		trustRegistrationDigest: "",
	})),
): VerificationRequest {
	return {
		runId: "run-1",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		task: testContract("Fix", { taskId: "task-1" }),
		handoff: { role: "Developer" } as never,
		checks: requirements.map((requirement) => ({
			id: requirement.id,
			kind: requirement.kind,
			required: requirement.required,
			...(requirement.trustRequired
				? {
						trustRequired: true,
						trustRegistrationDigest: requirement.trustRegistrationDigest,
					}
				: {}),
		})),
	};
}

beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-trust-")));
	mkdirSync(join(cwd, "test"));
	mkdirSync(join(cwd, "src"));
	marker = join(realpathSync(mkdtempSync(join(tmpdir(), "weavra-marker-"))), "ran.txt");
	writeFileSync(
		join(cwd, "test/acceptance.test.mjs"),
		`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "yes");\nconsole.log("ACCEPTANCE OK");\n`,
	);
	writeFileSync(join(cwd, "src/app.ts"), "export const app = 1;\n");
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["add", "--", "."], { cwd });
	execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "init"], { cwd });
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(cwd, { recursive: true, force: true });
});

describe("V0.4B verifier trust config", () => {
	it("defaults to compatible and accepts only two trust modes", () => {
		const base = {
			schemaVersion: 1,
			models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
		};
		expect(configOf("compatible").verification.trust).toEqual({ mode: "compatible" });
		expect(configOf("strict").verification.trust).toEqual({ mode: "strict" });
		expect(parseRuntimeConfig(JSON.stringify(base)).verification.trust).toEqual({ mode: "compatible" });
		expect(() =>
			parseRuntimeConfig(JSON.stringify({ ...base, verification: { trust: { mode: "paranoid" } } })),
		).toThrow();
		expect(() =>
			parseRuntimeConfig(
				JSON.stringify({
					...base,
					verification: { checks: [{ id: "c", kind: "test", executable: "node", args: [], trust: { file: [] } }] },
				}),
			),
		).toThrow();
	});

	it("rejects duplicate, traversing and protected trust files", () => {
		const base = {
			schemaVersion: 1,
			models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
		};
		const withFiles = (files: string[]) =>
			JSON.stringify({
				...base,
				verification: {
					checks: [{ id: "c", kind: "test", executable: "node", args: [], trust: { files } }],
				},
			});
		expect(() => parseRuntimeConfig(withFiles(["test/a.mjs", "test/a.mjs"]))).toThrow();
		expect(() => parseRuntimeConfig(withFiles(["../outside.mjs"]))).toThrow();
		expect(() => parseRuntimeConfig(withFiles([".ai/config.yaml"]))).toThrow();
	});

	it("resolves direct argv sources and declared trust files together", () => {
		const config = configOf("strict", ["test/expectations.json"]);
		writeFileSync(join(cwd, "test/expectations.json"), "{}\n");
		expect(resolveVerifierTrustSources(cwd, config.verification.checks[0])).toEqual([
			"test/acceptance.test.mjs",
			"test/expectations.json",
		]);
	});

	it("fails closed when a declared trust file is missing or is a symlink", () => {
		const config = configOf("strict", ["test/missing.json"]);
		expect(() => resolveVerifierTrustSources(cwd, config.verification.checks[0])).toThrow();
		writeFileSync(join(cwd, "src/real.json"), "{}\n");
		execFileSync("ln", ["-s", "src/real.json", join(cwd, "test/link.json")]);
		const linked = configOf("strict", ["test/link.json"]);
		expect(() => resolveVerifierTrustSources(cwd, linked.verification.checks[0])).toThrow();
	});

	it("binds digest and filesystem generation in the trust snapshot", () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const executable = snapshotVerifierExecutable(process.execPath);
		const sources = snapshotVerifierSources(cwd, ["test/acceptance.test.mjs"]);
		const snapshot = {
			mode: "strict" as const,
			registrationDigest: registrationDigestOf({
				check: config.verification.checks[0],
				executable,
				sources,
				configDigest: "frozen-config",
				trustMode: "strict",
				environment: { PATH: "/usr/bin" },
			}),
			executableDigest: "sha256:test",
			executable,
			sources,
		};
		expect(validateVerifierTrust(cwd, snapshot).status).toBe("VERIFIED");
		const original = readFileSync(join(cwd, "test/acceptance.test.mjs"), "utf8");
		rmSync(join(cwd, "test/acceptance.test.mjs"));
		writeFileSync(join(cwd, "test/acceptance.test.mjs"), original);
		expect(validateVerifierTrust(cwd, snapshot).status).toBe("STALE");
	});
});

describe("V0.4B registered verifier trust", () => {
	it("passes a normal strict check with VERIFIED trust and a registration digest", async () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		expect(result.checks[0].status).toBe("PASS");
		expect(result.checks[0].trust).toMatchObject({ mode: "strict", status: "VERIFIED" });
		expect(result.checks[0].trust?.registrationDigest).toMatch(/^sha256:/);
		expect(result.checks[0].trust?.sources.map((source) => source.path)).toEqual(["test/acceptance.test.mjs"]);
	});

	it("marks compatible checks as UNVERIFIED without changing the check outcome", async () => {
		const config = configOf("compatible");
		const verifier = await verifierOf(config);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		expect(result.checks[0].status).toBe("PASS");
		expect(result.checks[0].trust).toMatchObject({ mode: "compatible", status: "UNVERIFIED" });
	});

	it("refuses to execute when a trusted source changed before the process", async () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		// Same bytes, different filesystem generation: only the trust snapshot can notice this.
		utimesSync(join(cwd, "test/acceptance.test.mjs"), new Date(), new Date());
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].trust).toMatchObject({ status: "STALE" });
		expect(result.checks[0].reason).toContain("before execution");
		expect(existsSync(marker)).toBe(false);
	});

	it("treats delete plus identical-byte recreation as stale and never executes", async () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		const original = readFileSync(join(cwd, "test/acceptance.test.mjs"), "utf8");
		rmSync(join(cwd, "test/acceptance.test.mjs"));
		writeFileSync(join(cwd, "test/acceptance.test.mjs"), original);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].trust).toMatchObject({ status: "STALE" });
		expect(existsSync(marker)).toBe(false);
	});

	it("does not promote exit 0 to PASS when the oracle rewrites itself while running", async () => {
		writeFileSync(
			join(cwd, "test/acceptance.test.mjs"),
			'import { writeFileSync } from "node:fs";\nconsole.log("LOOKS GOOD");\nwriteFileSync("test/acceptance.test.mjs", "console.log(\\"PASS ONLY\\");\\n");\n',
		);
		execFileSync("git", ["add", "--", "."], { cwd });
		execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "self-modifying"], { cwd });
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		expect(result.checks[0].exitCode).toBe(0);
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].trust).toMatchObject({ status: "STALE" });
		expect(result.checks[0].reason).toContain("during execution");
	});

	it("refuses to execute when the frozen executable was replaced", async () => {
		const exeRoot = realpathSync(mkdtempSync(join(tmpdir(), "weavra-exe-")));
		const fake = join(exeRoot, "fake-check.sh");
		writeFileSync(fake, '#!/bin/sh\necho "FAKE"\n');
		execFileSync("chmod", ["755", fake]);
		const inner = parseRuntimeConfig(
			JSON.stringify({
				schemaVersion: 1,
				models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
				verification: {
					trust: { mode: "strict" },
					checks: [{ id: "acceptance", kind: "test", executable: fake, args: [], required: true }],
				},
			}),
		);
		const verifier = await verifierOf(inner);
		writeFileSync(fake, '#!/bin/sh\necho "REPLACED"\nexit 0\n');
		execFileSync("chmod", ["755", fake]);
		const result = await verifier.verify(requestOf(inner, verifier.trustRequirements));
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].trust).toMatchObject({ status: "STALE" });
	});
});

describe("V0.4B trust evidence projections", () => {
	it("shows trust status in the evidence pack and keeps legacy results UNKNOWN", async () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		const packOf = (check: (typeof result.checks)[0]) => {
			const run = graphRun("STANDARD", "R1", 0);
			return projectEvidencePack({
				run: { ...run, selfCheck: result, verification: [check] } as never,
				report: { changedFiles: [], partialChanges: false, changesUnknown: false } as never,
			});
		};
		const text = formatEvidencePack(packOf(result.checks[0]));
		expect(text).toContain("Verifier trust: VERIFIED (strict)");
		expect(text).toContain("trusted sources 1");
		expect(text).not.toContain("console.log");
		const legacy = structuredClone(result.checks[0]);
		delete legacy.trust;
		expect(formatEvidencePack(packOf(legacy))).toContain("Verifier trust: UNKNOWN (legacy)");
	});
});

describe("V0.4B kernel trust guard", () => {
	const DIGEST = `sha256:${"a".repeat(64)}`;

	async function runWithTrust(trust: unknown): Promise<string> {
		const checks = [
			{
				id: "acceptance",
				kind: "test" as const,
				required: true,
				trustRequired: true,
				trustRegistrationDigest: DIGEST,
			},
		];
		const ports: KernelPorts = {
			agents: {
				execute: async (input) => ({
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
				verify: async (input) =>
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
							...(trust === undefined ? {} : { trust }),
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
				runId: "trust-run",
				task: testContract("Fix", { taskId: "task-1", checkIds: ["acceptance"] }),
				classification: classifyRequest("Fix").classification,
				checks,
			},
			ports,
		);
		await kernel.start();
		for (let guard = 0; guard < 16 && kernel.snapshot.status === "RUNNING"; guard += 1) {
			const step = kernel.snapshot.currentStep?.stepId;
			if (!step) break;
			await kernel.advance(step);
		}
		return kernel.snapshot.lastError ?? "";
	}

	it("rejects a forged PASS that carries no verifier-trust evidence", async () => {
		expect(await runWithTrust(undefined)).toContain("not verifier-trust verified");
	});

	it("rejects a VERIFIED flag whose registration digest is not the Host-frozen one", async () => {
		const error = await runWithTrust({
			mode: "strict",
			status: "VERIFIED",
			registrationDigest: `sha256:${"b".repeat(64)}`,
			executableDigest: `sha256:${"c".repeat(64)}`,
			sources: [],
		});
		expect(error).toContain("frozen verifier registration");
	});

	it("rejects a malformed digest instead of treating VERIFIED as authority", async () => {
		const error = await runWithTrust({
			mode: "strict",
			status: "VERIFIED",
			registrationDigest: "sha256:not-a-hash",
			executableDigest: `sha256:${"c".repeat(64)}`,
			sources: [],
		});
		expect(error).toContain("Invalid runtime contract");
	});

	it("accepts a schema-valid VERIFIED evidence with the exact frozen digest", async () => {
		const error = await runWithTrust({
			mode: "strict",
			status: "VERIFIED",
			registrationDigest: DIGEST,
			executableDigest: `sha256:${"c".repeat(64)}`,
			sources: [{ path: "test/acceptance.test.mjs", digest: `sha256:${"d".repeat(64)}` }],
		});
		expect(error).not.toContain("verifier-trust");
		expect(error).not.toContain("frozen verifier registration");
	});
});

describe("V0.4B closure: digest contracts", () => {
	it("binds the actual filtered environment canonically", () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const executable = snapshotVerifierExecutable(process.execPath);
		const sources = snapshotVerifierSources(cwd, ["test/acceptance.test.mjs"]);
		const digestOf = (environment: Record<string, string>) =>
			registrationDigestOf({
				check: config.verification.checks[0],
				executable,
				sources,
				configDigest: "frozen-config",
				trustMode: "strict",
				environment,
			});
		const a = digestOf({ PATH: "/a", LANG: "C" });
		const b = digestOf({ PATH: "/b", LANG: "C" });
		const reordered = digestOf({ LANG: "C", PATH: "/a" });
		expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(a).not.toBe(b);
		expect(reordered).toBe(a);
		expect(canonicalEnvironment({ b: "2", a: "1" })).toEqual([
			["a", "1"],
			["b", "2"],
		]);
	});

	it("produces a real SHA-256 executable identity digest", () => {
		const executable = snapshotVerifierExecutable(process.execPath);
		const digest = executableIdentityDigest(executable);
		expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(executableIdentityDigest({ ...executable })).toBe(digest);
		expect(executableIdentityDigest({ ...executable, mtimeNs: "1" })).not.toBe(digest);
	});

	it("records strict VERIFIED evidence with real sha256 digests and a matching Host binding", async () => {
		const config = configOf("strict", ["test/acceptance.test.mjs"]);
		const verifier = await verifierOf(config);
		const result = await verifier.verify(requestOf(config, verifier.trustRequirements));
		const trust = result.checks[0].trust;
		expect(trust?.registrationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(trust?.executableDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		for (const source of trust?.sources ?? []) expect(source.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(verifier.trustRequirements[0].trustRegistrationDigest).toBe(trust?.registrationDigest);
	});
});
