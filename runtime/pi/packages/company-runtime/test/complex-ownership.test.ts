import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS } from "../src/agent-tools.ts";
import { capabilityJson } from "../src/capability-catalog.ts";
import {
	type ComplexLease,
	ComplexOwnershipDenied,
	ComplexOwnershipLedger,
	complexChangeDigest,
	complexOwnershipCapability,
} from "../src/complex-ownership.ts";
import { taskContext } from "../src/complex-state.ts";
import type { ComplexPlan } from "../src/complex-types.ts";
import type { RuntimeConfig } from "../src/config.ts";
import type { PolicyDecision, TaskContract, VerificationResult } from "../src/contracts.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest, ComplexWorkspaceImages, WorkspaceFileImage } from "../src/ports.ts";
import { complexConfig, complexPlanFor, FakeFiles } from "./complex-fixture.ts";

// #16 stage B (§5): exact-file task ownership in the real worker tools and the Kernel expected-image ledger.

const image = (content: string, mode = 0o644): WorkspaceFileImage => ({
	hash: createHash("sha256").update(content).digest("hex"),
	mode,
});

function capture(images: Record<string, WorkspaceFileImage | null>, changedFiles: string[] = [], safe = true) {
	return { diffDigest: createHash("sha256").update(JSON.stringify(images)).digest("hex"), safe, changedFiles, images };
}

async function ledgerFixture() {
	const files = new FakeFiles({ "src/app.ts": "app\n", "src/other.ts": "other\n", "src/obsolete.ts": "old\n" });
	const { plan } = await complexPlanFor(
		[
			{
				claims: [
					{ path: "src/app.ts", operation: "modify" },
					{ path: "src/new.ts", operation: "create" },
				],
			},
			{ claims: [{ path: "src/other.ts", operation: "modify" }] },
		],
		{ files },
	);
	const admission = capture({ "src/app.ts": image("app\n"), "src/new.ts": null, "src/other.ts": image("other\n") });
	const ledger = ComplexOwnershipLedger.admit(plan, admission);
	if (typeof ledger === "string") throw new Error(ledger);
	return { plan, ledger };
}

