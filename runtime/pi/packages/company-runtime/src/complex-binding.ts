import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { capabilityJson } from "./capability-catalog.ts";
import {
	COMPLEX_MAX_LOCAL_REVISION_CYCLES,
	COMPLEX_MAX_PLAN_CLAIMS,
	COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES,
	COMPLEX_PATH_MAX_BYTES,
	COMPLEX_PLAN_MAX_BYTES,
	ComplexParentSchema,
	type ComplexPlan,
	type ComplexPlanMaterial,
	ComplexPlanSchema,
	complexTaskId,
	type OwnershipClaim,
} from "./complex-types.ts";
import type { TaskContract } from "./contracts.ts";
import { assertCriterionIdentity, taskContractDigest } from "./criterion-evidence.ts";

/**
 * Frozen COMPLEX plan identity and binding (COMPLEX_SEQUENTIAL_WORKFLOW.md §4.2, §5.1): canonical digest, lexical
 * exact-file rule and the structural invariants shared by the Host compiler and the Kernel's admission, per-task
 * and completion guards. Pure and free of configuration, Policy and I/O so the Kernel import graph stays host-free.
 */
export const COMPLEX_PLAN_DIGEST_DOMAIN = "weavra-complex-plan-v1";

function sameList(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** sha256 over canonical JSON `["weavra-complex-plan-v1", plan without complexPlanDigest]` (§4.2). Not a signature. */
export function complexPlanDigest(plan: ComplexPlanMaterial): string {
	const material: Record<string, unknown> = { ...plan };
	delete material.complexPlanDigest;
	return `sha256:${createHash("sha256")
		.update(capabilityJson([COMPLEX_PLAN_DIGEST_DOMAIN, material]), "utf8")
		.digest("hex")}`;
}

/**
 * Lexical exact-file ownership rule (§5.1, identical on the App side): 1–256 UTF-8 bytes of well-formed text,
 * relative POSIX, nonempty components without `.`/`..`, no leading/trailing slash, backslash, control/bidi
 * character, glob metacharacter or drive prefix. Lexical validity is never permission.
 */
export function ownershipPathError(path: string): string | undefined {
	const encoded = Buffer.from(path, "utf8");
	if (encoded.toString("utf8") !== path) return "is not well-formed Unicode text";
	if (encoded.length < 1 || encoded.length > COMPLEX_PATH_MAX_BYTES)
		return `must be 1-${COMPLEX_PATH_MAX_BYTES} UTF-8 bytes`;
	if (path.startsWith("/") || path.endsWith("/")) return "must be relative, without a leading or trailing slash";
	if (/^[A-Za-z]:/.test(path)) return "must not start with a drive prefix";
	for (let index = 0; index < path.length; index++) {
		const code = path.charCodeAt(index);
		// C0 controls, DEL and bidi controls (U+200E/F, U+202A-E, U+2066-9).
		if (
			code <= 0x1f ||
			code === 0x7f ||
			code === 0x200e ||
			code === 0x200f ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		)
			return "must not contain control or bidirectional characters";
	}
	if (/[\\*?[\]{}]/.test(path)) return "must not contain backslashes or glob metacharacters";
	if (path.split("/").some((part) => part === "" || part === "." || part === ".."))
		return "must name one exact file: nonempty components without . or .. (no root or subtree claims)";
	return undefined;
}

/**
 * Graph, coverage, check and exclusive-ownership invariants of a (typed) plan and its parent (§4.1, §5.1, §7.2).
 * Shared by the compiler (INVALID_CRITERIA) and the frozen-plan binding guard (PLAN_MISMATCH).
 */
export function complexStructureError(
	plan: ComplexPlanMaterial,
	parent: TaskContract,
	registeredCheckIds?: readonly string[],
): string | undefined {
	const parentIds = parent.acceptanceCriteria.map((criterion) => criterion.id);
	const mappedChecks = new Map(
		parent.acceptanceCriteria.map((criterion) => [criterion.id, criterion.verification.checkIds]),
	);
	const registered = registeredCheckIds ? new Set(registeredCheckIds) : undefined;
	const taskIds = plan.tasks.map((_task, index) => complexTaskId(index + 1));
	const covered = new Set<string>();
	const claims: Array<{ taskId: string; claim: OwnershipClaim }> = [];
	for (const [index, task] of plan.tasks.entries()) {
		const id = taskIds[index];
		if (task.id !== id) return `Task ${index + 1} must carry the Host-assigned ID ${id}`;
		let previousDependency = 0;
		for (const dependency of task.dependsOn) {
			const position = taskIds.indexOf(dependency) + 1;
			if (!position) return `${id} depends on missing task ${JSON.stringify(dependency)}`;
			if (position === index + 1) return `${id} depends on itself`;
			if (position > index + 1)
				return `${id} depends on later task ${dependency}; dependencies must reference earlier tasks (no forward edges or cycles, and tasks are never reordered)`;
			if (position === previousDependency) return `${id} lists dependency ${dependency} more than once`;
			if (position < previousDependency) return `${id} dependencies must be listed in plan order`;
			previousDependency = position;
		}
		let previousCriterion = 0;
		for (const criterion of task.criterionIds) {
			const position = parentIds.indexOf(criterion) + 1;
			if (!position)
				return `${id} references acceptance criterion ${JSON.stringify(criterion)}, which the parent Task Contract does not contain`;
			if (position === previousCriterion) return `${id} lists ${criterion} more than once`;
			if (position < previousCriterion) return `${id} criteria must be listed in parent order`;
			previousCriterion = position;
			covered.add(criterion);
		}
		const selectable = new Set(task.criterionIds.flatMap((criterion) => mappedChecks.get(criterion) ?? []));
		let previousCheck: string | undefined;
		for (const check of task.checkIds) {
			if (check === previousCheck) return `${id} selects check ${JSON.stringify(check)} more than once`;
			if (previousCheck !== undefined && check < previousCheck) return `${id} checks must be ASCII-sorted`;
			previousCheck = check;
			if (registered && !registered.has(check)) return `${id} selects unregistered check ${JSON.stringify(check)}`;
			if (!selectable.has(check))
				return `${id} check ${JSON.stringify(check)} is not mapped to its acceptance criteria (selectable: ${[...selectable].sort().join(", ") || "none"})`;
			if (!plan.integration.checkIds.includes(check))
				return `${id} check ${JSON.stringify(check)} is not part of the integration check set`;
		}
		let previousPath: string | undefined;
		for (const claim of task.ownership) {
			const lexical = ownershipPathError(claim.path);
			if (lexical) return `${id} claim ${JSON.stringify(claim.path)} ${lexical}`;
			if (previousPath !== undefined && claim.path < previousPath) return `${id} claims must be ASCII path-sorted`;
			previousPath = claim.path;
			claims.push({ taskId: id, claim });
		}
	}
	const uncovered = parentIds.filter((criterion) => !covered.has(criterion));
	if (uncovered.length)
		return `Acceptance criteria ${uncovered.join(", ")} are not covered by any task; every parent criterion must be mapped`;
	if (claims.length > COMPLEX_MAX_PLAN_CLAIMS)
		return `The plan claims ${claims.length} files; at most ${COMPLEX_MAX_PLAN_CLAIMS} are supported`;
	// Case/Unicode folding for comparison only; claimed spellings are never rewritten or normalized.
	const folded = claims.map(({ claim }) => claim.path.normalize("NFC").toLowerCase());
	for (let left = 0; left < claims.length; left++)
		for (let right = left + 1; right < claims.length; right++) {
			const first = claims[left];
			const second = claims[right];
			if (first.claim.path === second.claim.path)
				return `${JSON.stringify(first.claim.path)} is claimed by ${first.taskId} and ${second.taskId === first.taskId ? "again by the same task" : second.taskId}; claims are exclusive even with different operations`;
			if (folded[left] === folded[right])
				return `${JSON.stringify(first.claim.path)} and ${JSON.stringify(second.claim.path)} are case or Unicode aliases of one file`;
			if (folded[right].startsWith(`${folded[left]}/`) || folded[left].startsWith(`${folded[right]}/`))
				return `${JSON.stringify(first.claim.path)} and ${JSON.stringify(second.claim.path)} overlap; only exact files can be claimed (no subtree ownership)`;
		}
	if (!sameList(plan.integration.criterionIds, parentIds))
		return "Integration must cover every parent acceptance criterion in parent order";
	const integrationChecks = plan.integration.checkIds;
	if (integrationChecks.some((check, index) => index > 0 && check <= integrationChecks[index - 1]))
		return "Integration checks must be unique and ASCII-sorted";
	if (registeredCheckIds && !sameList(integrationChecks, [...registeredCheckIds].sort()))
		return "Integration must run exactly every registered check";
	for (const task of plan.tasks)
		if (task.maxRevisionCycles !== Math.min(COMPLEX_MAX_LOCAL_REVISION_CYCLES, plan.limits.maxTotalRevisionCycles))
			return `${task.id} revision cap must equal min(${COMPLEX_MAX_LOCAL_REVISION_CYCLES}, total revision cycles)`;
	const deletions = claims.filter(({ claim }) => claim.operation === "delete");
	if (
		deletions.length &&
		(claims.length !== 1 || deletions[0].taskId !== complexTaskId(1) || plan.limits.maxTotalRevisionCycles !== 0)
	)
		return "A delete claim must be the plan's only claim, held by CT-001, with no revision cycles (single R3 deletion)";
	return undefined;
}

/** Frozen-plan binding failure, already expressed as the closed COMPLEX failure code for the Kernel. */
export class ComplexPlanBindingError extends Error {
	readonly code: "PARENT_MISMATCH" | "PLAN_MISMATCH";

	constructor(code: "PARENT_MISMATCH" | "PLAN_MISMATCH", message: string) {
		super(message);
		this.name = "ComplexPlanBindingError";
		this.code = code;
	}
}

/**
 * Admission, per-task and completion guard (§4.2): the frozen plan keeps its closed shape and byte bound,
 * recomputes to its own digest, binds this exact unchanged parent and keeps every graph, coverage, check and
 * exclusive-claim invariant. When given, the frozen registration IDs must equal the integration check set.
 * Current Policy/config/trust bindings are separate checks; a matching digest authorizes nothing.
 */
export function assertComplexPlanBinding(
	plan: unknown,
	parent: TaskContract,
	options: { registeredCheckIds?: readonly string[] } = {},
): ComplexPlan {
	let parentValid = Check(ComplexParentSchema, parent);
	if (parentValid)
		try {
			assertCriterionIdentity(parent.acceptanceCriteria);
		} catch {
			parentValid = false;
		}
	if (
		!parentValid ||
		parent.acceptanceCriteria.some(
			(criterion) =>
				!criterion.verification.reviewRequired ||
				criterion.scope.paths.some((path) => Buffer.byteLength(path, "utf8") > COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES),
		)
	)
		throw new ComplexPlanBindingError("PARENT_MISMATCH", "The parent is not a valid COMPLEX Task Contract");
	if (!Check(ComplexPlanSchema, plan))
		throw new ComplexPlanBindingError("PLAN_MISMATCH", "The plan does not match the closed COMPLEX plan schema");
	if (plan.parentTaskId !== parent.id || plan.parentTaskContractDigest !== taskContractDigest(parent))
		throw new ComplexPlanBindingError("PARENT_MISMATCH", "The plan is bound to a different parent Task Contract");
	if (complexPlanDigest(plan) !== plan.complexPlanDigest)
		throw new ComplexPlanBindingError("PLAN_MISMATCH", "The plan does not recompute to its complexPlanDigest");
	const structural = complexStructureError(plan, parent, options.registeredCheckIds);
	if (structural) throw new ComplexPlanBindingError("PLAN_MISMATCH", structural);
	if (Buffer.byteLength(JSON.stringify(plan), "utf8") > COMPLEX_PLAN_MAX_BYTES)
		throw new ComplexPlanBindingError("PLAN_MISMATCH", "The plan exceeds the COMPLEX plan byte limit");
	return plan;
}
