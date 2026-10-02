import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "pi-command-credentials-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
async function files(
	source: "stored" | "key" | "provider-header" | "model-header" | "override-header",
	command: boolean,
) {
	const sentinel = join(root, "executed");
	const script = join(root, "credential.cjs");
	await writeFile(
		script,
		`require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed'); process.stdout.write('key')`,
	);
	const value = command ? `!"${process.execPath}" "${script}"` : "static-key";
	const provider = {
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:1",
		apiKey: source === "key" ? value : "static-key",
		...(source === "provider-header" ? { headers: { "x-key": value } } : {}),
		models: [{ id: "test", ...(source === "model-header" ? { headers: { "x-key": value } } : {}) }],
		...(source === "override-header" ? { modelOverrides: { test: { headers: { "x-key": value } } } } : {}),
	};
	const authPath = join(root, "auth.json");
	const modelsPath = join(root, "models.json");
	await writeFile(authPath, JSON.stringify(source === "stored" ? { isolated: { type: "api_key", key: value } } : {}));
	await writeFile(modelsPath, JSON.stringify({ providers: { isolated: provider } }));
	return { authPath, modelsPath, sentinel };
}
it.each(["stored", "key", "provider-header", "model-header", "override-header"] as const)(
	"denies %s command resolution for the lifetime of an opted-in Runtime",
	async (source) => {
		const paths = await files(source, true);
		const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, allowCredentialCommands: false });
		const model = runtime.getModel("isolated", "test");
		if (!model) throw new Error("Missing static model");
		await expect(runtime.getAuth(model)).rejects.toThrow();
		expect(existsSync(paths.sentinel)).toBe(false);
		await runtime.refresh({ allowNetwork: false });
		await expect(runtime.getAuth(model)).rejects.toThrow();
		expect(existsSync(paths.sentinel)).toBe(false);
	},
);
it("rechecks an atomically replaced auth file at actual use, not only construction", async () => {
	const paths = await files("stored", false);
	const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, allowCredentialCommands: false });
	expect((await runtime.getAuth("isolated"))?.auth.apiKey).toBe("static-key");
	await files("stored", true);
	const replacement = `${paths.authPath}.new`;
	await writeFile(replacement, await readFile(paths.authPath));
	await rename(replacement, paths.authPath);
	await expect(runtime.getAuth("isolated")).rejects.toThrow();
	expect(existsSync(paths.sentinel)).toBe(false);
});
it("keeps default command credential behavior unchanged outside controlled tasks", async () => {
	const paths = await files("key", true);
	const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false });
	expect((await runtime.getAuth("isolated"))?.auth.apiKey).toBe("key");
	expect(await readFile(paths.sentinel, "utf8")).toBe("executed");
});
