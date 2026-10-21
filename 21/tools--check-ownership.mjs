import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees";
const repo = `${root}/hig-21`;
const plan = await fs.readFile(`${root}/omo-user-flow-20261003/.omo/plans/weavra-hig-design-20261018.md`, "utf8");
assert.ok(plan.includes("## Amendment 2026-10-21"));
assert.ok(plan.includes("Todo 21 additionally owns `S/components/chat/PanelLayoutControls.tsx`"));
const allowed = new Set([
  "app/t3code/apps/web/src/components/ChatView.tsx",
  "app/t3code/apps/web/src/components/AppSidebarLayout.tsx",
  "app/t3code/apps/web/src/components/WorkspacePageHeader.tsx",
  "app/t3code/apps/web/src/components/GitActionsControl.tsx",
  "app/t3code/apps/web/src/components/GitActionsControl.logic.ts",
  "app/t3code/apps/web/src/components/GitActionsControl.logic.test.ts",
  "app/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
  "app/t3code/apps/web/src/components/chat/MessagesTimeline.test.tsx",
  "app/t3code/apps/web/src/components/chat/MessagesTimeline.logic.ts",
  "app/t3code/apps/web/src/components/chat/MessagesTimeline.logic.test.ts",
  "app/t3code/apps/desktop/src/window/DesktopWindow.test.ts",
  "app/t3code/apps/web/src/components/chat/PanelLayoutControls.tsx",
]);
const git = async (...args) => (await exec("git", ["-C", repo, ...args], {
  env: { ...process.env, GIT_MASTER: "1" },
})).stdout.trim();
const files = (await git("diff", "--name-only", "d81bc594776ea0cf5b9ea45db6865a4f24831ded", "HEAD")).split("\n");
const product = files.filter(file => !file.startsWith("scripts/hig/"));
assert.ok(product.length > 0);
assert.deepEqual(product.filter(file => !allowed.has(file)), []);
assert.equal(await git("diff", "82834bcf1be52aed98eef525696550077bf83df2", "HEAD", "--", "scripts/hig"), "");
assert.equal(await git("status", "--porcelain", "--untracked-files=no"), "");
const result = {
  head: await git("rev-parse", "HEAD"),
  parent: "d81bc594776ea0cf5b9ea45db6865a4f24831ded",
  runner: "82834bcf1be52aed98eef525696550077bf83df2",
  amendmentApplied: true, product, unchangedRunnerFiles: files.filter(file => file.startsWith("scripts/hig/")),
};
await fs.writeFile("/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21/ownership.json", JSON.stringify(result, null, 2));
console.log(`OWNERSHIP_PASS productFiles=${product.length} amendmentApplied=true runnerIdentical=true`);
