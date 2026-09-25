import type { ComplexPathFact } from "./complex-plan.ts";
import {
	COMPLEX_GOAL_MAX_LENGTH,
	COMPLEX_TITLE_MAX_LENGTH,
	type ComplexDraft,
	type ComplexRunState,
	type OwnershipClaim,
} from "./complex-types.ts";
import { isTaskContract, type Run, type TaskContract } from "./contracts.ts";
import {
	type HostRerunLeftovers,
	RERUN_LEFTOVER_MAX_BYTES,
	RERUN_LEFTOVER_MAX_PATHS,
	RERUN_MAX_NOTES,
	RERUN_NOTE_MAX_BYTES,
	RERUN_SOURCE_STATUSES,
} from "./host-control-protocol.ts";

/**
 * V0.8C explicit re-run of unfinished COMPLEX work (docs/architecture/COMPLEX_RERUN.md §3–§5). Pure and deterministic:
 * a candidate draft is a function of the durable source Run and current file facts only. It resumes, replays and
 * reuses nothing and grants nothing: the draft is planning-form data that `workflow.prepare` compiles like any other,
 * into a new Run with new identities and fresh evidence for every task.
 */

/** A §3-eligible source: the latest durable Run's frozen parent, plan and settled rows. */
export interface RerunSource {
	runId: string;
	status: (typeof RERUN_SOURCE_STATUSES)[number];
	parent: TaskContract;
	state: ComplexRunState;
}

/**
 * §3 rows 2–5 on the latest durable Run, in the contract's order: COMPLEX with a Host-confirmed plan; BLOCKED,
 * CANCELLED, FAILED or INTERRUPTED; at least one row not COMPLETED; not R3. Undefined means RERUN_NOT_APPLICABLE.
 */
export function rerunSource(run: Run): RerunSource | undefined {
	const parent = run.tasks[0];
	const state = run.complex;
	if (run.workflow !== "COMPLEX" || !state || run.tasks.length !== 1 || !parent || !isTaskContract(parent))
		return undefined;
	const status = RERUN_SOURCE_STATUSES.find((value) => value === run.status);
	if (!status) return undefined;
	if (state.tasks.every((row) => row.status === "COMPLETED")) return undefined;
	// A single-delete plan is never derived.
	if (run.risk === "R3") return undefined;
	return { runId: run.runId, status, parent, state };
}

/**
 * The paths whose current facts §4 needs, in plan order without duplicates: the changed files of COMPLETED rows and
 * the claims of every other row. At most the plan's 64 claims.
 */
export function rerunFactPaths(source: RerunSource): string[] {
	const paths = new Set<string>();
	for (const [index, task] of source.state.plan.tasks.entries()) {
		const row = source.state.tasks[index];
		for (const path of row?.status === "COMPLETED" ? row.changedFiles : task.ownership.map((claim) => claim.path))
			paths.add(path);
	}
	return [...paths];
}

/**
 * The longest prefix of `text` within `max` UTF-16 code units (the draft schema's character bound) that ends on a
 * code-point boundary: a surrogate pair is never split.
 */
export function codePointPrefix(text: string, max: number): string {
	let end = 0;
	for (const point of text) {
		if (end + point.length > max) break;
		end += point.length;
	}
	return text.slice(0, end);
}

const ELLIPSIS = "…";
/** One note within `RERUN_NOTE_MAX_BYTES` UTF-8 bytes; a longer one is cut on a code-point boundary and marked. */
function boundNote(text: string): string {
	if (Buffer.byteLength(text, "utf8") <= RERUN_NOTE_MAX_BYTES) return text;
	let bytes = Buffer.byteLength(ELLIPSIS, "utf8");
	let end = 0;
	for (const point of text) {
		const size = Buffer.byteLength(point, "utf8");
		if (bytes + size > RERUN_NOTE_MAX_BYTES) break;
		bytes += size;
		end += point.length;
	}
	return `${text.slice(0, end)}${ELLIPSIS}`;
}

/** §4 step 6: at most 16 bounded notes; a longer list keeps 15 and says how many were omitted, never silently. */
function boundNotes(notes: readonly string[]): string[] {
	const bounded = notes.map(boundNote);
	if (bounded.length <= RERUN_MAX_NOTES) return bounded;
	return [...bounded.slice(0, RERUN_MAX_NOTES - 1), `${bounded.length - (RERUN_MAX_NOTES - 1)} more notes omitted`];
}

