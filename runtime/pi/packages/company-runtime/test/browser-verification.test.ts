import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateBrowserAssertion, validBrowserCheckEvidence } from "../src/browser-evidence.ts";
import {
	BrowserObservationError,
	observeLocalBrowser,
	parseBrowserObservationArguments,
} from "../src/browser-observation.ts";
import { saveBrowserCandidate } from "../src/browser-registry.ts";
import {
	type BrowserObservationCandidate,
	type BrowserRegistrationRequest,
	browserDigest,
	browserEvidenceDigestOf,
	browserProjectId,
	browserRegistrationDigestOf,
	candidateDigestOf,
	validateBrowserCandidate,
} from "../src/browser-types.ts";
import { classifyRequest } from "../src/classification.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import {
	type CheckRequirement,
	CheckResultSchema,
	type Handoff,
	type VerificationResult,
	validateContract,
} from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { projectEvidencePack } from "../src/evidence.ts";
import { HostControlBridge } from "../src/host-control.ts";
import type { HostBrowserPreview, HostControlResponse } from "../src/host-control-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { type ActionAudit, evaluatePolicy, type PolicyContext } from "../src/policy.ts";
import type { KernelPorts, VerificationRequest } from "../src/ports.ts";
import { RegisteredVerifier } from "../src/verification.ts";
import * as verifierTrust from "../src/verifier-trust.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

