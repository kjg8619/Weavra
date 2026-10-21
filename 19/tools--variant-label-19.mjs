import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

const wt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19";
const qa = `${wt}/scripts/hig`;
const bundle = process.env.QA_APP;
const out = process.env.QA_OUT;
assert.ok(bundle && out, "QA_APP and QA_OUT are required");
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-19-label-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const dir of [iso.home, iso.workspace, iso.app]) await fs.mkdir(dir);
prepareCaptureProfile(iso);
const report = {
  revision: process.env.QA_REVISION,
  asarSha256: hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  scriptSha256: hash(await fs.readFile(new URL(import.meta.url))),
  rows: [], failures: [], screenshots: [],
  counters: { model: 0, execution: 0, externalNetwork: 0 },
};
const app = await _electron.launch({
  colorScheme: null,
  executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
  args: [`--user-data-dir=${iso.home}/chromium`, "--disable-background-networking"],
  env: {
    PATH: process.env.PATH, HOME: iso.home, TMPDIR: base, LANG: "en_US.UTF-8",
    WEAVRA_HOME: `${iso.home}/.weavra`, WEAVRA_APP_HOME: iso.app,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
  },
  timeout: 45000,
});
try {
  const page = await app.firstWindow();
  const win = await app.browserWindow(page);
  page.setDefaultTimeout(20000);
  await installCaptureNetworkFixture(page);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      report.counters.externalNetwork++;
      await route.abort();
    } else await route.continue();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameSent", ({ response }) => {
    if (/thread\.turn\.start/.test(response.payloadData)) report.counters.model++;
    if (/"(?:terminal\.create|terminal\.write|workflow\.prepare|workflow\.confirm|planner\.start)"/.test(response.payloadData))
      report.counters.execution++;
  });
  const click = (role, name, root = page) => root.getByRole(role, { name, exact: true }).click();
  const settle = () => page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.reload();
  await win.evaluate(w => w.setContentSize(1280, 800));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor({ timeout: 30000 });
  await click("button", "계속하기");
  await click("button", "계속하기");
  await click("button", "프로젝트 가져오지 않기");
  await click("button", "프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
  await fs.mkdir(`${iso.workspace}/baseline-project`);
  await page.getByText("로컬 폴더", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
  await page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]').fill(`${iso.workspace}/`);
  await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  seed(iso);
  await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks", { exact: true }).waitFor();
  await click("button", "설정");
  await click("button", "Appearance");
  // Both halves have two options, so the selected preview, +1 and check badge
  // are present in every measured context, not only an inactive label.
  for (const mode of ["light", "dark"]) {
    for (const [name, accent] of [["Alpha", "#327a45"], ["Beta", "#a03a8a"]]) {
      await click("button", "Add theme");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "Theme JSON", exact: true }).fill(JSON.stringify({
        version: 1, id: `qa19-${mode}-${name.toLowerCase()}`, name: `QA19 ${name}`,
        appearance: mode, colors: { accent }, collection: { id: "qa19-set", label: "QA19 set" },
      }));
      await click("button", "Add theme", dialog);
      await dialog.waitFor({ state: "hidden" });
    }
  }
  const card = page.locator('[data-theme-library-card]').filter({
    has: page.locator('button[aria-label^="Choose dark variant"]'),
  });
  assert.equal(await card.count(), 1);
  for (const theme of ["light", "dark"]) {
    await click("button", `Use ${theme} mode`);
    await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, theme === "dark");
    for (const [width, height] of [[840, 620], [1280, 800], [1920, 1080]]) {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w, size) => w.setContentSize(...size), [width, height]);
      await page.setViewportSize({ width, height });
      for (const scale of [100, 150]) {
        await page.evaluate(value => { document.documentElement.style.fontSize = `${value}%`; }, scale);
        await card.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.activeElement?.blur());
        await settle();
        const native = await win.evaluate(w => ({
          minimum: w.getMinimumSize(), bounds: w.getBounds(), content: w.getContentBounds(),
        }));
        const rows = await card.evaluate(card => {
          const group = card.querySelector('[aria-label="Light and dark theme variants"]');
          const triggers = [...group.querySelectorAll("[data-theme-variant-trigger]")];
          const labels = [...group.querySelectorAll(":scope > .contents > span")];
          if (triggers.length !== 2 || labels.length !== 2) throw new Error("Expected both preview labels");
          const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
            * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          return triggers.map((trigger, index) => {
            const label = labels[index];
            const previewRect = trigger.getBoundingClientRect();
            const badge = trigger.querySelector('[data-slot="selection-check"]')?.parentElement;
            if (!badge) throw new Error("Selected preview must have a check badge");
            const badgeRect = badge.getBoundingClientRect();
            const textNodes = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
            const textRects = [];
            for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) textRects.push(rect.toJSON());
            }
            if (textRects.length < 2 || label.lastElementChild.textContent.trim() !== "+1")
              throw new Error("Expected variant name and option count");
            const labelRect = label.getBoundingClientRect();
            return {
              mode: trigger.dataset.themeVariantTrigger, label: label.textContent.trim(),
              fontSize: parseFloat(getComputedStyle(label).fontSize),
              groupHeight: group.getBoundingClientRect().height,
              previewRect: previewRect.toJSON(), badgeRect: badgeRect.toJSON(),
              labelRect: labelRect.toJSON(), textRects,
              textPreviewOverlap: textRects.reduce((area, rect) => area + intersect(rect, previewRect), 0),
              textBadgeOverlap: textRects.reduce((area, rect) => area + intersect(rect, badgeRect), 0),
              labelPreviewOverlap: intersect(labelRect, previewRect),
              labelBadgeOverlap: intersect(labelRect, badgeRect),
              clipped: label.querySelector(".truncate").scrollWidth > label.querySelector(".truncate").clientWidth,
            };
          });
        });
        for (const row of rows) {
          const result = {
            theme, width, height, scale, native, ...row,
            pass: row.textPreviewOverlap === 0 && row.textBadgeOverlap === 0
              && row.labelPreviewOverlap === 0 && row.labelBadgeOverlap === 0
              && !row.clipped && row.fontSize >= 14,
          };
          report.rows.push(result);
          if (!result.pass) report.failures.push(result);
        }
        const file = `variant-${theme}-${width}x${height}-${scale}.png`;
        const bytes = await page.screenshot({ path: `${out}/${file}`, scale: "css" });
        report.screenshots.push({ file, sha256: hash(bytes) });
      }
    }
  }
  assert.equal(report.rows.length, 24);
  assert.equal(report.screenshots.length, 12);
  assert.ok(Object.values(report.counters).every(value => value === 0), "Forbidden request counters");
} catch (error) {
  report.failures.push({ error: String(error), stack: error.stack });
  console.error(error);
} finally {
  await app.close();
  report.cleanup = { closed: true };
  report.summary = {
    contexts: report.rows.length / 2, labels: report.rows.length,
    failures: report.failures.length,
    maximumTextPreviewOverlap: Math.max(0, ...report.rows.map(row => row.textPreviewOverlap)),
    maximumTextBadgeOverlap: Math.max(0, ...report.rows.map(row => row.textBadgeOverlap)),
    counters: report.counters,
  };
  await fs.writeFile(`${out}/measurements.json`, JSON.stringify(report, null, 2));
  await fs.writeFile(`${out}/summary.json`, JSON.stringify(report.summary, null, 2));
}
console.log("VARIANT_LABEL", JSON.stringify(report.summary));
process.exitCode = report.failures.length ? 1 : 0;
