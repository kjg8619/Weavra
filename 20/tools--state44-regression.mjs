import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra";
const runner = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01";
const { _electron } = await import(`${runner}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const { seed, prepareCaptureProfile, freezeCaptureServerFrame } = await import(`${runner}/scripts/hig/seed.mjs`);
const { threadDeleteConfirmation } = await import(`${runner}/scripts/hig/cases.mjs`);
const { validateVisibleState, observeVisibleState, bounded } = await import(`${runner}/scripts/hig/assert.mjs`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { runner: (await Bun.$`GIT_MASTER=1 git -C ${runner} rev-parse HEAD`.text()).trim(), rows: [] };
const output = `${root}/pr-20/state44-regression`;
await fs.mkdir(output, { recursive: false });
for (const number of [16, 17, 18, 19]) {
  const bundle = `${root}/pr-${number}/after/app/weavra-desktop.app`;
  const manifest = JSON.parse(await fs.readFile(`${root}/pr-${number}/after/capture/capture-manifest.json`, "utf8"));
  const asarSha256 = hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`));
  assert.equal(asarSha256, manifest.provenance.asarSha256);
  const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-state44-"));
  const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
  for (const dir of [iso.home, iso.workspace, iso.app, `${iso.workspace}/baseline-project`]) await fs.mkdir(dir);
  prepareCaptureProfile(iso);
  const app = await _electron.launch({
    colorScheme: null, executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
    args: [`--user-data-dir=${iso.home}/chromium`, "--disable-background-networking"],
    env: { PATH: process.env.PATH, HOME: iso.home, TMPDIR: base, LANG: "en_US.UTF-8",
      WEAVRA_HOME: `${iso.home}/.weavra`, WEAVRA_APP_HOME: iso.app, GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", AWS_EC2_METADATA_DISABLED: "true" },
    timeout: 45000,
  });
  try {
    const page = await app.firstWindow(), win = await app.browserWindow(page);
    page.setDefaultTimeout(20000);
    await page.routeWebSocket("**/*", socket => {
      const server = socket.connectToServer(), methods = new Map();
      socket.onMessage(message => {
        const decoded = JSON.parse(String(message));
        for (const frame of Array.isArray(decoded) ? decoded : [decoded])
          if (frame._tag === "Request") methods.set(frame.id, frame.tag);
        server.send(message);
      });
      server.onMessage(message => {
        const decoded = JSON.parse(String(message));
        const frames = (Array.isArray(decoded) ? decoded : [decoded]).map(frame => freezeCaptureServerFrame(frame, methods.get(frame.requestId)));
        socket.send(JSON.stringify(Array.isArray(decoded) ? frames : frames[0]));
      });
      socket.onClose(() => server.close()); server.onClose(() => socket.close());
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ? route.abort() : route.continue();
    });
    await page.reload();
    const click = (name, within = page) => within.getByRole("button", { name, exact: true }).click();
    await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor();
    await click("계속하기"); await click("계속하기"); await click("프로젝트 가져오지 않기");
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await click("프로젝트 추가", sidebar); await page.getByText("로컬 폴더", { exact: true }).click();
    const folder = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
    await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
    await folder.fill(`${iso.workspace}/`); await page.getByText("baseline-project", { exact: true }).click();
    await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
    await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor(); await page.keyboard.press("Escape");
    seed(iso); await page.reload();
    await sidebar.getByText("03 Code blocks", { exact: true }).click();
    await page.waitForFunction(() => location.hash.includes("baseline-code"));
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () {
        const targets = this.items.filter(item => item.label === "삭제");
        if (targets.length !== 1) throw new Error("Exact delete menu target missing");
        targets[0].click();
      };
    });
    for (const [width, height] of [[1280, 800], [1920, 1080]]) {
      await win.evaluate((window, size) => window.setContentSize(...size), [width, height]);
      await page.setViewportSize({ width, height });
      await sidebar.getByText("03 Code blocks", { exact: true }).click({ button: "right" });
      const confirmation = await threadDeleteConfirmation(page);
      await bounded(page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }), "state44 composited frame", 20000);
      const observed = await page.evaluate(observeVisibleState, { target: '[role="alertdialog"]', boundary: null });
      validateVisibleState("44", observed, { target: '[role="alertdialog"]', boundary: null, theme: null });
      assert.equal(confirmation.label, "Confirm");
      const file = `${number}-${width}x${height}-44.png`, bytes = await page.screenshot({ path: `${output}/${file}`, scale: "css" });
      report.rows.push({ number, revision: manifest.revision, asarSha256, width, height, label: confirmation.label, observed, file, sha256: hash(bytes), pass: true });
      await page.keyboard.press("Escape"); await page.getByRole("alertdialog").waitFor({ state: "hidden" });
      assert.equal(await sidebar.getByText("03 Code blocks", { exact: true }).count(), 1);
    }
  } finally { await app.close(); }
  console.log(`STATE44_PR_${number}_PASS`);
}
await fs.writeFile(`${output}/receipt.json`, JSON.stringify(report, null, 2));
console.log(`STATE44_REGRESSION_PASS rows=${report.rows.length}`);
