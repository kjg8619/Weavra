// Read-only local prerequisites; no SDK/auth, check execution, state recovery, or lock acquisition.
import { spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { loadRuntimeConfig } from "./config.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import { resolveExecutable, verificationEnvironment } from "./process-runner.ts";
import { resolveSandboxBackend } from "./sandbox.ts";
import { FileStateStore } from "./state-store.ts";
import { probeWorkspaceEvidence, readCleanStartBlockers, WorkspaceEvidenceError } from "./workspace.ts";

type Severity = "ERROR" | "WARN" | "INFO";
type Diagnostic = { readonly code: string; readonly severity: Severity; readonly action: string };
type Configuration = {
	readonly requiredChecks: number;
	readonly sandboxMode: "disabled" | "required";
	readonly budgetConfigured: boolean;
	readonly maxWorkerInvocations: number | null;
	readonly maxReportedTokens: number | null;
};
export type ProjectReadiness = {
	readonly schemaVersion: 1;
	readonly ready: boolean;
	readonly diagnostics: readonly Diagnostic[];
	readonly configuration: Configuration | null;
};

/** Fixed Git flags and bounded output, without optional Git index locks, hooks, or user config. */
export async function gitProjectRoot(cwd: string): Promise<boolean> {
	const result = spawnSync(
		"git",
		[
			"--no-optional-locks",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
			"rev-parse",
			"--show-toplevel",
		],
		{
			cwd,
			env: {
				PATH: process.env.PATH,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_TERMINAL_PROMPT: "0",
				GIT_OPTIONAL_LOCKS: "0",
			},
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
			maxBuffer: 4096,
		},
	);
	if (result.error || result.status !== 0 || !result.stdout.trim()) return false;
	try {
		return (await realpath(result.stdout.trim())) === (await realpath(cwd));
	} catch {
		return false;
	}
}

export async function projectReadiness(cwd: string): Promise<ProjectReadiness> {
	const diagnostics: Diagnostic[] = [];
	const add = (code: string, severity: Severity, action: string) => diagnostics.push({ code, severity, action });
	if (!(await gitProjectRoot(cwd)))
		add("GIT_PROJECT_ROOT_REQUIRED", "ERROR", "Run from the root of a Git project with git on PATH.");
	else {
		const head = spawnSync(
			"git",
			[
				"--no-optional-locks",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.hooksPath=/dev/null",
				"rev-parse",
				"--verify",
				"HEAD^{commit}",
			],
			{
				cwd,
				env: {
					PATH: process.env.PATH,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
				},
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 5000,
				maxBuffer: 4096,
			},
		);
		if (head.status !== 0 || head.error)
			add("GIT_HEAD_MISSING", "ERROR", "Create an initial Git commit before starting a workflow.");
		const blockers = await readCleanStartBlockers(cwd);
		if (blockers === null)
			add("WORKSPACE_UNAVAILABLE", "ERROR", "Inspect Git workspace status and path safety manually.");
		else if (blockers.length)
			add("WORKSPACE_DIRTY", "ERROR", "Review and resolve existing workspace changes before starting a workflow.");
	}
	try {
		const directory = join(cwd, ".ai");
		let directoryExists = false;
		try {
			const stat = await lstat(directory);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe directory");
			directoryExists = true;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		if (directoryExists) {
			const snapshot = await FileStateStore.readSnapshot(cwd);
			if (snapshot.writerPresent)
				add("WRITER_LOCK_PRESENT", "ERROR", "Inspect the project writer lock; no recovery was attempted.");
			if (snapshot.state?.runs.some((run) => ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status)))
				add(
					"ACTIVE_RUN_PRESENT",
					"ERROR",
					"Inspect the active Runtime Run before starting another workflow; no recovery was attempted.",
				);
			if (snapshot.state && !snapshot.tasksCurrent)
				add("STATE_PROJECTION_STALE", "ERROR", "Inspect state and tasks projection; no repair was attempted.");
		}
	} catch {
		add("STATE_UNAVAILABLE", "ERROR", "Inspect .ai directory and Runtime state integrity manually.");
	}
	let configuration: Configuration | null = null;
	try {
		const loaded = await loadRuntimeConfig(cwd);
		if (loaded.status === "missing")
			add("CONFIG_MISSING", "ERROR", "Supply a reviewed YAML file with weavra project init --config <file>.");
		else {
			const config = loaded.config;
			configuration = {
				requiredChecks: config.verification.checks.filter((check) => check.required).length,
				sandboxMode: config.verification.sandbox.mode,
				budgetConfigured: !!config.budget,
				maxWorkerInvocations: config.budget?.max_worker_invocations ?? null,
				maxReportedTokens: config.budget?.max_reported_tokens ?? null,
			};
			if (configuration.requiredChecks === 0)
				add(
					"REQUIRED_CHECK_MISSING",
					"ERROR",
					"Register at least one required verification check in .ai/config.yaml.",
				);
			if (
				configuration.sandboxMode === "required" &&
				config.verification.checks.some((check) => check.kind !== "browser")
			) {
				try {
					resolveSandboxBackend();
				} catch {
					add(
						"SANDBOX_BACKEND_UNAVAILABLE",
						"ERROR",
						"Install the pinned local verifier sandbox backend before running checks.",
					);
				}
			}
			const paths = await FilePolicyPathInspector.open(cwd);
			for (const check of config.verification.checks) {
				try {
					await resolveExecutable(check.executable, verificationEnvironment().PATH);
				} catch {
					add(
						"CHECK_EXECUTABLE_UNAVAILABLE",
						check.required ? "ERROR" : "WARN",
						"Make a registered check executable available on PATH or at its configured absolute path.",
					);
				}
				if (
					check.cwd !== "." &&
					!(await paths.inspect([check.cwd])).some((entry) => entry.safe && entry.kind === "directory")
				)
					add(
						"CHECK_WORKDIR_UNAVAILABLE",
						check.required ? "ERROR" : "WARN",
						"Create or correct a registered check working directory inside the project.",
					);
			}
			if (!diagnostics.some((item) => item.severity === "ERROR")) {
				try {
					await probeWorkspaceEvidence(cwd, {
						allowedPaths: config.files.allowed_paths,
						...(config.workspace ? { evidenceMode: config.workspace.evidence.mode } : {}),
					});
				} catch (error) {
					switch (error instanceof WorkspaceEvidenceError ? error.kind : "unavailable") {
						case "capacity":
							add(
								"WORKSPACE_EVIDENCE_CAPACITY",
								"ERROR",
								"Review workspace evidence limits and the selected profile; use a supported workspace without bypassing evidence.",
							);
							break;
						case "unsupported":
							add(
								"WORKSPACE_EVIDENCE_UNSUPPORTED",
								"ERROR",
								"Inspect unsupported workspace paths, file types and Git entries; no files were changed.",
							);
							break;
						case "unavailable":
							add(
								"WORKSPACE_EVIDENCE_UNAVAILABLE",
								"ERROR",
								"Inspect workspace readability and Git availability, then run doctor again; no recovery was attempted.",
							);
							break;
					}
				}
			}
			add(
				"BOUNDARIES_LOCAL_ONLY",
				"INFO",
				"Review sandbox and budget settings; local readiness does not validate model authentication or prove checks passed.",
			);
		}
	} catch {
		add("CONFIG_INVALID", "ERROR", "Inspect .ai/config.yaml safety and schema; no config content was displayed.");
	}
	return {
		schemaVersion: 1,
		ready: !diagnostics.some((item) => item.severity === "ERROR"),
		diagnostics,
		configuration,
	};
}
