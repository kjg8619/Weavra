import { describe, expect, it } from "vitest";
import type { Handoff, RoleSessionReference, Run } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

const ref: RoleSessionReference = {
	role: "Developer",
	sessionId: "session-1",
	sessionFile: "/pi/sessions/session-1.jsonl",
};
const handoff: Handoff = {
	role: "Developer",
	runId: "run-1",
	revision: 0,
	task: "task-1",
	changed_files: [],
	summary: "Fixture",
	assumptions: [],
	tests_run: [],
	known_risks: [],
	unresolved: [],
};

async function setup(execute: (request: AgentExecutionRequest) => Promise<void>, failReferenceSave = false) {
	let saved: Run | undefined;
	const events: RuntimeEvent[] = [];
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run-1",
			task: testContract("Fix bug", { taskId: "task-1" }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", reason: "Fixture", confidence: null },
		},
		{
			agents: {
				execute: async (request) => {
					await execute(request);
					return { role: "Developer", handoff };
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("Not used");
				},
			},
			store: {
				load: async () => structuredClone(saved),
				save: async (run) => {
					if (failReferenceSave && run.roleSessionRefs.length) throw new Error("Reference save failed");
					saved = structuredClone(run);
				},
			},
			events: {
				emit: (event) => {
					events.push(event);
				},
			},
		},
	);
	await kernel.start();
	return { kernel, events, saved: () => saved };
}

describe("host-independent worker session metadata", () => {
	it("persists reference before worker continuation, emits metadata and rejects late callbacks", async () => {
		let register: AgentExecutionRequest["onSessionCreated"];
		const fixture = await setup(async (request) => {
			register = request.onSessionCreated;
			await register!(ref);
			expect(fixture.saved()?.roleSessionRefs).toEqual([ref]);
		});
		await fixture.kernel.advance("implement");
		expect(fixture.events.find((event) => event.type === "AgentSessionCreated")).toMatchObject({
			sessionRef: ref,
			profile: "coding",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
		});
		const revision = fixture.kernel.snapshot.revision;
		await expect(register!({ ...ref, sessionId: "late" })).rejects.toThrow("closed");
		expect(fixture.kernel.snapshot.revision).toBe(revision);
	});
	it.each(["wrong role", "duplicate", "invalid schema"])("rejects %s session registration", async (mode) => {
		const fixture = await setup(async (request) => {
			if (mode === "duplicate") await request.onSessionCreated!(ref);
			await request.onSessionCreated!({
				...ref,
				role: mode === "wrong role" ? "Reviewer" : "Developer",
				sessionFile: mode === "invalid schema" ? "" : ref.sessionFile,
			});
		});
		const result = await fixture.kernel.advance("implement");
		expect(result.status).toBe("FAILED");
		expect(fixture.events.some((event) => event.type === "AgentCompleted")).toBe(false);
	});
	it("prevents worker continuation and completion events on reference persistence failure", async () => {
		let calls = 0;
		const fixture = await setup(async (request) => {
			await request.onSessionCreated!(ref);
			calls++;
		}, true);
		await expect(fixture.kernel.advance("implement")).rejects.toThrow("Reference save failed");
		expect(calls).toBe(0);
		expect(fixture.kernel.snapshot.status).toBe("FAILED");
		expect(
			fixture.events.some((event) => event.type === "AgentCompleted" || event.type === "AgentSessionCreated"),
		).toBe(false);
	});
});
