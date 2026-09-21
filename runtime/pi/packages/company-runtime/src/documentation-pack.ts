import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Check } from "typebox/value";
import { fileDigest } from "./anchored-edit.ts";
import {
	type DocumentationConfig,
	DocumentationConfigSchema,
	type DocumentationMatch,
	type DocumentationPack,
	type DocumentationStatus,
} from "./documentation-pack-types.ts";
import {
	evaluatePolicy,
	isPolicyPath,
	isProtectedPath,
	type PolicyContext,
	type PolicyPathInspector,
} from "./policy.ts";
import { isContextEligible, readStableText } from "./task-context.ts";
import { CONTEXT_MAX_PACK_BYTES } from "./task-context-types.ts";

const exactVersion =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Strict inert registry validation. Errors never echo snapshot content or config fragments. */
export function validateDocumentationConfig(value: unknown): asserts value is DocumentationConfig {
	if (!Check(DocumentationConfigSchema, value)) throw new Error("Invalid reviewed documentation config");
	if (
		!isPolicyPath(value.manifest) ||
		isProtectedPath(value.manifest) ||
		!/(?:^|\/)package\.json$/.test(value.manifest)
	)
		throw new Error("Documentation version source must be a safe package.json path");
	const ids = new Set<string>();
	for (const entry of value.entries) {
		if (
			ids.has(entry.id) ||
			!exactVersion.test(entry.version) ||
			Buffer.byteLength(entry.content) > 8192 ||
			entry.content.includes("\0") ||
			Buffer.from(entry.content).toString("utf8") !== entry.content
		)
			throw new Error("Invalid reviewed documentation entry");
		ids.add(entry.id);
		for (const date of [entry.capturedAt, ...(entry.validUntil ? [entry.validUntil] : [])])
			if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date)
				throw new Error("Invalid documentation timestamp");
		if (entry.validUntil && entry.validUntil < entry.capturedAt)
			throw new Error("Invalid documentation validity interval");
		// References are labels, never fetched. Explicit URI userinfo/query/fragment can carry credentials.
		if (
			/^[A-Za-z][A-Za-z0-9+.-]*:/.test(entry.source.reference) &&
			!/^local:[A-Za-z0-9._/-]+$/.test(entry.source.reference)
		) {
			let source: URL;
			try {
				source = new URL(entry.source.reference);
			} catch {
				throw new Error("Invalid documentation source reference");
			}
			if (
				!entry.source.reference.startsWith("https://") ||
				source.protocol !== "https:" ||
				source.username ||
				source.password ||
				source.search ||
				source.hash
			)
				throw new Error("Unsupported documentation source reference");
		}
	}
}

