import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve, win32 } from "node:path";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { parseDocument } from "yaml";
import { RegisteredBrowserCheckSchema, validateRegisteredBrowserCheck } from "./browser-types.ts";
import { CommandCheckKindSchema, WorkflowSchema } from "./contracts.ts";
import { validateDocumentationConfig } from "./documentation-pack.ts";
import { DocumentationConfigSchema } from "./documentation-pack-types.ts";
import { LspConfigSchema, normalizeLspConfig } from "./lsp/config.ts";
import { isPolicyPath, isProtectedPath } from "./policy.ts";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const strict = { additionalProperties: false } as const;
const profile = Type.Object({ provider: text, model: text }, strict);

export const RuntimeConfigSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		models: Type.Object(
			{
				profiles: Type.Object(
					{
						coding: profile,
						reasoning: profile,
						fast: Type.Optional(profile),
						creative: Type.Optional(profile),
					},
					strict,
				),
			},
			strict,
		),
		runtime: Type.Optional(
			Type.Object(
				{
					workflow: Type.Optional(Type.Union([Type.Literal("adaptive"), WorkflowSchema])),
				},
				strict,
			),
		),
		agents: Type.Optional(
			Type.Object(
				{
					max_parallel: Type.Optional(Type.Literal(1)),
					max_revision_cycles: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
					worker_timeout_ms: Type.Optional(Type.Integer({ minimum: 10_000, maximum: 600_000 })),
					// Task Context Pack (V0.5A): Host-selected advisory context. Opt-in and bounded only.
					context_pack: Type.Optional(
						Type.Object(
							{ mode: Type.Optional(Type.Union([Type.Literal("disabled"), Type.Literal("bounded")])) },
							strict,
						),
					),
				},
				strict,
			),
		),
		review: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(Type.Literal(true)),
					context: Type.Optional(
						Type.Object(
							{
								impact: Type.Enum(["disabled", "bounded"]),
								documentation: Type.Optional(DocumentationConfigSchema),
							},
							strict,
						),
					),
				},
				strict,
			),
		),
		// Optional bounded budget; absent means no configured budget (explicit unlimited). Not a billing hard cap.
		budget: Type.Optional(
			Type.Object(
				{
					max_worker_invocations: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
					max_reported_tokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000_000 })),
				},
				strict,
			),
		),
		state: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(Type.Literal(true)),
					directory: Type.Optional(Type.Literal(".ai")),
				},
				strict,
			),
		),
		risk: Type.Optional(
			Type.Object(
				{
					approval_required: Type.Optional(Type.Tuple([Type.Literal("R3")])),
				},
				strict,
			),
		),
		files: Type.Optional(
			Type.Object(
				{
					// Literal workspace-relative file/directory roots, not shell or glob patterns.
					allowed_paths: Type.Optional(Type.Array(text, { uniqueItems: true })),
				},
				strict,
			),
		),
		project: Type.Optional(
			Type.Object(
				{ instructions: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }, strict) },
				strict,
			),
		),
		// Strict mutation is an opt-in freshness/precondition contract for existing-file changes.
		// It never grants permission and is not human approval; Policy/R2/R3 authority is unchanged.
		mutation: Type.Optional(
			Type.Object({ mode: Type.Optional(Type.Union([Type.Literal("compatible"), Type.Literal("strict")])) }, strict),
		),
		code_intelligence: Type.Optional(Type.Object({ lsp: LspConfigSchema }, strict)),
		verification: Type.Optional(
			Type.Object(
				{
					repair: Type.Optional(
						Type.Object({ mode: Type.Optional(Type.Enum(["disabled", "self-check-once"])) }, strict),
					),
					// Verifier sandbox is an OS boundary for registered check processes; not permission or approval.
					sandbox: Type.Optional(
						Type.Object(
							{ mode: Type.Optional(Type.Union([Type.Literal("disabled"), Type.Literal("required")])) },
							strict,
						),
					),
					// Verifier trust pins the frozen registration and direct oracle sources; it is not a sandbox.
					trust: Type.Optional(
						Type.Object(
							{ mode: Type.Optional(Type.Union([Type.Literal("compatible"), Type.Literal("strict")])) },
							strict,
						),
					),
					checks: Type.Optional(
						Type.Array(
							Type.Union([
								Type.Object(
									{
										id: text,
										kind: CommandCheckKindSchema,
										executable: text,
										args: Type.Array(Type.String()),
										cwd: Type.Optional(text),
										timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 3_600_000 })),
										required: Type.Optional(Type.Boolean()),
										repairable_exit_codes: Type.Optional(
											Type.Array(Type.Integer({ minimum: 1, maximum: 255 }), { uniqueItems: true }),
										),
										trust: Type.Optional(
											Type.Object({ files: Type.Array(text, { uniqueItems: true, maxItems: 64 }) }, strict),
										),
									},
									strict,
								),
								Type.Object(
									{
										id: text,
										kind: Type.Literal("browser"),
										executable: text,
										required: Type.Optional(Type.Boolean()),
										browser: RegisteredBrowserCheckSchema,
										args: Type.Optional(Type.Array(Type.String(), { maxItems: 0 })),
										cwd: Type.Optional(Type.Literal(".")),
										timeout_ms: Type.Optional(Type.Literal(15000)),
										repairable_exit_codes: Type.Optional(Type.Array(Type.Integer(), { maxItems: 0 })),
										trust: Type.Optional(
											Type.Object({ files: Type.Array(Type.String(), { maxItems: 0 }) }, strict),
										),
									},
									strict,
								),
							]),
						),
					),
				},
				strict,
			),
		),
	},
	strict,
);

