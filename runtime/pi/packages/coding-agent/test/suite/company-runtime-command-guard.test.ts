import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandGuardEntry } from "../../../company-runtime/src/command-guard.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { ExtensionUIContext } from "../../src/index.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

// #5 candidate 1: the Weavra command guard in a real AgentSession tool loop, faux model only.
// A recording stand-in replaces the built-in bash tool, so no shell runs in these tests.
describe("Weavra command guard in the parent conversation (#5)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length) harnesses.pop()?.cleanup();
	});

	async function conversation(executed: string[]) {
		const bash: AgentTool = {
			name: "bash",
			label: "bash",
			description: "Execute bash commands",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_id, params) => {
				executed.push((params as { command: string }).command);
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [bash],
			extensionFactories: [(pi) => registerCompanyRuntime(pi, { commandGuard: "confirm" })],
		});
		harnesses.push(harness);
		return harness;
	}
	const guardEntries = (harness: Harness) =>
		harness.sessionManager
			.getEntries()
			.flatMap((entry) =>
				entry.type === "custom" && entry.customType === "weavra.command-guard"
					? [entry.data as CommandGuardEntry]
					: [],
			);
	/** One bash call, then a final message quoting the tool result and the context roles the model received. */
	function script(harness: Harness, command: string) {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
			(context) => {
				const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
				const text =
					result?.role === "toolResult"
						? result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
						: "";
				return fauxAssistantMessage(`${context.messages.map((message) => message.role).join(",")}|${text}`);
			},
		]);
	}

	it("without a UI, runs read-only commands and refuses destructive ones before the tool executes", async () => {
		const executed: string[] = [];
		const harness = await conversation(executed);
		script(harness, "ls -la");
		await harness.session.prompt("list files");
		script(harness, "rm -rf build");
		await harness.session.prompt("clean the build");
		expect(executed).toEqual(["ls -la"]);
		const [allowed, refused] = getAssistantTexts(harness).filter((text) => text.includes("|"));
		expect(allowed).toBe("user,assistant,toolResult|ran");
		// Guard records never enter the model context: only the conversation messages are sent.
		expect(refused.split("|")[0]).toBe("user,assistant,toolResult,assistant,user,assistant,toolResult");
		expect(refused).toContain("this destructive bash command was not run");
		expect(refused).toContain("not available in print mode");
		expect(guardEntries(harness).map((entry) => [entry.category, entry.confirmation, entry.decision])).toEqual([
			["read_only", "not_required", "allow"],
			["destructive", "unavailable", "deny"],
		]);
		expect(JSON.stringify(guardEntries(harness))).not.toContain("rm -rf build");
	});

	it("in the TUI, a destructive command runs only after Run once; Deny blocks it", async () => {
		const executed: string[] = [];
		const harness = await conversation(executed);
		const select = vi.fn<ExtensionUIContext["select"]>();
		await harness.session.bindExtensions({
			mode: "tui",
			uiContext: { select, notify: vi.fn(), setStatus: vi.fn() } as unknown as ExtensionUIContext,
		});
		select.mockResolvedValueOnce("Deny");
		script(harness, "git reset --hard");
		await harness.session.prompt("reset");
		select.mockResolvedValueOnce("Run once");
		script(harness, "git reset --hard");
		await harness.session.prompt("reset, I confirm");
		expect(executed).toEqual(["git reset --hard"]);
		expect(select).toHaveBeenCalledTimes(2);
		expect(select.mock.calls[0][1]).toEqual(["Deny", "Run once"]);
		expect(getAssistantTexts(harness).find((text) => text.includes("did not confirm"))).toContain(
			"Do not retry it or work around it",
		);
		expect(guardEntries(harness).map((entry) => [entry.confirmation, entry.decision])).toEqual([
			["declined", "deny"],
			["confirmed", "allow"],
		]);
	});

	it("in the TUI, an unknown command allowed for the session reruns without a prompt until the next session start", async () => {
		const executed: string[] = [];
		const harness = await conversation(executed);
		const select = vi.fn<ExtensionUIContext["select"]>();
		const ui = { select, notify: vi.fn(), setStatus: vi.fn() } as unknown as ExtensionUIContext;
		await harness.session.bindExtensions({ mode: "tui", uiContext: ui });
		select.mockResolvedValueOnce("Allow for this session");
		for (const prompt of ["test", "test again"]) {
			script(harness, "npm test");
			await harness.session.prompt(prompt);
		}
		expect(executed).toEqual(["npm test", "npm test"]);
		expect(select).toHaveBeenCalledOnce();
		expect(select.mock.calls[0][1]).toEqual(["Deny", "Run once", "Allow for this session"]);
		// Binding a session emits session_start, which forgets every session allowance.
		await harness.session.bindExtensions({ mode: "tui", uiContext: ui });
		select.mockResolvedValueOnce("Deny");
		script(harness, "npm test");
		await harness.session.prompt("test once more");
		expect(executed).toEqual(["npm test", "npm test"]);
		expect(select).toHaveBeenCalledTimes(2);
		expect(guardEntries(harness).map((entry) => [entry.confirmation, entry.decision])).toEqual([
			["allowed_session", "allow"],
			["allowed_session_cached", "allow"],
			["declined", "deny"],
		]);
	});
});
