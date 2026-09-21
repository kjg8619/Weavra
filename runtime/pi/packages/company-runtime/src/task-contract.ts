import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "./config.ts";
import {
	MAX_ACCEPTANCE_CRITERIA,
	MAX_ACCEPTANCE_STATEMENT_LENGTH,
	type TaskContract,
	TaskContractSchema,
	validateContract,
	type Workflow,
} from "./contracts.ts";
import { assertCriterionIdentity } from "./criterion-evidence.ts";

function normalizeStatement(statement: string): string {
	return statement.trim().replace(/\s+/g, " ");
}

/** One line = one criterion. Blank lines are dropped; bounds and duplicates are reported separately. */
export function parseAcceptanceStatements(source: string): string[] {
	return source
		.split("\n")
		.map(normalizeStatement)
		.filter((line) => line.length > 0);
}

/** Host preflight rejection reasons; returns undefined when the statements are acceptable. */
export function acceptanceStatementsError(statements: readonly string[]): string | undefined {
	if (!statements.length) return "At least one acceptance criterion is required";
	if (statements.length > MAX_ACCEPTANCE_CRITERIA)
		return `At most ${MAX_ACCEPTANCE_CRITERIA} acceptance criteria are supported`;
	for (const [index, statement] of statements.entries()) {
		if (!statement.trim()) return `Acceptance criterion ${index + 1} is blank`;
		if (statement.length > MAX_ACCEPTANCE_STATEMENT_LENGTH)
			return `Acceptance criterion ${index + 1} exceeds ${MAX_ACCEPTANCE_STATEMENT_LENGTH} characters`;
	}
	const normalized = statements.map((statement) => normalizeStatement(statement).toLowerCase());
	if (new Set(normalized).size !== normalized.length) return "Duplicate acceptance criteria are not allowed";
	return undefined;
}

export interface TaskContractInput {
	goal: string;
	statements: readonly string[];
	workflow: Workflow;
	config: RuntimeConfig;
	taskId?: string;
}

/** Host-side construction: assigns stable sequential IDs and maps registered required checks. Workers never call this. */
export function buildTaskContract(input: TaskContractInput): TaskContract {
	const statements = input.statements.map(normalizeStatement);
	const error = acceptanceStatementsError(statements);
	if (error) throw new Error(error);
	const checkIds = input.config.verification.checks.filter((check) => check.required).map((check) => check.id);
	// Criteria may map to zero checks (no required checks configured); the Workflow still requires
	// at least one required check for every live run, and STANDARD criteria are covered by review evidence.
	const contract = validateContract(TaskContractSchema, {
		id: input.taskId ?? randomUUID(),
		goal: input.goal,
		acceptanceCriteria: statements.map((statement, index) => ({
			id: `AC-${String(index + 1).padStart(3, "0")}`,
			statement,
			scope: { paths: [...input.config.files.allowed_paths] },
			verification: { checkIds, reviewRequired: input.workflow === "STANDARD" },
		})),
		status: "pending",
	});
	assertCriterionIdentity(contract.acceptanceCriteria);
	return contract;
}

/** Fail-closed binding between a Host-confirmed contract and the trusted run configuration. */
export function assertTaskContractBinding(
	contract: TaskContract,
	options: { workflow: Workflow; config: RuntimeConfig },
): void {
	validateContract(TaskContractSchema, contract);
	assertCriterionIdentity(contract.acceptanceCriteria);
	const registered = new Set(options.config.verification.checks.map((check) => check.id));
	for (const criterion of contract.acceptanceCriteria) {
		for (const id of criterion.verification.checkIds)
			if (!registered.has(id)) throw new Error(`Acceptance criterion ${criterion.id} maps to an unregistered check`);
		if (options.workflow === "QUICK" && criterion.verification.reviewRequired)
			throw new Error("QUICK cannot satisfy review-required acceptance criteria; select STANDARD");
		if (options.workflow === "STANDARD" && !criterion.verification.reviewRequired)
			throw new Error("STANDARD acceptance criteria must require independent review");
	}
}

/** One-line summary used by prompts and observation. */
export function formatAcceptanceCriteria(contract: TaskContract): string[] {
	return contract.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.statement}`);
}