export async function buildDocumentationPack(input: {
	cwd: string;
	config: DocumentationConfig;
	policy: PolicyContext;
	paths: PolicyPathInspector;
	protectedPaths?: readonly string[];
	verifierSources?: readonly string[];
	generatedAt: number;
	maxBytes?: number;
	signal?: AbortSignal;
}): Promise<DocumentationPack> {
	validateDocumentationConfig(input.config);
	input.signal?.throwIfAborted();
	const maxBytes = input.maxBytes ?? CONTEXT_MAX_PACK_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > CONTEXT_MAX_PACK_BYTES)
		throw new Error("Invalid documentation context budget");
	const cwd = realpathSync(input.cwd),
		config = input.config;
	let manifest: Record<string, unknown> | undefined,
		manifestDigest: string | null = null;
	const eligible = () =>
		isContextEligible(cwd, config.manifest, input.protectedPaths ?? [], input.verifierSources ?? [], input.policy);
	if (eligible()) {
		const decision = evaluatePolicy(
			{
				runId: input.policy.executionRunId,
				actionId: "documentation-version",
				actionDigest: "documentation-version",
				role: "Reviewer",
				tool: "runtime_read",
				risk: "R0",
				paths: [config.manifest],
			},
			input.policy,
			await input.paths.inspect([config.manifest]),
		);
		if (decision.decision === "ALLOW" && eligible()) {
			const source = readStableText(join(cwd, config.manifest));
			if (source && eligible()) {
				try {
					const value: unknown = JSON.parse(source.text);
					if (value && typeof value === "object" && !Array.isArray(value)) {
						manifest = value as Record<string, unknown>;
						manifestDigest = source.digest;
					}
				} catch {
					/* Malformed metadata is unavailable, never a guessed version. */
				}
			}
		}
	}
	const requested = [...config.requested].sort(lexical),
		entries: DocumentationMatch[] = [];
	for (const entry of [...config.entries].sort(
		(a, b) => lexical(a.component, b.component) || lexical(a.version, b.version) || lexical(a.id, b.id),
	)) {
		if (!requested.includes(entry.component)) continue;
		const versions = new Set<string>();
		let invalid = false;
		for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
			const table = manifest?.[field];
			if (!table || typeof table !== "object" || Array.isArray(table) || !Object.hasOwn(table, entry.component))
				continue;
			const version = (table as Record<string, unknown>)[entry.component];
			if (typeof version === "string" && exactVersion.test(version)) versions.add(version);
			else invalid = true;
		}
		const declaredVersion = !invalid && versions.size === 1 ? [...versions][0] : null;
		let status: DocumentationStatus;
		if (entry.reviewStatus === "UNREVIEWED") status = "UNAVAILABLE";
		else if (
			entry.reviewStatus === "STALE" ||
			fileDigest(entry.content) !== entry.digest ||
			(entry.validUntil !== undefined && Date.parse(entry.validUntil) <= input.generatedAt)
		)
			status = "STALE";
		else if (!manifest) status = "UNAVAILABLE";
		else if (!declaredVersion || Date.parse(entry.capturedAt) > input.generatedAt) status = "UNKNOWN";
		else status = declaredVersion === entry.version ? "MATCHED" : "VERSION_MISMATCH";
		const { content, ...metadata } = entry;
		entries.push({
			entry: metadata,
			status,
			declaredVersion,
			manifestDigest,
			...(status === "MATCHED" ? { content } : {}),
		});
	}
	let truncated = false;
	const finish = (): DocumentationPack => {
		const body = {
			version: 1 as const,
			requested,
			entries,
			unmatched: requested.filter(
				(component) => !entries.some((item) => item.entry.component === component && item.status === "MATCHED"),
			),
			stale: entries
				.filter((item) => item.status === "STALE")
				.map((item) => item.entry.id)
				.sort(lexical),
			versionSource: "npm-package-json-declaration" as const,
			truncated,
		};
		return {
			...body,
			digest: `sha256:${createHash("sha256")
				.update(JSON.stringify(["weavra-documentation-pack-v1", body]))
				.digest("hex")}`,
		};
	};
	let pack = finish();
	const bound = entries.length;
	for (let i = 0; Buffer.byteLength(JSON.stringify(pack)) > maxBytes && i <= bound; i++) {
		truncated = true;
		// Unmatched metadata yields first, then reverse canonical MATCHED entries; never half a snapshot.
		let index = entries.length - 1;
		while (index >= 0 && entries[index].status === "MATCHED") index--;
		if (!entries.length) throw new Error("Documentation context minimum exceeds byte cap");
		entries.splice(index < 0 ? entries.length - 1 : index, 1);
		pack = finish();
	}
	if (Buffer.byteLength(JSON.stringify(pack)) > maxBytes) throw new Error("Documentation context exceeds byte cap");
	input.signal?.throwIfAborted();
	return pack;
}

export function summarizeDocumentationPack(pack: DocumentationPack) {
	return {
		digest: pack.digest,
		matchedCount: pack.entries.filter((item) => item.status === "MATCHED").length,
		staleCount: pack.stale.length,
		unmatchedCount: pack.unmatched.length,
		bytes: Buffer.byteLength(JSON.stringify(pack)),
		truncated: pack.truncated,
	};
}
