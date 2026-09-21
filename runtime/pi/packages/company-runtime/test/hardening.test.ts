import { execFileSync, fork } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitApproval } from "../src/approval.ts";
import { loadRuntimeConfig } from "../src/config.ts";
import type { ApprovalRequest } from "../src/contracts.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { isPolicyPath } from "../src/policy.ts";
import { resolveExecutable, runProcess, verificationEnvironment } from "../src/process-runner.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
const stores: FileStateStore[] = [];
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "company s6-"));
});
afterEach(async () => {
	vi.restoreAllMocks();
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	await rm(cwd, { recursive: true, force: true });
});

async function childScript(content: string): Promise<number | null> {
	const script = join(cwd, "child.mjs");
	await writeFile(script, content);
	return new Promise((resolve, reject) => {
		const child = fork(script, [cwd], { stdio: "ignore" });
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("Fixture child did not settle"));
		}, 5000);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}
describe("S6 process and platform failure boundaries", () => {
	it("handles executable and argv paths containing spaces without shell interpretation", async () => {
		const binary = join(cwd, "node alias");
		await symlink(process.execPath, binary);
		const executable = await resolveExecutable(binary, "");
		await writeFile(join(cwd, "check script.mjs"), "console.log(process.argv[2]);");
		const result = await runProcess({
			executable,
			argv: ["check script.mjs", "literal; no shell"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 2000,
		});
		expect(result.stdout).toBe("literal; no shell\n");
		expect(result.cleanupConfirmed).toBe(true);
		expect(result.exitCode).toBe(0);
	});
	it("rejects a non-executable registration", async () => {
		const path = join(cwd, "not executable");
		await writeFile(path, "noop");
		await chmod(path, 0o600);
		await expect(resolveExecutable(path, "")).rejects.toThrow("unavailable");
	});
	it.each([
		"C:\\project\\file.ts",
		"\\\\server\\share\\file.ts",
		"/absolute",
		"../parent",
		"src/../file",
		"src\\file",
		"src//file",
	])("rejects nonportable/escaping path %s", (path) => {
		expect(isPolicyPath(path)).toBe(false);
	});
	it("a signal exit has no successful exit code", async () => {
		await writeFile(join(cwd, "signal.mjs"), "process.kill(process.pid,'SIGTERM');");
		const result = await runProcess({
			executable: process.execPath,
			argv: ["signal.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 2000,
		});
		expect(result.exitCode).toBeNull();
		expect(result.cleanupConfirmed).toBe(true);
	});
	it("bounds combined stdout/stderr and treats overflow as failure", async () => {
		await writeFile(
			join(cwd, "output.mjs"),
			"console.log('x'.repeat(200)); console.error('y'.repeat(100000)); setInterval(()=>{},1000);",
		);
		const result = await runProcess({
			executable: process.execPath,
			argv: ["output.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 2000,
			maxOutputBytes: 256,
		});
		expect(result.reason).toBe("output-limit");
		expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(256);
		expect(result.cleanupConfirmed).toBe(true);
	});
	it("escalates ignored TERM to KILL and waits for the group before returning cancellation", async () => {
		await writeFile(
			join(cwd, "ignore-term.mjs"),
			"import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync('ready',String(process.pid)); setInterval(()=>{},1000);",
		);
		const controller = new AbortController();
		const job = runProcess({
			executable: process.execPath,
			argv: ["ignore-term.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 5000,
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(existsSync(join(cwd, "ready"))).toBe(true));
		const started = Date.now();
		controller.abort();
		const result = await job;
		expect(result.reason).toBe("cancelled");
		expect(result.cleanupConfirmed).toBe(true);
		expect(Date.now() - started).toBeGreaterThanOrEqual(150);
	});
	it("does not claim cleanup when group probes fail with EPERM", async () => {
		await writeFile(join(cwd, "exit.mjs"), "process.exit(0);");
		const kill = process.kill.bind(process);
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid < 0 && signal === 0) throw Object.assign(new Error("Probe denied"), { code: "EPERM" });
			return kill(pid, signal);
		});
		const result = await runProcess({
			executable: process.execPath,
			argv: ["exit.mjs"],
			cwd,
			env: verificationEnvironment(),
			timeoutMs: 2000,
		});
		expect(result.cleanupConfirmed).toBe(false);
	});
});

describe("S6 filesystem/crash safety", () => {
	it.each(["state", "config", "lock"])("rejects a FIFO %s without waiting for a writer", async (mode) => {
		await mkdir(join(cwd, ".ai"));
		const path = join(
			cwd,
			".ai",
			mode === "state" ? "state.json" : mode === "config" ? "config.yaml" : "writer.lock",
		);
		execFileSync("mkfifo", [path]);
		const modulePath =
			mode === "config"
				? new URL("../src/config.ts", import.meta.url).href
				: new URL("../src/state-store.ts", import.meta.url).href;
		const operation =
			mode === "config"
				? "await loadRuntimeConfig(process.argv[2])"
				: mode === "state"
					? "await FileStateStore.readSnapshot(process.argv[2])"
					: "await FileStateStore.open(process.argv[2])";
		const code = await childScript(
			`import { ${mode === "config" ? "loadRuntimeConfig" : "FileStateStore"} } from ${JSON.stringify(modulePath)}; const timeout=setTimeout(()=>process.exit(98),1500); try { ${operation}; process.exitCode=2; } catch { process.exitCode=0; } clearTimeout(timeout);`,
		);
		expect(code).toBe(0);
	});
	it("rejects symlinked config instead of reading outside the trusted directory", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, "outside"), "DO_NOT_ECHO");
		await symlink(join(cwd, "outside"), join(cwd, ".ai/config.yaml"));
		await expect(loadRuntimeConfig(cwd)).rejects.toThrow("Unable to read");
	});
	it("coalesces concurrent close calls before another writer acquires the project", async () => {
		const store = await FileStateStore.open(cwd);
		stores.push(store);
		await Promise.all([store.close(), store.close(), store.close()]);
		const next = await FileStateStore.open(cwd);
		stores.push(next);
		await store.close();
		await next.assertWritable();
	});
	it("holds the writer lease after an actual I/O failure until its owner explicitly closes", async () => {
		let fail = false;
		const store = await FileStateStore.open(cwd, {
			beforeAtomicStep: (file, step) => {
				if (fail && file === "state.json" && step === "rename") throw new Error("Disk full");
			},
		});
		stores.push(store);
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "run",
				task: testContract("Fix bug", { taskId: "task" }),
				classification: {
					intent: "bugfix",
					complexity: "STANDARD",
					risk: "R1",
					confidence: null,
					reason: "Fixture",
				},
			},
			{
				store,
				agents: {
					execute: async () => {
						throw new Error("Unused");
					},
				},
				verifier: {
					verify: async () => {
						throw new Error("Unused");
					},
				},
			},
		);
		fail = true;
		await expect(kernel.start()).rejects.toThrow();
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
		await expect(FileStateStore.open(cwd)).rejects.toThrow();
		await store.close();
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["state-before-projection", "effect-before-result"])(
		"crash at %s keeps a stale lease and never infers success on owned recovery",
		async (phase) => {
			const statePath = new URL("../src/state-store.ts", import.meta.url).href;
			const kernelPath = new URL("../src/kernel.ts", import.meta.url).href;
			const code =
				await childScript(`import {FileStateStore} from ${JSON.stringify(statePath)}; import {CompanyKernel} from ${JSON.stringify(kernelPath)}; import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
let armed=false; const store=await FileStateStore.open(process.argv[2],{beforeAtomicStep(file,step){if(armed && ${JSON.stringify(phase)}==='state-before-projection' && file==='tasks.json' && step==='rename') process.exit(23);}});
const kernel=await CompanyKernel.create({executionMode:'EDIT',runId:'crash',task:{id:'task',goal:'Fix bug',acceptanceCriteria:[{id:'AC-001',statement:'Fix bug',scope:{paths:['src']},verification:{checkIds:[],reviewRequired:false}}],status:'pending'},classification:{intent:'bugfix',complexity:'STANDARD',risk:'R1',confidence:null,reason:'Fixture'}},{store,agents:{execute:async()=>{throw Error('Unused')}},verifier:{verify:async()=>{throw Error('Unused')}}});
armed=true; await kernel.start(); await store.prepare({executionMode:'EDIT',runId:'crash',actionId:'effect',role:'Developer',risk:'R1',decision:'ALLOW',reason:'Fixture effect',actionDigest:'input',configDigest:'config'}); writeFileSync(join(process.argv[2],'effect.txt'),'effect happened'); process.exit(23);`);
			expect(code).toBe(23);
			const before = await FileStateStore.readSnapshot(cwd);
			expect(before.state?.runs[0].status).toBe("RUNNING");
			expect(before.writerPresent).toBe(true);
			await expect(FileStateStore.open(cwd)).rejects.toThrow();
			// Only this fixture child has exited. Production never guesses that a crash lock is safe to steal.
			await unlink(join(cwd, ".ai/writer.lock"));
			const recovered = await FileStateStore.open(cwd);
			stores.push(recovered);
			expect(recovered.snapshot.runs[0].status).toBe("INTERRUPTED");
			if (phase === "effect-before-result") {
				expect(recovered.snapshot.actions[0].status).toBe("INTERRUPTED");
				expect(await readFile(join(cwd, "effect.txt"), "utf8")).toBe("effect happened");
			} else expect(before.tasksCurrent).toBe(false);
		},
	);
});

