import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { workerDigest } from "./agent-tools.ts";
import { evaluateBrowserAssertion, invalidateBrowserCheck, validBrowserCheckEvidence } from "./browser-evidence.ts";
import { observeLocalBrowser } from "./browser-observation.ts";
import {
	type BrowserObservationCandidate,
	type BrowserVerificationEvidence,
	browserDigest,
	browserEvidenceDigestOf,
	browserProjectId,
	type RegisteredBrowserCheck,
	validateRegisteredBrowserCheck,
} from "./browser-types.ts";
import type { RuntimeConfig } from "./config.ts";
import type { CheckRequirement, CheckResult, VerificationResult } from "./contracts.ts";
import { collectLspEvidence, markStaleLspEvidence } from "./lsp/evidence.ts";
import type { LspEvidence, LspPort } from "./lsp/types.ts";
import { type ActionAudit, evaluateRegisteredCheck, type PolicyContext, type RegisteredCheck } from "./policy.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import type { VerificationRequest, Verifier } from "./ports.ts";
import { ProcessCleanupError, resolveExecutable, runProcess, verificationEnvironment } from "./process-runner.ts";
import {
	buildSandboxPolicy,
	canonicalHostPath,
	probeSandboxBackend,
	runSandboxedCheck,
	type SandboxPolicySnapshot,
	SandboxUnavailableError,
	sandboxEvidence,
	validateSandboxBackend,
} from "./sandbox.ts";
import {
	executableIdentityDigest,
	registrationDigestOf,
	resolveVerifierTrustSources,
	snapshotBrowserImplementation,
	snapshotVerifierExecutable,
	snapshotVerifierSources,
	type VerifierTrustSnapshot,
	validateVerifierTrust,
	verifierTrustEvidence,
} from "./verifier-trust.ts";
import type { DiffEvidence, GitWorkspace } from "./workspace.ts";

