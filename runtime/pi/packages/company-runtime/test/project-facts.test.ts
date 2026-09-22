import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostBridgeConnection } from "../src/host-bridge.ts";
import { HostControlBridge } from "../src/host-control.ts";
import type { HostControlResponse, HostControlState } from "../src/host-control-protocol.ts";
import { confirmProjectFact, loadProjectFactProjection, prepareProjectFact } from "../src/project-facts.ts";
import { FileStateStore } from "../src/state-store.ts";

let cwd: string;
let bridge: HostControlBridge;
let clock: number;
let responses: HostControlResponse[];
let connection: HostBridgeConnection;
const sourceRef = "src/status.txt";
const statement = "The status document says Ready.";
const config = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "unused", model: "unused" }, reasoning: { provider: "unused", model: "unused" } },
	},
	files: { allowed_paths: ["src"] },
	verification: { checks: [] },
};
async function send(request: object) {
	await connection.receive(JSON.stringify({ protocolVersion: 1, ...request }));
	return responses.at(-1)!;
}
async function snapshot(): Promise<HostControlState> {
	const response = await send({ id: "snapshot", type: "control.snapshot" });
	if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
	return response.data.state;
}
async function mutate(fields: object) {
	const state = await snapshot();
	return send({
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision: state.projectRevision,
		...fields,
	});
}
async function prepare() {
	const response = await mutate({ type: "facts.prepare", sourceRef, statement });
	if (!response.success || response.data.kind !== "fact-prepared") throw new Error(JSON.stringify(response));
	return response.data.preview;
}
async function review() {
	const preview = await prepare();
	const response = await mutate({
		type: "facts.confirm",
		previewId: preview.previewId,
		previewDigest: preview.previewDigest,
	});
	expect(response.success).toBe(true);
	return (await snapshot()).projectFacts.entries[0]!;
}
beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "facts-")));
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, ".ai"));
	writeFileSync(join(cwd, sourceRef), "Ready\n");
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	clock = 1000;
	responses = [];
	bridge = await HostControlBridge.create({
		cwd,
		agentDir: join(cwd, "unused"),
		projectTrusted: true,
		now: () => clock,
	});
	connection = bridge.connect((line) => {
		responses.push(JSON.parse(line));
		return true;
	});
	await send({ id: "hello", type: "control.hello" });
});
afterEach(async () => {
	await bridge.shutdown();
	rmSync(cwd, { recursive: true, force: true });
});