describe("S6 exact approval deadline and cancellation", () => {
	const request: ApprovalRequest = {
		runId: "run",
		actionId: "action",
		actionDigest: "input",
		configDigest: "config",
		role: "Developer",
		operation: "delete-file",
		path: "src/old.ts",
		preconditionDigest: "fingerprint",
		bytes: 1,
		reason: "Fixture",
		step: { stepId: "implement", attempt: 1 },
		revision: 0,
		expiresAt: 2000,
	};
	it("rejects consent exactly at expiresAt, not only after it", async () => {
		let now = 1000;
		const result = await awaitApproval(
			request,
			{
				requestApproval: async () => {
					now = 2000;
					return {
						runId: "run",
						actionId: "action",
						actionDigest: "input",
						configDigest: "config",
						expiresAt: 2000,
						approved: true,
					};
				},
			},
			undefined,
			() => now,
		);
		expect(result.status).toBe("EXPIRED");
		expect(result.decision.approved).toBe(false);
	});
	it("same-turn cancellation beats an affirmative authority response", async () => {
		const controller = new AbortController();
		const result = await awaitApproval(
			request,
			{
				requestApproval: async () => {
					controller.abort();
					return {
						runId: "run",
						actionId: "action",
						actionDigest: "input",
						configDigest: "config",
						expiresAt: 2000,
						approved: true,
					};
				},
			},
			controller.signal,
			() => 1000,
		);
		expect(result.status).toBe("CANCELLED");
		expect(result.decision.approved).toBe(false);
	});
});
