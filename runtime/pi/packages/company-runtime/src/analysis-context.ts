import { type AnchoredFileIdentity, readAnchoredSource, sameAnchoredIdentity } from "./anchored-files.ts";
import { browserProjectId, validateRegisteredBrowserCheck } from "./browser-types.ts";
import type { RuntimeConfig } from "./config.ts";
import {
	type AnalysisContext,
	AnalysisContextSchema,
	type SymptomVerification,
	type TaskContract,
	type TaskPreparation,
	validateContract,
} from "./contracts.ts";
import { HostWorkflowError } from "./host-workflow-error.ts";
import { isListablePath } from "./policy.ts";
import { resolveExecutable, verificationEnvironment } from "./process-runner.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
import { snapshotCheckTrust, validateVerifierTrust } from "./verifier-trust.ts";

export interface PreparedAnalysisContext {
	readonly packet: AnalysisContext;
	/** First-use consent fence only. Historical findings are not revalidated against the Run's own edits. */
	readonly assertCurrent: () => void;
}

/** Read-only, bounded Host capture. Supplied hashes are compared, never replaced with newer bytes. */
export async function prepareAnalysisContext(
	cwd: string,
	config: RuntimeConfig,
	input: AnalysisContext,
): Promise<PreparedAnalysisContext> {
	const packet = structuredClone(validateContract(AnalysisContextSchema, input));
	const protectedPaths = await resolveProjectProtectedPaths(cwd, config);
	if (config.project) protectedPaths.push(config.project.instructions.path);
	const policy = { allowedPaths: config.files.allowed_paths, protectedPaths };
	const identities = new Map<string, AnchoredFileIdentity>();
	const assertCurrent = () => {
		for (const reference of packet.sourceReferences) {
			if (!isListablePath(reference.path, policy))
				throw new HostWorkflowError("POLICY_DENIED", "Analysis source is outside the worker's readable scope");
			let source: ReturnType<typeof readAnchoredSource>;
			try {
				source = readAnchoredSource(cwd, reference.path);
			} catch {
				throw new HostWorkflowError("PLAN_CHANGED", "Analysis source is missing, unsafe or unreadable");
			}
			const previous = identities.get(reference.path);
			if (
				source.fileDigest !== reference.digest ||
				(previous && !sameAnchoredIdentity(previous, source.identity)) ||
				(reference.lines && reference.lines.end > source.text.split("\n").length)
			)
				throw new HostWorkflowError("PLAN_CHANGED", "Analysis source changed; review a new packet");
			if (!previous) identities.set(reference.path, source.identity);
		}
	};
	assertCurrent();
	return { packet: structuredClone(packet), assertCurrent };
}

/** Compile an ordinal to the actual criterion and freeze the existing registered program, without running it. */
export async function prepareSymptomVerification(input: {
	cwd: string;
	config: RuntimeConfig;
	contract: TaskContract;
	configDigest: string;
	proposal: NonNullable<TaskPreparation["symptomVerification"]>;
}): Promise<{ binding: SymptomVerification; assertCurrent: () => void }> {
	const { cwd, config, contract, configDigest, proposal } = input;
	const criterion = contract.acceptanceCriteria[proposal.criterionIndex - 1];
	const check = config.verification.checks.find((check) => check.id === proposal.checkId);
	if (
		!criterion ||
		!criterion.verification.reviewRequired ||
		!criterion.verification.checkIds.includes(proposal.checkId) ||
		!check?.required
	)
		throw new HostWorkflowError("INVALID_CRITERIA", "The symptom must map to a registered required criterion check");
	try {
		if (check.kind === "browser") {
			validateRegisteredBrowserCheck(check.browser);
			if (check.browser.checkId !== check.id || check.browser.projectId !== browserProjectId(cwd))
				throw new Error("Foreign browser registration");
		}
		const environment = verificationEnvironment();
		const snapshot = snapshotCheckTrust(cwd, {
			check,
			executable: await resolveExecutable(check.executable, environment.PATH),
			configDigest,
			trustMode: check.kind === "browser" ? "strict" : config.verification.trust.mode,
			environment,
		});
		return {
			binding: { criterionId: criterion.id, checkId: check.id, registrationDigest: snapshot.registrationDigest },
			assertCurrent: () => {
				if (!validateVerifierTrust(cwd, snapshot).ok)
					throw new HostWorkflowError("PLAN_CHANGED", "The symptom check registration changed; prepare again");
			},
		};
	} catch {
		throw new HostWorkflowError("INVALID_CRITERIA", "The symptom check registration cannot be captured");
	}
}
