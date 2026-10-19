import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const wt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-03";
const root = path.dirname(new URL(import.meta.url).pathname);
const side = process.argv[2];
const scenarios1280 = process.argv.includes("--scenarios-1280");
assert.ok(["before", "after"].includes(side));
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const exec = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const apps = (await fs.readdir(path.join(root, side, "app"))).filter((name) => name.endsWith(".app"));
assert.equal(apps.length, 1);
const bundle = path.join(root, side, "app", apps[0]);
const out = path.join(root, "supplemental", scenarios1280 ? "scenarios-1280" : side);
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-runtime-"));
const isolation = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const dir of [isolation.home, isolation.workspace, isolation.app]) await fs.mkdir(dir);
const suffix = "/baseline-project";
const longPath = scenarios1280 ? isolation.workspace + suffix : `${isolation.workspace}/${"path-".repeat(60).slice(0, 240 - isolation.workspace.length - suffix.length - 1)}${suffix}`;
assert.equal(longPath.length, scenarios1280 ? isolation.workspace.length + suffix.length : 240);
await fs.mkdir(longPath, { recursive: true });
prepareCaptureProfile(isolation);
const report = {
  authority: "PACKAGED_RENDERER; synthetic empty project; no Runtime execution",
  side, bundle, longPath, asarSha256: sha256(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  screenshots: [], measurements: [], counters: { model: 0, mutation: 0, externalNetwork: 0 },
  cleanup: { exited: false }, startedAt: new Date().toISOString(),
};
const application = await _electron.launch({
  executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
  args: [`--user-data-dir=${isolation.home}/chromium`, "--disable-background-networking"],
  env: {
    PATH: process.env.PATH, HOME: isolation.home, TMPDIR: base, LANG: "en_US.UTF-8",
    WEAVRA_HOME: `${isolation.home}/.weavra`, WEAVRA_APP_HOME: isolation.app,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    AWS_EC2_METADATA_DISABLED: "true",
  },
  timeout: 45000,
});
const page = await application.firstWindow();
page.setDefaultTimeout(15000);
const win = await application.browserWindow(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  if (response.payloadData.includes("thread.turn.start")) report.counters.model++;
  if (/"(?:workflow\.prepare|workflow\.confirm|planner\.start|weavra\.control)"/.test(response.payloadData)) report.counters.mutation++;
});
await installCaptureNetworkFixture(page);
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    report.counters.externalNetwork++;
    await route.abort();
  } else await route.continue();
});
const click = (role, name, scope = page) => scope.getByRole(role, { name, exact: true }).click();
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map((animation) => animation.finished));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function shot(file, note) {
  await settle();
  const absolute = path.join(out, file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await page.screenshot({ path: absolute, scale: "css" });
  report.screenshots.push({ file, note, sha256: sha256(await fs.readFile(absolute)) });
}
async function theme(mode) {
  const route = await page.evaluate(() => location.hash);
  await page.evaluate(() => { location.hash = "/"; });
  await click("button", "설정");
  await click("button", "Appearance");
  await page.getByText(mode === "dark" ? "Dark" : "Light", { exact: true }).click();
  await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, mode === "dark");
  await page.evaluate((route) => { location.hash = route; }, route);
  await page.waitForFunction((route) => location.hash === route, route);
  await settle();
}
async function measure(selector, label, size, mode) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  await settle();
  const sample = await locator.evaluate((node) => {
    const s = getComputedStyle(node), rect = node.getBoundingClientRect().toJSON();
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = s.color; ctx.fillRect(0, 0, 1, 1);
    const fg = [...ctx.getImageData(0, 0, 1, 1).data];
    return { rect, fg, fontSize: s.fontSize, opacity: s.opacity, disabled: node.matches(":disabled"), text: node.textContent };
  });
  const bg = await win.evaluate(async (w, rect) => {
    const bitmap = (await w.webContents.capturePage({
      x: Math.round(rect.left + rect.width / 2), y: Math.floor(rect.top + 3), width: 1, height: 1,
    })).toBitmap();
    return [bitmap[2], bitmap[1], bitmap[0]];
  }, sample.rect);
  const luminance = (rgb) => rgb.map((v) => {
    const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const alpha = sample.fg[3] / 255;
  const fg = bg.map((v, i) => sample.fg[i] * alpha + v * (1 - alpha));
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  const ratio = (light + 0.05) / (dark + 0.05);
  report.measurements.push({ label, size, mode, ...sample, bg, ratio });
  assert.ok(ratio >= 4.5, `${label}: ${mode} contrast ${ratio}`);
  assert.ok(parseFloat(sample.fontSize) >= 14);
  if (label === "prepare") {
    assert.equal(sample.disabled, true);
    assert.equal(sample.opacity, "1");
    assert.ok(sample.rect.height >= 32);
  }
}
try {
  await page.reload();
  await win.evaluate((w) => w.setContentSize(1280, 800));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor();
  if (side === "after") await page.getByText("연결 진단 정보", { exact: true }).click();
  await shot("1280x800/onboarding-diagnostics.png", side === "after" ? "Connection name precedes labelled selectable endpoint and environment ID" : "Parent exposes endpoint before disclosure exists");
  await click("button", "계속하기");
  await click("button", "계속하기");
  await click("button", "프로젝트 가져오지 않기");
  await click("button", "프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
  await page.getByText("로컬 폴더", { exact: true }).click();
  const address = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await address.fill(path.dirname(longPath) + "/");
  await page.getByText("baseline-project", { exact: true }).waitFor();
  await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"], button[aria-label="추가 (⌘ Enter)"], button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  if (scenarios1280) {
    seed(isolation);
    await page.reload();
    const { runScenarios, LABELS, chooseAlias } = await import(`${qa}/cases.mjs`);
    const { validateCheckCoverage } = await import(`${qa}/assert.mjs`);
    const named = async (page, role, key, scope = page) => {
      const locators = (LABELS[key] ?? [key]).map((label) =>
        scope.getByRole(role, { name: label, exact: true }).filter({ visible: true }));
      await locators.reduce((all, locator) => all.or(locator)).waitFor({ state: "visible" });
      const counts = await Promise.all(locators.map((locator) => locator.count()));
      return locators[chooseAlias(counts)];
    };
    const nativeMenu = async (label) => {
      await application.evaluate(({ Menu }, label) => {
        globalThis.higOriginalPopup ??= Menu.prototype.popup;
        Menu.prototype.popup = function () {
          const entries = this.items.filter((item) => item.label === label);
          if (entries.length !== 1) throw new Error(`Ambiguous native menu: ${label}`);
          entries[0].click();
        };
      }, label);
      await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks", { exact: true }).click({ button: "right" });
    };
    const scenarioPacket = { counters: { model: 0, runtimeMutation: 0, blockedOutbound: 0 } };
    report.scenarioChecks = await runScenarios({
      selected: ["03"], page, application, cdp, win, output: out, isolation, packet: scenarioPacket,
      click: async (role, key, scope) => (await named(page, role, key, scope)).click(),
      named, theme, nativeMenu,
      thread: async (title) => page.locator('[data-sidebar="sidebar"]').getByText(title, { exact: true }).click(),
      resize: async () => {
        await win.evaluate((w) => w.setContentSize(1280, 800));
        await page.setViewportSize({ width: 1280, height: 800 });
      },
      ready: async (page, text) => {
        await page.locator("body").filter({ hasText: text }).waitFor();
        await settle();
      },
    });
    validateCheckCoverage({ schemaVersion: 1, selection: "03", checks: report.scenarioChecks });
    report.authority = "SUPPLEMENTAL shared original case executors, actual 1280x800 viewport; synthetic wire observations";
    report.scenarioCounters = scenarioPacket.counters;
  } else {
  await click("combobox", "프로젝트별로 대화 보기");
  await page.locator('[title="baseline-project 프로젝트 설정"]').click();
  await page.locator("#weavra-controls").waitFor();
  for (const size of [[1280, 800], [1920, 1080], [840, 620]]) {
    await win.evaluate((w, [width, height]) => w.setContentSize(width, height), size);
    await page.setViewportSize({ width: size[0], height: size[1] });
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      const controls = page.locator("#weavra-controls");
      await controls.scrollIntoViewIfNeeded();
      const disclosure = controls.getByRole("button", { name: "연결 진단 정보", exact: true });
      if (side === "after" && await disclosure.getAttribute("aria-expanded") === "false") await disclosure.click();
      await shot(`${size.join("x")}/${mode}/diagnostic-open.png`, side === "after" ? "240-character workspace path selectable and wrapped within labelled disclosure" : "Parent has no diagnostic disclosure; raw scope remains in capability section");
      if (side === "after") {
        const pathNode = controls.locator("dd").filter({ hasText: longPath });
        assert.equal(await pathNode.count(), 1);
        assert.equal(await pathNode.textContent(), longPath);
        const geometry = await pathNode.evaluate((node) => ({
          width: node.clientWidth, scrollWidth: node.scrollWidth,
          userSelect: getComputedStyle(node).userSelect,
        }));
        assert.ok(geometry.scrollWidth <= geometry.width + 1);
        assert.equal(geometry.userSelect, "text");
        await page.evaluate(() => {
          const write = navigator.clipboard.writeText.bind(navigator.clipboard);
          let complete;
          globalThis.higCopyCompleted = new Promise((resolve) => { complete = resolve; });
          navigator.clipboard.writeText = async (value) => {
            await write(value);
            complete();
          };
        });
        const copyCompleted = page.evaluate(() => globalThis.higCopyCompleted);
        await controls.getByRole("button", { name: "진단 정보 복사", exact: true }).click();
        await copyCompleted;
        const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
        assert.ok(copied.includes(`작업 공간 전체 경로: ${longPath}`));
        report.measurements.push({ label: "exact-path-copy", size, mode, geometry, pathLength: longPath.length });
        await measure("#weavra-prepare-reason", "reason", size, mode);
        await measure('#weavra-controls button[aria-describedby="weavra-prepare-reason"]', "prepare", size, mode);
      }
      await controls.getByRole("button", { name: "워크플로 준비", exact: true }).scrollIntoViewIfNeeded();
      await shot(`${size.join("x")}/${mode}/prepare-end.png`, "Preparation action visible at scroll end; after has neutral disabled state and persistent cause");
      const metadata = page.locator("#weavra-overview details");
      if (side === "after") {
        await metadata.locator("summary").click();
        const fields = await metadata.locator("dt").allTextContents();
        assert.equal(fields.length, 16);
        assert.equal(new Set(fields).size, fields.length);
        report.measurements.push({ label: "all-original-metadata", size, mode, fields });
        await metadata.scrollIntoViewIfNeeded();
        await shot(`${size.join("x")}/${mode}/observation-details.png`, "All sixteen original fields retained once; unknown values remain unknown");
        await metadata.locator("summary").click();
      } else {
        await page.locator("#weavra-overview").scrollIntoViewIfNeeded();
        await shot(`${size.join("x")}/${mode}/observation-details.png`, "Parent shows repeated unknown metadata in the main overview");
      }
    }
  }
  assert.deepEqual(report.counters, { model: 0, mutation: 0, externalNetwork: 0 });
  }
} catch (error) {
  report.failure = String(error);
  await page.screenshot({ path: path.join(out, "failure.png") });
  await fs.writeFile(path.join(out, "failure-ax.txt"), await page.locator("body").ariaSnapshot());
  throw error;
} finally {
  await cdp.detach();
  const child = application.process();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await application.close();
  if (child.exitCode === null && child.signalCode === null) await exited;
  report.cleanup = { exited: true, pid: child.pid, code: child.exitCode, signal: child.signalCode };
  report.completedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, "measurements.json"), JSON.stringify(report, null, 2));
}
console.log(`SUPPLEMENTAL_${side.toUpperCase()}_PASS ${report.screenshots.length} PNGs`);