describe("COMPLEX expected-image ledger", () => {
	it("admits only a clean safe baseline whose claimed images fit the claim semantics", async () => {
		const { plan } = await ledgerFixture();
		const clean = { "src/app.ts": image("app\n"), "src/new.ts": null, "src/other.ts": image("other\n") };
		expect(ComplexOwnershipLedger.admit(plan, capture(clean))).toBeInstanceOf(ComplexOwnershipLedger);
		expect(ComplexOwnershipLedger.admit(plan, capture(clean, [], false))).toContain("unsafe");
		expect(ComplexOwnershipLedger.admit(plan, capture(clean, ["src/util.ts"]))).toContain("clean Run baseline");
		expect(ComplexOwnershipLedger.admit(plan, capture({ ...clean, "src/new.ts": image("exists") }))).toContain(
			"no longer fits",
		);
		expect(ComplexOwnershipLedger.admit(plan, capture({ ...clean, "src/app.ts": null }))).toContain("no longer fits");
		const { "src/other.ts": _missing, ...uncaptured } = clean;
		expect(ComplexOwnershipLedger.admit(plan, capture(uncaptured))).toContain("was not captured");
	});

	it("enforces exact ownership and operation semantics with typed denials", async () => {
		const { ledger } = await ledgerFixture();
		const lease: ComplexLease = { taskId: "CT-001", attempt: 1 };
		expect(() => ledger.authorize(lease, "src/app.ts", "edit")).toThrow("No active ownership lease");
		ledger.activate(lease);
		expect(() => ledger.activate({ taskId: "CT-002", attempt: 1 })).toThrow("Another task holds the active lease");
		const denial = (path: string, operation: Parameters<ComplexOwnershipLedger["authorize"]>[2]) => {
			try {
				ledger.authorize(lease, path, operation);
			} catch (error) {
				if (error instanceof ComplexOwnershipDenied) return error.code;
				throw error;
			}
			return "ALLOWED";
		};
		expect(denial("src/other.ts", "edit")).toBe("OWNERSHIP_CONFLICT");
		expect(denial("src/util.ts", "edit")).toBe("UNOWNED_PATH");
		expect(denial("SRC/app.ts", "edit")).toBe("UNOWNED_PATH");
		// modify: existing-file edit/replace only.
		expect(denial("src/app.ts", "edit")).toBe("ALLOWED");
		expect(denial("src/app.ts", "replace")).toBe("ALLOWED");
		expect(denial("src/app.ts", "create")).toBe("OWNERSHIP_CONFLICT");
		expect(denial("src/app.ts", "delete")).toBe("OWNERSHIP_CONFLICT");
		// A compatible write intent is allowed for either claim; the late gate resolves create vs replace.
		expect(denial("src/app.ts", "write")).toBe("ALLOWED");
		expect(denial("src/new.ts", "write")).toBe("ALLOWED");
		expect(denial("src/other.ts", "write")).toBe("OWNERSHIP_CONFLICT");
		// create: one no-clobber create, then edit/replace in the same task lineage, never recreation.
		expect(denial("src/new.ts", "edit")).toBe("OWNERSHIP_CONFLICT");
		expect(denial("src/new.ts", "create")).toBe("ALLOWED");
		ledger.recordEffect(lease, "src/new.ts", image("new\n", 0o600));
		expect(denial("src/new.ts", "create")).toBe("OWNERSHIP_CONFLICT");
		expect(denial("src/new.ts", "replace")).toBe("ALLOWED");
		const revision = { taskId: "CT-001", attempt: 2 };
		ledger.activate(revision);
		expect(() => ledger.authorize(lease, "src/new.ts", "edit")).toThrow("No active ownership lease");
		expect(() => ledger.authorize(revision, "src/new.ts", "edit")).not.toThrow();
		ledger.release();
		expect(() => ledger.authorize(revision, "src/new.ts", "edit")).toThrow("No active ownership lease");
	});

	it("V0.8A: holds one lease per implementing task with the unchanged exact denials", async () => {
		const { plan } = await ledgerFixture();
		const admission = capture({ "src/app.ts": image("app\n"), "src/new.ts": null, "src/other.ts": image("other\n") });
		const ledger = ComplexOwnershipLedger.admit(plan, admission, 2);
		if (typeof ledger === "string") throw new Error(ledger);
		const first: ComplexLease = { taskId: "CT-001", attempt: 1 };
		const second: ComplexLease = { taskId: "CT-002", attempt: 1 };
		ledger.activate(second);
		ledger.activate(first);
		expect(ledger.activeLeases).toEqual([first, second]);
		const denial = (lease: ComplexLease, path: string) => {
			try {
				ledger.authorize(lease, path, "edit");
			} catch (error) {
				if (error instanceof ComplexOwnershipDenied) return error.code;
				throw error;
			}
			return "ALLOWED";
		};
		// Each capability is checked against its own lease: a sibling's file stays OWNERSHIP_CONFLICT, running or not.
		expect(denial(first, "src/app.ts")).toBe("ALLOWED");
		expect(denial(first, "src/other.ts")).toBe("OWNERSHIP_CONFLICT");
		expect(denial(second, "src/other.ts")).toBe("ALLOWED");
		expect(denial(second, "src/app.ts")).toBe("OWNERSHIP_CONFLICT");
		expect(denial(second, "src/util.ts")).toBe("UNOWNED_PATH");
		expect(() => ledger.recordEffect(first, "src/other.ts", image("x"))).toThrow("outside the active task's claims");
		ledger.recordEffect(second, "src/other.ts", image("other v2\n"));
		// Own-claim images at a handoff: exactly the task's files, against its own recorded effects.
		expect(ledger.ownClaimsError("CT-002", { "src/other.ts": image("other v2\n") })).toBeUndefined();
		expect(ledger.ownClaimsError("CT-002", { "src/other.ts": image("other\n") })).toContain("unattributed");
		expect(ledger.ownClaimsError("CT-001", { "src/app.ts": image("app\n") })).toContain("was not captured");
		expect(ledger.ownClaimsError("CT-001", { "src/app.ts": image("app\n"), "src/new.ts": null })).toBeUndefined();
		// A REVISE attempt replaces only its own task's lease; settling one task never touches another.
		ledger.activate({ taskId: "CT-002", attempt: 2 });
		expect(() => ledger.authorize(second, "src/other.ts", "edit")).toThrow("No active ownership lease");
		ledger.release("CT-001");
		expect(() => ledger.authorize(first, "src/app.ts", "edit")).toThrow("No active ownership lease");
		expect(denial({ taskId: "CT-002", attempt: 2 }, "src/other.ts")).toBe("ALLOWED");
		// A closed capability of an aborted sibling rejects its late call while the other lease stays usable.
		const late = complexOwnershipCapability(ledger, { taskId: "CT-002", attempt: 2 }, () => {});
		late.close();
		expect(() => late.port.authorize("src/other.ts", "edit")).toThrow("closed");
		ledger.release();
		expect(ledger.activeLeases).toEqual([]);
		expect(ComplexOwnershipLedger.admit(plan, admission, 0)).toBe("Invalid lease bound");
	});

	it("reconciles captures against the expected cumulative state and detects unattributed changes", async () => {
		const { ledger } = await ledgerFixture();
		const lease = { taskId: "CT-001", attempt: 1 };
		ledger.activate(lease);
		const before = ledger.snapshot();
		ledger.recordEffect(lease, "src/app.ts", image("app v2\n"));
		const expected = { "src/app.ts": image("app v2\n"), "src/new.ts": null, "src/other.ts": image("other\n") };
		const ok = capture(expected, ["src/app.ts"]);
		expect(ledger.reconcile(ok)).toBeUndefined();
		expect(ledger.expectedWorkspaceDigest).toBe(ok.diffDigest);
		expect(ledger.reconcile(capture(expected, ["src/app.ts", "src/util.ts"]))).toContain("Unclaimed files changed");
		expect(ledger.reconcile(capture({ ...expected, "src/other.ts": image("external\n") }, ["src/app.ts"]))).toContain(
			"unattributed",
		);
		expect(ledger.reconcile(capture({ ...expected, "src/app.ts": image("app v2\n", 0o755) }))).toContain(
			"unattributed",
		);
		expect(ledger.reconcile({ ...ok, safe: false })).toContain("unsafe");
		expect(ledger.expectedWorkspaceDigest).toBe(ok.diffDigest);
		expect(ledger.changedSince(before)).toEqual(["src/app.ts"]);
		expect(ledger.changedSince(before, "CT-002")).toEqual([]);
		// §10.1 change digest: sha256 over canonical sorted [path, beforeHash, beforeMode, afterHash, afterMode].
		const tuples = [["src/app.ts", image("app\n").hash, 0o644, image("app v2\n").hash, 0o644]];
		expect(ledger.changeDigest(before, ["src/app.ts"])).toBe(
			`sha256:${createHash("sha256").update(capabilityJson(tuples)).digest("hex")}`,
		);
		ledger.recordEffect(lease, "src/new.ts", undefined);
		expect(ledger.unknown).toBe(true);
		expect(ledger.reconcile(ok)).toContain("unknown");
		expect(
			complexChangeDigest(
				["src/new.ts"],
				() => null,
				() => undefined,
			),
		).toBeNull();
	});

	it("closes the per-invocation capability and reports the first typed denial", async () => {
		const { ledger } = await ledgerFixture();
		const lease = { taskId: "CT-001", attempt: 1 };
		ledger.activate(lease);
		const denials: string[] = [];
		const capability = complexOwnershipCapability(ledger, lease, (denial) => denials.push(denial.code));
		expect(() => capability.port.authorize("src/other.ts", "edit")).toThrow(ComplexOwnershipDenied);
		expect(denials).toEqual(["OWNERSHIP_CONFLICT"]);
		capability.port.authorize("src/app.ts", "edit");
		capability.close();
		expect(() => capability.port.authorize("src/app.ts", "edit")).toThrow("closed");
		expect(() => capability.port.recordEffect("src/app.ts", image("late\n"))).toThrow("closed");
		expect(ledger.snapshot().get("src/app.ts")).toEqual(image("app\n"));
	});
});

