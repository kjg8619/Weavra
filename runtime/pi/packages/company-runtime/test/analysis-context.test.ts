import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { prepareAnalysisContext, prepareSymptomVerification } from "../src/analysis-context.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { AnalysisContext } from "../src/contracts.ts";
import { buildTaskContract } from "../src/task-contract.ts";

let cwd: string;
const source = "export const value = 0;\n";
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const config = parseRuntimeConfig(
	JSON.stringify({
		schemaVersion: 1,
		models: {
			profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
		},
		files: { allowed_paths: ["src", "checks"] },
		verification: {
			checks: [{ id: "symptom", kind: "test", executable: process.execPath, args: ["checks/check.mjs"] }],
		},
	}),
);
const packet = (): AnalysisContext => ({
	version: 1,
	packetVersion: 1,
	authority: "ADVISORY_ONLY",
	reviewedAt: 100,
	symptom: "The value is zero",
	observations: [{ text: "Observed zero", provenance: "MODEL", reference: { kind: "source", path: "src/value.ts" } }],
	candidateCause: { kind: "HYPOTHESIS", text: "A constant may be wrong" },
	uncertainties: [],
	sourceReferences: [{ path: "src/value.ts", digest: digest(source) }],
	constraints: [],
});
beforeEach(async () => {
	cwd = await realpath(await mkdtemp(join(tmpdir(), "weavra-analysis-")));
	await mkdir(join(cwd, "src"));
	await mkdir(join(cwd, "checks"));
	await writeFile(join(cwd, "src/value.ts"), source);
	await writeFile(join(cwd, "checks/check.mjs"), "process.exit(0);\n");
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

it("compares the supplied digest instead of silently refreshing stale findings", async () => {
	const stale = packet();
	stale.sourceReferences[0].digest = digest("older source");
	await expect(prepareAnalysisContext(cwd, config, stale)).rejects.toMatchObject({ code: "PLAN_CHANGED" });
	expect(stale.sourceReferences[0].digest).toBe(digest("older source"));
});

it("captures source generation and rejects replacement immediately before use", async () => {
	const prepared = await prepareAnalysisContext(cwd, config, packet());
	prepared.assertCurrent();
	await rm(join(cwd, "src/value.ts"));
	await writeFile(join(cwd, "src/value.ts"), source);
	expect(() => prepared.assertCurrent()).toThrow();
	expect(prepared.packet).toEqual(packet());
});

it.each([".env", "checks/check.mjs", "src/link.ts", "../outside.ts"])(
	"rejects protected oracle or unsafe source %s",
	async (path) => {
		await writeFile(join(cwd, ".env"), source);
		await symlink(join(cwd, "src/value.ts"), join(cwd, "src/link.ts"));
		const input = packet();
		input.observations = [];
		input.sourceReferences = [{ path, digest: digest(source) }];
		await expect(prepareAnalysisContext(cwd, config, input)).rejects.toThrow();
	},
);

it("freezes a required symptom registration against the actual compiled criterion", async () => {
	const contract = buildTaskContract({
		goal: "Fix value bug",
		statements: ["Preserve input", "Value is one"],
		workflow: "STANDARD",
		config,
	});
	const prepared = await prepareSymptomVerification({
		cwd,
		config,
		contract,
		configDigest: digest("config"),
		proposal: { criterionIndex: 2, checkId: "symptom" },
	});
	expect(prepared.binding).toMatchObject({ criterionId: "AC-002", checkId: "symptom" });
	expect(prepared.binding.registrationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	prepared.assertCurrent();
	await writeFile(join(cwd, "checks/check.mjs"), "process.exit(1);\n");
	expect(() => prepared.assertCurrent()).toThrow();
});

it.each(["missing", "optional", "criterion"])("refuses an invalid symptom mapping: %s", async (kind) => {
	const selected = structuredClone(config);
	if (kind === "optional") selected.verification.checks[0].required = false;
	const contract = buildTaskContract({
		goal: "Fix value bug",
		statements: ["Value is one"],
		workflow: "STANDARD",
		config: selected,
	});
	await expect(
		prepareSymptomVerification({
			cwd,
			config: selected,
			contract,
			configDigest: digest("config"),
			proposal: {
				criterionIndex: kind === "criterion" ? 2 : 1,
				checkId: kind === "missing" ? "unknown" : "symptom",
			},
		}),
	).rejects.toMatchObject({ code: "INVALID_CRITERIA" });
});