/** The same fact semantics as claim admission: a safe, exactly spelled, existing regular file. */
function regularFile(fact: ComplexPathFact | undefined): boolean {
	return fact?.safe === true && fact.exactSpelling && fact.kind === "file";
}

export interface RerunDerivation {
	goal: string;
	acceptanceStatements: string[];
	draft: ComplexDraft;
	notes: string[];
}

/**
 * §4: the candidate draft. The parent is the source goal with its acceptance statements in AC order, so a prepare
 * reassigns the same AC IDs to the same statements. Task count, order and dependency indexes stay. A COMPLETED row
 * becomes a read-only verification task with the same criteria and checks, whose checks and reviews run again; its
 * earlier PASS is never carried over. Every other row keeps its title, goal, criteria and checks, with each claim
 * re-evaluated against the current file: `create` of an existing regular file becomes `modify`, and nothing else
 * changes. `facts` are the claim-fact inspector's answers for `rerunFactPaths(source)`; notes never hold contents.
 */
export function deriveRerunDraft(source: RerunSource, facts: readonly ComplexPathFact[]): RerunDerivation {
	const { parent, state } = source;
	const { plan } = state;
	const byPath = new Map(facts.map((fact) => [fact.path, fact]));
	const regular = (path: string) => regularFile(byPath.get(path));
	const criterionIds = parent.acceptanceCriteria.map((criterion) => criterion.id);
	const taskIds = plan.tasks.map((task) => task.id);
	const notes: string[] = [];
	const tasks = plan.tasks.map((task, index): ComplexDraft["tasks"][number] => {
		const row = state.tasks[index];
		// 1-based, exactly as in the source plan (§4 step 4).
		const dependsOnIndexes = task.dependsOn.map((id) => taskIds.indexOf(id) + 1);
		const criterionIndexes = task.criterionIds.map((id) => criterionIds.indexOf(id) + 1);
		if (row?.status === "COMPLETED") {
			const missing = row.changedFiles.filter((path) => !regular(path));
			if (missing.length)
				notes.push(
					`${task.id} completed files missing: ${missing.join(", ")}; a verification task cannot recreate them`,
				);
			return {
				title: codePointPrefix(`Verify: ${task.title}`, COMPLEX_TITLE_MAX_LENGTH),
				goal: codePointPrefix(`Re-verify without changes: ${task.goal}`, COMPLEX_GOAL_MAX_LENGTH),
				dependsOnIndexes,
				criterionIndexes,
				ownership: [],
				checkIds: [...task.checkIds],
			};
		}
		const ownership = task.ownership.map(({ path, operation }): OwnershipClaim => {
			if (operation === "create" && regular(path)) {
				// The source Run or the user created it; the dry run still judges the file.
				notes.push(`${task.id} claim ${path}: create became modify (file exists)`);
				return { path, operation: "modify" };
			}
			// Kept: the dry run shows that prepare refuses it.
			if (operation === "modify" && !regular(path)) notes.push(`${task.id} claim ${path}: modify target is missing`);
			return { path, operation };
		});
		return {
			title: task.title,
			goal: task.goal,
			dependsOnIndexes,
			criterionIndexes,
			ownership,
			checkIds: [...task.checkIds],
		};
	});
	return {
		goal: parent.goal,
		acceptanceStatements: parent.acceptanceCriteria.map((criterion) => criterion.statement),
		draft: { tasks },
		notes: boundNotes(notes),
	};
}

/**
 * §5 bounds over the clean-start blockers: sorted and unique, at most 200 paths and 16,384 UTF-8 bytes of names,
 * cut at the first path that does not fit, with `truncated` set. Null (Git could not answer) is unknown, never clean.
 * A dirty answer always names at least one path, so output that cannot be named is unknown too: an empty name, which
 * Git never prints, or a first name longer than the whole byte bound (longer than any path a filesystem allows).
 */
export function boundLeftovers(paths: readonly string[] | null): HostRerunLeftovers {
	const unknown: HostRerunLeftovers = { clean: null, paths: [], truncated: false };
	if (paths === null || paths.some((path) => !path)) return unknown;
	const sorted = [...new Set(paths)].sort();
	const kept: string[] = [];
	let bytes = 0;
	for (const path of sorted) {
		const size = Buffer.byteLength(path, "utf8");
		if (kept.length >= RERUN_LEFTOVER_MAX_PATHS || bytes + size > RERUN_LEFTOVER_MAX_BYTES) break;
		kept.push(path);
		bytes += size;
	}
	if (sorted.length && !kept.length) return unknown;
	return { clean: sorted.length === 0, paths: kept, truncated: kept.length < sorted.length };
}