// ------------------------------------------------------------------------------------------------------------
// Real worker tools on a real filesystem: early ownership gate before Policy/intent, late gate after the Policy
// reinspection, then the observed post-image recorded in the ledger. Reads are unaffected.
// ------------------------------------------------------------------------------------------------------------

let cwd: string;
let plan: ComplexPlan;
let parent: TaskContract;
let config: RuntimeConfig;
let ledger: ComplexOwnershipLedger;
let decisions: PolicyDecision[];
let audit: ActionAudit;
let denials: string[];
let capability: ReturnType<typeof complexOwnershipCapability>;
let worker: ReturnType<typeof createWorkerTools>;
let baseline: Map<string, WorkspaceFileImage>;

function imageOf(path: string): WorkspaceFileImage | null {
	const absolute = join(cwd, path);
	if (!existsSync(absolute)) return null;
	return {
		hash: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
		mode: lstatSync(absolute).mode & 0o777,
	};
}

/** The GitWorkspace capture encoding over the real files: claimed images plus changed files vs the baseline. */
function realCapture(): ComplexWorkspaceImages {
	const current = new Map<string, WorkspaceFileImage>();
	for (const name of readdirSync(join(cwd, "src"))) {
		const path = `src/${name}`;
		const value = imageOf(path);
		if (value) current.set(path, value);
	}
	const changedFiles = [...new Set([...baseline.keys(), ...current.keys()])]
		.filter((path) => JSON.stringify(baseline.get(path)) !== JSON.stringify(current.get(path)))
		.sort();
	const images: ComplexWorkspaceImages["images"] = {};
	for (const path of new Set([...ComplexOwnershipLedger.claimPaths(plan), ...changedFiles]))
		images[path] = current.get(path) ?? null;
	return {
		diffDigest: createHash("sha256")
			.update(JSON.stringify([...current]))
			.digest("hex"),
		safe: true,
		changedFiles,
		images,
	};
}