const directories: string[] = [];
const owners: HostControlBridge[] = [];
const documentUrl = "http://127.0.0.1:3880/status";
function browserFixture(settings: Record<string, unknown> = {}) {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "weavra-c08-test-")));
	directories.push(directory);
	const executable = join(directory, "chromium-fixture.mjs");
	writeFileSync(
		executable,
		`#!${process.execPath}\n${readFileSync(new URL("./fixtures/browser-cdp.mjs", import.meta.url), "utf8")}`,
	);
	chmodSync(executable, 0o700);
	const update = (value: Record<string, unknown>) =>
		writeFileSync(join(directory, "capture.json"), JSON.stringify(value));
	update(settings);
	return {
		directory,
		executable,
		update,
		capture: (projectRoot = directory, signal?: AbortSignal) =>
			observeLocalBrowser({
				url: documentUrl,
				executable,
				localTestApp: true,
				projectRoot,
				target: { selector: "#status" },
				signal,
			}),
		profiles: () =>
			readFileSync(join(directory, "captures.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { pid: number; home: string; profile: string }),
	};
}
function candidateData(): BrowserObservationCandidate {
	const observation = {
		url: documentUrl,
		title: "Fixture",
		text: "Ready",
		markerDigest: "a".repeat(64),
		elements: [],
		omittedElements: 0,
		target: { target: { selector: "#status" }, exists: true, value: "Ready" },
	};
	const fields: Omit<BrowserObservationCandidate, "candidateDigest"> = {
		schemaVersion: 2,
		kind: "BROWSER_OBSERVATION_CANDIDATE",
		candidateId: "00000000-0000-4000-8000-000000000001",
		projectId: browserProjectId("/fixture"),
		authority: "CANDIDATE_ONLY",
		scope: "LOCAL_STATIC_DOCUMENT",
		origin: new URL(documentUrl).origin,
		documentIdentity: documentUrl,
		capturedAt: 100,
		pageRevision: browserDigest("document"),
		observationType: "target",
		source: {
			implementationRevision: browserDigest("implementation"),
			readerRevision: "a".repeat(40),
			readerDigest: browserDigest("reader"),
			executableIdentityDigest: browserDigest("executable"),
			browserVersion: "CDP fixture",
		},
		freshness: { mode: "CAPTURE_ONLY", startedAt: 90, finishedAt: 100 },
		observationDigest: browserDigest(observation),
		observation,
		cleanup: "CONFIRMED",
	};
	return { ...fields, candidateDigest: candidateDigestOf(fields) };
}
function registrationFor(candidate: BrowserObservationCandidate): BrowserRegistrationRequest {
	return {
		candidateId: candidate.candidateId,
		expectedCandidateDigest: candidate.candidateDigest,
		checkId: "browser-status",
		origin: candidate.origin,
		documentIdentity: candidate.documentIdentity,
		target: { selector: "#status" },
		assertion: { type: "text_equals", expected: "Ready" },
		freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 },
	};
}
function previewOf(response: HostControlResponse): HostBrowserPreview {
	if (!response.success || response.data.kind !== "browser-prepared")
		throw new Error(`Missing browser preview: ${JSON.stringify(response)}`);
	return response.data.preview;
}
async function registrationFixture() {
	const browser = browserFixture();
	const root = join(browser.directory, "project");
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, ".ai"), { mode: 0o700 });
	writeFileSync(join(root, "src/status.html"), '<p id="status">Ready</p>\n');
	writeFileSync(join(root, ".gitignore"), ".ai/\n");
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["add", "--", ".gitignore", "src/status.html"], { cwd: root });
	execFileSync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.email=c08@example.invalid",
			"-c",
			"user.name=C08",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd: root },
	);
	const configPath = join(root, ".ai/config.yaml");
	writeFileSync(
		configPath,
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "fixture" },
					reasoning: { provider: "faux", model: "fixture" },
				},
			},
			files: { allowed_paths: ["src"] },
			verification: { checks: [] },
		}),
		{ mode: 0o600 },
	);
	const createModels = vi.fn(async () => {
		throw new Error("Browser registration must not initialize a Provider");
	});
	const owner = await HostControlBridge.create({
		cwd: root,
		projectTrusted: true,
		agentDir: join(browser.directory, "agents"),
		createModels,
	});
	owners.push(owner);
	const responses: HostControlResponse[] = [];
	const connection = owner.connect((line) => {
		responses.push(JSON.parse(line) as HostControlResponse);
		return true;
	});
	const receive = async (input: Record<string, unknown>) => {
		const count = responses.length;
		await connection.receive(JSON.stringify(input));
		if (responses.length !== count + 1) throw new Error("Missing control response");
		return responses[count];
	};
	await receive({ protocolVersion: 1, id: randomUUID(), type: "control.hello" });
	const command = async (input: Record<string, unknown>) => {
		const snapshot = await receive({ protocolVersion: 1, id: randomUUID(), type: "control.snapshot" });
		if (!snapshot.success || snapshot.data.kind !== "snapshot") throw new Error("Missing owner snapshot");
		return receive({
			protocolVersion: 1,
			id: snapshot.data.state.nextRequestId,
			ownerId: owner.ownerId,
			expectedProjectRevision: snapshot.data.state.projectRevision,
			...input,
		});
	};
	const candidate = await browser.capture(root);
	await saveBrowserCandidate(root, candidate, browser.executable);
	return {
		...browser,
		root,
		candidate,
		command,
		receive,
		owner,
		createModels,
		configPath,
		request: registrationFor(candidate),
		config: () => parseRuntimeConfig(readFileSync(configPath, "utf8")),
		confirm: (preview: HostBrowserPreview) =>
			command({ type: "browser.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest }),
	};
}
async function registeredFixture(options: { commandExit?: number; repair?: boolean } = {}) {
	const fixture = await registrationFixture();
	const preview = previewOf(await fixture.command({ type: "browser.prepare", registration: fixture.request }));
	const confirmed = await fixture.confirm(preview);
	if (!confirmed.success || confirmed.data.kind !== "browser-registered") throw new Error("Registration failed");
	const config = fixture.config();
	if (options.repair) config.verification.repair.mode = "self-check-once";
	if (options.commandExit !== undefined) {
		mkdirSync(join(fixture.root, "test"));
		writeFileSync(join(fixture.root, "test/check.mjs"), `process.exit(${options.commandExit});\n`);
		execFileSync("git", ["add", "--", "test/check.mjs"], { cwd: fixture.root });
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"user.email=c08@example.invalid",
				"-c",
				"user.name=C08",
				"commit",
				"-qm",
				"oracle",
			],
			{ cwd: fixture.root },
		);
		config.verification.checks.push({
			id: "command-check",
			kind: "test",
			executable: process.execPath,
			args: ["test/check.mjs"],
			cwd: ".",
			timeout_ms: 5000,
			required: true,
			trust: { files: [] },
			repairable_exit_codes: [],
		});
	}
	const policy: PolicyContext = {
		executionMode: "EDIT",
		executionRunId: "run-c08",
		tools: [],
		allowedPaths: ["src"],
		configDigest: browserDigest(config),
	};
	const audit: ActionAudit = {
		prepare: vi.fn(async () => {}),
		finish: vi.fn(async () => {}),
		assertWritable: vi.fn(async () => {}),
	};
	const workspace = await GitWorkspace.open(fixture.root, policy);
	const verifier = await RegisteredVerifier.create(config, policy, audit, workspace);
	const checks: CheckRequirement[] = verifier.trustRequirements.map((requirement) => ({
		id: requirement.id,
		kind: requirement.kind,
		required: requirement.required,
		...(requirement.browser ? { browser: requirement.browser } : {}),
		...(requirement.trustRequired || options.repair
			? { trustRegistrationDigest: requirement.trustRegistrationDigest }
			: {}),
		...(requirement.trustRequired ? { trustRequired: true } : {}),
	}));
	const task = testContract("Fix browser status", { taskId: "task-c08", checkIds: checks.map((check) => check.id) });
	const handoff: Handoff = {
		runId: "run-c08",
		revision: 0,
		role: "Developer",
		task: task.id,
		summary: "Fixture implementation",
		changed_files: [],
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	};
	const request: VerificationRequest = {
		runId: "run-c08",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		task,
		handoff,
		checks,
	};
	return { ...fixture, frozenConfig: config, verifier, request, checks, task, handoff, check: confirmed.data.check };
}
async function kernelFixture(
	fixture: Awaited<ReturnType<typeof registeredFixture>>,
	verifier: KernelPorts["verifier"] = fixture.verifier,
) {
	const events: RuntimeEvent["type"][] = [];
	let developerCalls = 0;
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run-c08",
			task: fixture.task,
			classification: classifyRequest("Fix browser status").classification,
			workflow: "STANDARD",
			checks: fixture.checks,
			verificationRepairMode: fixture.frozenConfig.verification.repair.mode,
		},
		{
			verifier,
			store: { load: async () => undefined, save: async () => {} },
			events: {
				emit: (event) => {
					events.push(event.type);
				},
			},
			agents: {
				execute: async (input) => {
					await input.onSessionCreated?.({
						role: input.role,
						sessionId: randomUUID(),
						sessionFile: join(fixture.directory, `${randomUUID()}.jsonl`),
					});
					if (input.role === "Developer") {
						developerCalls++;
						return { role: "Developer", handoff: fixture.handoff };
					}
					if (input.role !== "Reviewer") throw new Error("Unexpected fixture role");
					return {
						role: "Reviewer",
						review: {
							runId: input.runId,
							revision: input.revision,
							role: "Reviewer",
							task: input.task.id,
							result: "PASS",
							issues: [],
							criteria: input.task.acceptanceCriteria.map((criterion) => ({
								criterionId: criterion.id,
								status: "MET",
								evidenceRefs: [...input.verification.evidenceRefs],
							})),
							evidenceRefs: [...input.verification.evidenceRefs],
							diffDigest: input.verification.diffDigest,
						},
					};
				},
			},
		},
	);
	return { kernel, events, developerCalls: () => developerCalls };
}
async function drive(kernel: CompanyKernel, stopBefore?: string) {
	if (kernel.snapshot.status === "CREATED") await kernel.start();
	for (let count = 0; count < 12 && kernel.snapshot.status === "RUNNING"; count++) {
		const step = kernel.snapshot.currentStep;
		if (!step) throw new Error("Missing fixture step");
		if (step.stepId === stopBefore) break;
		await kernel.advance(step.stepId);
	}
	return kernel.snapshot;
}
afterEach(async () => {
	vi.restoreAllMocks();
	for (const owner of owners.splice(0)) await owner.shutdown();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("C08 candidate data boundary", () => {
	it("accepts a valid bounded candidate without creating a registration or PASS", async () => {
		const fixture = await registrationFixture();
		expect(validateBrowserCandidate(fixture.candidate).observation.target?.value).toBe("Ready");
		expect(fixture.candidate.authority).toBe("CANDIDATE_ONLY");
		expect(fixture.config().verification.checks).toEqual([]);
	});
	it("canonicalizes candidate digests independently of field order and binds observed changes", () => {
		const candidate = candidateData();
		const reordered = Object.fromEntries(Object.entries(candidate).reverse()) as BrowserObservationCandidate;
		expect(candidateDigestOf(reordered)).toBe(candidate.candidateDigest);
		const changed = structuredClone(candidate);
		changed.observation.target!.value = "Broken";
		changed.observationDigest = browserDigest(changed.observation);
		expect(candidateDigestOf(changed)).not.toBe(candidate.candidateDigest);
	});
	it("rejects oversized observation output before returning a candidate", async () => {
		const fixture = browserFixture({ text: "x".repeat(6001) });
		await expect(fixture.capture()).rejects.toBeInstanceOf(BrowserObservationError);
		expect(fixture.profiles().every((profile) => !existsSync(profile.home))).toBe(true);
	});
	it("rejects credential-bearing fields at the candidate boundary", () => {
		for (const key of ["authorization", "password", "accessToken"])
			expect(() => validateBrowserCandidate({ ...candidateData(), [key]: "must-not-persist" })).toThrow();
	});
	it("rejects cookie and storage output from the browser reader", async () => {
		const fixture = browserFixture();
		for (const key of ["cookies", "localStorage", "sessionStorage"]) {
			fixture.update({ observationExtras: { [key]: "must-not-persist" } });
			await expect(fixture.capture()).rejects.toBeInstanceOf(BrowserObservationError);
		}
	});
	it("cannot change candidate-only authority into PASS or COMPLETE", () => {
		for (const authority of ["PASS", "COMPLETE", "REGISTERED_CHECK"])
			expect(() => validateBrowserCandidate({ ...candidateData(), authority })).toThrow();
	});
});

describe("C08 explicitly reviewed registration", () => {
	it("requires confirmation and preserves a Host-edited expectation rather than the observed value", async () => {
		const fixture = await registrationFixture();
		const request = { ...fixture.request, assertion: { type: "text_equals", expected: "Corrected expectation" } };
		const preview = previewOf(await fixture.command({ type: "browser.prepare", registration: request }));
		expect(fixture.config().verification.checks).toEqual([]);
		const response = await fixture.confirm(preview);
		expect(response.success && response.data.kind).toBe("browser-registered");
		const check = fixture.config().verification.checks[0];
		if (check.kind !== "browser") throw new Error("Missing typed registration");
		expect(check.browser.assertion).toEqual(request.assertion);
		expect(check.browser.registrationDigest).toBe(browserRegistrationDigestOf(check.browser));
		expect(fixture.createModels).not.toHaveBeenCalled();
	});
	it("rejects stale expected candidate digests", async () => {
		const fixture = await registrationFixture();
		const response = await fixture.command({
			type: "browser.prepare",
			registration: { ...fixture.request, expectedCandidateDigest: browserDigest("stale") },
		});
		expect(response).toMatchObject({ success: false, error: { code: "CANDIDATE_CHANGED" } });
		expect(fixture.config().verification.checks).toEqual([]);
	});
	it("rejects candidate replacement between review and confirmation", async () => {
		const fixture = await registrationFixture();
		const preview = previewOf(await fixture.command({ type: "browser.prepare", registration: fixture.request }));
		const path = join(fixture.root, ".ai/browser-candidates", `${fixture.candidate.candidateId}.json`);
		const record = JSON.parse(readFileSync(path, "utf8")) as { candidate: BrowserObservationCandidate };
		record.candidate.observation.target!.value = "Changed";
		record.candidate.observationDigest = browserDigest(record.candidate.observation);
		record.candidate.candidateDigest = candidateDigestOf(record.candidate);
		writeFileSync(path, JSON.stringify(record));
		expect(await fixture.confirm(preview)).toMatchObject({ success: false, error: { code: "CANDIDATE_CHANGED" } });
		expect(fixture.config().verification.checks).toEqual([]);
	});
	it("rejects unsupported assertion registration", async () => {
		const fixture = await registrationFixture();
		expect(
			await fixture.command({
				type: "browser.prepare",
				registration: { ...fixture.request, assertion: { type: "screenshot_matches", expected: "anything" } },
			}),
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
	});
	it("rejects origin and document substitutions", async () => {
		const fixture = await registrationFixture();
		expect(
			await fixture.command({
				type: "browser.prepare",
				registration: {
					...fixture.request,
					origin: "http://127.0.0.1:3881",
					documentIdentity: "http://127.0.0.1:3881/status",
				},
			}),
		).toMatchObject({ success: false, error: { code: "INVALID_BROWSER_CHECK" } });
	});
	it("rejects duplicate check IDs rather than replacing their frozen expectation", async () => {
		const fixture = await registeredFixture();
		for (const expected of ["Ready", "Replacement"])
			expect(
				await fixture.command({
					type: "browser.prepare",
					registration: { ...registrationFor(fixture.candidate), assertion: { type: "text_equals", expected } },
				}),
			).toMatchObject({ success: false, error: { code: "CHECK_EXISTS" } });
		expect(fixture.config().verification.checks).toHaveLength(1);
	});
	it("denies agent registration tools and protected configuration writes", async () => {
		const fixture = await registrationFixture();
		const context: PolicyContext = {
			executionMode: "EDIT",
			executionRunId: "run-c08",
			tools: [{ id: "runtime_write", operation: "write" }],
			allowedPaths: ["src", ".ai"],
			configDigest: "fixture",
		};
		for (const role of ["Developer", "Reviewer", "Lead"] as const)
			for (const tool of ["runtime_write", "browser.register"])
				expect(
					evaluatePolicy(
						{
							runId: "run-c08",
							actionId: randomUUID(),
							role,
							risk: "R1",
							tool,
							paths: [".ai/config.yaml"],
							actionDigest: browserDigest(fixture.request),
						},
						context,
						[{ path: ".ai/config.yaml", safe: true, kind: "file" }],
					).decision,
				).toBe("DENY");
		expect(
			await fixture.command({ type: "browser.prepare", registration: fixture.request, role: "Developer" }),
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
		expect(fixture.config().verification.checks).toEqual([]);
	});
});

describe("C08 independent fresh verification", () => {
	it("passes a fresh Ready document after a Ready exploration with typed strict evidence", async () => {
		const fixture = await registeredFixture();
		const result = await fixture.verifier.verify(fixture.request);
		expect(result.checks[0]).toMatchObject({
			kind: "browser",
			status: "PASS",
			exitCode: null,
			trust: { mode: "strict", status: "VERIFIED" },
		});
		expect(result.checks[0].browser?.captureId).not.toBe(fixture.candidate.candidateId);
		expect(validBrowserCheckEvidence(result.checks[0], fixture.check, Date.now())).toBe(true);
	});
	it("fails fresh Broken content instead of reusing the historical Ready candidate", async () => {
		const fixture = await registeredFixture();
		fixture.update({ value: "Broken" });
		const result = await fixture.verifier.verify(fixture.request);
		expect(result.checks[0].status).toBe("FAIL");
		expect(result.checks[0].browser?.documentDigest).not.toBe(fixture.candidate.pageRevision);
		expect(fixture.candidate.observation.target?.value).toBe("Ready");
	});
	it("executes registered checks after the advisory candidate has been removed", async () => {
		const fixture = await registeredFixture();
		rmSync(join(fixture.root, ".ai/browser-candidates"), { recursive: true });
		expect((await fixture.verifier.verify(fixture.request)).checks[0].status).toBe("PASS");
	});
	it("does not use a retained historical candidate when the new browser is unavailable", async () => {
		const fixture = await registeredFixture();
		fixture.update({ mode: "unavailable" });
		const check = (await fixture.verifier.verify(fixture.request)).checks[0];
		expect(check).toMatchObject({ status: "UNAVAILABLE", exitCode: null });
		expect(check.browser).toBeUndefined();
	});
	it("creates and cleans distinct HOME/profile sessions for exploration, SELF_CHECK and TEST", async () => {
		const fixture = await registeredFixture();
		const self = await fixture.verifier.verify(fixture.request);
		const final = await fixture.verifier.verify({ ...fixture.request, step: { stepId: "test", attempt: 1 } });
		expect([self.checks[0].status, final.checks[0].status]).toEqual(["PASS", "PASS"]);
		const profiles = fixture.profiles();
		expect(profiles).toHaveLength(3);
		expect(new Set(profiles.map((profile) => profile.home)).size).toBe(3);
		expect(new Set(profiles.map((profile) => profile.profile)).size).toBe(3);
		for (const profile of profiles) {
			expect(existsSync(profile.home)).toBe(false);
			expect(existsSync(profile.profile)).toBe(false);
		}
		expect(JSON.stringify(self)).not.toContain(fixture.directory);
	});
});

describe("C08 browser request and assertion restrictions", () => {
	it("rejects redirects without producing PASS", async () => {
		const fixture = await registeredFixture();
		fixture.update({ mode: "redirect" });
		expect((await fixture.verifier.verify(fixture.request)).checks[0].status).toBe("UNAVAILABLE");
	});
	it("rejects a new external origin without producing PASS", async () => {
		const fixture = await registeredFixture();
		fixture.update({ mode: "external" });
		expect((await fixture.verifier.verify(fixture.request)).checks[0].status).toBe("UNAVAILABLE");
	});
	it("rejects unexpected subresource requests without producing PASS", async () => {
		const fixture = await registeredFixture();
		fixture.update({ mode: "subresource" });
		expect((await fixture.verifier.verify(fixture.request)).checks[0].status).toBe("UNAVAILABLE");
	});
	it("rejects JavaScript and eval assertion instructions", async () => {
		const fixture = await registrationFixture();
		for (const type of ["javascript", "eval"])
			expect(
				await fixture.command({
					type: "browser.prepare",
					registration: { ...fixture.request, assertion: { type, expected: "globalThis.document" } },
				}),
			).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
	});
	it("cannot express cookie access as an assertion or target attribute", async () => {
		const fixture = await registrationFixture();
		expect(
			await fixture.command({
				type: "browser.prepare",
				registration: { ...fixture.request, assertion: { type: "cookie_equals", expected: "secret" } },
			}),
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
		expect(() =>
			parseBrowserObservationArguments([
				"observe",
				"--url",
				documentUrl,
				"--executable",
				process.execPath,
				"--local-test-app",
				"--json",
				"--selector",
				"#status",
				"--attribute",
				"cookie",
			]),
		).toThrow(BrowserObservationError);
	});
	it("cannot express localStorage or sessionStorage access", async () => {
		const fixture = await registrationFixture();
		for (const storage of ["localStorage", "sessionStorage"])
			expect(
				await fixture.command({
					type: "browser.prepare",
					registration: { ...fixture.request, [storage]: { token: "secret" } },
				}),
			).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
	});
	it("rejects downloads without producing PASS", async () => {
		const fixture = await registeredFixture();
		fixture.update({ mode: "download" });
		expect((await fixture.verifier.verify(fixture.request)).checks[0].status).toBe("UNAVAILABLE");
	});
	it("rejects excessive decoded streaming bytes before load completion or cancellation", async () => {
		const fixture = browserFixture({ mode: "streaming-oversize" });
		await expect(fixture.capture(fixture.directory, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
			BrowserObservationError,
		);
	}, 12000);
});

describe("C08 completion authority", () => {
	it("does not accept a candidate as a CheckResult", () => {
		expect(() => validateContract(CheckResultSchema, { ...candidateData(), status: "PASS", exitCode: 0 })).toThrow();
	});
	it("cannot substitute a candidate for the independently registered verifier definition", async () => {
		const fixture = await registeredFixture();
		const forged = structuredClone(fixture.request);
		forged.checks[0].browser = fixture.candidate as never;
		await expect(fixture.verifier.verify(forged)).rejects.toThrow("changed registered checks");
		expect(fixture.profiles()).toHaveLength(1);
	});
	it("does not grant Jev DONE or candidate PASS claims Kernel completion authority", async () => {
		const fixture = await registeredFixture();
		const { kernel, events } = await kernelFixture(fixture, {
			verify: async () =>
				({ ...fixture.candidate, result: "DONE", status: "PASS" }) as unknown as VerificationResult,
			inspect: (signal) => fixture.verifier.inspect(signal),
		});
		const run = await drive(kernel);
		expect(["FAILED", "BLOCKED"]).toContain(run.status);
		expect(run.verification).toEqual([]);
		expect(events).not.toContain("RunCompleted");
	});
	it("rejects T3-supplied registration digests and forged confirmation digests", async () => {
		const fixture = await registrationFixture();
		expect(
			await fixture.command({
				type: "browser.prepare",
				registration: { ...fixture.request, registrationDigest: browserDigest("forged") },
			}),
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
		const preview = previewOf(await fixture.command({ type: "browser.prepare", registration: fixture.request }));
		expect(
			await fixture.command({
				type: "browser.confirm",
				previewId: preview.previewId,
				previewDigest: browserDigest("forged"),
			}),
		).toMatchObject({ success: false, error: { code: "PLAN_CHANGED" } });
		expect(fixture.config().verification.checks).toEqual([]);
	});
	it("blocks completion when a browser passes but another required command fails", async () => {
		const fixture = await registeredFixture({ commandExit: 1 });
		const { kernel, events } = await kernelFixture(fixture);
		const run = await drive(kernel);
		expect(run.status).toBe("BLOCKED");
		expect(run.verification.map((check) => [check.kind, check.status])).toEqual([
			["browser", "PASS"],
			["test", "FAIL"],
		]);
		expect(events).not.toContain("RunCompleted");
	});
	it("blocks a fresh browser failure after an independent Reviewer PASS", async () => {
		const fixture = await registeredFixture();
		const { kernel, events } = await kernelFixture(fixture);
		await drive(kernel, "test");
		expect(events).toContain("ReviewPassed");
		fixture.update({ value: "Broken" });
		const run = await drive(kernel);
		expect(run.status).toBe("BLOCKED");
		expect(run.verification.map((check) => [check.step?.stepId, check.status])).toEqual([
			["self-check", "PASS"],
			["test", "FAIL"],
		]);
		expect(projectEvidencePack({ run }).checks.at(-1)?.browser?.result).toBe("FAIL");
		expect(events).not.toContain("RunCompleted");
	});
});

describe("C08 frozen identity and lifecycle regressions", () => {
	it("completes only with separately captured SELF_CHECK and TEST evidence", async () => {
		const fixture = await registeredFixture();
		const { kernel, events } = await kernelFixture(fixture);
		const run = await drive(kernel);
		expect(run.status).toBe("COMPLETED");
		expect(events).toContain("RunCompleted");
		expect(new Set(run.verification.map((check) => check.browser?.captureId)).size).toBe(2);
	});
	it("refuses reused SELF_CHECK capture even if its envelope is rebound to TEST", async () => {
		const fixture = await registeredFixture();
		let first: VerificationResult;
		const { kernel, events } = await kernelFixture(fixture, {
			inspect: (signal) => fixture.verifier.inspect(signal),
			verify: async (request) => {
				if (request.step.stepId === "self-check") {
					first = await fixture.verifier.verify(request);
					return first;
				}
				const reused = structuredClone(first);
				reused.step = request.step;
				for (const check of reused.checks) {
					check.step = request.step;
					if (!check.browser) throw new Error("Missing browser fixture evidence");
					check.browser.browserEvidenceDigest = browserEvidenceDigestOf(check.browser, {
						checkId: check.id,
						runId: check.runId,
						revision: check.revision,
						step: request.step,
						diffDigest: check.diffDigest,
					});
				}
				return reused;
			},
		});
		expect((await drive(kernel)).status).toBe("BLOCKED");
		expect(kernel.snapshot.lastError).toContain("reuse");
		expect(events).not.toContain("RunCompleted");
	});
	it("never schedules automatic repair for browser assertion failure", async () => {
		const fixture = await registeredFixture({ repair: true });
		fixture.update({ value: "Broken" });
		const { kernel, events, developerCalls } = await kernelFixture(fixture);
		const run = await drive(kernel);
		expect(run.status).toBe("BLOCKED");
		expect(run.verificationRepair?.attempts).toEqual([]);
		expect(developerCalls()).toBe(1);
		expect(events).not.toContain("VerificationRepairScheduled");
	});
	it("rejects an executable replacement before launching another browser", async () => {
		const fixture = await registeredFixture();
		writeFileSync(fixture.executable, `${readFileSync(fixture.executable, "utf8")}\n// replaced\n`);
		const result = await fixture.verifier.verify(fixture.request);
		expect(result.checks[0]).toMatchObject({ status: "FAIL", trust: { status: "STALE" } });
		expect(fixture.profiles()).toHaveLength(1);
	});
	it("rejects changed Host helper sources before capture", async () => {
		const helper = browserFixture();
		writeFileSync(join(helper.directory, "reader.ts"), "export const reader = 1;\n");
		vi.spyOn(verifierTrust, "snapshotBrowserImplementation").mockImplementation(() => ({
			root: helper.directory,
			sources: verifierTrust.snapshotVerifierSources(helper.directory, ["reader.ts"]),
		}));
		const fixture = await registeredFixture();
		writeFileSync(join(helper.directory, "reader.ts"), "export const reader = 2;\n");
		expect((await fixture.verifier.verify(fixture.request)).checks[0]).toMatchObject({
			status: "FAIL",
			trust: { status: "STALE" },
		});
		expect(fixture.profiles()).toHaveLength(1);
	});
	it("rejects expired or rebound evidence while retaining historical capture provenance", async () => {
		const fixture = await registeredFixture();
		const check = (await fixture.verifier.verify(fixture.request)).checks[0];
		expect(validBrowserCheckEvidence(check, fixture.check, check.browser!.capturedAt + 15001)).toBe(false);
		const rebound = structuredClone(check);
		rebound.runId = "other-run";
		expect(validBrowserCheckEvidence(rebound, fixture.check)).toBe(false);
		expect(validBrowserCheckEvidence(check, fixture.check)).toBe(true);
	});
	it("rejects candidate symlinks without mutating the registered project configuration", async () => {
		const fixture = await registrationFixture();
		const path = join(fixture.root, ".ai/browser-candidates", `${fixture.candidate.candidateId}.json`);
		const outside = join(fixture.directory, "copied-candidate.json");
		writeFileSync(outside, readFileSync(path));
		rmSync(path);
		symlinkSync(outside, path);
		expect((await fixture.command({ type: "browser.prepare", registration: fixture.request })).success).toBe(false);
		expect(fixture.config().verification.checks).toEqual([]);
	});
	it("evaluates equality, containment, existence, absence and allowlisted attributes without code execution", () => {
		const target = { target: { selector: "#status" }, exists: true, value: "Ready now" };
		expect(evaluateBrowserAssertion({ type: "text_equals", expected: "Ready now" }, target)).toBe(true);
		expect(evaluateBrowserAssertion({ type: "text_equals", expected: "Ready" }, target)).toBe(false);
		expect(evaluateBrowserAssertion({ type: "text_contains", expected: "Ready" }, target)).toBe(true);
		expect(evaluateBrowserAssertion({ type: "text_contains", expected: "" }, target)).toBe(false);
		expect(evaluateBrowserAssertion({ type: "element_exists" }, target)).toBe(true);
		expect(evaluateBrowserAssertion({ type: "element_not_exists" }, target)).toBe(false);
		expect(evaluateBrowserAssertion({ type: "element_not_exists" }, { ...target, exists: false, value: null })).toBe(
			true,
		);
		expect(
			evaluateBrowserAssertion(
				{ type: "attribute_equals", expected: "status" },
				{ target: { selector: "#status", attribute: "role" }, exists: true, value: "status" },
			),
		).toBe(true);
	});
});
