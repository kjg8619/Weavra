// Standalone project commands: no SDK session, home bootstrap, or Runtime state writer.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { parseRuntimeConfig } from "./config.ts";
import { setupWeavra } from "./launcher-home.ts";
import { resolveExecutable, runProcess, verificationEnvironment } from "./process-runner.ts";
import { ProjectConfigError, readProjectConfig, updateProjectConfig } from "./project-config.ts";
import { draftProject, draftProtectedPaths } from "./project-draft.ts";
import { readProjectModels } from "./project-models.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
import { evaluateCheckPolicies, gitProjectRoot, MAX_CHECK_POLICIES, projectReadiness } from "./project-readiness.ts";
import { runSandboxedCheck, SandboxUnavailableError, verifierSandbox } from "./sandbox.ts";
import { FileStateStore } from "./state-store.ts";

class ProjectInitError extends Error {}
class TrialCheckError extends ProjectInitError {
	readonly code:
		| "CHECK_NOT_FOUND"
		| "CHECK_POLICY_DENIED"
		| "CHECK_UNAVAILABLE"
		| "TRIAL_CHECK_CONSENT_REQUIRED"
		| "TRIAL_CHECK_WRITER_ACTIVE";
	constructor(code: TrialCheckError["code"], message: string) {
		super(message);
		this.code = code;
	}
}
const TRIAL_STDOUT_TAIL_BYTES = 2048;
const MAX_JSON_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 131_072;

async function readJsonInput(): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of process.stdin) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		length += bytes.length;
		if (length > MAX_JSON_BYTES) throw new ProjectInitError("입력 JSON은 64 KiB 이하여야 해요.");
		chunks.push(bytes);
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
	} catch {
		throw new ProjectInitError("입력은 유효한 UTF-8 JSON이어야 해요.");
	}
	if (!isJsonObject(value)) throw new ProjectInitError("입력은 JSON 객체여야 해요.");
	return value;
}

function emitJson(value: unknown): void {
	const output = JSON.stringify(value);
	if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
		process.stdout.write(
			`${JSON.stringify({ schemaVersion: 1, kind: "error", code: "OUTPUT_TOO_LARGE", message: "응답이 허용 크기를 초과해요." })}\n`,
		);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`${output}\n`);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigDigest(value: string): value is `sha256:${string}` {
	return /^sha256:[0-9a-f]{64}$/.test(value);
}

function configErrorCode(error: unknown): string {
	return error instanceof ProjectConfigError || error instanceof TrialCheckError
		? error.code
		: "PROJECT_OPERATION_FAILED";
}

/**
 * One user-consented run of a saved registered check through the verifier process path and sandbox. Refused by
 * execution Policy means nothing runs. The bounded result is returned only: no audit intent, state or evidence.
 */
