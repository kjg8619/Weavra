import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssistantMessage,
	type Context,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { type FauxProviderRegistration, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";
import { HostControlBridge, type HostControlOptions } from "../src/host-control.ts";
import type { HostControlResponse, HostControlState, HostPlannerStatus } from "../src/host-control-protocol.ts";

/**
 * V0.8B Planner fixtures: a real Host Control bridge over a temporary project and a scripted faux model runtime.
 * No real provider, credential or network is used; every model answer is scripted per test.
 */
export const COMPLEX_GOAL = "Refactor the parser across multiple modules";
export const STATEMENTS = ["The parser is split into modules", "Duplicate keys are rejected"];
export const CONFIG = {
	schemaVersion: 1,
	models: {
		profiles: {
			coding: { provider: "faux", model: "coding" },
			reasoning: { provider: "faux", model: "review" },
		},
	},
	agents: { max_revision_cycles: 3 },
	files: { allowed_paths: ["src"] },
	verification: {
		checks: [
			{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: ["--secret-arg"], required: false },
			{ id: "test", kind: "test", executable: "/usr/bin/true", args: ["--test-arg"] },
		],
	},
};
/** A valid two-task draft for COMPLEX_GOAL with STATEMENTS in the fixture project. */
export const DRAFT = {
	tasks: [
		{
			title: "Extract parser",
			goal: "Move parsing into src/parse.ts",
			dependsOnIndexes: [],
			criterionIndexes: [1],
			ownership: [
				{ path: "src/app.ts", operation: "modify" },
				{ path: "src/parse.ts", operation: "create" },
			],
			checkIds: ["test"],
		},
		{
			title: "Add validation",
			goal: "Reject duplicate keys",
			dependsOnIndexes: [1],
			criterionIndexes: [2],
			ownership: [],
			checkIds: ["test"],
		},
	],
};

export function submission(args: unknown, id?: string): AssistantMessage {
	return fauxAssistantMessage(fauxToolCall("submit_plan_draft", args as Record<string, unknown>, id ? { id } : {}), {
		stopReason: "toolUse",
	});
}
export function text(value = "Here is my plan in prose."): AssistantMessage {
	return fauxAssistantMessage(value);
}
/** The Planning Context the Host sent: the first user message. */
export function planningContext(context: Context): Record<string, unknown> & { role: string } {
	const first = context.messages.find((message) => message.role === "user");
	if (!first || first.role !== "user") throw new Error("No Planning Context");
	const body =
		typeof first.content === "string"
			? first.content
			: first.content.map((part) => ("text" in part ? part.text : "")).join("");
	return JSON.parse(body);
}
export function toolResultTexts(context: Context): string[] {
	return context.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => message.content.map((part) => ("text" in part ? part.text : "")).join(""));
}
export function userTexts(context: Context): string[] {
	return context.messages
		.filter((message) => message.role === "user")
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: message.content.map((part) => ("text" in part ? part.text : "")).join(""),
		);
}
/** A response that stays pending until the Host aborts it (a model that never answers). */
export function hanging(entered?: () => void): FauxResponseFactory {
	return async (_context, options) => {
		entered?.();
		await new Promise<void>((resolve) => {
			if (options?.signal?.aborted) resolve();
			else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
		});
		return fauxAssistantMessage("Late answer after abort");
	};
}
export function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** A faux provider registered as `faux` with models `coding` and `review`, plus configured test-only auth. */
export async function fauxModels(): Promise<{ runtime: ModelRuntime; faux: FauxProviderRegistration }> {
	const faux = registerFauxProvider({ models: [{ id: "coding" }, { id: "review" }] });
	faux.setResponses([]);
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("faux", async () => ({ type: "api_key", key: "faux-key" }));
	const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
	runtime.registerProvider("faux", {
		baseUrl: faux.getModel().baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		models: faux.models.map((model) => ({
			id: model.id,
			name: model.name,
			api: model.api,
			reasoning: model.reasoning,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			baseUrl: model.baseUrl,
		})),
	});
	return { runtime, faux };
}

export interface PlannerProject {
	cwd: string;
	agentDir: string;
	cleanup(): Promise<void>;
	configure(value?: unknown): Promise<void>;
	aiFiles(): Promise<Record<string, string>>;
}
export async function plannerProject(config: unknown = CONFIG): Promise<PlannerProject> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "wv-plan-")));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	await mkdir(join(cwd, ".ai"), { recursive: true });
	await mkdir(join(cwd, "src"), { recursive: true });
	await mkdir(agentDir);
	await writeFile(join(cwd, "src/app.ts"), "export const app = 1;\n");
	const configure = async (value: unknown = config) => writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(value));
	await configure();
	return {
		cwd,
		agentDir,
		configure,
		cleanup: () => rm(root, { recursive: true, force: true }),
		async aiFiles() {
			const names = (await readdir(join(cwd, ".ai"))).sort();
			return Object.fromEntries(
				await Promise.all(
					names.map(async (name) => [name, await readFile(join(cwd, ".ai", name), "utf8")] as const),
				),
			);
		},
	};
}

export type Connection = Awaited<ReturnType<typeof plannerClient>>;
/** One Host Control connection with sequenced mutations, as the App's ControlTransport sends them. */
export async function plannerClient(
	project: PlannerProject,
	options: Partial<HostControlOptions> & { models?: ModelRuntime } = {},
	bridge?: HostControlBridge,
) {
	const createModels = vi.fn(async () => {
		if (!options.models) throw new Error("Model initialization forbidden");
		return options.models;
	});
	const owner =
		bridge ??
		(await HostControlBridge.create({
			cwd: project.cwd,
			projectTrusted: true,
			agentDir: project.agentDir,
			readiness: "READY",
			createModels,
			...options,
		}));
	const lines: string[] = [];
	const connection = owner.connect((line) => {
		lines.push(line);
		return true;
	});
	const send = async (input: Record<string, unknown>): Promise<HostControlResponse> => {
		const offset = lines.length;
		await connection.receive(JSON.stringify({ protocolVersion: 1, id: "read-only", ...input }));
		return JSON.parse(lines[offset]!);
	};
	const hello = await send({ type: "control.hello" });
	const state = async (): Promise<HostControlState> => {
		const response = await send({ type: "control.snapshot" });
		if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
		return response.data.state;
	};
	const mutation = async (fields: Record<string, unknown>) => {
		const current = await state();
		return send({
			id: current.nextRequestId,
			ownerId: current.ownerId,
			expectedProjectRevision: current.projectRevision,
			...fields,
		});
	};
	const start = (fields: Record<string, unknown> = {}) =>
		mutation({ type: "planner.start", goal: COMPLEX_GOAL, acceptanceStatements: STATEMENTS, ...fields });
	/** Polls snapshots until the planner leaves RUNNING (or the predicate holds). */
	const settle = async (
		predicate: (planner: HostPlannerStatus | undefined) => boolean = (planner) => planner?.status !== "RUNNING",
	): Promise<HostControlState> => {
		let seen = await state();
		await vi.waitFor(
			async () => {
				seen = await state();
				expect(predicate(seen.planner)).toBe(true);
			},
			{ timeout: 20_000, interval: 10 },
		);
		return seen;
	};
	return { bridge: owner, connection, lines, send, hello, state, mutation, start, settle, createModels };
}
