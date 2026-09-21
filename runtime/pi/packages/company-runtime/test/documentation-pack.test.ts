import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fileDigest } from "../src/anchored-edit.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import {
	buildDocumentationPack,
	summarizeDocumentationPack,
	validateDocumentationConfig,
} from "../src/documentation-pack.ts";
import type { DocumentationConfig, DocumentationEntry } from "../src/documentation-pack-types.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";

let cwd: string;
const content = "label 1.2.3 returns an empty string for blank input. DATA_SENTINEL";
const entry: DocumentationEntry = {
	id: "label-doc",
	source: { kind: "reviewed-local", reference: "https://example.invalid/label/1.2.3" },
	component: "label",
	version: "1.2.3",
	capturedAt: "2026-09-01T00:00:00.000Z",
	digest: fileDigest(content),
	reviewStatus: "REVIEWED",
	content,
};
const config: DocumentationConfig = {
	mode: "bounded",
	manifest: "package.json",
	requested: ["label"],
	entries: [entry],
};
const generatedAt = Date.parse("2026-09-20T00:00:00.000Z");
async function build(
	overrides: Partial<DocumentationConfig> = {},
	maxBytes?: number,
	exclusions: { protectedPaths?: string[]; verifierSources?: string[] } = {},
) {
	return buildDocumentationPack({
		cwd,
		config: { ...config, ...overrides },
		generatedAt,
		maxBytes,
		...exclusions,
		paths: await FilePolicyPathInspector.open(cwd),
		policy: {
			executionMode: "EDIT",
			executionRunId: "run",
			tools: [{ id: "runtime_read", operation: "read" }],
			allowedPaths: ["package.json"],
			protectedPaths: [],
			configDigest: "config",
		},
	});
}
function manifest(value: unknown) {
	writeFileSync(join(cwd, "package.json"), JSON.stringify(value));
}
beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-docs-")));
	manifest({ dependencies: { label: "1.2.3" } });
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

it("binds exact declared dependency version and preserves reviewed provenance", async () => {
	const pack = await build();
	expect(pack.entries[0]).toEqual({
		entry: { ...entry, content: undefined },
		status: "MATCHED",
		declaredVersion: "1.2.3",
		manifestDigest: fileDigest(JSON.stringify({ dependencies: { label: "1.2.3" } })),
		content,
	});
	expect(pack.unmatched).toEqual([]);
	expect(pack.stale).toEqual([]);
	expect(pack.versionSource).toBe("npm-package-json-declaration");
});
it("canonicalizes registry order before computing its digest", async () => {
	const second = { ...entry, id: "label-other" };
	expect((await build({ entries: [entry, second] })).digest).toBe((await build({ entries: [second, entry] })).digest);
});
it("never presents mismatched documentation as current", async () => {
	manifest({ dependencies: { label: "2.0.0" } });
	const pack = await build();
	expect(pack.entries[0].status).toBe("VERSION_MISMATCH");
	expect(pack.entries[0].content).toBeUndefined();
	expect(pack.unmatched).toEqual(["label"]);
});
it.each([
	{ reviewStatus: "STALE" as const },
	{ validUntil: "2026-09-19T00:00:00.000Z" },
	{ digest: fileDigest("different reviewed bytes") },
])("marks stale registry data explicitly and withholds its content: %j", async (override) => {
	const pack = await build({ entries: [{ ...entry, ...override }] });
	expect(pack.entries[0].status).toBe("STALE");
	expect(pack.entries[0].content).toBeUndefined();
	expect(pack.stale).toEqual([entry.id]);
});
it("does not treat a recent capture timestamp as version knowledge", async () => {
	manifest({ dependencies: { label: "^1.2.3" } });
	expect((await build({ entries: [{ ...entry, capturedAt: "2026-09-19T23:59:59.999Z" }] })).entries[0].status).toBe(
		"UNKNOWN",
	);
});
it("does not guess between conflicting dependency declarations", async () => {
	manifest({ dependencies: { label: "1.2.3" }, devDependencies: { label: "2.0.0" } });
	expect((await build()).entries[0].status).toBe("UNKNOWN");
});
it("withholds unreviewed data even with an exact version and valid content digest", async () => {
	const pack = await build({ entries: [{ ...entry, reviewStatus: "UNREVIEWED" }] });
	expect(pack.entries[0].status).toBe("UNAVAILABLE");
	expect(pack.entries[0].content).toBeUndefined();
});
it.each([
	{ source: { kind: "network", reference: "https://example.invalid" } },
	{ digest: "sha256:bad" },
	{ command: "echo unsafe" },
	{ hook: "beforeReview" },
	{ tool: "runtime_write" },
	{ credential: "PRIVATE_SENTINEL" },
])("rejects unknown sources, malformed digests and executable/credential fields: %j", (override) => {
	expect(() => validateDocumentationConfig({ ...config, entries: [{ ...entry, ...override }] })).toThrow();
});
it("rejects URI credential/query data rather than copying it into the prompt", () => {
	expect(() =>
		validateDocumentationConfig({
			...config,
			entries: [
				{ ...entry, source: { kind: "reviewed-local", reference: "https://user:secret@example.invalid/docs" } },
			],
		}),
	).toThrow();
});
it("keeps inline registry schema strict through production config parsing", () => {
	const base = {
		schemaVersion: 1,
		models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
		review: { context: { impact: "bounded", documentation: config } },
	};
	expect(parseRuntimeConfig(JSON.stringify(base)).review.context?.documentation).toEqual(config);
	expect(() =>
		parseRuntimeConfig(
			JSON.stringify({
				...base,
				review: { context: { impact: "bounded", documentation: { ...config, hooks: [] } } },
			}),
		),
	).toThrow();
});
it.each(["symlink", "hardlink", "outside-policy"])("does not bypass the manifest read boundary: %s", async (kind) => {
	if (kind === "outside-policy") {
		mkdirSync(join(cwd, "other"));
		writeFileSync(join(cwd, "other/package.json"), JSON.stringify({ dependencies: { label: "1.2.3" } }));
		expect((await build({ manifest: "other/package.json" })).entries[0].status).toBe("UNAVAILABLE");
	} else {
		const source = join(cwd, "source.json");
		writeFileSync(source, JSON.stringify({ dependencies: { label: "1.2.3" } }));
		unlinkSync(join(cwd, "package.json"));
		if (kind === "symlink") symlinkSync(source, join(cwd, "package.json"));
		else linkSync(source, join(cwd, "package.json"));
		expect((await build()).entries[0].status).toBe("UNAVAILABLE");
	}
});
it("bounds the complete pack without retaining a truncated snapshot as MATCHED", async () => {
	const large = "x".repeat(8000),
		largeEntry = { ...entry, content: large, digest: fileDigest(large) };
	const pack = await build({ entries: [largeEntry] }, 1000);
	expect(pack.truncated).toBe(true);
	expect(pack.entries).toEqual([]);
	expect(pack.unmatched).toEqual(["label"]);
	expect(Buffer.byteLength(JSON.stringify(pack))).toBeLessThanOrEqual(1000);
	await expect(build({}, 10)).rejects.toThrow("minimum exceeds");
});
it("stores only bounded digests and counts in measurement summaries", async () => {
	const summary = summarizeDocumentationPack(await build());
	expect(summary.matchedCount).toBe(1);
	for (const secret of ["DATA_SENTINEL", "example.invalid", "label-doc", content])
		expect(JSON.stringify(summary)).not.toContain(secret);
});

