import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { readAnchoredSource } from "./anchored-files.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "./config.ts";
import { isListablePath, type PolicyContext } from "./policy.ts";
import { PROJECT_FACT_LIMIT, type ProjectFact, type ProjectFactSummary } from "./project-fact-types.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
import { FileStateStore } from "./state-store.ts";

export class ProjectFactError extends Error {
	readonly code:
		| "FACT_SOURCE_UNAVAILABLE"
		| "FACT_SOURCE_CHANGED"
		| "INVALID_FACT"
		| "FACT_LIMIT"
		| "STALE_PROJECT"
		| "CONFIG_CHANGED";
	constructor(code: ProjectFactError["code"]) {
		super(code);
		this.code = code;
	}
}
function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
// Conservative known-secret/transcript exclusion, not a classifier for arbitrary sensitive prose.
function forbiddenContent(text: string): boolean {
	return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b|(?:api[_ -]?key|password|passwd|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token)\s*["']?\s*[:=]\s*["']?\S+|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|["']role["']\s*:\s*["'](?:assistant|user|tool|system)["']|<\/?(?:thinking|analysis|tool_result|tool_use)>/i.test(
		text,
	);
}
function assertStatement(statement: string): void {
	if (
		!statement.trim() ||
		statement !== statement.trim() ||
		statement.length > 500 ||
		/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(statement) ||
		forbiddenContent(statement)
	)
		throw new ProjectFactError("INVALID_FACT");
}
type SourcePolicy = Pick<PolicyContext, "allowedPaths" | "protectedPaths">;
function capture(cwd: string, sourceRef: string, policy: SourcePolicy) {
	try {
		if (
			sourceRef.length > 256 ||
			!isListablePath(sourceRef, policy) ||
			/(?:^|\/)(?:sessions?|transcripts?|logs?|reasoning|tool[-_]?outputs?)(?:[./_-]|$)|\.(?:jsonl|log)$/i.test(
				sourceRef,
			)
		)
			throw new Error("ineligible");
		if (realpathSync(cwd) !== cwd) throw new Error("root alias");
		const ancestors = () => {
			let current = cwd;
			return ["", ...sourceRef.split("/").slice(0, -1)].map((part) => {
				current = part ? join(current, part) : current;
				const stat = lstatSync(current, { bigint: true });
				if (
					!stat.isDirectory() ||
					stat.isSymbolicLink() ||
					(stat.mode & 0o444n) === 0n ||
					(stat.mode & 0o111n) === 0n
				)
					throw new Error("ancestor");
				return { dev: String(stat.dev), ino: String(stat.ino) };
			});
		};
		const before = ancestors();
		const stat = lstatSync(join(cwd, sourceRef));
		if (stat.size > 65536 || (stat.mode & 0o444) === 0) throw new Error("unreadable or oversized");
		const source = readAnchoredSource(cwd, sourceRef);
		if (
			Buffer.byteLength(source.text) > 65536 ||
			forbiddenContent(source.text) ||
			JSON.stringify(before) !== JSON.stringify(ancestors())
		)
			throw new Error("unsafe source");
		return { sourceDigest: source.fileDigest, sourceGeneration: digest([cwd, before, source.identity]) };
	} catch {
		throw new ProjectFactError("FACT_SOURCE_UNAVAILABLE");
	}
}
async function sourcePolicy(
	cwd: string,
	config: RuntimeConfig,
	additional: readonly string[] = [],
): Promise<SourcePolicy> {
	const protectedPaths = await resolveProjectProtectedPaths(cwd, config, additional);
	// Fact eligibility is conservative even when configured program arguments are temporarily missing.
	const programs = [
		...config.verification.checks.map((check) => ({ cwd: check.cwd, args: [check.executable, ...check.args] })),
		...(config.code_intelligence?.lsp.enabled
			? config.code_intelligence.lsp.servers.map((server) => ({
					cwd: ".",
					args: [server.executable, ...server.args],
				}))
			: []),
	];
	for (const program of programs)
		for (const argument of program.args) {
			if (argument.startsWith("-")) continue;
			const candidate = relative(cwd, resolve(cwd, program.cwd, argument));
			if (candidate && candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate))
				protectedPaths.push(candidate.split(sep).join("/"));
		}
	if (config.project) protectedPaths.push(config.project.instructions.path);
	return { allowedPaths: config.files.allowed_paths, protectedPaths };
}
function configuration(cwd: string): RuntimeConfig {
	try {
		return parseRuntimeConfig(readAnchoredSource(cwd, ".ai/config.yaml").text);
	} catch {
		throw new ProjectFactError("FACT_SOURCE_UNAVAILABLE");
	}
}
export interface PreparedProjectFact {
	fact: Omit<ProjectFact, "reviewedAt">;
	projectRevision: number;
	configurationDigest: string;
}
export async function prepareProjectFact(
	cwd: string,
	sourceRef: string,
	statement: string,
): Promise<PreparedProjectFact> {
	assertStatement(statement);
	const config = await configuration(cwd);
	const policy = await sourcePolicy(cwd, config);
	const state = await FileStateStore.readSnapshot(cwd);
	const facts = state.state?.projectFacts ?? [];
	const previous = facts.find((fact) => fact.sourceRef === sourceRef);
	if (!previous && facts.length >= PROJECT_FACT_LIMIT) throw new ProjectFactError("FACT_LIMIT");
	if (digest(configuration(cwd)) !== digest(config)) throw new ProjectFactError("CONFIG_CHANGED");
	return {
		fact: { id: previous?.id ?? randomUUID(), statement, sourceRef, ...capture(cwd, sourceRef, policy) },
		projectRevision: state.state?.revision ?? 0,
		configurationDigest: digest(config),
	};
}
export async function projectFactStillCurrent(cwd: string, prepared: PreparedProjectFact): Promise<boolean> {
	try {
		const config = await configuration(cwd);
		if (digest(config) !== prepared.configurationDigest) return false;
		const policy = await sourcePolicy(cwd, config);
		if (digest(configuration(cwd)) !== prepared.configurationDigest) return false;
		const source = capture(cwd, prepared.fact.sourceRef, policy);
		return (
			source.sourceDigest === prepared.fact.sourceDigest &&
			source.sourceGeneration === prepared.fact.sourceGeneration
		);
	} catch {
		return false;
	}
}
export async function confirmProjectFact(
	cwd: string,
	prepared: PreparedProjectFact,
	reviewedAt: number,
	guard: () => void,
): Promise<string> {
	const store = await FileStateStore.open(cwd, { recoverInterrupted: false });
	try {
		if (store.snapshot.revision !== prepared.projectRevision) throw new ProjectFactError("STALE_PROJECT");
		const config = await configuration(cwd);
		if (digest(config) !== prepared.configurationDigest) throw new ProjectFactError("CONFIG_CHANGED");
		const policy = await sourcePolicy(cwd, config);
		const assertFresh = () => {
			guard();
			if (digest(configuration(cwd)) !== prepared.configurationDigest) throw new ProjectFactError("CONFIG_CHANGED");
			const source = capture(cwd, prepared.fact.sourceRef, policy);
			if (
				source.sourceDigest !== prepared.fact.sourceDigest ||
				source.sourceGeneration !== prepared.fact.sourceGeneration
			)
				throw new ProjectFactError("FACT_SOURCE_CHANGED");
		};
		assertFresh();
		await store.saveProjectFact({ ...prepared.fact, reviewedAt }, prepared.projectRevision, assertFresh);
		return prepared.fact.id;
	} finally {
		await store.close();
	}
}

