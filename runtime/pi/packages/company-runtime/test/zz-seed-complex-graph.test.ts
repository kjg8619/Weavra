import { expect, it } from "vitest";
import { FileStateStore } from "../src/state-store.ts";
import {
	complexConfig,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";

it.runIf(process.env.WEAVRA_COMPLEX_SEED_DIR)("seeds a COMPLEX run into a project for UI QA", async () => {
	const files = new FakeFiles({ "src/a.ts": "a\n", "src/c.ts": "c\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(
		[
			{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
			{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [] },
			{ claims: [{ path: "src/c.ts", operation: "modify" }], dependsOn: [1, 2] },
		],
		{ files, config: complexConfig({ maxParallel: 2 }) },
	);
	const h = complexHarness({ plan, parent, files });
	await driveComplex(await h.create());
	takeConsumerIssues();
	const stopAt = h.saved.findIndex(
		(run) => (run.complex?.tasks.filter((task) => task.status === "IMPLEMENTING").length ?? 0) >= 2,
	);
	expect(stopAt).toBeGreaterThan(0);
	const store = await FileStateStore.open(process.env.WEAVRA_COMPLEX_SEED_DIR as string);
	for (const run of h.saved.slice(0, stopAt + 1)) await store.save(run);
	await store.close();
});
