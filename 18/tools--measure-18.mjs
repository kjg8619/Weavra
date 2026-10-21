import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
const side = process.argv[2] ?? "after";
if (!["before", "after"].includes(side)) throw new Error("Expected before or after");
const pk = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18";
const wt = `/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-${side === "before" ? "18-before" : "18"}`;
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const out = `${pk}/measure-${side}`;
const bundle = `${pk}/${side}/app/weavra-desktop.app`;
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const hash = b => createHash("sha256").update(b).digest("hex");
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-m18-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const dir of [iso.home, iso.workspace, iso.app]) await fs.mkdir(dir);
prepareCaptureProfile(iso);
const report = {
  side, revision: (await Bun.$`git -C ${wt} rev-parse HEAD`.text()).trim(),
  scriptSha256: hash(await fs.readFile(new URL(import.meta.url))),
  asarSha256: hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  rows: [], screenshots: [], failures: [], counters: { model: 0, execution: 0, externalNetwork: 0 },
};
const check = (name, ok, data) => {
  report.rows.push({ check: name, pass: ok, ...data });
  if (!ok && side === "after") report.failures.push({ name, ...data });
};
const app = await _electron.launch({
  executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
  args: [`--user-data-dir=${iso.home}/chromium`, "--disable-background-networking"],
  env: {
    PATH: process.env.PATH, HOME: iso.home, TMPDIR: base, LANG: "en_US.UTF-8",
    WEAVRA_HOME: `${iso.home}/.weavra`, WEAVRA_APP_HOME: iso.app,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    AWS_EC2_METADATA_DISABLED: "true",
  }, timeout: 45000,
});
const page = await app.firstWindow();
const win = await app.browserWindow(page);
page.setDefaultTimeout(20000);
process.once("SIGTERM", () => { void app.close(); });
await installCaptureNetworkFixture(page);
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    report.counters.externalNetwork++; await route.abort();
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
async function shot(file) {
  await settle();
  const path = `${out}/${file}`;
  await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const bytes = await page.screenshot({ path, scale: "css" });
  report.screenshots.push({ file, sha256: hash(bytes), native: await win.evaluate(w => ({
    minimum: w.getMinimumSize(), bounds: w.getBounds(), content: w.getContentBounds(),
  })) });
}
async function measure(root, context) {
  await settle();
  const rows = await root.evaluate(root => {
    const rgba = value => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] / 255 + b[i] * (1 - a[3] / 255));
    const background = n => {
      const layers = [];
      for (let p = n; p; p = p.parentElement) layers.unshift(rgba(getComputedStyle(p).backgroundColor));
      return layers.reduce((bg, layer) => blend(layer, bg), [255, 255, 255]);
    };
    const lum = rgb => rgb.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
      .reduce((v, s, i) => v + s * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const l = [lum(a), lum(b)].sort((a, b) => b - a); return (l[0] + .05) / (l[1] + .05); };
    const ink = n => {
      const color = rgba(getComputedStyle(n).color);
      for (let p = n; p; p = p.parentElement) color[3] *= Number(getComputedStyle(p).opacity);
      return color;
    };
    const nodes = [...root.querySelectorAll("button,input,label,p,summary")].filter(n => {
      const r = n.getBoundingClientRect(); return n.checkVisibility() && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
    });
    return nodes.map(n => {
      const r = n.getBoundingClientRect(), s = getComputedStyle(n), bg = background(n);
      const text = n.textContent.trim(), iconOnly = n.tagName === "BUTTON" && !text;
      const lineMap = new Map(), walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.data.length; i++) {
        const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
        const rect = range.getClientRects()[0];
        if (rect) lineMap.set(Math.round(rect.top), (lineMap.get(Math.round(rect.top)) ?? "") + t.data[i]);
      }
      const lines = [...lineMap.values()];
      const canvas = document.createElement("canvas").getContext("2d"); canvas.font = s.font;
      return {
        tag: n.tagName, text, name: n.getAttribute("aria-label") ?? text, rect: r.toJSON(), iconOnly,
        disabled: n.matches(":disabled"), role: n.getAttribute("role"), fontSize: parseFloat(s.fontSize),
        fg: ink(n), bg, contrast: contrast(blend(ink(n), bg), bg), opacity: s.opacity,
        textOverflow: s.textOverflow, clipped: n.tagName !== "INPUT" && n.scrollWidth > n.clientWidth + .5,
        lineClamp: s.webkitLineClamp, lines, orphan: lines.length > 1 && /^[가-힣]$/.test(lines.at(-1).trim()),
        labelWidth: Math.max(0, ...lines.map(line => canvas.measureText(line).width)),
        focus: n === document.activeElement, focusVisible: n.matches(":focus-visible"),
        outline: parseFloat(s.outlineWidth), outlineContrast: contrast(rgba(s.outlineColor).slice(0, 3), background(n.parentElement)),
        icons: [...n.querySelectorAll("svg")].map(i => contrast(blend(ink(i), bg), bg)),
        transition: s.transitionProperty, wordBreak: s.wordBreak, textWrap: s.textWrap,
        hits: [[r.x+r.width/2,r.y+r.height/2],[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4]]
          .map(([x,y]) => { const hit = document.elementFromPoint(x,y); return n === hit || n.contains(hit); }),
      };
    });
  });
  for (const row of rows) {
    report.rows.push({ ...context, kind: "computed", ...row });
    if (row.tag === "BUTTON" && row.role !== "switch") {
      check("a/target", row.rect.height >= 32 && (row.iconOnly ? row.rect.width >= 36 && row.rect.height >= 36 : row.rect.width + .5 >= row.labelWidth + 20), { ...context, row });
      if (!row.disabled) check("a/hits", row.hits.every(Boolean), { ...context, row });
      check("h/icons", row.icons.every(r => r >= 3), { ...context, row });
      if (row.focusVisible) check("h/focus", row.outline >= 2 && row.outlineContrast >= 3, { ...context, row });
    }
    if (["LABEL", "P"].includes(row.tag)) check("b/size", row.fontSize >= 14, { ...context, row });
    if (row.text || row.tag === "INPUT") check("c/contrast", row.contrast >= 4.5, { ...context, row });
    check("d/orphan", !row.orphan, { ...context, row });
    if (!row.iconOnly) check("i/clipping", !row.clipped && row.textOverflow !== "ellipsis", { ...context, row });
  }
  const buttons = rows.filter(r => r.tag === "BUTTON");
  for (let a = 0; a < buttons.length; a++) for (let b = a + 1; b < buttons.length; b++) {
    const x = buttons[a].rect, y = buttons[b].rect;
    const area = Math.max(0, Math.min(x.right,y.right)-Math.max(x.left,y.left)) * Math.max(0, Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
    check("j/control-overlap", area === 0, { ...context, area, names: [buttons[a].name, buttons[b].name] });
  }
}
const field = () => page.locator('input[id$="-custom-model"]');
const form = () => field().locator("xpath=../../..");
const models = () => page.getByRole("heading", { name: "Models", exact: true }).locator("xpath=ancestor::section[1]");
const providers = () => click("button", "Providers");
try {
  await page.reload();
  await win.evaluate(w => w.setContentSize(1280, 800)); await page.setViewportSize({ width:1280, height:800 });
  await page.getByText("컴퓨터 연결하기", { exact:true }).waitFor({ timeout:30000 });
  await click("button", "계속하기"); await click("button", "계속하기"); await click("button", "프로젝트 가져오지 않기");
  await click("button", "프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
  await fs.mkdir(`${iso.workspace}/baseline-project`);
  await page.getByText("로컬 폴더", { exact:true }).click();
  const folder = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
  await folder.fill(iso.workspace + "/"); await page.getByText("baseline-project", { exact:true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name:"프로젝트 변경", exact:true }).waitFor(); await page.keyboard.press("Escape");
  seed(iso); await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks", { exact:true }).waitFor();
  await click("button", "설정");
  for (const theme of ["light", "dark"]) {
    await click("button", "Appearance"); await page.getByText(theme === "dark" ? "Dark" : "Light", { exact:true }).click();
    await page.waitForFunction(d => document.documentElement.classList.contains("dark") === d, theme === "dark");
    await providers();
    for (const [width, height] of [[840,620],[1280,800],[1920,1080]]) {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w, size) => w.setContentSize(...size), [width,height]);
      await page.setViewportSize({ width,height });
      for (const scale of (side === "after" ? [100,150] : [100])) {
        const context = { theme, width, height, scale };
        await page.evaluate(s => { document.documentElement.style.fontSize = `${s}%`; }, scale);
        const prefix = `${width}x${height}/${theme}/${scale}`;
        const select = page.getByRole("button", { name:"Select Codex", exact:true });
        await select.scrollIntoViewIfNeeded(); await settle();
        await shot(`${prefix}-provider-list.png`);
        if (side === "after") {
          const summary = await select.locator("xpath=ancestor::div[@data-slot='settings-row'][1]").evaluate(n => {
            const text = n.querySelector(".break-keep"); const s = getComputedStyle(text);
            return { text:text.textContent, clamp:s.webkitLineClamp, overflow:s.textOverflow, clipped:text.scrollWidth > text.clientWidth };
          });
          check("i/status-summary", !summary.clipped && summary.overflow !== "ellipsis" && summary.clamp === "none", { ...context, summary });
          await select.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
          await measure(select.locator("xpath=ancestor::div[@data-slot='settings-row'][1]"), { ...context, state:"provider-focus" });
          const diagnostic = page.getByRole("button", { name:"원문 진단 및 복구 안내", exact:true });
          await diagnostic.scrollIntoViewIfNeeded(); await diagnostic.focus();
          await page.keyboard.press("Enter");
          check("e-g/diagnostic", await diagnostic.getAttribute("aria-expanded") === "true" &&
            await page.getByRole("button", { name:"Select Codex", exact:true }).getAttribute("aria-pressed") === "true", context);
          await measure(diagnostic.locator("xpath=.."), { ...context, state:"diagnostic" });
          await shot(`${prefix}-diagnostic.png`);
          await page.keyboard.press("Enter");
        }
        await click("button", "Add custom model"); await field().waitFor(); await settle();
        await field().focus();
        if (side === "after") {
          const geometry = await form().evaluate(root => {
            const input = root.querySelector("input"), owners = [];
            for (let p = input.parentElement; p; p = p.parentElement)
              if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) owners.push(p.getBoundingClientRect().toJSON());
            return { viewport: { width:innerWidth, height:innerHeight }, owners,
              rects:[...root.querySelectorAll("label,input,button")].map(n => n.getBoundingClientRect().toJSON()),
              horizontal:document.querySelector("main").scrollWidth > document.querySelector("main").clientWidth };
          });
          check("f/one-owner", geometry.owners.length === 1, { ...context, geometry });
          check("f/form-contained", geometry.rects.every(r => r.top >= geometry.owners[0].top && r.bottom <= geometry.owners[0].bottom && r.left >= 0 && r.right <= width), { ...context, geometry });
          check("f/no-page-overflow", !geometry.horizontal, { ...context, geometry });
          await measure(form(), { ...context, state:"focus" });
        }
        await shot(`${prefix}-new-form.png`);
        if (side === "after") {
          const add = form().getByRole("button", { name:"Add", exact:true });
          await add.hover(); await measure(form(), { ...context, state:"hover" });
          await shot(`${prefix}-hover.png`);
          const r = await add.boundingBox();
          await page.mouse.move(r.x+r.width/2,r.y+r.height/2); await page.mouse.down();
          await measure(form(), { ...context, state:"pressed" }); await shot(`${prefix}-pressed.png`);
          await page.mouse.up();
        }
        await field().fill("x".repeat(1000)); await click("button", "Add", form());
        if (side === "after") {
          await page.getByRole("alert").filter({ hasText:"characters or less" }).waitFor();
          await measure(form(), { ...context, state:"invalid" });
        }
        await shot(`${prefix}-invalid.png`);
        await field().fill("hig-model-18"); await click("button", "Add", form());
        const row = page.locator('[data-model-slug="hig-model-18"]');
        await row.waitFor(); await row.scrollIntoViewIfNeeded();
        await shot(`${prefix}-corrected.png`);
        {
          if (side === "after") {
          await measure(models(), { ...context, state:"saved" });
          }
          const edit = page.getByRole("button", { name:"Edit hig-model-18", exact:true });
          await edit.click(); const name = page.locator('input[id$="-custom-model-name"]');
          await name.waitFor();
          const editor = name.locator('xpath=ancestor::div[contains(@class,"rounded-md") and contains(@class,"p-3")][1]');
          await name.fill("Long display name ".repeat(12));
          await shot(`${prefix}-edited-form.png`);
          await editor.getByRole("button", { name:"Save", exact:true }).click();
          await page.getByRole("button", { name:"Edit hig-model-18", exact:true }).click();
          await name.waitFor(); await name.fill("discarded draft");
          const route = await page.evaluate(() => location.hash);
          await page.keyboard.press("Escape");
          if (side === "after") check("e-g/edit-cancel", await page.evaluate(() => location.hash) === route && await name.count() === 0, context);
        }
        await page.getByRole("button", { name:"Remove hig-model-18", exact:true }).click(); await row.waitFor({ state:"hidden" });
        await click("button", "Add custom model"); await field().fill("unsaved-".repeat(30));
        const route = await page.evaluate(() => location.hash);
        await page.keyboard.press("Tab");
        if (side === "after") await measure(form(), { ...context, state:"keyboard" });
        await shot(`${prefix}-keyboard.png`);
        await field().focus(); await page.keyboard.press("Escape");
        check("e-g/add-cancel", await field().count() === 0 && await page.evaluate(() => location.hash) === route, context);
        await page.getByRole("heading", { name:"Models", exact:true }).scrollIntoViewIfNeeded();
        await shot(`${prefix}-models-end.png`);
      }
    }
  }
  check("no-paid-or-execution", report.counters.model === 0 && report.counters.execution === 0 && report.counters.externalNetwork === 0, report.counters);
} catch (error) {
  report.error = String(error.stack ?? error); report.failures.push({ error:report.error });
  await shot("failure.png").catch(() => undefined);
} finally {
  await app.close(); report.cleanup = "app.close completed";
  await fs.writeFile(`${out}/qa-measure.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ side, rows:report.rows.length, screenshots:report.screenshots.length, failures:report.failures }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}