/** Async canonical/config reads first; caller invokes the returned synchronous source check at its final use boundary. */
export async function loadProjectFactProjection(
	cwd: string,
	frozenPolicy?: SourcePolicy,
): Promise<() => ProjectFactSummary[]> {
	const config = await configuration(cwd);
	const policy = await sourcePolicy(cwd, config, frozenPolicy?.protectedPaths);
	const state = await FileStateStore.readSnapshot(cwd);
	const registryIdentity = JSON.stringify(state.state?.projectFacts ?? []);
	const facts = state.state?.projectFacts ?? [];
	return () => {
		if (facts.length === 0) return [];
		let canonicalCurrent = false;
		try {
			canonicalCurrent =
				digest(configuration(cwd)) === digest(config) &&
				JSON.stringify(FileStateStore.readProjectFacts(cwd)) === registryIdentity;
		} catch {
			/* Missing or malformed canonical state cannot authorize cached facts. */
		}
		return facts.map((fact) => {
			let valid = false;
			try {
				if (!canonicalCurrent) throw new Error("canonical inputs changed");
				assertStatement(fact.statement);
				if (frozenPolicy && !isListablePath(fact.sourceRef, frozenPolicy)) throw new Error("outside frozen scope");
				const source = capture(cwd, fact.sourceRef, policy);
				valid = source.sourceDigest === fact.sourceDigest && source.sourceGeneration === fact.sourceGeneration;
			} catch {
				/* Unverifiable sources never reuse their last valid content. */
			}
			return {
				id: fact.id,
				statement: valid ? fact.statement : null,
				sourceRef: fact.sourceRef,
				sourceDigest: fact.sourceDigest,
				reviewedAt: fact.reviewedAt,
				status: valid ? ("VALID" as const) : ("STALE" as const),
			};
		});
	};
}
