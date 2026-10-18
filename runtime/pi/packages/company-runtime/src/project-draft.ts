import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { isPolicyPath, isProtectedPath } from "./policy.ts";
import { assessProjectWorkspace } from "./project-preflight.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
import { evaluateCheckPolicies, gitProjectRoot } from "./project-readiness.ts";

/** Notes stay short constant codes, bounded like the host control check-policy list. */
const MAX_DRAFT_NOTES = 16;

async function startsWithShebang(path: string): Promise<boolean> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const bytes = Buffer.alloc(2);
		const { bytesRead } = await handle.read(bytes, 0, 2, 0);
		return bytesRead === 2 && bytes.toString("latin1") === "#!";
	} finally {
		await handle.close();
	}
}

/**
 * The project protected paths a Run would use for these candidate checks once saved with their parser defaults.
 * A draft has no project instructions or code intelligence yet, so only check sources and the Runtime source apply.
 */
export async function draftProtectedPaths(
	project: string,
	checks: readonly {
		readonly id: string;
		readonly executable: string;
		readonly args: readonly string[];
		readonly cwd?: string;
	}[],
): Promise<string[]> {
	return resolveProjectProtectedPaths(project, {
		verification: {
			checks: checks.map((check) => ({
				id: check.id,
				kind: "custom",
				required: false,
				executable: check.executable,
				args: check.args,
				cwd: check.cwd ?? ".",
				timeout_ms: 60_000,
			})),
		},
	});
}

/**
 * Candidate data only. Never executes scripts, reads credentials or selects a paid model.
 * With `policyFiltered`, only checks the registered-check execution policy allows are drafted; the rest become notes.
 */