describe("reviewed project facts", () => {
	it("keeps drafts ephemeral and requires exact review; re-review retains identity without rewriting run authority", async () => {
		const preview = await prepare();
		expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
		expect((await snapshot()).projectFacts.entries).toEqual([]);
		const response = await mutate({
			type: "facts.confirm",
			previewId: preview.previewId,
			previewDigest: preview.previewDigest,
		});
		expect(response.success).toBe(true);
		const fact = (await snapshot()).projectFacts.entries[0]!;
		expect(fact).toMatchObject({ statement, sourceRef, reviewedAt: 1000, status: "VALID" });
		const stored = (await FileStateStore.readSnapshot(cwd)).state!;
		expect(stored.runs).toEqual([]);
		expect(stored.actions).toEqual([]);
		expect(stored.projectFacts![0]).not.toHaveProperty("status");
		clock++;
		expect((await review()).id).toBe(fact.id);
		expect((await snapshot()).projectFacts.entries).toHaveLength(1);
	});
	it("withholds changed source and never refreshes it from matching bytes after recreation", async () => {
		const fact = await review();
		writeFileSync(join(cwd, sourceRef), "Other\n");
		expect((await snapshot()).projectFacts.entries[0]).toMatchObject({
			id: fact.id,
			status: "STALE",
			statement: null,
		});
		unlinkSync(join(cwd, sourceRef));
		writeFileSync(join(cwd, sourceRef), "Ready\n");
		expect((await snapshot()).projectFacts.entries[0]).toMatchObject({
			status: "STALE",
			statement: null,
			sourceDigest: fact.sourceDigest,
		});
		expect((await review()).status).toBe("VALID");
	});
	it("rejects changes between preview and confirm without durable review", async () => {
		const preview = await prepare();
		writeFileSync(join(cwd, sourceRef), "Other\n");
		const result = await mutate({
			type: "facts.confirm",
			previewId: preview.previewId,
			previewDigest: preview.previewDigest,
		});
		expect(result).toMatchObject({ success: false, error: { code: "FACT_SOURCE_CHANGED" } });
		expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
	});
	it("treats missing, unreadable, symlinked and hardlinked sources as stale", async () => {
		await review();
		chmodSync(join(cwd, sourceRef), 0);
		expect((await snapshot()).projectFacts.entries[0]?.status).toBe("STALE");
		chmodSync(join(cwd, sourceRef), 0o600);
		unlinkSync(join(cwd, sourceRef));
		expect((await snapshot()).projectFacts.entries[0]?.status).toBe("STALE");
		writeFileSync(join(cwd, "src/other.txt"), "Ready\n");
		symlinkSync("other.txt", join(cwd, sourceRef));
		expect((await snapshot()).projectFacts.entries[0]?.status).toBe("STALE");
		unlinkSync(join(cwd, sourceRef));
		linkSync(join(cwd, "src/other.txt"), join(cwd, sourceRef));
		expect((await snapshot()).projectFacts.entries[0]?.status).toBe("STALE");
	});
	it("rechecks source and canonical registry at deferred use rather than reusing valid projection", async () => {
		await review();
		const project = await loadProjectFactProjection(cwd);
		expect(project()[0]?.status).toBe("VALID");
		renameSync(join(cwd, ".ai/state.json"), join(cwd, ".ai/retained.json"));
		expect(project()[0]).toMatchObject({ status: "STALE", statement: null });
		renameSync(join(cwd, ".ai/retained.json"), join(cwd, ".ai/state.json"));
		writeFileSync(join(cwd, sourceRef), "Other\n");
		expect(project()[0]).toMatchObject({ status: "STALE", statement: null });
	});
	it("rejects fake client freshness and preview identities, consumes only one review and expires previews", async () => {
		expect(
			await mutate({ type: "facts.prepare", sourceRef, statement, status: "VALID", reviewedAt: 1 }),
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
		expect(
			await mutate({ type: "facts.confirm", previewId: "fake", previewDigest: `sha256:${"a".repeat(64)}` }),
		).toMatchObject({ success: false });
		const preview = await prepare();
		clock += 300001;
		expect(
			await mutate({ type: "facts.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest }),
		).toMatchObject({ success: false, error: { code: "PLAN_EXPIRED" } });
		const current = await prepare();
		const state = await snapshot();
		const request = {
			id: state.nextRequestId,
			ownerId: state.ownerId,
			expectedProjectRevision: state.projectRevision,
			type: "facts.confirm",
			previewId: current.previewId,
			previewDigest: current.previewDigest,
		};
		const accepted = await send(request);
		expect(await send(request)).toEqual(accepted);
		expect((await snapshot()).projectFacts.entries).toHaveLength(1);
	});
	it("rejects protected, external, credential and transcript material without persisting drafts", async () => {
		for (const path of [
			"src/.env",
			"src/auth.json",
			"src/transcript.jsonl",
			"../outside.txt",
			"/tmp/outside.txt",
			".ai/config.yaml",
		]) {
			if (path.startsWith("src/")) writeFileSync(join(cwd, path), "Ready\n");
			expect(await mutate({ type: "facts.prepare", sourceRef: path, statement })).toMatchObject({ success: false });
		}
		writeFileSync(join(cwd, sourceRef), "api_key=not-for-facts\n");
		expect(await mutate({ type: "facts.prepare", sourceRef, statement })).toMatchObject({ success: false });
		writeFileSync(join(cwd, sourceRef), "Ready\n");
		expect(await mutate({ type: "facts.prepare", sourceRef, statement: "password=hunter2" })).toMatchObject({
			success: false,
		});
		expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
	});
	it("preserves legacy state bytes on inspection and rejects newly protected oracle sources", async () => {
		const legacy = JSON.stringify({ schemaVersion: 1, revision: 1, runs: [], actions: [] });
		writeFileSync(join(cwd, ".ai/state.json"), legacy);
		expect((await snapshot()).projectFacts.entries).toEqual([]);
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(legacy);
		await review();
		writeFileSync(
			join(cwd, ".ai/config.yaml"),
			JSON.stringify({
				...config,
				verification: {
					checks: [
						{ id: "oracle", kind: "test", executable: process.execPath, args: [sourceRef], timeout_ms: 10000 },
					],
				},
			}),
		);
		expect((await snapshot()).projectFacts.entries[0]).toMatchObject({ status: "STALE", statement: null });
	});
	it("rechecks source after lease acquisition and directly before atomic commit", async () => {
		const prepared = await prepareProjectFact(cwd, sourceRef, statement);
		let guards = 0;
		await expect(
			confirmProjectFact(cwd, prepared, clock, () => {
				if (++guards === 3) writeFileSync(join(cwd, sourceRef), "Changed\n");
			}),
		).rejects.toThrow();
		expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
});
