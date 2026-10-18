// Read-only local prerequisites; no SDK/auth, check execution, state recovery, or lock acquisition.
import { spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { loadRuntimeConfig } from "./config.ts";
import { evaluateRegisteredCheck, isPolicyPath, registeredCheckCommandBlocker } from "./policy.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import { resolveExecutable, verificationEnvironment } from "./process-runner.ts";
import { assessProjectWorkspace, type ProjectWorkspaceAssessment } from "./project-preflight.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
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
export type CheckPolicy = {
	readonly id: string;
	readonly policy: "allowed" | "denied";
	readonly reason: string;
	readonly suggestion?: { readonly executable: string; readonly args: readonly string[]; readonly note: string };
};
export type ProjectReadiness = {
	readonly schemaVersion: 1;
	readonly ready: boolean;
	readonly diagnostics: readonly Diagnostic[];
	readonly configuration: Configuration | null;
	readonly workspaceAssessment: ProjectWorkspaceAssessment | null;
	readonly checkPolicies: readonly CheckPolicy[];
};

/** Keeps doctor/setup responses well under the host control response limit. */
export const MAX_CHECK_POLICIES = 16;

/**
 * Execution-policy verdict per registered check; PATH lookup and literal path inspection only, nothing runs.
 * Pass the project protected paths a real Run uses, or a protected check cwd is reported allowed here and denied later.
 */
export async function evaluateCheckPolicies(
	cwd: string,
	checks: readonly {
		readonly id: string;
		readonly executable: string;
		readonly args: readonly string[];
		readonly cwd?: string;
	}[],
	protectedPaths: readonly string[] = [],
): Promise<CheckPolicy[]> {
	const paths = await FilePolicyPathInspector.open(cwd);
	const policies: CheckPolicy[] = [];
	for (const check of checks) {
		const checkCwd = check.cwd ?? ".";
		const cwdSafe =
			checkCwd === "." ||
			(await paths.inspect([checkCwd])).some((entry) => entry.safe && entry.kind === "directory");
		let executable: string;
		try {
			executable = await resolveExecutable(check.executable, verificationEnvironment().PATH, {
				root: cwd,
				cwd: checkCwd,
			});
		} catch {
			policies.push({ id: check.id, policy: "denied", reason: "EXECUTABLE_UNAVAILABLE" });
			continue;
		}
		const registration = { id: check.id, executable, argv: [...check.args], cwd: checkCwd, timeoutMs: 1, env: {} };
		const decision = evaluateRegisteredCheck(
			{ runId: "doctor", actionId: check.id, actionDigest: "doctor" },
			registration,
			registration,
			{
				executionMode: "READ_ONLY",
				executionRunId: "doctor",
				tools: [],
				allowedPaths: [],
				protectedPaths,
				configDigest: "doctor",
			},
			cwdSafe,
		);
		if (decision.decision === "ALLOW") {
			policies.push({ id: check.id, policy: "allowed", reason: decision.reason });
			continue;
		}
		const blocker = registeredCheckCommandBlocker(executable, check.args);
		const script = check.args[0];
		const scriptIsProjectFile =
			blocker === "SHELL_COMMAND" &&
			/(?:^|\/)(?:bash|sh|zsh)$/.test(check.executable) &&
			script !== undefined &&
			isPolicyPath(script) &&
			(await paths.inspect([checkCwd === "." ? script : `${checkCwd}/${script}`])).some(
				(entry) => entry.safe && entry.kind === "file",
			);
		policies.push({
			id: check.id,
			policy: "denied",
			reason: blocker ?? (cwdSafe ? decision.reason : "CHECK_WORKDIR_UNAVAILABLE"),
			...(scriptIsProjectFile
				? {
						suggestion: {
							executable: script,
							args: check.args.slice(1),
							note: "chmod +x와 shebang 줄이 필요해요.",
						},
					}
				: {}),
		});
	}
	return policies;
}

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
	let workspaceAssessment: ProjectWorkspaceAssessment | null = null;
	let checkPolicies: CheckPolicy[] = [];
	if (!(await gitProjectRoot(cwd)))
		add("GIT_PROJECT_ROOT_REQUIRED", "ERROR", "git이 PATH에 있는 환경에서 Git 프로젝트 루트로 이동해 실행해 주세요.");
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
			add("GIT_HEAD_MISSING", "ERROR", "워크플로를 시작하려면 프로젝트에 최초 Git 커밋이 필요해요.");
		const blockers = await readCleanStartBlockers(cwd);
		if (blockers === null)
			add("WORKSPACE_UNAVAILABLE", "ERROR", "Git 작업 공간 상태와 경로 안전성을 직접 확인해 주세요.");
		else if (blockers.length)
			add("WORKSPACE_DIRTY", "ERROR", "워크플로 전에 .ai/ 밖의 기존 변경사항을 검토하고 정리해 주세요.");
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
				add("WRITER_LOCK_PRESENT", "ERROR", "프로젝트의 쓰기 잠금을 확인해 주세요. 복구는 시도하지 않았어요.");
			if (snapshot.state?.runs.some((run) => ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status)))
				add(
					"ACTIVE_RUN_PRESENT",
					"ERROR",
					"다른 워크플로 전에 활성 Runtime Run을 확인해 주세요. 복구는 시도하지 않았어요.",
				);
			if (snapshot.state && !snapshot.tasksCurrent)
				add(
					"STATE_PROJECTION_STALE",
					"ERROR",
					"state와 tasks 상태의 일치 여부를 확인해 주세요. 자동 수정은 하지 않았어요.",
				);
		}
	} catch {
		add("STATE_UNAVAILABLE", "ERROR", ".ai 디렉터리와 Runtime 상태의 무결성을 직접 확인해 주세요.");
	}
	let configuration: Configuration | null = null;
	try {
		const loaded = await loadRuntimeConfig(cwd);
		if (loaded.status === "missing")
			add(
				"CONFIG_MISSING",
				"ERROR",
				"검토한 YAML로 프로젝트를 설정해 주세요. 명령: weavra project init --config <file>",
			);
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
				add("REQUIRED_CHECK_MISSING", "ERROR", ".ai/config.yaml에 필수 검증 검사를 하나 이상 등록해 주세요.");
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
						"검사 전에 지정 버전의 로컬 검증 sandbox 도구를 준비해 주세요.",
					);
				}
			}
			const paths = await FilePolicyPathInspector.open(cwd);
			for (const check of config.verification.checks) {
				try {
					const executable = await resolveExecutable(check.executable, verificationEnvironment().PATH, {
						root: cwd,
						cwd: check.cwd,
					});
					const blocker = registeredCheckCommandBlocker(executable, check.args);
					if (blocker)
						add(
							`CHECK_COMMAND_${blocker}`,
							"ERROR",
							"등록된 검사 명령은 셸 또는 인라인 실행을 사용해 안전하지 않아요. 직접 실행할 수 있는 명령으로 바꿔 주세요.",
						);
				} catch {
					add(
						"CHECK_EXECUTABLE_UNAVAILABLE",
						check.required ? "ERROR" : "WARN",
						"등록된 검사 실행 파일이 PATH, 설정한 절대 경로, 또는 프로젝트 안의 실행 가능한 shebang 스크립트인지 확인해 주세요.",
					);
				}
				if (
					check.cwd !== "." &&
					!(await paths.inspect([check.cwd])).some((entry) => entry.safe && entry.kind === "directory")
				)
					add(
						"CHECK_WORKDIR_UNAVAILABLE",
						check.required ? "ERROR" : "WARN",
						"등록된 검사의 작업 디렉터리가 프로젝트 안에 있도록 확인하거나 수정해 주세요.",
					);
			}
			const protectedPaths = await resolveProjectProtectedPaths(cwd, config);
			if (config.project) protectedPaths.push(config.project.instructions.path);
			checkPolicies = await evaluateCheckPolicies(cwd, config.verification.checks, protectedPaths);
			for (const [index, policy] of checkPolicies.entries())
				if (policy.policy === "denied" && config.verification.checks[index]?.required)
					add(
						`CHECK_POLICY_DENIED:${policy.id}`,
						"ERROR",
						"필수 검사가 실행 정책에서 거부돼요. checkPolicies의 수정 제안을 검토해 주세요.",
					);
			try {
				workspaceAssessment = await assessProjectWorkspace(cwd, config.files.allowed_paths);
			} catch {
				// Assessment is optional and must not change readiness.
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
								"작업 공간 증거 한도와 선택한 프로필을 검토해 주세요. 증거 검사를 우회하지 말고 지원되는 작업 공간을 사용해 주세요.",
							);
							break;
						case "unsupported":
							add(
								"WORKSPACE_EVIDENCE_UNSUPPORTED",
								"ERROR",
								"지원하지 않는 경로·파일 형식·Git 항목을 확인해 주세요. 파일을 변경하지 않았어요.",
							);
							break;
						case "unavailable":
							add(
								"WORKSPACE_EVIDENCE_UNAVAILABLE",
								"ERROR",
								"작업 공간 읽기 권한과 Git 사용 가능 여부를 확인하고 doctor를 다시 실행해 주세요. 복구는 시도하지 않았어요.",
							);
							break;
					}
				}
			}
			add(
				"BOUNDARIES_LOCAL_ONLY",
				"INFO",
				"sandbox와 예산 설정을 검토해 주세요. 로컬 준비 완료는 모델 인증이나 검사 통과를 뜻하지 않아요.",
			);
		}
	} catch {
		add(
			"CONFIG_INVALID",
			"ERROR",
			".ai/config.yaml의 안전성과 스키마를 확인해 주세요. 설정 내용은 표시하지 않았어요.",
		);
	}
	return {
		schemaVersion: 1,
		ready: !diagnostics.some((item) => item.severity === "ERROR"),
		diagnostics,
		configuration,
		workspaceAssessment,
		checkPolicies: checkPolicies.slice(0, MAX_CHECK_POLICIES),
	};
}