function policy(): PolicyContext {
	return {
		executionMode: "EDIT",
		executionRunId: "run",
		tools: WORKER_FILE_TOOLS,
		allowedPaths: ["src"],
		configDigest: "frozen-policy",
	};
}

function request(taskId = "CT-001", overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
	const index = plan.tasks.findIndex((task) => task.id === taskId);
	return {
		executionMode: "EDIT",
		runId: "run",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: parent,
		role: "Developer",
		profile: "coding",
		complexContext: taskContext(plan, taskId, 1),
		complexTask: {
			task: plan.tasks[index],
			otherClaims: plan.tasks
				.filter((task) => task.id !== taskId)
				.flatMap((task) => task.ownership.map((claim) => ({ taskId: task.id, ...claim }))),
		},
		ownership: capability.port,
		...overrides,
	} as AgentExecutionRequest;
}

async function tools(value: AgentExecutionRequest = request(), mutation: "compatible" | "strict" = "compatible") {
	worker = createWorkerTools({
		cwd,
		request: value,
		config: { ...config, mutation: { mode: mutation } },
		policy: policy(),
		audit,
		signal: new AbortController().signal,
		paths: await FilePolicyPathInspector.open(cwd),
		assertActive: () => {},
	});
}

async function call(name: string, params: Record<string, unknown>, id = "call") {
	const tool = worker.tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Tool unavailable: ${name}`);
	const result = await tool.execute(id, params, new AbortController().signal, undefined, {} as ExtensionContext);
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-complex-owner-")));
	mkdirSync(join(cwd, "src"));
	writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
	writeFileSync(join(cwd, "src/other.ts"), "other()\n");
	writeFileSync(join(cwd, "src/free.ts"), "free()\n");
	config = complexConfig();
	const files = new FakeFiles({ "src/app.ts": "", "src/other.ts": "", "src/free.ts": "" });
	({ plan, parent } = await complexPlanFor(
		[
			{
				claims: [
					{ path: "src/app.ts", operation: "modify" },
					{ path: "src/new.ts", operation: "create" },
				],
			},
			{ claims: [{ path: "src/other.ts", operation: "modify" }] },
		],
		{ files, config },
	));
	baseline = new Map();
	for (const name of readdirSync(join(cwd, "src"))) baseline.set(`src/${name}`, imageOf(`src/${name}`)!);
	const admitted = ComplexOwnershipLedger.admit(plan, realCapture());
	if (typeof admitted === "string") throw new Error(admitted);
	ledger = admitted;
	ledger.activate({ taskId: "CT-001", attempt: 1 });
	denials = [];
	capability = complexOwnershipCapability(ledger, { taskId: "CT-001", attempt: 1 }, (denial) =>
		denials.push(denial.code),
	);
	decisions = [];
	audit = {
		prepare: vi.fn(async (decision: PolicyDecision) => {
			decisions.push(decision);
		}),
		finish: vi.fn(async () => {}),
		assertWritable: vi.fn(async () => {}),
	};
	await tools();
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("COMPLEX ownership gates in worker tools", () => {
	it("writes and edits only its own claims, and the ledger reconciles with the real capture", async () => {
		await call("runtime_write", { path: "src/new.ts", content: "created\n" });
		await call("runtime_edit", { path: "src/app.ts", oldText: "foo()\nfoo()", newText: "bar()\nfoo()" });
		expect(readFileSync(join(cwd, "src/new.ts"), "utf8")).toBe("created\n");
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("bar()\nfoo()\n");
		expect(ledger.reconcile(realCapture())).toBeUndefined();
		expect(ledger.changedSince(ledger.baselineSnapshot())).toEqual(["src/app.ts", "src/new.ts"]);
		expect(decisions.map((decision) => decision.decision)).toEqual(["ALLOW", "ALLOW"]);
		expect(worker.denialCode()).toBeUndefined();
	});

	it.each([
		["another task's claim", "src/other.ts", "OWNERSHIP_CONFLICT"],
		["an unclaimed file", "src/free.ts", "UNOWNED_PATH"],
	])("denies %s before Policy, intent or effect (C03/C04)", async (_name, path, code) => {
		const before = readFileSync(join(cwd, path), "utf8");
		await expect(call("runtime_write", { path, content: "overwrite\n" })).rejects.toThrow(code);
		await expect(call("runtime_edit", { path, oldText: before.trim(), newText: "x" })).rejects.toThrow(code);
		expect(readFileSync(join(cwd, path), "utf8")).toBe(before);
		expect(audit.prepare).not.toHaveBeenCalled();
		expect(worker.denialCode()).toBe(code);
		expect(worker.fatalToolError()).toContain(code);
		expect(denials[0]).toBe(code);
		expect(ledger.reconcile(realCapture())).toBeUndefined();
	});

	it("keeps reads unaffected by ownership", async () => {
		expect(await call("runtime_read", { path: "src/other.ts" })).toContain("other()");
		expect(worker.denialCode()).toBeUndefined();
	});

	it("enforces create/modify operation semantics under strict mutation", async () => {
		await tools(request(), "strict");
		await expect(
			call("runtime_write", { path: "src/app.ts", content: "x\n", operation: "create", mustNotExist: true }),
		).rejects.toThrow("OWNERSHIP_CONFLICT");
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("foo()\nfoo()\n");
		await tools(request(), "strict");
		await call("runtime_write", { path: "src/new.ts", content: "one\n", operation: "create", mustNotExist: true });
		await tools(request(), "strict");
		await expect(
			call("runtime_write", { path: "src/new.ts", content: "two\n", operation: "create", mustNotExist: true }),
		).rejects.toThrow("OWNERSHIP_CONFLICT");
		expect(readFileSync(join(cwd, "src/new.ts"), "utf8")).toBe("one\n");
		expect(ledger.reconcile(realCapture())).toBeUndefined();
	});

	it("rejects a late tool call after the invocation settled, with no effect", async () => {
		capability.close();
		await expect(call("runtime_write", { path: "src/new.ts", content: "late\n" })).rejects.toThrow("closed");
		expect(existsSync(join(cwd, "src/new.ts"))).toBe(false);
	});

	it("refuses a COMPLEX mutation without the Kernel-bound capability", async () => {
		await tools(request("CT-001", { ownership: undefined }));
		await expect(call("runtime_write", { path: "src/new.ts", content: "x\n" })).rejects.toThrow(
			"ownership capability",
		);
		expect(existsSync(join(cwd, "src/new.ts"))).toBe(false);
	});

	it("attaches the Kernel context to the handoff and requires the actual changed files", async () => {
		await call("runtime_write", { path: "src/new.ts", content: "created\n" });
		const handoff = {
			runId: "run",
			revision: 0,
			role: "Developer",
			task: parent.id,
			changed_files: [],
			summary: "Done",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		};
		await expect(call("submit_handoff", handoff, "first")).rejects.toThrow('["src/new.ts"]');
		expect(worker.consumeSubmissionValidationError("submit_handoff", "first")).toBe(true);
		await expect(
			call("submit_handoff", { ...handoff, complexContext: taskContext(plan, "CT-002", 1) }),
		).rejects.toThrow();
		await call("submit_handoff", { ...handoff, changed_files: ["src/new.ts"] }, "second");
		const result = worker.result();
		expect(result).toMatchObject({
			role: "Developer",
			handoff: { changed_files: ["src/new.ts"], complexContext: taskContext(plan, "CT-001", 1) },
		});
	});

	it("keeps STANDARD tool schemas and handoffs free of COMPLEX identity", async () => {
		await tools({
			executionMode: "EDIT",
			runId: "run",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			task: parent,
			role: "Developer",
			profile: "coding",
		});
		const submit = worker.tools.find((tool) => tool.name === "submit_handoff");
		expect(JSON.stringify(submit?.parameters)).not.toContain("complexContext");
		await call("runtime_write", { path: "src/free.ts", content: "standard\n" });
		expect(readFileSync(join(cwd, "src/free.ts"), "utf8")).toBe("standard\n");
		await call("submit_handoff", {
			runId: "run",
			revision: 0,
			role: "Developer",
			task: parent.id,
			changed_files: ["src/free.ts"],
			summary: "Done",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		});
		expect("complexContext" in (worker.result() as { handoff: object }).handoff).toBe(false);
	});

	it("submits a task contribution review of exactly the mapped criteria with the Kernel context", async () => {
		const verification: VerificationResult = {
			runId: "run",
			revision: 0,
			step: { stepId: "self-check", attempt: 1 },
			complexContext: taskContext(plan, "CT-001", 1),
			diffDigest: "d".repeat(64),
			evidenceRefs: ["diff:d"],
			checks: [],
		};
		const reviewer = {
			...request(),
			role: "Reviewer",
			profile: "reasoning",
			step: { stepId: "review", attempt: 1 },
			ownership: undefined,
			handoff: {
				runId: "run",
				revision: 0,
				role: "Developer",
				task: parent.id,
				changed_files: [],
				summary: "Done",
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
				complexContext: taskContext(plan, "CT-001", 1),
			},
			verification,
		} as AgentExecutionRequest;
		await tools(reviewer);
		const base = {
			runId: "run",
			revision: 0,
			role: "Reviewer",
			task: parent.id,
			result: "PASS",
			issues: [],
			evidenceRefs: ["diff:d"],
			diffDigest: "d".repeat(64),
		};
		await expect(
			call("submit_review", {
				...base,
				criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["diff:d"] }],
			}),
		).rejects.toThrow();
		await call("submit_review", {
			...base,
			criteria: plan.tasks[0].criterionIds.map((criterionId) => ({
				criterionId,
				status: "SUPPORTED",
				evidenceRefs: ["diff:d"],
			})),
		});
		expect(worker.result()).toMatchObject({
			role: "Reviewer",
			contribution: { result: "PASS", complexContext: taskContext(plan, "CT-001", 1) },
		});
	});
});

describe("COMPLEX R3 deletion tool", () => {
	it("gates the single deletion by ownership before any Approval request, then records the absence", async () => {
		writeFileSync(join(cwd, "src/obsolete.ts"), "old\n");
		mkdirSync(join(cwd, ".ai"));
		const r3Config = complexConfig();
		writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(r3Config));
		const files = new FakeFiles({ "src/obsolete.ts": "old\n" });
		const r3 = await complexPlanFor(
			[
				{ claims: [{ path: "src/obsolete.ts", operation: "delete" }], criteria: [1] },
				{ claims: [], criteria: [1] },
			],
			{ files, goal: "Delete file src/obsolete.ts", risk: "R3", statements: ["Removed"], config: r3Config },
		);
		plan = r3.plan;
		parent = r3.parent;
		baseline.set("src/obsolete.ts", imageOf("src/obsolete.ts")!);
		const admitted = ComplexOwnershipLedger.admit(plan, realCapture());
		if (typeof admitted === "string") throw new Error(admitted);
		const r3Ledger = admitted;
		const r3Policy: PolicyContext = {
			...policy(),
			tools: [...WORKER_FILE_TOOLS, { id: "runtime_delete", operation: "delete" }],
			r3Scope: { runId: "run", targetPath: "src/obsolete.ts" },
		};
		const onApprovalRequested = vi.fn(
			async (proposal: Parameters<NonNullable<AgentExecutionRequest["onApprovalRequested"]>>[0]) => ({
				runId: proposal.runId,
				actionId: proposal.actionId,
				actionDigest: proposal.actionDigest,
				configDigest: proposal.configDigest,
				expiresAt: Date.now() + 10_000,
				approved: true,
			}),
		);
		const onApprovalConsumed = vi.fn(async () => {});
		// Task 2 (read-only) cannot request the deletion: denied before any Approval request or effect.
		r3Ledger.activate({ taskId: "CT-002", attempt: 1 });
		const second = complexOwnershipCapability(r3Ledger, { taskId: "CT-002", attempt: 1 }, () => {});
		const secondTools = createWorkerTools({
			cwd,
			request: {
				...request("CT-002"),
				ownership: second.port,
				onApprovalRequested,
				onApprovalConsumed,
			} as AgentExecutionRequest,
			config: r3Config,
			policy: r3Policy,
			audit,
			signal: new AbortController().signal,
			paths: await FilePolicyPathInspector.open(cwd),
			assertActive: () => {},
		});
		const remove = secondTools.tools.find((tool) => tool.name === "runtime_delete");
		await expect(
			remove!.execute(
				"d",
				{ path: "src/obsolete.ts" },
				new AbortController().signal,
				undefined,
				{} as ExtensionContext,
			),
		).rejects.toThrow("OWNERSHIP_CONFLICT");
		expect(onApprovalRequested).not.toHaveBeenCalled();
		expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(true);
		expect(secondTools.denialCode()).toBe("OWNERSHIP_CONFLICT");
		second.close();
		r3Ledger.release();
		// Task 1 owns the delete claim: Approval, exact deletion, recorded absence and one consumption.
		r3Ledger.activate({ taskId: "CT-001", attempt: 1 });
		const first = complexOwnershipCapability(r3Ledger, { taskId: "CT-001", attempt: 1 }, () => {});
		const firstTools = createWorkerTools({
			cwd,
			request: {
				...request("CT-001"),
				ownership: first.port,
				onApprovalRequested,
				onApprovalConsumed,
			} as AgentExecutionRequest,
			config: r3Config,
			policy: r3Policy,
			audit,
			signal: new AbortController().signal,
			paths: await FilePolicyPathInspector.open(cwd),
			assertActive: () => {},
		});
		await firstTools.tools
			.find((tool) => tool.name === "runtime_delete")!
			.execute("d", { path: "src/obsolete.ts" }, new AbortController().signal, undefined, {} as ExtensionContext);
		expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(false);
		expect(onApprovalRequested).toHaveBeenCalledOnce();
		expect(onApprovalRequested.mock.calls[0][0].complexContext).toEqual(taskContext(plan, "CT-001", 1));
		expect(onApprovalConsumed).toHaveBeenCalledOnce();
		expect(r3Ledger.snapshot().get("src/obsolete.ts")).toBeNull();
		expect(r3Ledger.reconcile(realCapture())).toBeUndefined();
	});
});