export type RuntimeConfigInput = Static<typeof RuntimeConfigSchema>;
export type RuntimeConfig = ReturnType<typeof parseRuntimeConfig>;
export type LoadedConfig =
	| { status: "missing"; path: string }
	| { status: "configured"; path: string; config: RuntimeConfig };

function validateRelativePath(path: string): void {
	if (
		path.startsWith("/") ||
		win32.isAbsolute(path) ||
		path.includes("\\") ||
		path.includes(":") ||
		path.split("/").includes("..") ||
		/[\x00-\x1f*?[\]{}]/.test(path)
	) {
		throw new Error("Config paths must be literal workspace-relative paths without parent traversal");
	}
}

/** Strict data parsing only: no interpolation, command execution, credential lookup or file writes. */
export function parseRuntimeConfig(source: string) {
	if (Buffer.byteLength(source, "utf8") > 65_536) throw new Error("Runtime config exceeds 64 KiB");
	let value: unknown;
	try {
		const document = parseDocument(source, {
			version: "1.2",
			schema: "core",
			merge: false,
			uniqueKeys: true,
			resolveKnownTags: false,
			prettyErrors: false,
			logLevel: "silent",
		});
		if (document.errors.length || document.warnings.length) throw new Error("Invalid YAML");
		value = document.toJS({ maxAliasCount: 0 });
	} catch {
		// Do not echo YAML snippets: malformed settings can contain credentials.
		throw new Error("Invalid runtime YAML: expected one document without aliases or unknown tags");
	}
	if (!Check(RuntimeConfigSchema, value)) {
		throw new Error(
			"Invalid runtime config: check schemaVersion, model profiles, supported fields and policy limits",
		);
	}
	if (
		value.project &&
		(!isPolicyPath(value.project.instructions.path) || isProtectedPath(value.project.instructions.path))
	)
		throw new Error("Project instruction path must be an unprotected literal workspace-relative file");
	const allowedPaths = value.files?.allowed_paths ?? [];
	if (value.review?.context?.documentation) validateDocumentationConfig(value.review.context.documentation);
	for (const path of allowedPaths) validateRelativePath(path);
	const ids = new Set<string>();
	const checks = (value.verification?.checks ?? []).map((check) => {
		if (ids.has(check.id)) throw new Error("Duplicate verification check ID");
		ids.add(check.id);
		if (check.kind === "browser") {
			validateRegisteredBrowserCheck(check.browser);
			if (check.id !== check.browser.checkId || !isAbsolute(check.executable))
				throw new Error("Browser check identity or executable is invalid");
			return {
				...check,
				args: [] as string[],
				cwd: ".",
				timeout_ms: 15000,
				required: check.required ?? true,
				trust: { files: [] as string[] },
				repairable_exit_codes: [] as number[],
			};
		}
		validateRelativePath(check.cwd ?? ".");
		const trustFiles = check.trust?.files ?? [];
		for (const file of trustFiles) {
			validateRelativePath(file);
			// A trusted verifier source cannot be an already protected/built-in path.
			if (isProtectedPath(file)) throw new Error("Verifier trust source must not be a protected path");
		}
		return {
			...check,
			cwd: check.cwd ?? ".",
			timeout_ms: check.timeout_ms ?? 60_000,
			required: check.required ?? true,
			trust: { files: [...trustFiles] },
		};
	});
	return {
		schemaVersion: value.schemaVersion,
		models: value.models,
		runtime: { workflow: value.runtime?.workflow ?? "adaptive" },
		agents: {
			max_parallel: 1 as const,
			max_revision_cycles: value.agents?.max_revision_cycles ?? 1,
			worker_timeout_ms: value.agents?.worker_timeout_ms ?? 180_000,
			context_pack: { mode: value.agents?.context_pack?.mode ?? ("disabled" as const) },
		},
		review: {
			enabled: true as const,
			...(value.review?.context ? { context: structuredClone(value.review.context) } : {}),
		},
		...(value.budget ? { budget: structuredClone(value.budget) } : {}),
		state: { enabled: true as const, directory: ".ai" as const },
		risk: { approval_required: ["R3"] as ["R3"] },
		files: { allowed_paths: allowedPaths },
		verification: {
			checks,
			trust: { mode: value.verification?.trust?.mode ?? ("compatible" as const) },
			sandbox: { mode: value.verification?.sandbox?.mode ?? ("disabled" as const) },
			repair: { mode: value.verification?.repair?.mode ?? ("disabled" as const) },
		},
		mutation: { mode: value.mutation?.mode ?? ("compatible" as const) },
		...(value.project ? { project: structuredClone(value.project) } : {}),
		...(value.code_intelligence
			? { code_intelligence: { lsp: normalizeLspConfig(value.code_intelligence.lsp) } }
			: {}),
	};
}

/** The caller must establish project trust before reading this project-local configuration. */
export async function loadRuntimeConfig(cwd: string): Promise<LoadedConfig> {
	const path = resolve(cwd, ".ai", "config.yaml");
	let source: string;
	try {
		const directory = await lstat(dirname(path));
		if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe config directory");
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536)
				throw new Error("Unsafe or oversized config file");
			source = await handle.readFile("utf8");
			const current = await lstat(dirname(path));
			if (
				!current.isDirectory() ||
				current.isSymbolicLink() ||
				current.dev !== directory.dev ||
				current.ino !== directory.ino
			)
				throw new Error("Config directory changed");
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return { status: "missing", path };
		throw new Error("Unable to read .ai/config.yaml");
	}
	return { status: "configured", path, config: parseRuntimeConfig(source) };
}