export async function trialCheck(cwd: string, checkId: string) {
	const root = await realpath(cwd);
	// Same writer-lock signal the Host and readiness use: a Run holding the writer means nothing runs here.
	if ((await FileStateStore.readSnapshot(root)).writerPresent)
		throw new TrialCheckError(
			"TRIAL_CHECK_WRITER_ACTIVE",
			"실행 중인 작업이 쓰기 잠금을 갖고 있어 검사를 실행하지 않았어요. 작업이 끝난 뒤 다시 시도해 주세요.",
		);
	const config = parseRuntimeConfig((await readProjectConfig(root)).yaml);
	const check = config.verification.checks.find((item) => item.id === checkId);
	if (!check) throw new TrialCheckError("CHECK_NOT_FOUND", "저장된 설정에서 이 검사를 찾을 수 없어요.");
	if (check.kind === "browser")
		throw new TrialCheckError("CHECK_UNAVAILABLE", "브라우저 검사는 검증 단계에서만 실행해요.");
	// The same policy and sandbox read boundary as a real Run: project protections plus the configured instruction file.
	const protectedPaths = await resolveProjectProtectedPaths(root, config);
	if (config.project) protectedPaths.push(config.project.instructions.path);
	const [policy] = await evaluateCheckPolicies(root, [check], protectedPaths);
	if (policy?.policy !== "allowed")
		throw new TrialCheckError("CHECK_POLICY_DENIED", "실행 정책이 거부한 검사라 실행하지 않았어요.");
	const env = verificationEnvironment();
	let sandbox: Awaited<ReturnType<typeof verifierSandbox>>;
	try {
		sandbox = await verifierSandbox(config, root, protectedPaths);
	} catch (error) {
		if (error instanceof SandboxUnavailableError)
			throw new TrialCheckError("CHECK_UNAVAILABLE", "검증 sandbox를 준비할 수 없어 실행하지 않았어요.");
		throw error;
	}
	const run = {
		executable: await resolveExecutable(check.executable, env.PATH, { root, cwd: check.cwd }),
		argv: [...check.args],
		cwd: join(root, check.cwd),
		env,
		// Bounded below the App setup request timeout so a slow check reports timedOut instead of an uncertain request.
		timeoutMs: Math.min(check.timeout_ms, config.agents.worker_timeout_ms, 60_000),
	};
	const result = sandbox ? (await runSandboxedCheck({ snapshot: sandbox, ...run })).result : await runProcess(run);
	if (result.reason === "unavailable" || !result.cleanupConfirmed)
		throw new TrialCheckError("CHECK_UNAVAILABLE", "검사를 실행하거나 종료를 확인할 수 없었어요.");
	let stdoutTail = result.stdout.slice(-TRIAL_STDOUT_TAIL_BYTES);
	while (Buffer.byteLength(stdoutTail) > TRIAL_STDOUT_TAIL_BYTES) stdoutTail = stdoutTail.slice(1);
	return {
		schemaVersion: 1,
		kind: "trial-check",
		checkId: check.id,
		exitCode: result.exitCode,
		durationMs: result.finishedAt - result.startedAt,
		outputBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
		truncated: result.reason === "output-limit",
		timedOut: result.reason === "timeout",
		stdoutTail,
	};
}

async function optionalStat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

/** Publish validated bytes using an exclusive temporary inode and atomic no-replace hardlink. */
export async function initProject(cwd: string, supplied: string): Promise<void> {
	const project = await realpath(cwd);
	if (!(await gitProjectRoot(project)))
		throw new ProjectInitError("Git 프로젝트 루트에서 project init을 실행해 주세요.");
	const source = resolve(project, supplied);
	let bytes: Buffer;
	try {
		if ((await realpath(dirname(source))) !== dirname(source))
			throw new ProjectInitError("설정 원본의 상위 디렉터리는 심볼릭 링크일 수 없어요.");
		const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536)
				throw new ProjectInitError("설정 원본은 최대 64 KiB의 일반 YAML 파일이어야 하며 hardlink가 없어야 해요.");
			bytes = await handle.readFile();
		} finally {
			await handle.close();
		}
		if (!Buffer.from(bytes.toString("utf8")).equals(bytes))
			throw new ProjectInitError("설정 원본은 UTF-8이어야 해요.");
		parseRuntimeConfig(bytes.toString("utf8"));
	} catch {
		throw new ProjectInitError(
			"읽을 수 있는 일반 YAML 설정 파일을 지정해 주세요. 최대 64 KiB이며 스키마가 유효해야 해요. 파일은 저장하지 않았어요.",
		);
	}
	await initProjectYaml(project, bytes.toString("utf8"));
}

