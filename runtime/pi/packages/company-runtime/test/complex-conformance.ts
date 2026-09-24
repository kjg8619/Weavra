import { createHash } from "node:crypto";
import { maxComplexExecution } from "../src/complex-plan.ts";
import { projectComplexExecution } from "../src/complex-state.ts";
import { isTaskContract, type Run } from "../src/contracts.ts";
import { projectHostEvidence, projectHostGraph, projectHostRun } from "../src/host-bridge-projections.ts";
import type { HostControlCapabilities, HostControlState } from "../src/host-control-protocol.ts";

/**
 * Runtime-side restatement of every rule the App consumer applies before it publishes a Host Control observation:
 * the strict wire decoder (app/t3code/packages/contracts/src/weavraControl.ts), the COMPLEX cross-field checks
 * (app/t3code/apps/server/src/weavra/ComplexProjection.ts) and the snapshot envelope checks
 * (RuntimeController.consistent). Kept in sync with the V0.8A #21 App (contract v2, PARALLEL_AGENTS.md §8, its
 * Amendment A1 for terminal historical v1 plans and the atomic-save rules). This Runtime advertises exactly contract
 * version 2, so only the v2 shapes are restated. App code is never imported across build roots: each rule is
 * re-stated here, so a Runtime projection the App would reject (and show COMPLEX as unavailable) fails a Runtime
 * test instead.
 */

type Json = Record<string, unknown>;
type Issues = string[];

/** One checked control observation: the snapshot state, the connection capabilities and, if known, the envelope. */
export interface ComplexObservation {
	capabilities: Pick<HostControlCapabilities, "complexContractVersion">;
	state: HostControlState;
	response?: { ownerId: string; runId: string | null; stateRevision: number | null; projectRevision: number | null };
}

// --- Canonical material (the App's own digest implementations, restated) -------------------------------------

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Json;
		return `{${Object.keys(record)
			.sort()
			.map((key) => {
				if (record[key] === undefined) throw new Error("Canonical JSON rejects undefined");
				return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
			})
			.join(",")}}`;
	}
	throw new Error("Canonical JSON rejects unsupported values");
}
const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const sameList = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length && left.every((value, index) => value === right[index]);
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

interface CriterionMaterial {
	id: string;
	statement: string;
	paths: readonly string[];
	checkIds: readonly string[];
	reviewRequired: boolean;
}
/** The Runtime `taskContractDigest`: key order of this JSON.stringify material is digest input. */
function contractDigest(id: string, goal: string, criteria: readonly CriterionMaterial[]): string {
	return sha256(
		JSON.stringify({
			id,
			goal,
			acceptanceCriteria: criteria.map((criterion) => ({
				id: criterion.id,
				statement: criterion.statement,
				scope: { paths: criterion.paths },
				verification: { checkIds: criterion.checkIds, reviewRequired: criterion.reviewRequired },
			})),
		}),
	);
}
function parentDigest(parent: WireParent): string {
	return contractDigest(
		parent.id,
		parent.goal,
		parent.acceptanceCriteria.map((criterion) => ({
			id: criterion.id,
			statement: criterion.statement,
			paths: criterion.scope.paths,
			checkIds: criterion.verification.checkIds,
			reviewRequired: criterion.verification.reviewRequired,
		})),
	);
}
/** Each plan version hashes in its own domain; a historical v1 plan is recomputed in the v1 domain (A1). */
function planDigest(plan: WirePlan): string {
	const { complexPlanDigest: _excluded, ...material } = plan;
	return sha256(
		canonicalJson([plan.schemaVersion === 1 ? "weavra-complex-plan-v1" : "weavra-complex-plan-v2", material]),
	);
}
/** v1 plans run one task at a time. */
const maxParallelOf = (plan: WirePlan) => (plan.schemaVersion === 2 ? (plan.limits.maxParallel ?? 0) : 1);
/** v1 plans, and v2 plans frozen to one worker, schedule only the next row after every earlier one. */
const sequential = (plan: WirePlan) => maxParallelOf(plan) === 1;

// --- Strict decoder (weavraControl.ts), restated field by field -----------------------------------------------

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const WORKSPACE_DIGEST = /^[0-9a-f]{64}$/;
const TASK_ID = /^CT-00[1-8]$/;
const CRITERION_ID = /^AC-[0-9]{3}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TASK_STATUSES_V1 = [
	"PENDING",
	"ELIGIBLE",
	"IMPLEMENTING",
	"WAITING_APPROVAL",
	"SELF_CHECK",
	"REVIEW",
	"TEST",
	"STOPPING",
	"COMPLETED",
	"BLOCKED",
	"FAILED",
	"CANCELLED",
	"INTERRUPTED",
];
/** v2 adds HANDED_OFF: implemented, waiting for its verification turn. */
const TASK_STATUSES = [...TASK_STATUSES_V1, "HANDED_OFF"];
const PHASES = [
	"TASK_SEQUENCE",
	"INTEGRATION_CHECK",
	"FINAL_REVIEW",
	"FINAL_TEST",
	"COMPLETING",
	"STOPPING",
	"TERMINAL",
];
const CLEANUP = ["NOT_REQUESTED", "PENDING", "CONFIRMED", "UNCONFIRMED"];
const FAILURE_CODES = [
	"OWNERSHIP_CONFLICT",
	"UNOWNED_PATH",
	"DEPENDENCY_NOT_COMPLETED",
	"RUN_STOPPED",
	"WORKER_FAILED",
	"INVALID_RESULT",
	"POLICY_DENIED",
	"CHECK_FAILED",
	"CHECK_UNAVAILABLE",
	"REVIEW_BLOCKED",
	"REVIEW_MISSING",
	"STALE_EVIDENCE",
	"PARENT_MISMATCH",
	"PLAN_MISMATCH",
	"BUDGET_EXHAUSTED",
	"BUDGET_UNKNOWN",
	"REVISION_LIMIT",
	"APPROVAL_DENIED",
	"APPROVAL_EXPIRED",
	"APPROVAL_INVALID",
	"EXTERNAL_MUTATION",
	"CANCELLED",
	"OWNER_LOST",
	"CLEANUP_UNCONFIRMED",
	"STORAGE_FAILED",
];
const CHECK_GATES = ["NOT_RUN", "RUNNING", "PASS", "FAIL", "UNAVAILABLE", "STALE"];
const REVIEW_GATES = ["NOT_RUN", "RUNNING", "PASS", "REVISE", "BLOCK", "UNAVAILABLE", "STALE"];
const FRESHNESS = ["NONE", "CURRENT", "STALE", "UNKNOWN"];
const GRAPH_KINDS = ["preflight", "agent", "verification", "review", "completion", "approval", "mutation"];
const GRAPH_STATUSES = [
	"pending",
	"running",
	"passed",
	"failed",
	"blocked",
	"cancelled",
	"skipped",
	"waiting_approval",
	"revised",
	"unknown",
];
const GRAPH_EDGES = ["sequence", "pass", "revise", "next_attempt", "contains", "approved"];
const STEP_IDS = ["implement", "self-check", "review", "test", "complete"];
const encoder = new TextEncoder();
const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

const isRecord = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isCounter = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isText = (value: unknown, max: number, nonBlank = true): value is string =>
	typeof value === "string" && value.length >= 1 && value.length <= max && (!nonBlank || /\S/.test(value));
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && pattern.test(value);
const oneOf = (value: unknown, values: readonly string[]) => typeof value === "string" && values.includes(value);
/** Unique and ascending in code-unit order (ASCII order for ASCII values). */
const ascending = (values: readonly string[]) =>
	values.every((value, index) => index === 0 || values[index - 1] < value);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