export class RegisteredVerifier implements Verifier {
	readonly workspace: GitWorkspace;
	private processCleanupConfirmed = true;
	get safeToRelease(): boolean {
		return this.processCleanupConfirmed && this.workspace.safeToRelease && this.lsp?.cleanupFailed !== true;
	}
	private readonly config: RuntimeConfig;
	private readonly policy: PolicyContext;
	private readonly audit: ActionAudit;
	private readonly paths: FilePolicyPathInspector;
	private readonly registrations: Array<RegisteredCheck | undefined>;
	private readonly trustSnapshots: Array<VerifierTrustSnapshot | undefined>;
	private readonly sandbox?: SandboxPolicySnapshot;
	private readonly lsp?: LspPort;
	private constructor(
		config: RuntimeConfig,
		policy: PolicyContext,
		audit: ActionAudit,
		workspace: GitWorkspace,
		paths: FilePolicyPathInspector,
		registrations: Array<RegisteredCheck | undefined>,
		trustSnapshots: Array<VerifierTrustSnapshot | undefined>,
		sandbox: SandboxPolicySnapshot | undefined,
		lsp?: LspPort,
	) {
		this.trustSnapshots = trustSnapshots;
		this.sandbox = sandbox;
		this.lsp = lsp;
		this.config = config;
		this.policy = policy;
		this.audit = audit;
		this.workspace = workspace;
		this.paths = paths;
		this.registrations = registrations;
	}
	static async create(
		config: RuntimeConfig,
		policy: PolicyContext,
		audit: ActionAudit,
		workspace: GitWorkspace,
		lsp?: LspPort,
	): Promise<RegisteredVerifier> {
		config = structuredClone(config);
		const env = verificationEnvironment();
		const registrations = await Promise.all(
			config.verification.checks.map(async (check) => {
				if (check.kind === "browser") {
					validateRegisteredBrowserCheck(check.browser);
					if (check.browser.checkId !== check.id || check.browser.projectId !== browserProjectId(workspace.cwd))
						throw new Error("Browser check belongs to another registration or project");
				}
				let executable: string;
				try {
					executable = await resolveExecutable(check.executable, env.PATH);
				} catch {
					if (check.kind === "browser") throw new Error("Registered browser executable unavailable");
					return undefined;
				}
				return {
					id: check.id,
					executable,
					argv: [...check.args],
					cwd: check.cwd,
					timeoutMs: check.timeout_ms,
					env: { ...env },
				};
			}),
		);
		const trustMode = config.verification.trust?.mode ?? "compatible";
		// Strict: a missing/invalid declared trust source or unreadable direct source fails before any process.
		// Compatible: existing behavior is preserved; trust metadata degrades to absent instead of failing the Run.
		const trustSnapshots = registrations.map((registration, index) => {
			if (!registration) return undefined;
			const check = config.verification.checks[index];
			const mode = check.kind === "browser" ? "strict" : trustMode;
			try {
				const sources = snapshotVerifierSources(workspace.cwd, resolveVerifierTrustSources(workspace.cwd, check));
				const executable = snapshotVerifierExecutable(registration.executable);
				const runtimeSources = check.kind === "browser" ? snapshotBrowserImplementation() : undefined;
				return {
					mode,
					registrationDigest: registrationDigestOf({
						check,
						executable,
						sources,
						configDigest: policy.configDigest,
						trustMode: mode,
						environment: registration.env,
						...(runtimeSources ? { runtimeSources } : {}),
					}),
					executableDigest: executableIdentityDigest(executable),
					executable,
					sources,
					...(runtimeSources ? { runtimeSources } : {}),
				};
			} catch (error) {
				if (mode === "strict") throw error;
				return undefined;
			}
		});
		// Sandbox preflight runs before any worker model interaction; required mode never falls back unsandboxed.
		const sandboxMode = config.verification.sandbox?.mode ?? "disabled";
		let sandbox: SandboxPolicySnapshot | undefined;
		if (sandboxMode === "required" && config.verification.checks.some((check) => check.kind !== "browser")) {
			const trustedSources = [
				...new Set(
					config.verification.checks.flatMap((check) => resolveVerifierTrustSources(workspace.cwd, check)),
				),
			];
			const canonicalTrust = trustedSources.map((path) => canonicalHostPath(join(workspace.cwd, path)));
			const protectedCandidates = [
				...new Set([
					...(policy.protectedPaths ?? []),
					...(policy.projectInstruction?.path ? [policy.projectInstruction.path] : []),
					".git",
					".ai",
					".env",
				]),
			].map((path) => canonicalHostPath(join(workspace.cwd, path)));
			// Worker protection is not the sandbox read boundary, but a trusted source nested inside a
			// protected read region (or equal to it) would stop the verifier from reading its own oracle.
			for (const source of canonicalTrust) {
				for (const protectedPath of protectedCandidates) {
					// Exact equality is a Worker-protection entry, not a read-boundary conflict.
					if (source.startsWith(`${protectedPath}${sep}`))
						throw new SandboxUnavailableError(
							"trusted verifier source conflicts with sandbox protected read boundary",
						);
				}
			}
			sandbox = buildSandboxPolicy({
				workspace: canonicalHostPath(workspace.cwd),
				trustedSources,
				// Trusted sources stay write-denied through trustedSources; they are not read-denied here.
				protectedPaths: protectedCandidates.filter((path) => !canonicalTrust.includes(path)),
			});
			const probe = await probeSandboxBackend(sandbox);
			if (!probe.ok) throw new SandboxUnavailableError(probe.reason ?? "OS sandbox backend preflight failed");
		}
		return new RegisteredVerifier(
			config,
			structuredClone(policy),
			audit,
			workspace,
			await FilePolicyPathInspector.open(workspace.cwd),
			registrations,
			trustSnapshots,
			sandbox,
			lsp,
		);
	}
	/**
	 * Bounded Host metadata for the Kernel guard: the frozen registration digest per check.
	 * Never exposes sources, env or executable paths, and never comes from a Verifier result.
	 */
	get trustRequirements(): Array<{
		id: string;
		kind: CheckRequirement["kind"];
		required: boolean;
		trustRequired: boolean;
		trustRegistrationDigest: string;
		sandboxRequired: boolean;
		sandboxPolicyDigest: string;
		repairableExitCodes: number[];
		browser?: RegisteredBrowserCheck;
	}> {
		return this.config.verification.checks.map((check, index) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			trustRequired: this.trustSnapshots[index]?.mode === "strict",
			trustRegistrationDigest: this.trustSnapshots[index]?.registrationDigest ?? "",
			sandboxRequired: check.kind !== "browser" && this.sandbox !== undefined,
			sandboxPolicyDigest: check.kind !== "browser" ? (this.sandbox?.policyDigest ?? "") : "",
			repairableExitCodes: [...(check.repairable_exit_codes ?? [])],
			...(check.kind === "browser" ? { browser: structuredClone(check.browser) } : {}),
		}));
	}

	private async cwdSafe(path: string): Promise<boolean> {
		const cwd = join(this.workspace.cwd, path);
		try {
			return path === "."
				? (await realpath(cwd)) === this.workspace.cwd && (await lstat(cwd)).isDirectory()
				: (await this.paths.inspect([path])).every((item) => item.safe && item.kind === "directory");
		} catch {
			return false;
		}
	}
	async inspect(signal?: AbortSignal) {
		const { diff: _diff, ...snapshot } = await this.workspace.inspect(signal);
		return snapshot;
	}

	private async verifyBrowserCheck(
		base: CheckResult,
		check: Extract<RuntimeConfig["verification"]["checks"][number], { kind: "browser" }>,
		executable: string,
		snapshot: VerifierTrustSnapshot,
		signal?: AbortSignal,
	): Promise<CheckResult> {
		if (!base.step || !snapshot.runtimeSources) throw new Error("Missing frozen browser verifier identity");
		this.processCleanupConfirmed = false;
		let capture: BrowserObservationCandidate;
		try {
			capture = await observeLocalBrowser({
				url: check.browser.documentIdentity,
				executable,
				localTestApp: true,
				projectRoot: this.workspace.cwd,
				target: structuredClone(check.browser.target),
				signal,
			});
			this.processCleanupConfirmed = true;
		} catch (error) {
			if (error instanceof ProcessCleanupError) throw error;
			this.processCleanupConfirmed = true;
			return {
				...base,
				finishedAt: Date.now(),
				status: signal?.aborted ? "SKIPPED" : "UNAVAILABLE",
				reason: signal?.aborted ? "Browser capture cancelled" : "Browser capture unavailable or denied",
				trust: verifierTrustEvidence(snapshot, validateVerifierTrust(this.workspace.cwd, snapshot).status),
			};
		}
		const current = await this.workspace.inspect();
		const trust = validateVerifierTrust(this.workspace.cwd, snapshot);
		const target = capture.observation.target;
		const identityMatches =
			capture.projectId === check.browser.projectId &&
			capture.documentIdentity === check.browser.documentIdentity &&
			capture.source.implementationRevision === browserDigest(snapshot.runtimeSources.sources) &&
			capture.source.executableIdentityDigest === snapshot.executableDigest &&
			browserDigest(target?.target) === browserDigest(check.browser.target);
		const fresh =
			Date.now() >= capture.capturedAt && Date.now() - capture.capturedAt <= check.browser.freshness.maxAgeMs;
		const passed =
			!signal?.aborted &&
			current.safe &&
			current.diffDigest === base.diffDigest &&
			trust.ok &&
			identityMatches &&
			fresh &&
			target !== undefined &&
			evaluateBrowserAssertion(check.browser.assertion, target);
		const evidence: Omit<BrowserVerificationEvidence, "browserEvidenceDigest"> = {
			version: 1,
			registrationDigest: check.browser.registrationDigest,
			projectId: check.browser.projectId,
			origin: check.browser.origin,
			documentIdentity: check.browser.documentIdentity,
			documentDigest: capture.pageRevision,
			observationType: "target",
			target: structuredClone(check.browser.target),
			assertion: structuredClone(check.browser.assertion),
			freshness: structuredClone(check.browser.freshness),
			captureId: capture.candidateId,
			capturedAt: capture.capturedAt,
			implementationRevision: capture.source.implementationRevision,
			executableIdentityDigest: capture.source.executableIdentityDigest,
			browserVersion: capture.source.browserVersion,
			observationDigest: capture.observationDigest,
			isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE",
			cleanup: "CONFIRMED",
			result: passed ? "PASS" : "FAIL",
		};
		return {
			...base,
			status: passed ? "PASS" : "FAIL",
			finishedAt: Date.now(),
			exitCode: null,
			reason: passed ? "Fresh browser assertion passed" : "Browser assertion failed or capture integrity changed",
			trust: verifierTrustEvidence(snapshot, trust.status),
			browser: {
				...evidence,
				browserEvidenceDigest: browserEvidenceDigestOf(evidence, {
					checkId: base.id,
					runId: base.runId,
					revision: base.revision,
					step: base.step,
					diffDigest: base.diffDigest,
				}),
			},
		};
	}
	async verify(request: VerificationRequest): Promise<VerificationResult> {
		if (!this.safeToRelease) throw new ProcessCleanupError();
		if (this.policy.r3Scope && request.runId !== this.policy.r3Scope.runId)
			throw new Error("R3 verifier run binding mismatch");
		if (this.policy.r2RunId && request.runId !== this.policy.r2RunId)
			throw new Error("R2 verifier run binding mismatch");
		const configured = this.config.verification.checks;
		const repairEnabled = this.config.verification.repair.mode === "self-check-once";
		const requirementOf = (check: {
			id: string;
			kind: string;
			required: boolean;
			trustRequired?: boolean;
			trustRegistrationDigest?: string;
			sandboxRequired?: boolean;
			sandboxPolicyDigest?: string;
			repairableExitCodes?: number[];
			browser?: RegisteredBrowserCheck;
		}) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			...(check.trustRequired === true ? { trustRequired: true } : {}),
			...(check.trustRegistrationDigest ? { trustRegistrationDigest: check.trustRegistrationDigest } : {}),
			...(check.sandboxRequired === true ? { sandboxRequired: true } : {}),
			...(check.sandboxPolicyDigest ? { sandboxPolicyDigest: check.sandboxPolicyDigest } : {}),
			...(check.repairableExitCodes?.length ? { repairableExitCodes: check.repairableExitCodes } : {}),
			...(check.browser ? { browser: browserDigest(check.browser) } : {}),
		});
		const frozenRequirements = this.trustRequirements;
		if (
			JSON.stringify(request.checks.map(requirementOf)) !==
			JSON.stringify(
				frozenRequirements.map((check) =>
					requirementOf({
						...check,
						trustRegistrationDigest: check.trustRequired || repairEnabled ? check.trustRegistrationDigest : "",
					}),
				),
			)
		)
			throw new Error("Verification request changed registered checks");
		const before = await this.workspace.inspect(request.signal);
		if (!before.safe) throw new Error("Unsupported workspace mutation; review required");
		const checks: CheckResult[] = [];
		for (const [index, check] of configured.entries()) {
			const now = Date.now();
			const base: CheckResult = {
				id: check.id,
				runId: request.runId,
				revision: request.revision,
				step: structuredClone(request.step),
				kind: check.kind,
				required: check.required,
				status: "SKIPPED",
				exitCode: null,
				reason: "Cancelled before check",
				startedAt: now,
				finishedAt: now,
				evidenceRefs: [`check:${request.runId}:${request.step.stepId}:${request.step.attempt}:${check.id}`],
				diffDigest: before.diffDigest,
				stdout: "",
				stderr: "",
			};
			if (request.signal?.aborted) {
				checks.push(base);
				continue;
			}
			const registration = this.registrations[index];
			if (!registration) {
				checks.push({ ...base, status: "UNAVAILABLE", reason: "Registered executable unavailable" });
				continue;
			}
			const action = structuredClone(registration);
			const cwd = join(this.workspace.cwd, action.cwd);
			const cwdSafe = await this.cwdSafe(action.cwd);
			const decision = evaluateRegisteredCheck(
				{
					runId: request.runId,
					actionId: randomUUID(),
					actionDigest: workerDigest({
						executionContract: { runId: this.policy.executionRunId, mode: this.policy.executionMode },
						projectInstructionDigest: this.policy.projectInstruction?.digest ?? null,
						request: action,
						step: request.step,
						revision: request.revision,
						...(check.kind === "browser" ? { browser: check.browser } : {}),
					}),
				},
				action,
				registration,
				this.policy,
				cwdSafe,
			);
			await this.audit.prepare(decision);
			if (decision.decision !== "ALLOW") {
				checks.push({
					...base,
					status:
						request.handoff.role === "Executor" || this.policy.r2RunId || this.policy.r3Scope
							? "FAIL"
							: "UNAVAILABLE",
					reason: "Check blocked by execution policy",
				});
				continue;
			}
			let intentOpen = true;
			try {
				await this.audit.assertWritable();
				if (!(await this.cwdSafe(action.cwd))) {
					intentOpen = false;
					await this.audit.finish(decision.runId, decision.actionId, "FAILED");
					checks.push({
						...base,
						status:
							request.handoff.role === "Executor" || this.policy.r2RunId || this.policy.r3Scope
								? "FAIL"
								: "UNAVAILABLE",
						reason: "Check cwd changed after intent persistence",
					});
					continue;
				}
				const trustSnapshot = this.trustSnapshots[index];
				const preTrust =
					trustSnapshot && (trustSnapshot.mode === "strict" || repairEnabled)
						? validateVerifierTrust(this.workspace.cwd, trustSnapshot)
						: undefined;
				if (trustSnapshot?.mode === "strict") {
					if (!preTrust?.ok) {
						intentOpen = false;
						await this.audit.finish(decision.runId, decision.actionId, "FAILED");
						checks.push({
							...base,
							// A trust violation is never PASS and never silently optional.
							status: "FAIL",
							reason: `${preTrust?.reason ?? "Verifier trust source changed"} before execution`,
							trust: verifierTrustEvidence(trustSnapshot, "STALE"),
						});
						continue;
					}
				}
				if (check.kind === "browser") {
					if (!trustSnapshot) throw new Error("Browser verifier trust unavailable");
					const result = await this.verifyBrowserCheck(
						base,
						check,
						action.executable,
						trustSnapshot,
						request.signal,
					);
					await this.audit.assertWritable();
					intentOpen = false;
					await this.audit.finish(
						decision.runId,
						decision.actionId,
						request.signal?.aborted ? "INTERRUPTED" : result.status === "PASS" ? "SUCCEEDED" : "FAILED",
					);
					checks.push(result);
					continue;
				}
				request.signal?.throwIfAborted();
				this.processCleanupConfirmed = false;
				const sandboxRun = this.sandbox
					? await runSandboxedCheck({
							snapshot: this.sandbox,
							executable: action.executable,
							argv: action.argv,
							cwd,
							env: action.env,
							timeoutMs: action.timeoutMs,
							signal: request.signal,
						})
					: undefined;
				const result =
					sandboxRun?.result ??
					(await runProcess({
						executable: action.executable,
						argv: action.argv,
						cwd,
						env: action.env,
						timeoutMs: action.timeoutMs,
						signal: request.signal,
					}));
				this.processCleanupConfirmed = result.cleanupConfirmed;
				if (!this.safeToRelease) {
					intentOpen = false;
					await this.audit.finish(decision.runId, decision.actionId, "INTERRUPTED");
					throw new ProcessCleanupError();
				}
				await this.audit.assertWritable();
				intentOpen = false;
				await this.audit.finish(
					decision.runId,
					decision.actionId,
					request.signal?.aborted
						? "INTERRUPTED"
						: result.reason === "exited" && result.exitCode === 0
							? "SUCCEEDED"
							: "FAILED",
				);
				let current: DiffEvidence;
				try {
					current = await this.workspace.inspect();
				} catch {
					if (!this.workspace.safeToRelease) throw new ProcessCleanupError();
					current = { ...before, safe: false };
				}
				const post = trustSnapshot ? validateVerifierTrust(this.workspace.cwd, trustSnapshot) : undefined;
				checks.push({
					...base,
					status:
						post && !post.ok
							? "FAIL"
							: result.reason === "unavailable"
								? "UNAVAILABLE"
								: result.reason === "exited" &&
										result.exitCode === 0 &&
										current.safe &&
										!request.signal?.aborted
									? "PASS"
									: "FAIL",
					exitCode: result.exitCode,
					reason: post
						? post.ok
							? `Check ${request.signal?.aborted ? "cancelled" : result.reason}${current.safe ? "" : "; unsupported mutation"}`
							: `${post.reason ?? "Verifier trust source changed"} during execution`
						: `Check ${request.signal?.aborted ? "cancelled" : result.reason}${current.safe ? "" : "; unsupported mutation"}`,
					startedAt: result.startedAt,
					finishedAt: result.finishedAt,
					stdout: result.stdout,
					stderr: result.stderr,
					diffDigest: current.diffDigest,
					...(repairEnabled &&
					result.reason === "exited" &&
					result.exitCode !== null &&
					(check.repairable_exit_codes ?? []).includes(result.exitCode) &&
					result.cleanupConfirmed &&
					preTrust?.ok &&
					post?.ok &&
					current.safe &&
					!request.signal?.aborted &&
					(!this.sandbox || sandboxRun?.status === "ENFORCED")
						? { failureKind: "COMMAND_NONZERO" as const }
						: {}),
					...(trustSnapshot
						? {
								trust: verifierTrustEvidence(
									trustSnapshot,
									post?.ok ? (trustSnapshot.mode === "strict" ? "VERIFIED" : "UNVERIFIED") : "STALE",
								),
							}
						: {}),
					...(this.sandbox && sandboxRun
						? {
								sandbox: sandboxEvidence(this.sandbox, sandboxRun.status),
							}
						: {}),
				});
			} catch (error) {
				// An intent may remain PREPARED on storage failure; S2 recovery marks it INTERRUPTED, never replays.
				if (!this.safeToRelease) throw new ProcessCleanupError();
				if (request.signal?.aborted && intentOpen && error === request.signal.reason) {
					await this.audit.finish(decision.runId, decision.actionId, "INTERRUPTED");
					checks.push({ ...base, reason: "Cancelled before process start" });
				} else throw error;
			}
		}
		let final: DiffEvidence;
		try {
			final = await this.workspace.inspect();
		} catch {
			if (!this.workspace.safeToRelease) throw new ProcessCleanupError();
			final = { ...before, safe: false };
		}
		const lspConfig = this.config.code_intelligence?.lsp;
		let lspEvidence: LspEvidence[] | undefined;
		if (this.lsp && lspConfig?.enabled && final.safe && !request.signal?.aborted) {
			try {
				lspEvidence = await collectLspEvidence(this.lsp, lspConfig, request, final.changedFiles, final.diffDigest);
			} catch (error) {
				if (error instanceof ProcessCleanupError || this.lsp.cleanupFailed) {
					this.processCleanupConfirmed = false;
					throw new ProcessCleanupError();
				}
				if (!request.signal?.aborted) throw error;
				// Preserve already-executed process outcomes on LSP cancellation, as on process cancellation.
				const now = Date.now();
				lspEvidence = [
					{
						serverId: "runtime",
						status: "ERROR",
						diagnostics: [],
						reason: "LSP diagnostics cancelled",
						diffDigest: final.diffDigest,
						evidenceRef: `lsp:${request.runId}:${request.step.stepId}:${request.step.attempt}:cancelled`,
						startedAt: now,
						finishedAt: now,
						withheld: 0,
						truncated: 0,
					},
				];
			}
		}
		if (lspEvidence) {
			try {
				final = await this.workspace.inspect();
			} catch {
				if (!this.workspace.safeToRelease) throw new ProcessCleanupError();
				final = { ...final, safe: false };
			}
			markStaleLspEvidence(lspEvidence, final.diffDigest, final.safe);
		}
		let integrity = final.safe && !request.signal?.aborted && this.safeToRelease;
		if (this.sandbox) {
			const backendState = validateSandboxBackend(this.sandbox.backend);
			if (!backendState.ok) {
				integrity = false;
				for (const check of checks)
					if (check.sandbox) {
						if (check.status === "PASS") check.status = "FAIL";
						check.reason = backendState.reason ?? "Verifier sandbox backend changed";
						check.sandbox = sandboxEvidence(this.sandbox, "STALE");
						delete check.failureKind;
					}
			}
			if (checks.some((check) => check.kind !== "browser" && check.sandbox?.status !== "ENFORCED"))
				integrity = false;
		}
		for (const [index, check] of checks.entries()) {
			const snapshot = this.trustSnapshots[index];
			if (repairEnabled || (check.status === "PASS" && snapshot?.mode === "strict")) {
				const settled = snapshot ? validateVerifierTrust(this.workspace.cwd, snapshot) : undefined;
				if (!settled?.ok) {
					integrity = false;
					if (check.status === "PASS") check.status = "FAIL";
					check.reason = `${settled?.reason ?? "Verifier trust unavailable"} before result settlement`;
					if (snapshot) check.trust = verifierTrustEvidence(snapshot, "STALE");
					delete check.failureKind;
				}
			}
		}
		for (const check of checks)
			if (request.signal?.aborted || !final.safe || check.diffDigest !== final.diffDigest) {
				integrity = false;
				delete check.failureKind;
				if (check.status !== "PASS") continue;
				check.status = "FAIL";
				check.reason = request.signal?.aborted
					? "Verification cancelled before result settlement"
					: "Workspace changed or evidence unavailable; check evidence is stale";
			}
		for (const [index, check] of checks.entries()) {
			if (check.kind !== "browser") continue;
			const definition = configured[index];
			if (
				check.status === "PASS" &&
				(definition.kind !== "browser" || !validBrowserCheckEvidence(check, definition.browser, Date.now()))
			) {
				check.status = "FAIL";
				check.reason = "Browser evidence expired or changed before result settlement";
				integrity = false;
			}
			if (check.status !== "PASS") invalidateBrowserCheck(check);
		}
		return {
			runId: request.runId,
			revision: request.revision,
			step: request.step,
			diffDigest: final.diffDigest,
			evidenceRefs: [...final.evidenceRefs, ...(lspEvidence?.map((item) => item.evidenceRef) ?? [])],
			...(lspEvidence ? { lspEvidence } : {}),
			changedFiles: final.changedFiles,
			checks,
			...(repairEnabled ? { integrity: integrity ? ("CLEAN" as const) : ("BLOCKED" as const) } : {}),
			reviewContext: {
				diff: final.diff,
				evidence: [
					{
						ref: final.evidenceRefs[0],
						content: `Actual changed files: ${JSON.stringify(final.changedFiles)}\nDigest: ${final.diffDigest}`,
					},
					...checks.map((check) => ({ ref: check.evidenceRefs[0], content: JSON.stringify(check) })),
					...(lspEvidence?.map((item) => ({ ref: item.evidenceRef, content: JSON.stringify(item) })) ?? []),
				],
			},
		};
	}
}