/** Same no-replace publication for explicitly reviewed App input; no temporary source file or caller argv. */
export async function initProjectYaml(cwd: string, yaml: string): Promise<void> {
	const project = await realpath(cwd);
	if (!(await gitProjectRoot(project)))
		throw new ProjectInitError("Git 프로젝트 루트에서 project init을 실행해 주세요.");
	try {
		parseRuntimeConfig(yaml);
	} catch {
		throw new ProjectInitError("Runtime YAML이 유효하지 않아요. 모델 프로필·경로·등록 검사를 검토해 주세요.");
	}
	const bytes = Buffer.from(yaml, "utf8");
	const directory = join(project, ".ai");
	const target = join(directory, "config.yaml");
	const existing = await optionalStat(directory);
	if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
		throw new ProjectInitError(".ai 디렉터리의 안전성을 확인할 수 없어 저장하지 않았어요.");
	if (await optionalStat(target))
		throw new ProjectInitError(".ai/config.yaml이 이미 있어요. 기존 파일은 덮어쓰지 않아요.");
	if (await optionalStat(join(directory, "writer.lock")))
		throw new ProjectInitError("쓰기 잠금이 있어요. project init 전에 잠금 상태를 확인해 주세요.");
	if (!existing) {
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
		}
	}
	const identity = await lstat(directory);
	if (!identity.isDirectory() || identity.isSymbolicLink())
		throw new ProjectInitError(".ai 디렉터리의 안전성을 확인할 수 없어 저장하지 않았어요.");
	let temporary: string | undefined;
	try {
		temporary = join(directory, `.config-${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		const current = await lstat(directory);
		if (
			current.dev !== identity.dev ||
			current.ino !== identity.ino ||
			current.isSymbolicLink() ||
			(await optionalStat(join(directory, "writer.lock")))
		)
			throw new ProjectInitError("프로젝트 디렉터리나 쓰기 소유자가 바뀌어 저장하지 않았어요.");
		try {
			await link(temporary, target);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST")
				throw new ProjectInitError(".ai/config.yaml이 이미 있어요. 기존 파일은 덮어쓰지 않아요.");
			throw error;
		}
	} finally {
		if (temporary) await unlink(temporary).catch(() => undefined);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, ...args] = process.argv.slice(2);
	if (
		(command === "draft" && args.length === 1 && args[0] === "--json") ||
		(command === "init" && args.length === 2 && args[0] === "--stdin" && args[1] === "--json") ||
		(command === "read" && args.length === 1 && args[0] === "--json") ||
		(command === "update" && args.length === 2 && args[0] === "--stdin" && args[1] === "--json") ||
		(command === "trial-check" && args.length === 2 && args[0] === "--stdin" && args[1] === "--json") ||
		(command === "initialize" && args.length === 1 && args[0] === "--json") ||
		(command === "doctor" && args.length === 1 && args[0] === "--app-json")
	) {
		try {
			if (command === "draft") {
				const draft = await draftProject(process.cwd(), { policyFiltered: true });
				// The draft has empty model IDs, so the strict config parser cannot read its candidate checks.
				const candidate: unknown = parse(draft.yaml);
				const verification = isJsonObject(candidate) ? candidate.verification : undefined;
				const checks =
					isJsonObject(verification) && Array.isArray(verification.checks)
						? verification.checks.filter(
								(check): check is { id: string; executable: string; args: string[] } =>
									isJsonObject(check) &&
									typeof check.id === "string" &&
									typeof check.executable === "string" &&
									Array.isArray(check.args) &&
									check.args.every((arg) => typeof arg === "string"),
							)
						: [];
				emitJson({
					...draft,
					checkPolicies: (
						await evaluateCheckPolicies(process.cwd(), checks, await draftProtectedPaths(process.cwd(), checks))
					).slice(0, MAX_CHECK_POLICIES),
					modelAvailability: await readProjectModels(),
				});
			} else if (command === "read") {
				const saved = await readProjectConfig(process.cwd());
				const config = parseRuntimeConfig(saved.yaml);
				// The same protected paths doctor, trial and a real Run use, so the setup badge cannot say allowed here.
				const protectedPaths = await resolveProjectProtectedPaths(process.cwd(), config);
				if (config.project) protectedPaths.push(config.project.instructions.path);
				emitJson({
					schemaVersion: 1,
					kind: "read",
					...saved,
					checkPolicies: (
						await evaluateCheckPolicies(process.cwd(), config.verification.checks, protectedPaths)
					).slice(0, MAX_CHECK_POLICIES),
				});
			} else if (command === "update") {
				const input = await readJsonInput();
				if (
					Object.keys(input).length !== 2 ||
					!("yaml" in input) ||
					!("expectedConfigDigest" in input) ||
					typeof input.yaml !== "string" ||
					typeof input.expectedConfigDigest !== "string" ||
					!isConfigDigest(input.expectedConfigDigest)
				)
					throw new ProjectInitError("입력은 yaml과 expectedConfigDigest만 포함해야 해요.");
				const saved = await updateProjectConfig(process.cwd(), input.expectedConfigDigest, input.yaml);
				emitJson({ schemaVersion: 1, kind: "saved", ...saved, readiness: await projectReadiness(process.cwd()) });
			} else if (command === "trial-check") {
				const input = await readJsonInput();
				if (input.consent !== true)
					throw new TrialCheckError(
						"TRIAL_CHECK_CONSENT_REQUIRED",
						"사용자 동의(consent: true)가 없어 검사를 실행하지 않았어요.",
					);
				if (
					Object.keys(input).length !== 2 ||
					typeof input.checkId !== "string" ||
					input.checkId.length === 0 ||
					input.checkId.length > 128
				)
					throw new ProjectInitError("입력은 checkId와 consent: true만 포함해야 해요.");
				emitJson(await trialCheck(process.cwd(), input.checkId));
			} else if (command === "initialize") {
				await setupWeavra(
					process.env,
					async () => false,
					() => undefined,
				);
				emitJson({ schemaVersion: 1, kind: "initialized" });
			} else if (command === "doctor" && args[0] === "--app-json") {
				const readiness = await projectReadiness(process.cwd());
				emitJson({ ...readiness, kind: "doctor" });
				if (!readiness.ready) process.exitCode = 1;
			} else {
				const chunks: Buffer[] = [];
				let length = 0;
				for await (const chunk of process.stdin) {
					const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					length += bytes.length;
					if (length > 65_536) throw new ProjectInitError("검토한 YAML이 64 KiB를 초과해요.");
					chunks.push(bytes);
				}
				const bytes = Buffer.concat(chunks);
				if (!Buffer.from(bytes.toString("utf8")).equals(bytes))
					throw new ProjectInitError("검토한 YAML은 UTF-8이어야 해요.");
				await initProjectYaml(process.cwd(), bytes.toString("utf8"));
				emitJson({
					schemaVersion: 1,
					kind: "saved",
					...(await readProjectConfig(process.cwd())),
					readiness: await projectReadiness(process.cwd()),
				});
			}
		} catch (error) {
			emitJson({
				schemaVersion: 1,
				kind: "error",
				code: configErrorCode(error),
				message:
					error instanceof ProjectInitError
						? error.message
						: "프로젝트 설정 작업에 실패했어요. 경로와 설정을 확인해 주세요. 기존 설정은 보존했어요.",
			});
			process.exitCode = 1;
		}
	} else if (command === "init" && args.length === 2 && args[0] === "--config" && args[1]) {
		try {
			await initProject(process.cwd(), args[1]);
			console.log(".ai/config.yaml을 저장했어요. 다음 명령으로 확인해 주세요: weavra project doctor");
		} catch (error) {
			console.error(
				`Weavra project: ${error instanceof ProjectInitError ? error.message : "프로젝트 초기화에 실패했어요. 경로와 권한을 확인해 주세요. 기존 설정은 덮어쓰지 않았어요."}`,
			);
			process.exitCode = 1;
		}
	} else if (
		command === "doctor" &&
		(args.length === 0 || (args.length === 1 && (args[0] === "--json" || args[0] === "--app-json")))
	) {
		const result = await projectReadiness(process.cwd());
		if (args[0] === "--json") console.log(JSON.stringify(result));
		else if (args[0] === "--app-json") emitJson({ ...result, kind: "doctor" });
		else {
			for (const diagnostic of result.diagnostics)
				console.log(`${diagnostic.severity}  ${diagnostic.code}: ${diagnostic.action}`);
			console.log(
				`Result: ${result.ready ? "READY" : "NOT READY"} (local prerequisites only; model authentication and verification not checked)`,
			);
			if (result.configuration)
				console.log(
					`Sandbox: ${result.configuration.sandboxMode}; budget: ${result.configuration.budgetConfigured ? "configured, not a billing cap" : "unlimited (no configured budget)"}.`,
				);
		}
		if (!result.ready) process.exitCode = 1;
	} else {
		console.error("Usage: weavra project init --config <reviewed-yaml-file> | weavra project doctor [--json]");
		process.exitCode = 1;
	}
}
