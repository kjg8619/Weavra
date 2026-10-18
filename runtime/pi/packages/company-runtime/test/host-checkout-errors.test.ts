import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostControlBridge } from "../src/host-control.ts";
import { FileStateStore } from "../src/state-store.ts";
import * as workspace from "../src/workspace.ts";
import { taskControlProject } from "./task-control-fixture.ts";

let project: Awaited<ReturnType<typeof taskControlProject>>;
beforeEach(async () => {
	project = await taskControlProject();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await project.cleanup();
});

async function checkoutResponse() {
	const bridge = await HostControlBridge.create({
		cwd: project.cwd,
		projectTrusted: true,
		agentDir: `${project.home}/.weavra/agent`,
	});
	const responses: unknown[] = [];
	const connection = bridge.connect((line) => {
		responses.push(JSON.parse(line));
		return true;
	});
	try {
		await connection.receive(JSON.stringify({ protocolVersion: 1, id: "hello", type: "control.hello" }));
		await connection.receive(JSON.stringify({ protocolVersion: 1, id: "checkout", type: "workflow.checkout" }));
		return responses[1];
	} finally {
		connection.close();
		await bridge.shutdown();
	}
}

describe("workflow.checkout evidence failures", () => {
	it.each([
		["capacity", "WORKSPACE_EVIDENCE_CAPACITY"],
		["unsupported", "WORKSPACE_EVIDENCE_UNSUPPORTED"],
		["unavailable", "WORKSPACE_EVIDENCE_UNAVAILABLE"],
	] as const)("preserves trusted %s evidence errors without writes", async (kind, code) => {
		vi.spyOn(workspace, "readCheckoutIdentity").mockRejectedValue(
			new workspace.WorkspaceEvidenceError(kind, "fixture evidence failure"),
		);
		const before = await FileStateStore.readSnapshot(project.cwd);

		expect(await checkoutResponse()).toMatchObject({
			success: false,
			error: { code },
		});
		expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
		expect(before.state).toBeUndefined();
		expect(before.writerPresent).toBe(false);
	});

	it("keeps unknown checkout errors fail-closed as PROJECT_CHANGED", async () => {
		vi.spyOn(workspace, "readCheckoutIdentity").mockRejectedValue(new Error("unknown checkout failure"));
		const before = await FileStateStore.readSnapshot(project.cwd);

		expect(await checkoutResponse()).toMatchObject({
			success: false,
			error: { code: "PROJECT_CHANGED" },
		});
		expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
		expect(before.state).toBeUndefined();
		expect(before.writerPresent).toBe(false);
	});

	it("keeps a genuinely dirty checkout as PROJECT_CHANGED without writes", async () => {
		await writeFile(`${project.cwd}/src/value.ts`, "dirty\n");
		const before = await FileStateStore.readSnapshot(project.cwd);

		expect(await checkoutResponse()).toMatchObject({
			success: false,
			error: { code: "PROJECT_CHANGED" },
		});
		expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
		expect(before.state).toBeUndefined();
		expect(before.writerPresent).toBe(false);
	});
});