it("requires valid literal SemVer without coercion, including prerelease identifier rules", async () => {
	for (const version of ["1.2.3-01", "1.2.3-alpha..1", "1.2.3+.", "01.2.3"]) {
		expect(() => validateDocumentationConfig({ ...config, entries: [{ ...entry, version }] })).toThrow();
		manifest({ dependencies: { label: version } });
		const pack = await build();
		expect(pack.entries[0].status).toBe("UNKNOWN");
		expect(pack.entries[0].content).toBeUndefined();
	}
	const version = "1.2.3-rc.1+build.7";
	manifest({ dependencies: { label: version } });
	expect((await build({ entries: [{ ...entry, version }] })).entries[0].content).toBe(content);
});

it("excludes manifest sources supplied separately from Policy protected paths", async () => {
	for (const exclusions of [{ verifierSources: ["PACKAGE.JSON"] }, { protectedPaths: ["package.json"] }]) {
		const pack = await build({}, undefined, exclusions);
		expect(pack.entries[0]).toMatchObject({ status: "UNAVAILABLE", manifestDigest: null });
		expect(pack.entries[0].content).toBeUndefined();
	}
});

it("rejects scheme-without-slashes credentials and unsupported schemes without echoing them", () => {
	for (const reference of [
		"https:example.invalid/docs?token=PRIVATE_SENTINEL",
		"mailto:PRIVATE_SENTINEL@example.invalid",
		"javascript:PRIVATE_SENTINEL",
	]) {
		let failure: unknown;
		try {
			validateDocumentationConfig({ ...config, entries: [{ ...entry, source: { ...entry.source, reference } }] });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(Error);
		expect(String(failure)).not.toContain("PRIVATE_SENTINEL");
	}
});

it("withholds content for missing metadata, future captures and the exact expiry boundary", async () => {
	const expired = await build({ entries: [{ ...entry, validUntil: new Date(generatedAt).toISOString() }] });
	expect(expired.entries[0].status).toBe("STALE");
	expect(expired.entries[0].content).toBeUndefined();
	const future = await build({ entries: [{ ...entry, capturedAt: new Date(generatedAt + 1).toISOString() }] });
	expect(future.entries[0].status).toBe("UNKNOWN");
	expect(future.entries[0].content).toBeUndefined();
	unlinkSync(join(cwd, "package.json"));
	const missing = await build();
	expect(missing.entries[0]).toMatchObject({ status: "UNAVAILABLE", manifestDigest: null });
	expect(missing.entries[0].content).toBeUndefined();
});