/** App lexical exact-file rule (the Runtime additionally inspects the filesystem). */
function isExactFilePath(path: unknown): path is string {
	if (typeof path !== "string" || path.length < 1 || path.length > 256) return false;
	if (encoder.encode(path).byteLength > 256 || /^[A-Za-z]:/.test(path)) return false;
	for (const character of path) {
		const code = character.codePointAt(0) ?? 0;
		if (
			code <= 0x1f ||
			code === 0x7f ||
			code === 0x200e ||
			code === 0x200f ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			["\\", "*", "?", "[", "]", "{", "}"].includes(character)
		)
			return false;
	}
	return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Closed object: every required key present and no unknown key (`onExcessProperty: "error"`). */
function closed(
	value: unknown,
	path: string,
	keys: readonly string[],
	issues: Issues,
	optional: readonly string[] = [],
): value is Json {
	if (!isRecord(value)) {
		issues.push(`${path}: expected an object`);
		return false;
	}
	for (const key of keys) if (!Object.hasOwn(value, key)) issues.push(`${path}.${key}: missing`);
	for (const key of Object.keys(value))
		if (!keys.includes(key) && !optional.includes(key)) issues.push(`${path}.${key}: unknown field rejected`);
	return keys.every((key) => Object.hasOwn(value, key));
}
function rule(issues: Issues, ok: boolean, path: string, message: string) {
	if (!ok) issues.push(`${path}: ${message}`);
}
function stringArray(
	value: unknown,
	path: string,
	issues: Issues,
	options: { min?: number; max: number; item: (item: unknown) => boolean; order?: "ascending" | "unique" },
): value is string[] {
	if (!Array.isArray(value)) {
		issues.push(`${path}: expected an array`);
		return false;
	}
	rule(issues, value.length >= (options.min ?? 0) && value.length <= options.max, path, "length out of bounds");
	rule(issues, value.every(options.item), path, "invalid item");
	if (options.order === "ascending")
		rule(issues, value.every((item) => typeof item === "string") && ascending(value), path, "not unique ascending");
	if (options.order === "unique") rule(issues, unique(value), path, "duplicate items");
	return value.every((item) => typeof item === "string");
}

interface WireParent {
	id: string;
	goal: string;
	acceptanceCriteria: Array<{
		id: string;
		statement: string;
		scope: { paths: string[] };
		verification: { checkIds: string[]; reviewRequired: boolean };
	}>;
	status: string;
}
interface WireTask {
	id: string;
	title: string;
	goal: string;
	dependsOn: string[];
	criterionIds: string[];
	ownership: Array<{ path: string; operation: string }>;
	checkIds: string[];
	maxRevisionCycles: number;
}
interface WirePlan {
	/** 2, or 1 only for a terminal historical V0.7B Run inside a v2 execution (Amendment A1). */
	schemaVersion: 1 | 2;
	planId: string;
	complexPlanDigest: string;
	parentTaskId: string;
	parentTaskContractDigest: string;
	tasks: WireTask[];
	integration: { criterionIds: string[]; checkIds: string[]; reviewRequired: true; finalChecksRequired: true };
	limits: {
		maxTasks: 8;
		maxWorkerInvocations: number;
		maxReportedTokens: number;
		maxTotalRevisionCycles: number;
		/** v2 only. */
		maxParallel?: number;
	};
}
interface WireRow {
	id: string;
	status: string;
	attempt: number;
	revisionCycle: number;
	workerInvocations: number;
	reportedTokens: number | null;
	entryWorkspaceDigest: string | null;
	exitWorkspaceDigest: string | null;
	changedFiles: string[];
	changesUnknown: boolean;
	selfCheck: string;
	review: string;
	test: string;
	evidenceFreshness: string;
	failureCode: string | null;
}
interface WireExecution {
	schemaVersion: 2;
	ownerId: string;
	projectRevision: number;
	runId: string;
	stateRevision: number;
	parent: WireParent;
	plan: WirePlan;
	phase: string;
	activeTaskIds: string[];
	tasks: WireRow[];
	integration: {
		check: string;
		review: string;
		test: string;
		workspaceDigest: string | null;
		evidenceFreshness: string;
		failureCode: string | null;
	};
	budget: { workerInvocations: number; reportedTokens: number | null; totalRevisionCycles: number; status: string };
	cleanup: string;
	partialChanges: boolean;
	changesUnknown: boolean;
	failureCode: string | null;
}

function claimShape(value: unknown, path: string, issues: Issues) {
	if (!closed(value, path, ["path", "operation"], issues)) return;
	rule(issues, isExactFilePath(value.path), `${path}.path`, "not an exact canonical project-relative file");
	rule(issues, oneOf(value.operation, ["modify", "create", "delete"]), `${path}.operation`, "unknown operation");
}

function planShape(value: unknown, path: string, issues: Issues): value is WirePlan {
	const before = issues.length;
	const keys = [
		"schemaVersion",
		"planId",
		"complexPlanDigest",
		"parentTaskId",
		"parentTaskContractDigest",
		"tasks",
		"integration",
		"limits",
	];
	if (!closed(value, path, keys, issues)) return false;
	rule(issues, value.schemaVersion === 1 || value.schemaVersion === 2, `${path}.schemaVersion`, "must be 1 or 2");
	rule(issues, matches(value.planId, UUID), `${path}.planId`, "not a canonical lowercase UUID");
	rule(issues, matches(value.complexPlanDigest, DIGEST), `${path}.complexPlanDigest`, "not a digest");
	rule(issues, matches(value.parentTaskId, IDENTIFIER), `${path}.parentTaskId`, "not an identifier");
	rule(issues, matches(value.parentTaskContractDigest, DIGEST), `${path}.parentTaskContractDigest`, "not a digest");
	const tasks = value.tasks;
	if (!Array.isArray(tasks)) issues.push(`${path}.tasks: expected an array`);
	else {
		rule(issues, tasks.length >= 2 && tasks.length <= 8, `${path}.tasks`, "2-8 tasks");
		for (const [index, task] of tasks.entries()) {
			const at = `${path}.tasks[${index}]`;
			const taskKeys = [
				"id",
				"title",
				"goal",
				"dependsOn",
				"criterionIds",
				"ownership",
				"checkIds",
				"maxRevisionCycles",
			];
			if (!closed(task, at, taskKeys, issues)) continue;
			rule(issues, matches(task.id, TASK_ID), `${at}.id`, "not a task ID");
			rule(issues, isText(task.title, 80), `${at}.title`, "1-80 nonblank characters");
			rule(issues, isText(task.goal, 300), `${at}.goal`, "1-300 nonblank characters");
			stringArray(task.dependsOn, `${at}.dependsOn`, issues, {
				max: 7,
				item: (item) => matches(item, TASK_ID),
				order: "unique",
			});
			stringArray(task.criterionIds, `${at}.criterionIds`, issues, {
				min: 1,
				max: 16,
				item: (item) => matches(item, CRITERION_ID),
				order: "ascending",
			});
			if (!Array.isArray(task.ownership)) issues.push(`${at}.ownership: expected an array`);
			else {
				rule(issues, task.ownership.length <= 16, `${at}.ownership`, "at most 16 claims");
				task.ownership.forEach((claim, claimIndex) => {
					claimShape(claim, `${at}.ownership[${claimIndex}]`, issues);
				});
				const paths = task.ownership.map((claim) => (isRecord(claim) ? claim.path : undefined));
				rule(
					issues,
					paths.every((item) => typeof item === "string") && ascending(paths as string[]),
					`${at}.ownership`,
					"claims not unique ascending by path",
				);
			}
			stringArray(task.checkIds, `${at}.checkIds`, issues, {
				min: 1,
				max: 16,
				item: (item) => matches(item, IDENTIFIER),
				order: "ascending",
			});
			rule(
				issues,
				isCounter(task.maxRevisionCycles) && task.maxRevisionCycles <= 2,
				`${at}.maxRevisionCycles`,
				"0-2",
			);
		}
	}
	if (
		closed(
			value.integration,
			`${path}.integration`,
			["criterionIds", "checkIds", "reviewRequired", "finalChecksRequired"],
			issues,
		)
	) {
		const integration = value.integration as Json;
		stringArray(integration.criterionIds, `${path}.integration.criterionIds`, issues, {
			min: 1,
			max: 16,
			item: (item) => matches(item, CRITERION_ID),
			order: "ascending",
		});
		stringArray(integration.checkIds, `${path}.integration.checkIds`, issues, {
			min: 1,
			max: 16,
			item: (item) => matches(item, IDENTIFIER),
			order: "ascending",
		});
		rule(issues, integration.reviewRequired === true, `${path}.integration.reviewRequired`, "must be true");
		rule(issues, integration.finalChecksRequired === true, `${path}.integration.finalChecksRequired`, "must be true");
	}
	const limitKeys = [
		"maxTasks",
		"maxWorkerInvocations",
		"maxReportedTokens",
		"maxTotalRevisionCycles",
		...(value.schemaVersion === 2 ? ["maxParallel"] : []),
	];
	if (closed(value.limits, `${path}.limits`, limitKeys, issues)) {
		const limits = value.limits as Json;
		rule(issues, limits.maxTasks === 8, `${path}.limits.maxTasks`, "must be 8");
		if (value.schemaVersion === 2)
			rule(
				issues,
				isCounter(limits.maxParallel) && limits.maxParallel >= 1 && limits.maxParallel <= 4,
				`${path}.limits.maxParallel`,
				"1-4",
			);
		rule(
			issues,
			isCounter(limits.maxWorkerInvocations) &&
				limits.maxWorkerInvocations >= 1 &&
				limits.maxWorkerInvocations <= 24,
			`${path}.limits.maxWorkerInvocations`,
			"1-24",
		);
		rule(
			issues,
			isCounter(limits.maxReportedTokens) && limits.maxReportedTokens >= 1 && limits.maxReportedTokens <= 200_000,
			`${path}.limits.maxReportedTokens`,
			"1-200000",
		);
		rule(
			issues,
			isCounter(limits.maxTotalRevisionCycles) && limits.maxTotalRevisionCycles <= 3,
			`${path}.limits.maxTotalRevisionCycles`,
			"0-3",
		);
	}
	if (issues.length !== before) return false;
	// Plan-level filter of the App decoder.
	const plan = value as unknown as WirePlan;
	const paths = plan.tasks.flatMap((task) => task.ownership.map((claim) => claim.path));
	rule(issues, jsonBytes(plan) <= 12_288, path, "plan exceeds 12,288 UTF-8 bytes");
	rule(issues, paths.length <= 64 && unique(paths), path, "at most 64 globally unique claims");
	plan.tasks.forEach((task, index) => {
		rule(issues, task.id === `CT-00${index + 1}`, `${path}.tasks[${index}].id`, "not contiguous plan order");
		rule(
			issues,
			task.maxRevisionCycles <= plan.limits.maxTotalRevisionCycles,
			`${path}.tasks[${index}].maxRevisionCycles`,
			"exceeds the total revision limit",
		);
		rule(
			issues,
			task.dependsOn.every((dependency) => dependency < task.id),
			`${path}.tasks[${index}].dependsOn`,
			"must reference earlier tasks",
		);
	});
	return issues.length === before;
}

function parentShape(value: unknown, path: string, issues: Issues): value is WireParent {
	const before = issues.length;
	if (!closed(value, path, ["id", "goal", "acceptanceCriteria", "status"], issues)) return false;
	rule(issues, matches(value.id, IDENTIFIER), `${path}.id`, "not an identifier");
	rule(issues, isText(value.goal, 2048), `${path}.goal`, "1-2048 nonblank characters");
	rule(issues, oneOf(value.status, ["pending", "inProgress", "completed", "blocked"]), `${path}.status`, "unknown");
	const criteria = value.acceptanceCriteria;
	if (!Array.isArray(criteria)) issues.push(`${path}.acceptanceCriteria: expected an array`);
	else {
		rule(issues, criteria.length >= 1 && criteria.length <= 16, `${path}.acceptanceCriteria`, "1-16 criteria");
		for (const [index, criterion] of criteria.entries()) {
			const at = `${path}.acceptanceCriteria[${index}]`;
			if (!closed(criterion, at, ["id", "statement", "scope", "verification"], issues)) continue;
			rule(issues, matches(criterion.id, CRITERION_ID), `${at}.id`, "not an AC ID");
			rule(issues, isText(criterion.statement, 500), `${at}.statement`, "1-500 nonblank characters");
			if (closed(criterion.scope, `${at}.scope`, ["paths"], issues))
				stringArray((criterion.scope as Json).paths, `${at}.scope.paths`, issues, {
					max: 32,
					item: (item) => isText(item, 256) && encoder.encode(item as string).byteLength <= 256,
					order: "unique",
				});
			if (closed(criterion.verification, `${at}.verification`, ["checkIds", "reviewRequired"], issues)) {
				const verification = criterion.verification as Json;
				stringArray(verification.checkIds, `${at}.verification.checkIds`, issues, {
					max: 16,
					item: (item) => matches(item, IDENTIFIER),
					order: "unique",
				});
				rule(
					issues,
					typeof verification.reviewRequired === "boolean",
					`${at}.verification.reviewRequired`,
					"boolean",
				);
			}
		}
	}
	return issues.length === before;
}

const nullOr = (value: unknown, test: (value: unknown) => boolean) => value === null || test(value);

function rowShape(value: unknown, path: string, issues: Issues, statuses: readonly string[]) {
	const keys = [
		"id",
		"status",
		"attempt",
		"revisionCycle",
		"workerInvocations",
		"reportedTokens",
		"entryWorkspaceDigest",
		"exitWorkspaceDigest",
		"changedFiles",
		"changesUnknown",
		"selfCheck",
		"review",
		"test",
		"evidenceFreshness",
		"failureCode",
	];
	if (!closed(value, path, keys, issues)) return;
	rule(issues, matches(value.id, TASK_ID), `${path}.id`, "not a task ID");
	rule(issues, oneOf(value.status, statuses), `${path}.status`, "unknown status");
	rule(issues, isCounter(value.attempt) && value.attempt <= 3, `${path}.attempt`, "0-3");
	rule(issues, isCounter(value.revisionCycle) && value.revisionCycle <= 2, `${path}.revisionCycle`, "0-2");
	rule(issues, isCounter(value.workerInvocations) && value.workerInvocations <= 6, `${path}.workerInvocations`, "0-6");
	rule(issues, nullOr(value.reportedTokens, isCounter), `${path}.reportedTokens`, "counter or null");
	for (const key of ["entryWorkspaceDigest", "exitWorkspaceDigest"])
		rule(
			issues,
			nullOr(value[key], (item) => matches(item, WORKSPACE_DIGEST)),
			`${path}.${key}`,
			"digest or null",
		);
	stringArray(value.changedFiles, `${path}.changedFiles`, issues, {
		max: 16,
		item: isExactFilePath,
		order: "ascending",
	});
	rule(issues, typeof value.changesUnknown === "boolean", `${path}.changesUnknown`, "boolean");
	rule(issues, oneOf(value.selfCheck, CHECK_GATES), `${path}.selfCheck`, "unknown gate");
	rule(issues, oneOf(value.review, REVIEW_GATES), `${path}.review`, "unknown gate");
	rule(issues, oneOf(value.test, CHECK_GATES), `${path}.test`, "unknown gate");
	rule(issues, oneOf(value.evidenceFreshness, FRESHNESS), `${path}.evidenceFreshness`, "unknown freshness");
	rule(
		issues,
		nullOr(value.failureCode, (item) => oneOf(item, FAILURE_CODES)),
		`${path}.failureCode`,
		"unknown code",
	);
}

/** The App's strict decode of `complexExecution`: every violation, or none when the value decodes. */
export function complexExecutionShapeIssues(value: unknown, path = "complexExecution"): Issues {
	const issues: Issues = [];
	const keys = [
		"schemaVersion",
		"ownerId",
		"projectRevision",
		"runId",
		"stateRevision",
		"parent",
		"plan",
		"phase",
		"activeTaskIds",
		"tasks",
		"integration",
		"budget",
		"cleanup",
		"partialChanges",
		"changesUnknown",
		"failureCode",
	];
	if (!closed(value, path, keys, issues)) return issues;
	rule(issues, value.schemaVersion === 2, `${path}.schemaVersion`, "must be 2");
	rule(issues, matches(value.ownerId, IDENTIFIER), `${path}.ownerId`, "not an identifier");
	rule(issues, isCounter(value.projectRevision), `${path}.projectRevision`, "counter");
	rule(issues, matches(value.runId, IDENTIFIER), `${path}.runId`, "not an identifier");
	rule(issues, isCounter(value.stateRevision), `${path}.stateRevision`, "counter");
	parentShape(value.parent, `${path}.parent`, issues);
	planShape(value.plan, `${path}.plan`, issues);
	rule(issues, oneOf(value.phase, PHASES), `${path}.phase`, "unknown phase");
	const activeTaskIds = value.activeTaskIds;
	if (!Array.isArray(activeTaskIds)) issues.push(`${path}.activeTaskIds: expected an array`);
	else
		rule(
			issues,
			activeTaskIds.length <= 4 &&
				activeTaskIds.every((item) => matches(item, TASK_ID)) &&
				ascending(activeTaskIds as string[]),
			`${path}.activeTaskIds`,
			"at most 4 task IDs, strictly ascending",
		);
	if (!Array.isArray(value.tasks)) issues.push(`${path}.tasks: expected an array`);
	else {
		rule(issues, value.tasks.length >= 2 && value.tasks.length <= 8, `${path}.tasks`, "2-8 rows");
		value.tasks.forEach((row, index) => {
			rowShape(row, `${path}.tasks[${index}]`, issues, TASK_STATUSES);
		});
		// Amendment A1: a historical v1 plan carries no wave and only v1 row statuses.
		if (isRecord(value.plan) && value.plan.schemaVersion === 1)
			rule(
				issues,
				Array.isArray(activeTaskIds) &&
					activeTaskIds.length === 0 &&
					value.tasks.every((row) => !isRecord(row) || oneOf(row.status, TASK_STATUSES_V1)),
				path,
				"a historical v1 plan has no active rows and no HANDED_OFF row",
			);
	}
	const integrationKeys = ["check", "review", "test", "workspaceDigest", "evidenceFreshness", "failureCode"];
	if (closed(value.integration, `${path}.integration`, integrationKeys, issues)) {
		const integration = value.integration as Json;
		rule(issues, oneOf(integration.check, CHECK_GATES), `${path}.integration.check`, "unknown gate");
		rule(issues, oneOf(integration.review, REVIEW_GATES), `${path}.integration.review`, "unknown gate");
		rule(issues, oneOf(integration.test, CHECK_GATES), `${path}.integration.test`, "unknown gate");
		rule(
			issues,
			nullOr(integration.workspaceDigest, (item) => matches(item, WORKSPACE_DIGEST)),
			`${path}.integration.workspaceDigest`,
			"digest or null",
		);
		rule(issues, oneOf(integration.evidenceFreshness, FRESHNESS), `${path}.integration.evidenceFreshness`, "unknown");
		rule(
			issues,
			nullOr(integration.failureCode, (item) => oneOf(item, FAILURE_CODES)),
			`${path}.integration.failureCode`,
			"unknown code",
		);
	}
	const budgetKeys = ["workerInvocations", "reportedTokens", "totalRevisionCycles", "status"];
	if (closed(value.budget, `${path}.budget`, budgetKeys, issues)) {
		const budget = value.budget as Json;
		rule(
			issues,
			isCounter(budget.workerInvocations) && budget.workerInvocations <= 24,
			`${path}.budget.workerInvocations`,
			"0-24",
		);
		rule(issues, nullOr(budget.reportedTokens, isCounter), `${path}.budget.reportedTokens`, "counter or null");
		rule(
			issues,
			isCounter(budget.totalRevisionCycles) && budget.totalRevisionCycles <= 3,
			`${path}.budget.totalRevisionCycles`,
			"0-3",
		);
		rule(issues, oneOf(budget.status, ["WITHIN_LIMITS", "EXHAUSTED", "UNKNOWN"]), `${path}.budget.status`, "unknown");
	}
	rule(issues, oneOf(value.cleanup, CLEANUP), `${path}.cleanup`, "unknown cleanup");
	rule(issues, typeof value.partialChanges === "boolean", `${path}.partialChanges`, "boolean");
	rule(issues, typeof value.changesUnknown === "boolean", `${path}.changesUnknown`, "boolean");
	rule(
		issues,
		nullOr(value.failureCode, (item) => oneOf(item, FAILURE_CODES)),
		`${path}.failureCode`,
		"unknown code",
	);
	rule(issues, jsonBytes(value) <= 32_768, path, "exceeds 32,768 UTF-8 bytes");
	return issues;
}

/** Only the COMPLEX-related preview decode: the workflow enum and `complexPlan` present iff COMPLEX. */
function previewShapeIssues(value: unknown, path: string): Issues {
	const issues: Issues = [];
	if (!isRecord(value)) return [`${path}: expected an object`];
	rule(issues, oneOf(value.workflow, ["QUICK", "STANDARD", "COMPLEX"]), `${path}.workflow`, "unknown workflow");
	rule(
		issues,
		(value.workflow === "COMPLEX") === Object.hasOwn(value, "complexPlan"),
		`${path}.complexPlan`,
		"required iff COMPLEX (absent, never null, otherwise)",
	);
	if (Object.hasOwn(value, "complexPlan")) planShape(value.complexPlan, `${path}.complexPlan`, issues);
	return issues;
}

function graphShapeIssues(value: unknown, path: string): Issues {
	const issues: Issues = [];
	if (value === null) return issues;
	if (!closed(value, path, ["runId", "stateRevision", "status", "nodes", "edges"], issues)) return issues;
	if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return [...issues, `${path}: nodes/edges arrays`];
	value.nodes.forEach((node, index) => {
		const at = `${path}.nodes[${index}]`;
		if (!closed(node, at, ["id", "kind", "status"], issues, ["stepId", "attempt", "role", "parentId"])) return;
		rule(issues, matches(node.id, IDENTIFIER), `${at}.id`, "not an identifier");
		rule(issues, oneOf(node.kind, GRAPH_KINDS), `${at}.kind`, "unknown kind");
		rule(issues, oneOf(node.status, GRAPH_STATUSES), `${at}.status`, "unknown status");
		if (Object.hasOwn(node, "stepId")) rule(issues, oneOf(node.stepId, STEP_IDS), `${at}.stepId`, "unknown step");
		if (Object.hasOwn(node, "attempt")) rule(issues, isCounter(node.attempt), `${at}.attempt`, "counter");
		if (Object.hasOwn(node, "role"))
			rule(issues, oneOf(node.role, ["Executor", "Developer", "Reviewer", "Lead"]), `${at}.role`, "unknown role");
		if (Object.hasOwn(node, "parentId")) rule(issues, matches(node.parentId, IDENTIFIER), `${at}.parentId`, "id");
	});
	value.edges.forEach((edge, index) => {
		const at = `${path}.edges[${index}]`;
		if (!closed(edge, at, ["from", "to", "kind"], issues)) return;
		rule(issues, matches(edge.from, IDENTIFIER) && matches(edge.to, IDENTIFIER), at, "edge endpoints");
		rule(issues, oneOf(edge.kind, GRAPH_EDGES), `${at}.kind`, "unknown edge kind");
	});
	return issues;
}

// --- ComplexProjection.ts cross-field rules, restated ------------------------------------------------------------

const ACTIVE = new Set([
	"ELIGIBLE",
	"IMPLEMENTING",
	"WAITING_APPROVAL",
	"HANDED_OFF",
	"SELF_CHECK",
	"REVIEW",
	"TEST",
	"STOPPING",
]);
const VERIFYING = new Set(["SELF_CHECK", "REVIEW", "TEST"]);
const FINISHED = new Set(["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const TERMINAL_RUN = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);
const INTEGRATION = new Set(["INTEGRATION_CHECK", "FINAL_REVIEW", "FINAL_TEST", "COMPLETING"]);
const PHASE_ORDER: Record<string, number> = {
	TASK_SEQUENCE: 0,
	INTEGRATION_CHECK: 1,
	FINAL_REVIEW: 2,
	FINAL_TEST: 3,
	COMPLETING: 4,
	STOPPING: 5,
	TERMINAL: 6,
};
/** A later gate of the same attempt runs only after the earlier gate passed. */
const ordered = (first: string, second: string, third: string) =>
	(second === "NOT_RUN" || first === "PASS") && (third === "NOT_RUN" || second === "PASS");

/** Plan rules that need the parent: bound identity, complete coverage and mapped check selection. */
function planFitsParentIssues(
	plan: WirePlan,
	criteria: ReadonlyArray<{ id: string; checkIds: readonly string[]; reviewRequired: boolean }>,
	digest: string,
	path: string,
): Issues {
	const issues: Issues = [];
	const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
	const registered = new Set(plan.integration.checkIds);
	const covered = new Set(plan.tasks.flatMap((task) => task.criterionIds));
	rule(issues, planDigest(plan) === plan.complexPlanDigest, path, "complexPlanDigest does not recompute");
	rule(issues, plan.parentTaskContractDigest === digest, path, "plan is bound to another parent digest");
	criteria.forEach((criterion, index) => {
		rule(
			issues,
			criterion.id === `AC-${String(index + 1).padStart(3, "0")}`,
			`${path} ${criterion.id}`,
			"AC IDs must be sequential",
		);
		rule(issues, criterion.reviewRequired, `${path} ${criterion.id}`, "COMPLEX criteria require review");
		rule(
			issues,
			criterion.checkIds.every((id) => registered.has(id)),
			`${path} ${criterion.id}`,
			"criterion check outside the integration check set",
		);
	});
	rule(
		issues,
		sameList(
			plan.integration.criterionIds,
			criteria.map((criterion) => criterion.id),
		),
		path,
		"integration must cover every parent criterion in order",
	);
	rule(issues, covered.size === criteria.length, path, "tasks must cover every parent criterion");
	for (const task of plan.tasks) {
		const mapped = new Set(task.criterionIds.flatMap((id) => byId.get(id)?.checkIds ?? []));
		rule(
			issues,
			task.criterionIds.every((id) => byId.has(id)),
			`${path} ${task.id}`,
			"unknown criterion",
		);
		rule(
			issues,
			task.checkIds.every((id) => mapped.has(id)),
			`${path} ${task.id}`,
			"check not mapped to its criteria",
		);
	}
	return issues;
}

/**
 * §10.3 preview checks (ComplexProjection.complexPreviewConsistent) plus the prepare-response checks of
 * RuntimeController.command: echoed owner/project revision and COMPLEX iff the request carried a draft. The plan has
 * exactly the advertised contract version (2 for this Runtime) and an R3 plan implements one task at a time.
 */
export function complexPreviewIssues(
	preview: unknown,
	request?: { ownerId: string; expectedProjectRevision: number; complexDraft?: unknown },
	path = "preview",
	version: number | undefined = 2,
): Issues {
	const shape = previewShapeIssues(preview, path);
	if (shape.length || !isRecord(preview)) return shape;
	const issues: Issues = [];
	if (request) {
		rule(issues, preview.ownerId === request.ownerId, `${path}.ownerId`, "must echo the request ownerId");
		rule(
			issues,
			preview.projectRevision === request.expectedProjectRevision,
			`${path}.projectRevision`,
			"must echo expectedProjectRevision",
		);
		rule(
			issues,
			(preview.workflow === "COMPLEX") === (request.complexDraft !== undefined),
			`${path}.workflow`,
			"COMPLEX requires the draft and a draft is never downgraded",
		);
	}
	if (!Object.hasOwn(preview, "complexPlan")) return issues;
	const plan = preview.complexPlan as WirePlan;
	const criteria = preview.acceptanceCriteria as Array<{
		id: string;
		statement: string;
		checkIds: string[];
		reviewRequired: boolean;
	}>;
	const checks = preview.checks as Array<{ id: string }>;
	const allowedPaths = preview.allowedPaths as string[];
	try {
		// The Host scopes every criterion to allowedPaths; the rebuilt pending parent must hash to both digests.
		const digest = contractDigest(
			plan.parentTaskId,
			preview.goal as string,
			criteria.map((criterion) => ({ ...criterion, paths: allowedPaths })),
		);
		rule(issues, preview.recipe === null, `${path}.recipe`, "a COMPLEX preview carries no recipe");
		rule(
			issues,
			plan.schemaVersion === version,
			`${path}.complexPlan.schemaVersion`,
			"must be the advertised version",
		);
		rule(
			issues,
			preview.risk !== "R3" || sequential(plan),
			`${path}.complexPlan.limits`,
			"an R3 plan implements one task at a time (maxParallel 1)",
		);
		rule(issues, preview.taskContractDigest === digest, `${path}.taskContractDigest`, "parent does not recompute");
		rule(
			issues,
			sameList(plan.integration.checkIds, checks.map((check) => check.id).sort()),
			`${path}.complexPlan.integration.checkIds`,
			"must be every preview check ID, sorted",
		);
		rule(
			issues,
			preview.executionMode === "EDIT" || plan.tasks.every((task) => task.ownership.length === 0),
			`${path}.complexPlan`,
			"READ_ONLY plans claim no files",
		);
		issues.push(...planFitsParentIssues(plan, criteria, digest, `${path}.complexPlan`));
	} catch (error) {
		issues.push(`${path}: unusable digest material (${error instanceof Error ? error.message : "unknown"})`);
	}
	return issues;
}

function rowIssues(
	row: WireRow,
	task: WireTask | undefined,
	rows: readonly WireRow[],
	index: number,
	inOrder: boolean,
	path: string,
): Issues {
	const issues: Issues = [];
	if (!task || row.id !== task.id) return [`${path}: row does not match the plan task in order`];
	if (row.status === "PENDING") {
		rule(
			issues,
			row.attempt === 0 &&
				row.revisionCycle === 0 &&
				row.workerInvocations === 0 &&
				row.reportedTokens === 0 &&
				row.entryWorkspaceDigest === null &&
				row.exitWorkspaceDigest === null &&
				row.changedFiles.length === 0 &&
				!row.changesUnknown &&
				row.selfCheck === "NOT_RUN" &&
				row.review === "NOT_RUN" &&
				row.test === "NOT_RUN" &&
				row.evidenceFreshness === "NONE" &&
				row.failureCode === null,
			path,
			"PENDING row must be pristine (attempt 0, zero counters and tokens, no capture/change/gate/failure)",
		);
		return issues;
	}
	const claims = new Set(task.ownership.map((claim) => claim.path));
	rule(
		issues,
		row.attempt === 0 ? row.revisionCycle === 0 : row.attempt === row.revisionCycle + 1,
		path,
		"attempt must equal revisionCycle + 1 once activated",
	);
	rule(issues, row.revisionCycle <= task.maxRevisionCycles, path, "exceeds the task revision cap");
	rule(issues, row.workerInvocations <= 2 * row.attempt, path, "more than one Developer and one Reviewer per attempt");
	rule(
		issues,
		row.attempt > 0 || (row.selfCheck === "NOT_RUN" && row.review === "NOT_RUN" && row.test === "NOT_RUN"),
		path,
		"gates before any attempt",
	);
	rule(
		issues,
		row.attempt === 0 || row.entryWorkspaceDigest !== null || row.failureCode !== null || row.changesUnknown,
		path,
		"an attempt needs an entry capture, a failure code or an unknown-change flag",
	);
	rule(
		issues,
		row.changedFiles.every((file) => claims.has(file)),
		path,
		"changed files outside the task claims",
	);
	rule(issues, ordered(row.selfCheck, row.review, row.test), path, "gates ran out of order");
	// v2 rule 2: declared dependencies COMPLETED; sequential plans (v1, maxParallel 1): every earlier row COMPLETED.
	const completed = (id: string) => rows.some((item) => item.id === id && item.status === "COMPLETED");
	const ready = inOrder
		? rows.slice(0, index).every((before) => before.status === "COMPLETED")
		: task.dependsOn.every(completed);
	rule(
		issues,
		(!ACTIVE.has(row.status) && row.status !== "COMPLETED") || ready,
		path,
		inOrder
			? "active or completed before every earlier task completed"
			: "active or completed before its declared dependencies completed",
	);
	// v2 rule 5: implemented and entry-captured, every gate still waiting for its verification turn.
	rule(
		issues,
		row.status !== "HANDED_OFF" ||
			(row.attempt >= 1 &&
				row.entryWorkspaceDigest !== null &&
				row.selfCheck === "NOT_RUN" &&
				row.review === "NOT_RUN" &&
				row.test === "NOT_RUN"),
		path,
		"HANDED_OFF needs an attempt, an entry capture and NOT_RUN gates",
	);
	rule(
		issues,
		row.status !== "COMPLETED" ||
			(row.attempt >= 1 &&
				row.selfCheck === "PASS" &&
				row.review === "PASS" &&
				row.test === "PASS" &&
				row.exitWorkspaceDigest !== null &&
				row.evidenceFreshness !== "NONE" &&
				row.failureCode === null),
		path,
		"COMPLETED without PASS x3, exit capture, evidence and no failure",
	);
	return issues;
}

type RunSummary = NonNullable<HostControlState["snapshot"]["status"]["run"]>;

/**
 * v2 rules 1, 3 and 4 with the §8 atomic-save amendment (activeRowsConsistent): `activeTaskIds` lists exactly the
 * active rows in plan order within maxParallel; without a working row the active rows are all ELIGIBLE (one wave
 * formation save) or any mix of HANDED_OFF and STOPPING (join and settlement); first-attempt implementation
 * (IMPLEMENTING attempt 1, WAITING_APPROVAL) coexists only with HANDED_OFF rows; exactly one verification-state row
 * (a stage, or a revising IMPLEMENTING attempt ≥ 2) coexists only with HANDED_OFF rows.
 */
function activeRowsIssues(execution: WireExecution, active: readonly WireRow[]): Issues {
	const issues: Issues = [];
	const path = "complexExecution";
	const eligible = active.filter((row) => row.status === "ELIGIBLE");
	const verifying = active.filter(
		(row) => VERIFYING.has(row.status) || (row.status === "IMPLEMENTING" && row.attempt >= 2),
	);
	const implementing = active.filter(
		(row) => row.status === "WAITING_APPROVAL" || (row.status === "IMPLEMENTING" && row.attempt < 2),
	);
	const othersHandedOff = (working: readonly WireRow[]) =>
		active.every((row) => working.includes(row) || row.status === "HANDED_OFF");
	rule(
		issues,
		sameList(
			execution.activeTaskIds,
			active.map((row) => row.id),
		),
		path,
		"activeTaskIds must list exactly the active rows in plan order",
	);
	rule(issues, active.length <= maxParallelOf(execution.plan), path, "more active rows than maxParallel");
	rule(
		issues,
		eligible.length === 0 || eligible.length === active.length,
		path,
		"a wave is formed in one save: ELIGIBLE rows are the whole active set",
	);
	rule(
		issues,
		implementing.length === 0 || (verifying.length === 0 && othersHandedOff(implementing)),
		path,
		"first-attempt implementation coexists only with HANDED_OFF rows",
	);
	rule(
		issues,
		verifying.length === 0 || (verifying.length === 1 && implementing.length === 0 && othersHandedOff(verifying)),
		path,
		"exactly one row verifies at a time, beside HANDED_OFF rows only",
	);
	return issues;
}

function executionIssues(execution: WireExecution, run: RunSummary): Issues {
	const issues: Issues = [];
	const path = "complexExecution";
	const { plan, parent, tasks, integration, budget } = execution;
	const digest = parentDigest(parent);
	const active = tasks.filter((row) => ACTIVE.has(row.status));
	const inOrder = sequential(plan);
	const integrationGates = [integration.check, integration.review, integration.test];
	const gates = [...tasks.flatMap((row) => [row.selfCheck, row.review, row.test]), ...integrationGates];
	const taskInvocations = sum(tasks.map((row) => row.workerInvocations));
	rule(issues, plan.parentTaskId === parent.id, path, "plan.parentTaskId must be the parent ID");
	rule(
		issues,
		run.taskContractDigest === null || run.taskContractDigest === digest,
		path,
		"snapshot Run taskContractDigest differs from the parent digest",
	);
	issues.push(
		...planFitsParentIssues(
			plan,
			parent.acceptanceCriteria.map((criterion) => ({
				id: criterion.id,
				checkIds: criterion.verification.checkIds,
				reviewRequired: criterion.verification.reviewRequired,
			})),
			digest,
			`${path}.plan`,
		),
	);
	rule(issues, parent.status !== "completed" || run.status === "COMPLETED", path, "parent completed before the Run");
	rule(issues, tasks.length === plan.tasks.length, path, "exactly one row per plan task");
	tasks.forEach((row, index) => {
		issues.push(...rowIssues(row, plan.tasks[index], tasks, index, inOrder, `${path}.tasks[${index}]`));
	});
	issues.push(...activeRowsIssues(execution, active));
	rule(
		issues,
		run.risk !== "R3" || sequential(plan),
		path,
		"an R3 plan implements one task at a time (maxParallel 1)",
	);
	rule(
		issues,
		!tasks.some((row) => row.status === "WAITING_APPROVAL") || run.status === "WAITING_APPROVAL",
		path,
		"a row waits for Approval only while the Run does",
	);
	rule(
		issues,
		(execution.phase === "TERMINAL") === TERMINAL_RUN.has(run.status),
		path,
		"phase TERMINAL iff the Run is terminal",
	);
	rule(
		issues,
		execution.phase !== "TASK_SEQUENCE" || integrationGates.every((gate) => gate === "NOT_RUN"),
		path,
		"integration gates ran during the task sequence",
	);
	rule(
		issues,
		!INTEGRATION.has(execution.phase) || tasks.every((row) => row.status === "COMPLETED"),
		path,
		"integration before every task COMPLETED",
	);
	rule(
		issues,
		execution.phase !== "TERMINAL" || (tasks.every((row) => FINISHED.has(row.status)) && !gates.includes("RUNNING")),
		path,
		"TERMINAL leaves an unfinished row or a RUNNING gate",
	);
	rule(
		issues,
		ordered(integration.check, integration.review, integration.test),
		path,
		"integration gates out of order",
	);
	rule(
		issues,
		(budget.status === "UNKNOWN") === (budget.reportedTokens === null),
		path,
		"UNKNOWN iff tokens are null",
	);
	rule(
		issues,
		budget.reportedTokens === null ||
			budget.reportedTokens < plan.limits.maxReportedTokens ||
			budget.status === "EXHAUSTED",
		path,
		"tokens at the cap must be EXHAUSTED",
	);
	rule(issues, budget.workerInvocations <= plan.limits.maxWorkerInvocations, path, "invocations over the plan cap");
	rule(
		issues,
		taskInvocations <= budget.workerInvocations && budget.workerInvocations <= taskInvocations + 1,
		path,
		"task invocation subtotals plus at most the final Reviewer must form the global ledger",
	);
	rule(
		issues,
		budget.totalRevisionCycles <= plan.limits.maxTotalRevisionCycles,
		path,
		"work cycles over the plan cap",
	);
	rule(
		issues,
		sum(tasks.map((row) => row.revisionCycle)) === budget.totalRevisionCycles,
		path,
		"task revision cycles must sum to the global work cycle",
	);
	rule(
		issues,
		run.status === "INTERRUPTED" || !TERMINAL_RUN.has(run.status) || execution.cleanup === "CONFIRMED",
		path,
		"a clean terminal outcome requires cleanup CONFIRMED",
	);
	rule(
		issues,
		run.status !== "COMPLETED" ||
			(tasks.every((row) => row.status === "COMPLETED") &&
				integrationGates.every((gate) => gate === "PASS") &&
				integration.evidenceFreshness === "CURRENT" &&
				integration.workspaceDigest !== null &&
				integration.failureCode === null &&
				execution.failureCode === null &&
				budget.status === "WITHIN_LIMITS"),
		path,
		"Run COMPLETED without every task, integration PASS x3/CURRENT and known budget",
	);
	return issues;
}

function canonicalExecution(execution: WireExecution) {
	const { ownerId: _owner, projectRevision: _project, ...data } = execution;
	return canonicalJson(data);
}
function frozenParent(parent: WireParent) {
	const { status: _status, ...identity } = parent;
	return canonicalJson(identity);
}

/** Same Run across snapshots: frozen parent/plan, no regression and no terminal re-entry. */
function transitionIssues(before: WireExecution, after: WireExecution): Issues {
	const issues: Issues = [];
	const path = `complexExecution ${before.stateRevision}->${after.stateRevision}`;
	if (after.stateRevision === before.stateRevision) {
		rule(issues, canonicalExecution(before) === canonicalExecution(after), path, "same stateRevision, changed data");
		return issues;
	}
	const tokens = (previous: number | null, next: number | null) =>
		previous === null || next === null || next >= previous;
	rule(issues, after.stateRevision > before.stateRevision, path, "stateRevision regressed");
	rule(issues, frozenParent(before.parent) === frozenParent(after.parent), path, "parent changed");
	rule(issues, canonicalJson(before.plan) === canonicalJson(after.plan), path, "plan changed");
	rule(issues, PHASE_ORDER[after.phase] >= PHASE_ORDER[before.phase], path, "phase regressed");
	rule(issues, after.budget.workerInvocations >= before.budget.workerInvocations, path, "invocations decreased");
	rule(issues, after.budget.totalRevisionCycles >= before.budget.totalRevisionCycles, path, "work cycles decreased");
	rule(
		issues,
		before.budget.reportedTokens !== null || after.budget.reportedTokens === null,
		path,
		"unknown usage became known",
	);
	rule(issues, tokens(before.budget.reportedTokens, after.budget.reportedTokens), path, "reported tokens decreased");
	after.tasks.forEach((row, index) => {
		const prior = before.tasks[index];
		const at = `${path} ${row.id}`;
		if (!prior) {
			issues.push(`${at}: row appeared`);
			return;
		}
		rule(issues, row.attempt >= prior.attempt, at, "attempt decreased");
		rule(issues, row.revisionCycle >= prior.revisionCycle, at, "revision cycle decreased");
		rule(issues, row.workerInvocations >= prior.workerInvocations, at, "invocations decreased");
		rule(issues, tokens(prior.reportedTokens, row.reportedTokens), at, "tokens decreased");
		rule(issues, prior.status === "PENDING" || row.status !== "PENDING", at, "re-entered PENDING");
		rule(issues, !FINISHED.has(prior.status) || row.status === prior.status, at, "finished row changed status");
	});
	rule(
		issues,
		before.phase !== "TERMINAL" ||
			(after.failureCode === before.failureCode &&
				after.integration.check === before.integration.check &&
				after.integration.review === before.integration.review &&
				after.integration.test === before.integration.test),
		path,
		"TERMINAL failure code or integration gates changed",
	);
	return issues;
}

/**
 * Every App rule for one observation (and against the previous accepted observation of the same connection):
 * strict decode of the COMPLEX fields, the WeavraControlState envelope filter, ComplexProjection presence and
 * cross-field consistency, and the RuntimeController snapshot envelope. An empty list means the App publishes it.
 */
export function complexConsumerIssues(current: ComplexObservation, previous?: ComplexObservation | null): Issues {
	const { state, capabilities } = current;
	const issues: Issues = [];
	const run = state.snapshot.status.run;
	const advertised = capabilities.complexContractVersion;
	// This Runtime implements exactly contract v2 (V0.8A §8) and never mixes versions on a connection.
	rule(issues, advertised === undefined || advertised === 2, "capabilities.complexContractVersion", "must be 2");
	// Strict decode of the COMPLEX fields (an optional key is absent, never null).
	const present = Object.hasOwn(state, "complexExecution");
	if (present) issues.push(...complexExecutionShapeIssues(state.complexExecution));
	issues.push(...graphShapeIssues(state.snapshot.graph, "snapshot.graph"));
	if (state.preview) issues.push(...complexPreviewIssues(state.preview, undefined, "preview", advertised));
	if (issues.length) return issues;
	const wire = present ? (state.complexExecution as unknown as WireExecution) : undefined;
	// WeavraControlState filter: the projection belongs to exactly the enclosing latest COMPLEX Run and observation,
	// and a plan of another version than its projection is only a terminal historical Run (Amendment A1).
	if (wire)
		rule(
			issues,
			wire.ownerId === state.ownerId &&
				wire.projectRevision === state.projectRevision &&
				wire.stateRevision === state.stateRevision &&
				wire.runId === run?.runId &&
				run?.workflow === "COMPLEX" &&
				(wire.plan.schemaVersion === wire.schemaVersion || TERMINAL_RUN.has(run.status)),
			"complexExecution",
			"envelope must equal the snapshot ownerId/projectRevision/stateRevision and latest COMPLEX runId; a v1 plan only on a terminal Run",
		);
	// ComplexProjection.complexStateConsistent: presence, then cross-field and cross-snapshot consistency.
	if (advertised === undefined) {
		rule(issues, wire === undefined, "complexExecution", "an unadvertised Runtime must not send it");
		rule(
			issues,
			state.preview?.workflow !== "COMPLEX",
			"preview",
			"an unadvertised Runtime must not preview COMPLEX",
		);
	} else if (!wire) rule(issues, run?.workflow !== "COMPLEX", "complexExecution", "a latest COMPLEX Run needs it");
	else if (!run) issues.push("complexExecution: projection without a latest Run");
	else if (wire.schemaVersion !== advertised)
		issues.push("complexExecution: schemaVersion differs from the advertised contract version");
	else
		try {
			issues.push(...executionIssues(wire, run));
			// A new Run replaces the projection; nothing is merged from an older one.
			const before = previous?.state.complexExecution as WireExecution | undefined;
			if (before && before.runId === wire.runId && before.schemaVersion === wire.schemaVersion) {
				issues.push(...transitionIssues(before, wire));
				rule(
					issues,
					before.phase !== "TERMINAL" || previous?.state.snapshot.status.run?.status === run.status,
					"complexExecution",
					"a terminal Run changed its outcome",
				);
			}
		} catch (error) {
			issues.push(
				`complexExecution: unusable digest material (${error instanceof Error ? error.message : "unknown"})`,
			);
		}
	// RuntimeController.consistent snapshot envelope.
	const response = current.response;
	if (response)
		rule(
			issues,
			response.ownerId === state.ownerId &&
				response.runId === (run?.runId ?? null) &&
				response.stateRevision === state.stateRevision &&
				(response.projectRevision ?? 0) === state.projectRevision,
			"response",
			"envelope must match the snapshot state",
		);
	const snapshot = state.snapshot;
	rule(issues, state.nextRequestId.startsWith(`${state.ownerId}:`), "nextRequestId", "owner-scoped");
	rule(issues, snapshot.status.state !== "unavailable", "snapshot.status.state", "unavailable");
	rule(issues, snapshot.graphAvailable === (snapshot.graph !== null), "snapshot.graphAvailable", "graph presence");
	rule(
		issues,
		!snapshot.graph ||
			(snapshot.graph.runId === run?.runId &&
				snapshot.graph.stateRevision === state.stateRevision &&
				snapshot.graph.status === run.status),
		"snapshot.graph",
		"graph identity/revision/status must match the Run",
	);
	rule(
		issues,
		!snapshot.evidence ||
			(snapshot.evidence.runId === run?.runId &&
				snapshot.evidence.status === run.status &&
				snapshot.evidence.codeRevision === run.codeRevision),
		"snapshot.evidence",
		"evidence identity/status/code revision must match the Run",
	);
	rule(
		issues,
		!state.preview ||
			(state.preview.ownerId === state.ownerId && state.preview.projectRevision === state.projectRevision),
		"preview",
		"must belong to this owner and project revision",
	);
	const approval = state.pendingApproval;
	rule(
		issues,
		!approval ||
			(approval.runId === run?.runId &&
				run.status === "WAITING_APPROVAL" &&
				approval.runId === state.ownedRunId &&
				state.busy &&
				approval.stateRevision === state.stateRevision &&
				approval.projectRevision === state.projectRevision),
		"pendingApproval",
		"must belong to the owned WAITING_APPROVAL Run at this revision",
	);
	const prior = previous?.state;
	rule(
		issues,
		!prior ||
			(state.projectRevision >= prior.projectRevision &&
				(prior.snapshot.status.run?.runId !== run?.runId ||
					prior.stateRevision === null ||
					(state.stateRevision !== null && state.stateRevision >= prior.stateRevision))),
		"snapshot",
		"project or state revision regressed",
	);
	return issues;
}

/**
 * The §10.3 observation of one durable Run as the Host Control snapshot builds it (production projections only):
 * `stateRevision` is the Run revision and the projection is present iff the Run is COMPLEX. Also asserts the
 * prepare-time maximal projection bound of Stage A covers every real projection.
 */
export function observeDurableRun(
	run: Run,
	envelope: { ownerId: string; projectRevision: number },
): { observation: ComplexObservation; issues: Issues } {
	const issues: Issues = [];
	let complexExecution: HostControlState["complexExecution"];
	if (run.workflow === "COMPLEX")
		try {
			complexExecution = projectComplexExecution(run, { ...envelope, stateRevision: run.revision });
			const parent = run.tasks[0];
			// The prepare-time bound applies to plans this Runtime compiles (v2), never to historical v1 plans.
			if (run.complex?.plan.schemaVersion === 2 && parent && isTaskContract(parent))
				rule(
					issues,
					jsonBytes(complexExecution) <= jsonBytes(maxComplexExecution(parent, run.complex.plan)),
					"complexExecution",
					"larger than the prepare-time maximal projection bound",
				);
		} catch (error) {
			issues.push(`complexExecution unavailable: ${error instanceof Error ? error.message : "unknown"}`);
		}
	let graph: HostControlState["snapshot"]["graph"] = null;
	try {
		graph = projectHostGraph(run);
	} catch {
		// Host Control publishes an unavailable graph as null.
	}
	const state: HostControlState = {
		ownerId: envelope.ownerId,
		nextRequestId: `${envelope.ownerId}:1`,
		projectRevision: envelope.projectRevision,
		stateRevision: run.revision,
		ownedRunId: null,
		busy: false,
		cancelling: false,
		startFailure: null,
		preview: null,
		browserPreview: null,
		factPreview: null,
		projectFacts: { status: "unavailable", entries: [] },
		pendingApproval: null,
		...(complexExecution ? { complexExecution } : {}),
		snapshot: {
			status: {
				source: "durable-canonical-state",
				ownerObserved: false,
				state: "available",
				writerPresent: true,
				run: projectHostRun(run),
			},
			graph,
			graphAvailable: graph !== null,
			evidence: projectHostEvidence(run),
			configuration: { source: "project-config-not-frozen-run-config", status: "unavailable" },
		},
	};
	return {
		observation: {
			capabilities: { complexContractVersion: 2 },
			state,
			response: {
				ownerId: envelope.ownerId,
				runId: run.runId,
				stateRevision: run.revision,
				projectRevision: envelope.projectRevision,
			},
		},
		issues,
	};
}
