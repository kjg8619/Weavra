import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const W = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-10";
const E = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra";
const O = `${E}/pr-10-fix1-measure`;
const P = `${E}/pr-10-fix1/pr-10`;
const Q = `${E}/qa-10-run/runner/scripts/hig`;
const { prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${Q}/seed.mjs`);
const { _electron } = await import(`${W}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const unsupported = process.argv.includes("--unsupported");
const mode = unsupported ? "unsupported" : "supported";
const bundle = `${P}/after/app/weavra-desktop.app`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const report = {
  mode, revision: execFileSync("git", ["-C", W, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  asarSha256: sha(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  scriptSha256: sha(await fs.readFile(import.meta.filename)), startedAt: new Date().toISOString(),
  syntheticInput: unsupported ? "Only the server weavraReadOnly capability is false; no product DOM or code substituted." : null,
  rows: [], failures: [], frames: [], events: [],
  counters: { model: 0, runtimeMutation: 0, externalNetwork: 0 },
};
await fs.mkdir(`${O}/${mode}`, { recursive: true });
const otherApps = () => execFileSync("ps", ["-ww", "-axo", "pid=,command="], { encoding: "utf8" })
  .split("\n").filter((s) => /^\s*\d+\s+\/Users\//.test(s) && s.includes("/.omo/evidence/") && s.includes("/weavra-desktop.app/Contents/"));
// Bounded exclusivity wait, then an immediate independent recheck before launch.
const deadline = Date.now() + 300000;
while (otherApps().length) {
  if (Date.now() >= deadline) throw Error(`Evidence app gate timed out: ${otherApps().join("\n")}`);
  await new Promise((r) => setTimeout(r, 1000));
}
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-fix10-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const d of [iso.home, iso.workspace, iso.app]) await fs.mkdir(d);
await fs.mkdir(`${iso.workspace}/baseline-project`);
prepareCaptureProfile(iso);
if (otherApps().length) throw Error(`Immediate evidence-app recheck failed: ${otherApps().join("\n")}`);
const app = await _electron.launch({
  executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
  args: [`--user-data-dir=${iso.home}/chromium`, "--disable-background-networking"],
  env: { PATH: process.env.PATH, HOME: iso.home, TMPDIR: base, LANG: "en_US.UTF-8", WEAVRA_HOME: `${iso.home}/.weavra`,
    WEAVRA_APP_HOME: iso.app, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", AWS_EC2_METADATA_DISABLED: "true" },
  timeout: 45000,
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const win = await app.browserWindow(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  const s = response.payloadData;
  report.events.push(s);
  if (/thread\.turn\.start/.test(s)) report.counters.model++;
  if (/workflow\.(prepare|confirm)|planner\.start|weavra\.control/.test(s)) report.counters.runtimeMutation++;
});
if (unsupported) {
  const routeWebSocket = page.routeWebSocket.bind(page);
  page.routeWebSocket = (pattern, handler) => routeWebSocket(pattern, (socket) => handler(new Proxy(socket, {
    get(t, k) {
      if (k === "connectToServer") return () => {
        const server = t.connectToServer();
        return new Proxy(server, {
          get(s, p) {
            if (p === "onMessage") return (callback) => s.onMessage((raw) => {
              const data = JSON.parse(String(raw));
              const change = (o) => { if (!o || typeof o !== "object") return; for (const [key, value] of Object.entries(o)) {
                if (key === "weavraReadOnly") o[key] = false; else change(value);
              } };
              change(data); callback(JSON.stringify(data));
            });
            const v = s[p]; return typeof v === "function" ? v.bind(s) : v;
          },
        });
      };
      const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
    },
  })));
}
await installCaptureNetworkFixture(page);
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (["http:", "https:"].includes(u.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    report.counters.externalNetwork++; await route.abort();
  } else await route.continue();
});
const settle = () => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const click = (name) => page.getByRole("button", { name, exact: true }).click();
const check = (name, pass, data) => { const row = { kind: "assert", name, pass, ...data }; report.rows.push(row); if (!pass) report.failures.push(row); };
const home = async () => {
  await page.evaluate(() => { location.hash = "/"; });
  await page.waitForFunction(() => location.hash.startsWith("#/draft/")); await settle();
};
async function graph() {
  const toggle = page.getByRole("button", { name: /^오른쪽 패널 열기\/닫기/ });
  if (await toggle.getAttribute("aria-pressed") !== "true") {
    await toggle.focus(); await page.keyboard.press("Enter");
  }
  const tab = page.locator("[data-active-tab]").getByRole("button", { name: "Run 그래프", exact: true });
  if (await tab.count()) await tab.click();
  else {
    const add = page.getByRole("button", { name: "패널 추가", exact: true });
    if (await add.isVisible()) { await add.click(); await page.getByRole("menuitem", { name: "Run 그래프 G", exact: true }).click(); }
    else await page.getByText("Run 그래프", { exact: true }).filter({ visible: true }).click();
  }
  await page.locator('[data-weavra="run-graph"]').waitFor(); await settle();
}
async function shot(name) {
  await settle();
  const file = `${O}/${mode}/${name}.png`;
  await page.screenshot({ path: file, scale: "css" });
  report.frames.push({ file, sha256: sha(await fs.readFile(file)) });
}
async function measure(locator, ctx) {
  await locator.scrollIntoViewIfNeeded(); await settle();
  const data = await locator.evaluate((el) => {
    const rgba = (color) => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = color; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
    const over = (a, b) => [...a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3])), 1];
    const luminance = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    const ancestors = []; for (let n = el; n; n = n.parentElement) ancestors.unshift(n);
    let bg = [255, 255, 255, 1]; const layers = [];
    for (const n of ancestors) { const s = getComputedStyle(n); bg = over(rgba(s.backgroundColor), bg); layers.push({ tag: n.tagName, color: s.backgroundColor }); }
    const contrast = (color) => { const a = luminance(over(rgba(color), bg)), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    const textRects = [...range.getClientRects()].filter((r) => r.width && r.height);
    const clipped = textRects.some((t) => t.left < r.left - .5 || t.right > r.right + .5 || t.top < r.top - .5 || t.bottom > r.bottom + .5);
    // Insets are inside the actual rounded hit region, including enlarged text.
    const inset = Math.min(r.width / 4, r.height / 4, Math.max(3, parseFloat(s.borderTopLeftRadius) / 2));
    const pts = [[r.x + r.width / 2, r.y + r.height / 2], [r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]];
    const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const external = [...document.querySelectorAll('[data-testid="composer-editor"],[data-slot="dialog-popup"],[aria-modal="true"],[data-message-id]')]
      .filter((n) => n.checkVisibility() && !n.contains(el) && !el.contains(n))
      .map((n) => ({ tag: n.tagName, rect: n.getBoundingClientRect().toJSON(), area: area(r, n.getBoundingClientRect()) }));
    const midWord = []; const lines = new Map(); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of n.textContent.matchAll(/[가-힣]+/g)) { const t = document.createRange(); t.setStart(n, m.index); t.setEnd(n, m.index + m[0].length); if (t.getClientRects().length > 1) midWord.push(m[0]); }
      for (let i = 0; i < n.textContent.length; i++) { const t = document.createRange(); t.setStart(n, i); t.setEnd(n, i + 1); const b = t.getBoundingClientRect(); if (b.width) lines.set(Math.round(b.top), (lines.get(Math.round(b.top)) || "") + n.textContent[i]); }
    }
    const lineText = [...lines.values()].map((s) => s.trim()).filter(Boolean);
    return { text: el.textContent.trim(), html: el.outerHTML, rect: r.toJSON(), fontSize: parseFloat(s.fontSize), foreground: s.color, background: bg, layers,
      contrast: contrast(s.color), borderContrast: contrast(s.borderTopColor), borderColor: s.borderTopColor,
      whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, wordBreak: s.wordBreak, textWrap: s.textWrap, clipped,
      midWord, isolatedFinal: lineText.length > 1 && /^[가-힣]$/.test(lineText.at(-1)), lines: lineText,
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + .5 && r.right <= innerWidth + .5,
      textWidth: Math.max(0, ...textRects.map((r) => r.width)), external,
      hitInset: inset, borderRadius: s.borderTopLeftRadius,
      hits: pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); return h === el || el.contains(h); }),
      hitElements: pts.map(([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 500)),
      focusVisible: el.matches(":focus-visible"), outline: { width: s.outlineWidth, color: s.outlineColor, contrast: contrast(s.outlineColor) }, shadow: s.boxShadow,
      disabled: el.matches(":disabled"), tabIndex: el.tabIndex };
  });
  report.rows.push({ kind: "measurement", ...ctx, ...data });
  return data;
}
async function control(locator, ctx, icon = false) {
  const d = await measure(locator, { ...ctx, state: "default", icon });
  check(icon ? "F2 icon >=36" : "text control geometry", icon ? d.rect.width >= 36 && d.rect.height >= 36 : d.rect.height >= 32 && d.rect.width >= d.textWidth + 20 - .5, { ...ctx, rect: d.rect, text: d.text });
  check("F5 zero external intersection", d.external.every((x) => x.area === 0), { ...ctx, external: d.external, text: d.text });
  check("control not clipped", d.inViewport && !d.clipped, { ...ctx, text: d.text });
  check("five point hit test", d.disabled || d.hits.every(Boolean), { ...ctx, text: d.text, hits: d.hits });
  if (!icon) check("F4 edge contrast", d.borderContrast >= 3, { ...ctx, ratio: d.borderContrast });
  if (!icon) check("text contrast", d.contrast >= 4.5 && d.fontSize >= 14, { ...ctx, ratio: d.contrast, fontSize: d.fontSize });
  await locator.hover(); await settle(); const hover = await measure(locator, { ...ctx, state: "hover", icon });
  if (!icon) check("F4 hover edge contrast", hover.borderContrast >= 3, { ...ctx, ratio: hover.borderContrast });
  await page.keyboard.press("Tab"); await locator.focus(); await settle();
  const focused = await measure(locator, { ...ctx, state: "focus", icon });
  if (icon) check("icon focus outline contrast", focused.outline.contrast >= 3 && parseFloat(focused.outline.width) >= 2, { ...ctx, outline: focused.outline });
  if (!icon) {
    await locator.hover();
    await page.mouse.down();
    const pressed = await measure(locator, { ...ctx, state: "pressed", icon });
    check("F4 pressed edge contrast", pressed.borderContrast >= 3, { ...ctx, ratio: pressed.borderContrast });
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
}
async function escape(help, ctx, round) {
  check("precondition help closed", await help.getAttribute("aria-expanded") === "false", { ...ctx, round });
  await help.focus(); await page.keyboard.press("Enter"); await settle();
  const open = await help.getAttribute("aria-expanded");
  const route = await page.evaluate(() => location.hash);
  await page.keyboard.press("Tab");
  const moved = await help.evaluate((e) => document.activeElement !== e);
  await page.keyboard.press("Escape"); await settle();
  const result = { open, closed: await help.getAttribute("aria-expanded"), focus: await help.evaluate((e) => document.activeElement === e), routeSame: await page.evaluate((r) => location.hash === r, route), moved };
  check("F1 Tab Escape closes and restores opener", open === "true" && result.closed === "false" && result.focus && result.routeSame && moved, { ...ctx, round, ...result });
}
async function text(locator, ctx) {
  for (let i = 0; i < await locator.count(); i++) {
    const e = locator.nth(i); if (!await e.isVisible()) continue;
    const d = await measure(e, ctx);
    check("F3 required text wraps", !d.clipped && d.textOverflow !== "ellipsis" && d.whiteSpace !== "nowrap", { ...ctx, text: d.text, clipped: d.clipped, whiteSpace: d.whiteSpace, textOverflow: d.textOverflow });
    check("text readability", d.fontSize >= 14 && d.contrast >= 4.5 && !d.midWord.length && !d.isolatedFinal, { ...ctx, text: d.text, fontSize: d.fontSize, contrast: d.contrast, midWord: d.midWord, isolatedFinal: d.isolatedFinal });
  }
}
try {
  await page.reload();
  try { await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor({ timeout: 30000 }); }
  catch (e) { const retry = page.getByRole("button", { name: "Try again", exact: true }); if (!await retry.isVisible()) throw e; report.rows.push({ kind: "startup-recovery", error: String(e) }); await retry.click(); await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor(); }
  await click("계속하기"); await click("계속하기"); await click("프로젝트 가져오지 않기");
  await page.locator('[data-sidebar="sidebar"]').getByRole("button", { name: "프로젝트 추가", exact: true }).click();
  await page.getByText("로컬 폴더", { exact: true }).click();
  const address = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await address.focus();
  await page.getByText("폴더", { exact: true }).waitFor();
  await settle();
  await address.fill(`${iso.workspace}/`);
  await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor(); await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await home(); await click("설정"); await click("Appearance");
    await page.getByText(theme === "light" ? "Light" : "Dark", { exact: true }).click();
    await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, theme === "dark");
    for (const [width, height] of [[840, 620], [1280, 800], [1920, 1080]]) {
      await win.evaluate((w, [x, y]) => w.setContentSize(x, y), [width, height]);
      await page.setViewportSize({ width, height });
      for (const scale of [100, 150]) {
        await page.evaluate((scale) => { document.documentElement.style.fontSize = scale === 150 ? "150%" : ""; }, scale);
        const ctx = { mode, theme, width, height, scale };
        report.rows.push({ kind: "dimensions", ...ctx, native: await win.evaluate((w) => ({ bounds: w.getBounds(), content: w.getContentBounds() })), renderer: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })) });
        await home(); await graph();
        const graphRoot = page.locator('[data-weavra="run-graph"]');
        if (unsupported) {
          const help = graphRoot.getByRole("button", { name: "이 환경에서 볼 수 없는 이유", exact: true });
          await escape(help, { ...ctx, surface: "unsupported" }, "first");
          await escape(help, { ...ctx, surface: "unsupported" }, "repeat");
          await help.click(); await settle();
          await text(graphRoot.locator("p"), { ...ctx, surface: "unsupported" });
          await control(help, { ...ctx, surface: "unsupported" });
          await shot(`${theme}-${width}-${scale}-unsupported`);
          await page.keyboard.press("Escape");
          continue;
        }
        await text(graphRoot.locator("p"), { ...ctx, surface: "graph" });
        const action = graphRoot.getByRole("button", { name: "프로젝트 설정 열기", exact: true });
        await control(action, { ...ctx, surface: "graph" });
        await shot(`${theme}-${width}-${scale}-graph`);
        await action.focus(); await page.keyboard.press("Enter");
        await page.locator("#weavra-controls").waitFor();
        const fit = page.locator("#weavra-fitness");
        const help = fit.getByRole("button", { name: "읽기 전용 안내", exact: true });
        await escape(help, { ...ctx, surface: "fitness" }, "first");
        await escape(help, { ...ctx, surface: "fitness" }, "repeat");
        await help.click(); await settle();
        await text(fit.locator("p"), { ...ctx, surface: "fitness" });
        for (const label of ["읽기 전용 안내", "기록 불러오기"]) await control(fit.getByRole("button", { name: label, exact: true }), { ...ctx, surface: "fitness", label });
        const gap = await fit.evaluate((root) => { const a = [...root.querySelectorAll("button")]; const x = a[0].getBoundingClientRect(), y = a[1].getBoundingClientRect(); return Math.max(y.top - x.bottom, x.top - y.bottom, y.left - x.right, x.left - y.right); });
        check("F2 distinct group gap >=8", gap >= 8, { ...ctx, surface: "fitness", gap });
        await shot(`${theme}-${width}-${scale}-fitness`);
        await page.keyboard.press("Escape");
        const load = fit.getByRole("button", { name: "기록 불러오기", exact: true });
        const receipt = page.waitForFunction(() => { const status = document.querySelector('#weavra-fitness [role="status"]'); return status && /과거 기록|적합성 기록을 불러올 수/.test(status.textContent); });
        await load.click(); await receipt;
        await page.evaluate(() => { location.hash = "/settings/diagnostics"; });
        await page.getByText("Resource monitor", { exact: false }).first().waitFor(); await settle();
        const labels = page.locator('main .group > div:first-child > span:last-child');
        await text(labels, { ...ctx, surface: "resource-labels" });
        const decorative = await page.locator("main .group > div:first-child > span[aria-hidden]").evaluateAll((nodes) => nodes.map((n) => ({ html: n.outerHTML, tabIndex: n.tabIndex, interactiveAncestor: !!n.closest("button,a[href],[tabindex]"), label: n.nextElementSibling?.textContent })));
        report.rows.push({ kind: "decorative-dom", ...ctx, decorative });
        const icons = page.locator('main button[aria-label$=" details"]');
        const rects = [];
        for (let i = 0; i < await icons.count(); i++) {
          const e = icons.nth(i); await control(e, { ...ctx, surface: "diagnostic-details", label: await e.getAttribute("aria-label") }, true);
          rects.push(await e.evaluate((e) => ({ label: e.getAttribute("aria-label"), rect: e.getBoundingClientRect().toJSON() })));
          await text(e.locator("xpath=preceding-sibling::span"), { ...ctx, surface: "diagnostic-labels" });
        }
        report.rows.push({ kind: "diagnostic-targets", ...ctx, rects });
        const groupGaps = await icons.evaluateAll((nodes) => {
          const rects = nodes.map((n) => n.getBoundingClientRect());
          const gaps = [];
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            gaps.push(Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom));
          }
          return { minimum: Math.min(...gaps), pairs: gaps.length };
        });
        check("F2 diagnostic group gap >=8", groupGaps.minimum >= 8, { ...ctx, ...groupGaps });
        const resource = page.getByText("Current CPU", { exact: true });
        await resource.scrollIntoViewIfNeeded(); await shot(`${theme}-${width}-${scale}-diagnostics-top`);
        const last = page.locator("main").locator("button").last();
        await last.scrollIntoViewIfNeeded(); await shot(`${theme}-${width}-${scale}-diagnostics-end`);
        console.log(`MATRIX ${theme} ${width} ${scale} rows=${report.rows.length} failures=${report.failures.length}`);
      }
    }
  }
} catch (error) {
  report.error = String(error.stack || error);
  await shot("error");
} finally {
  await cdp.detach();
  const child = app.process();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await app.close();
  if (child.exitCode === null && child.signalCode === null) await exited;
  report.cleanup = { exited: child.exitCode !== null || child.signalCode !== null };
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(`${O}/${mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, rows: report.rows.length, failures: report.failures.length, error: report.error, counters: report.counters, cleanup: report.cleanup }));
}
if (report.error || report.failures.length || Object.values(report.counters).some(Boolean)) process.exitCode = 1;