export async function draftProject(cwd: string, options: { readonly policyFiltered?: boolean } = {}) {
	const project = await realpath(cwd);
	if (!(await gitProjectRoot(project))) throw new Error("Git project root required");
	const entries = await readdir(project, { withFileTypes: true });
	if (entries.length > 1000) throw new Error("Project draft entry limit");
	const has = (name: string) => entries.some((entry) => entry.name === name && entry.isFile());
	const read = async (name: string) => {
		const handle = await open(join(project, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536) throw new Error("Unsafe project manifest");
			const bytes = await handle.readFile();
			if (bytes.length > 65_536 || !Buffer.from(bytes.toString("utf8")).equals(bytes))
				throw new Error("Invalid project manifest");
			return bytes.toString("utf8");
		} finally {
			await handle.close();
		}
	};
	const godotManifest = has("project.godot") ? await read("project.godot") : "";
	const supportsGodotCheck = /^config\/features=PackedStringArray\(/m.test(godotManifest);
	const checks: Array<{
		id: string;
		kind: "test" | "lint" | "typecheck" | "build" | "custom";
		executable: string;
		args: string[];
		required: boolean;
	}> = [];
	const notes: string[] = [];
	const projectTypes: string[] = [];
	if (has("package.json")) {
		projectTypes.push("Node");
		const manifest: unknown = JSON.parse(await read("package.json"));
		if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest))
			throw new Error("Invalid package manifest");
		const scripts = "scripts" in manifest ? manifest.scripts : undefined;
		const manager = has("pnpm-lock.yaml")
			? "pnpm"
			: has("yarn.lock")
				? "yarn"
				: has("bun.lock") || has("bun.lockb")
					? "bun"
					: "npm";
		for (const kind of ["test", "lint", "typecheck", "build"] as const) {
			const command =
				typeof scripts === "object" && scripts !== null && kind in scripts ? Reflect.get(scripts, kind) : undefined;
			if (typeof command === "string" && command.trim() && !/no test specified|not implemented/i.test(command))
				checks.push({
					id: `node-${kind}`,
					kind,
					executable: manager,
					args: ["run", kind],
					required: kind === "test",
				});
		}
	}
	if (has("pyproject.toml") || has("pytest.ini") || has("setup.py") || has("requirements.txt")) {
		projectTypes.push("Python");
		const pyproject = has("pyproject.toml") ? await read("pyproject.toml") : "";
		const requirements = has("requirements.txt") ? await read("requirements.txt") : "";
		if (
			has("pytest.ini") ||
			/\[tool\.pytest(?:\.ini_options)?\]|["']pytest(?:[<>=!~;[\s"'])/m.test(pyproject) ||
			/^\s*pytest(?:[<>=!~;[\s]|$)/m.test(requirements)
		)
			checks.push({ id: "python-test", kind: "test", executable: "pytest", args: [], required: true });
	}
	if (has("go.mod")) {
		projectTypes.push("Go");
		checks.push({ id: "go-test", kind: "test", executable: "go", args: ["test", "./..."], required: true });
	}
	if (has("Cargo.toml")) {
		projectTypes.push("Rust");
		checks.push({ id: "rust-test", kind: "test", executable: "cargo", args: ["test"], required: true });
	}
	if (has("project.godot")) {
		projectTypes.push("Godot");
		if (supportsGodotCheck)
			checks.push({
				id: "godot-editor-import",
				kind: "test",
				executable: "godot",
				args: ["--headless", "--path", ".", "--editor", "--quit"],
				required: true,
			});
		// Project tool scripts run directly: literal safe paths with a shebang and an execute bit, never via a shell.
		if (entries.some((entry) => entry.name === "tools" && entry.isDirectory())) {
			const tools = (await readdir(join(project, "tools"), { withFileTypes: true }))
				.filter((entry) => entry.name.endsWith(".sh"))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, MAX_DRAFT_NOTES);
			for (const entry of tools) {
				const path = `tools/${entry.name}`;
				const name = entry.name.slice(0, -".sh".length);
				const stat = await lstat(join(project, path));
				if (
					!entry.isFile() ||
					!stat.isFile() ||
					stat.nlink !== 1 ||
					!/^[A-Za-z0-9_-]+$/.test(name) ||
					!isPolicyPath(path) ||
					isProtectedPath(path)
				)
					notes.push(`UNSAFE_PATH:${path}`);
				else if ((stat.mode & 0o111) === 0) notes.push(`NOT_EXECUTABLE:${path}`);
				else if (!(await startsWithShebang(join(project, path)))) notes.push(`NO_SHEBANG:${path}`);
				else checks.push({ id: `godot-${name}`, kind: "custom", executable: path, args: [], required: false });
			}
		}
	}
	let drafted = checks;
	if (options.policyFiltered) {
		// A project script path is never resolved through PATH; judge its policy form at its literal project location.
		const policies = await evaluateCheckPolicies(
			project,
			checks.map((check) => ({
				id: check.id,
				executable: check.executable.includes("/") ? join(project, check.executable) : check.executable,
				args: check.args,
			})),
			await draftProtectedPaths(project, checks),
		);
		drafted = checks.filter((check, index) => {
			const policy = policies[index];
			if (policy?.policy === "allowed") return true;
			notes.push(`${policy?.reason ?? "POLICY_UNAVAILABLE"}:${check.id}`);
			return false;
		});
	}
	if (!drafted.length) notes.push("NO_CHECK_CANDIDATES");
	if (!projectTypes.length) projectTypes.push("Generic");
	// Literal existing roots only. Generated/dependency/hidden roots are not worker scope suggestions.
	const allowed: string[] = [];
	for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
		const godotEditableRoot =
			!projectTypes.includes("Godot") ||
			entry.name === "game" ||
			entry.name === "docs" ||
			entry.name === "src" ||
			/^readme(?:\.|$)/i.test(entry.name) ||
			entry.name === "project.godot";
		if (
			entry.name.startsWith(".") ||
			["node_modules", "vendor", "target", "dist", "build", "coverage", "venv", "__pycache__"].includes(
				entry.name,
			) ||
			!isPolicyPath(entry.name) ||
			isProtectedPath(entry.name) ||
			!godotEditableRoot ||
			(!entry.isDirectory() && !entry.isFile())
		)
			continue;
		const stat = await lstat(join(project, entry.name));
		if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) continue;
		allowed.push(entry.name);
		if (allowed.length === 64) break;
	}
	const workspaceProfile = await assessProjectWorkspace(project, allowed);
	const yaml = [
		"# 저장 전에 모든 허용 경로와 명령을 검토해 주세요. 아직 명령을 실행하지 않았어요.",
		"# 추천된 SDK 프로바이더·모델 ID를 검토하거나 직접 입력해 주세요. 빈 ID로는 저장할 수 없어요.",
		"# 실제 필수 검사가 확인되지 않으면 실행 전에 verification.checks에 추가해 주세요.",
		...(workspaceProfile.kind === "supported"
			? [
					`# 작업 공간 증거: ${workspaceProfile.fileCount}개 항목, ${workspaceProfile.totalBytes}바이트. ${workspaceProfile.profile.mode} 프로필이에요.`,
					...(workspaceProfile.profile.candidate
						? ["# bounded-monorepo는 기존 유한 프로필 후보예요. 저장 전에 검토해 주세요."]
						: []),
				]
			: [`# 작업 공간 프로필을 지원하지 않아요: ${workspaceProfile.diagnostic.action}`]),
		...(projectTypes.includes("Godot")
			? ["# Godot 편집기 가져오기는 실행 시 프로젝트 파일을 바꿀 수 있으니 먼저 검토해 주세요."]
			: []),
		stringify({
			schemaVersion: 1,
			models: { profiles: { coding: { provider: "", model: "" }, reasoning: { provider: "", model: "" } } },
			runtime: { workflow: "STANDARD" },
			files: { allowed_paths: allowed },
			...(workspaceProfile.kind === "supported" &&
			workspaceProfile.profile.mode === "bounded-monorepo" &&
			workspaceProfile.profile.candidate
				? { workspace: { evidence: { mode: "bounded-monorepo" } } }
				: {}),
			verification: { sandbox: { mode: "required" }, checks: drafted },
		}),
	].join("\n");
	return {
		schemaVersion: 1 as const,
		kind: "draft" as const,
		projectTypes,
		workspaceProfile,
		yaml,
		notes: notes.slice(0, MAX_DRAFT_NOTES),
	};
}
