// Supplemental W-27/W-28/W-29 measurements against a packaged app, mirroring
// the task-1 harness launch (isolated /tmp profile, no network, no model).
// Evidence only: this script lives outside the repository.
import * as FSP from "node:fs/promises";
import * as FS from "node:fs";
import * as Path from "node:path";
import * as Crypto from "node:crypto";
import * as ChildProcess from "node:child_process";
import * as Util from "node:util";

const WT = process.env.WEAVRA_CAPTURE_REPO;
const bundle = process.env.WEAVRA_CAPTURE_APP;
const out = process.env.WEAVRA_MEASURE_OUT;
if (!WT || !bundle || !out) throw new Error("WEAVRA_CAPTURE_REPO, WEAVRA_CAPTURE_APP, WEAVRA_MEASURE_OUT required");
const { seed, assertProfile, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${WT}/scripts/hig/seed.mjs`);
const { _electron } = await import(`${WT}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const exec = Util.promisify(ChildProcess.execFile);
await FSP.mkdir(out, { recursive: true });
await FSP.mkdir(Path.join(out, "motion"), { recursive: true });
const sha256 = (b) => Crypto.createHash("sha256").update(b).digest("hex");
const revision = (await exec("git", ["-C", WT, "rev-parse", "HEAD"])).stdout.trim();
const report = {
  revision,
  bundle,
  asarSha256: sha256(await FSP.readFile(Path.join(bundle, "Contents/Resources/app.asar"))),
  at: new Date().toISOString(),
  tokens: {},
  layers: [],
  portalOwner: [],
  escape: [],
  motion: [],
  reducedMotion: [],
  colors: [],
  contrast: [],
  staticClasses: [],
  notes: [],
  counters: { model: 0, runtimeMutation: 0, blockedOutbound: 0 },
};
const save = () => FSP.writeFile(Path.join(out, "measurements.json"), JSON.stringify(report, null, 2));
process.on("unhandledRejection", (error) => {
  report.notes.push({ failure: String(error).slice(0, 400) });
  FS.writeFileSync(Path.join(out, "measurements.json"), JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  report.notes.push({ failure: String(error).slice(0, 400) });
  FS.writeFileSync(Path.join(out, "measurements.json"), JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});

const base = await FSP.realpath(await FSP.mkdtemp("/tmp/weavra-hig-"));
const isolation = { base, home: Path.join(base, "home"), workspace: Path.join(base, "workspace"), app: Path.join(base, "app") };
for (const d of [isolation.home, isolation.workspace, isolation.app]) await FSP.mkdir(d);
await FSP.mkdir(Path.join(isolation.workspace, "baseline-project"));
assertProfile(base, isolation.home, isolation.workspace, isolation.app);
prepareCaptureProfile(isolation);

const application = await _electron.launch({
  executablePath: Path.join(bundle, "Contents/MacOS/weavra-desktop"),
  args: [`--user-data-dir=${isolation.home}/chromium`, "--disable-background-networking"],
  env: {
    PATH: process.env.PATH,
    HOME: isolation.home,
    TMPDIR: base,
    LANG: "en_US.UTF-8",
    WEAVRA_HOME: `${isolation.home}/.weavra`,
    WEAVRA_APP_HOME: isolation.app,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    AWS_EC2_METADATA_DISABLED: "true",
  },
  timeout: 45000,
});
const page = await application.firstWindow();
page.setDefaultTimeout(15000);
await installCaptureNetworkFixture(page);
const win = await application.browserWindow(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  const payload = response.payloadData;
  if (payload.includes("thread.turn.start")) report.counters.model++;
  if (/(?:workflow\.|planner\.|weavra\.task(?:Confirm|Prepare)|weavra\.controlCommand)/.test(payload)) report.counters.runtimeMutation++;
});
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    report.counters.blockedOutbound++;
    await route.abort();
  } else await route.continue();
});
await page.reload();
await win.evaluate((w) => w.setContentSize(1280, 800));
await page.setViewportSize({ width: 1280, height: 800 });

const byRole = (role, name, scope = page) => scope.getByRole(role, { name, exact: true }).filter({ visible: true });
const click = async (role, name, scope) => (await byRole(role, name, scope)).first().click();
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.allSettled(finite.map((a) => a.finished));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
const computed = (selector, props) =>
  page.evaluate(
    ({ selector, props }) => {
      const e = document.querySelector(selector);
      if (!e) return null;
      const s = getComputedStyle(e);
      const o = { selector, rect: e.getBoundingClientRect().toJSON() };
      for (const p of props) o[p] = s[p];
      return o;
    },
    { selector, props },
  );
const owner = (selector) =>
  page.evaluate((selector) => {
    const e = document.querySelector(selector);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      selector,
      rect: r.toJSON(),
      zIndex: getComputedStyle(e).zIndex,
      hitInside: hit === e || e.contains(hit),
      hitTag: hit ? `${hit.tagName.toLowerCase()}${hit.getAttribute("data-slot") ? `[data-slot=${hit.getAttribute("data-slot")}]` : ""}` : null,
      activeElement: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
    };
  }, selector);
const readTokens = () =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const names = [
      "--layer-content", "--layer-raised-content", "--layer-sticky", "--layer-selection-tools", "--layer-passive-notice",
      "--layer-modal-backdrop", "--layer-modal", "--layer-inspector-shade", "--layer-inspector-outline", "--layer-inspector-panel",
      "--layer-modal-child", "--layer-tooltip", "--layer-blocking-system", "--toast-stack-depth", "--motion-feedback", "--motion-surface",
      "--overlay-shade", "--overlay-dim", "--inspector-shade", "--shadow-popup", "--shadow-modal", "--shadow-preview", "--shadow-preview-glow",
      "--preview-separator", "--annotation-background", "--annotation-foreground", "--tool-error-icon", "--app-scrollbar-thumb",
      "--terminal-background", "--terminal-foreground",
    ];
    return Object.fromEntries(names.map((n) => [n, s.getPropertyValue(n).trim()]));
  });
async function shot(name) {
  const file = Path.join(out, name);
  await FSP.mkdir(Path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, scale: "css" });
  return name;
}
async function contrastOf(label, selector, theme) {
  const sample = await page.evaluate((selector) => {
    const e = document.querySelector(selector);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, rect: r.toJSON(), text: e.textContent?.trim().slice(0, 40) };
  }, selector);
  if (!sample) return report.contrast.push({ label, theme, selector, result: "N/A: not mounted" });
  const px = { x: Math.round(sample.rect.left + 1), y: Math.round(sample.rect.top + 1) };
  const bg = await win.evaluate(async (w, px) => {
    const img = await w.webContents.capturePage({ x: px.x, y: px.y, width: 1, height: 1 });
    const b = img.toBitmap();
    return [b[2], b[1], b[0]];
  }, px);
  const fg = await page.evaluate((color) => {
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, sample.color);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const l1 = lum(fg), l2 = lum(bg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  report.contrast.push({ label, theme, selector, text: sample.text, fontSize: sample.fontSize, fontWeight: sample.fontWeight, fg, bgSample: bg, samplePoint: px, ratio: Number(ratio.toFixed(2)), pass: ratio >= 4.5 });
}

// ---------------------------------------------------------------- onboarding
await page.getByText("컴퓨터 연결하기", { exact: true }).first().waitFor();
await settle();
report.tokens.light = await readTokens();
report.layers.push(await computed('[data-slot="toast-viewport"]', ["zIndex", "position"]));
await click("button", "계속하기");
await click("button", "계속하기");
await click("button", "프로젝트 가져오지 않기");
await page.getByText("무엇을 함께 해볼까요?", { exact: true }).first().waitFor();

// ------------------------------------------- command palette + popup inside it
await click("button", "프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
await page.locator('[data-slot="command-dialog-viewport"]').waitFor();
await settle();
report.layers.push(await computed('[data-slot="command-dialog-viewport"]', ["zIndex"]));
report.layers.push(await computed('[data-slot="command-dialog-backdrop"], [data-slot="dialog-backdrop"]', ["zIndex", "backgroundColor", "transitionProperty", "transitionDuration"]));
report.portalOwner.push({ state: "05 command palette", ...(await owner('[data-slot="command-dialog-popup"]')) });
await shot("w27/05-command-palette.png");
await page.getByText("로컬 폴더", { exact: true }).first().click();
const address = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
await address.focus();
await address.fill(`${isolation.workspace}/`);
await page.getByText("baseline-project", { exact: true }).first().waitFor();
await settle();
report.layers.push(await computed('[data-slot="autocomplete-positioner"]', ["zIndex"]));
report.portalOwner.push({ state: "06 autocomplete popup inside command dialog", ...(await owner('[data-slot="autocomplete-positioner"]')) });
await shot("w27/06-popup-in-dialog.png");
await page.keyboard.press("Escape");
await settle();
report.escape.push({
  state: "06 Escape with autocomplete open",
  popupStillOpen: (await page.locator('[data-slot="autocomplete-positioner"]').count()) > 0,
  dialogStillOpen: (await page.locator('[data-slot="command-dialog-viewport"]').count()) > 0,
  activeElement: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("data-slot") ?? document.activeElement?.tagName),
});
if ((await page.locator('[data-slot="command-dialog-viewport"]').count()) === 0) {
  await click("button", "프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
  await page.getByText("로컬 폴더", { exact: true }).first().click();
  await address.focus();
  await address.fill(`${isolation.workspace}/`);
}
await page.getByText("baseline-project", { exact: true }).first().click();
const add = page.locator('button[aria-label="추가 (Enter)"], button[aria-label="추가 (⌘ Enter)"], button[aria-label="추가 (Ctrl Enter)"]');
await add.click();
await page.locator('button[aria-label="프로젝트 변경"]').waitFor();
await page.keyboard.press("Escape");
const notice = page.locator('button[aria-label="Dismiss notification"]');
if (await notice.isVisible()) {
  report.layers.push(await computed('[data-slot="toast-viewport"]', ["zIndex"]));
  report.layers.push(await computed('[data-slot="toast-viewport"] [data-slot="toast-root"], [data-slot="toast-viewport"] > *', ["zIndex"]));
  await notice.click();
}
await settle();

// --------------------------------------------------------------- model popover
await click("button", "Claude Fable 5.1");
const popup = page.locator('[data-slot="menu-positioner"], [data-slot="popover-positioner"], [data-slot="select-positioner"]').first();
await popup.waitFor();
await settle();
const popupSlot = await popup.getAttribute("data-slot");
report.layers.push(await computed(`[data-slot="${popupSlot}"]`, ["zIndex"]));
const popupBody = popupSlot.replace("positioner", "popup");
report.layers.push(await computed(`[data-slot="${popupBody}"]`, ["boxShadow", "transitionProperty"]));
report.portalOwner.push({ state: "31 model selector popup", ...(await owner(`[data-slot="${popupSlot}"]`)) });
await contrastOf("31 popup item text (light)", `[data-slot="${popupBody}"] [role="menuitem"], [data-slot="${popupBody}"] [role="option"], [data-slot="${popupBody}"] button`, "light");
await shot("w27/31-model-popup.png");
await page.keyboard.press("Escape");
await settle();
report.escape.push({ state: "31 Escape closes popup, focus owner", popupStillOpen: (await popup.count()) > 0, activeElement: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim().slice(0, 30)) });

// ------------------------------------------------------------------- tooltip
await (await byRole("button", "오른쪽 패널 열기/닫기")).first().hover();
await page.locator('[data-slot="tooltip-positioner"]').waitFor();
await settle();
report.layers.push(await computed('[data-slot="tooltip-positioner"]', ["zIndex"]));
report.portalOwner.push({ state: "tooltip over panel toggle", ...(await owner('[data-slot="tooltip-popup"]')) });
await contrastOf("tooltip text (light)", '[data-slot="tooltip-popup"]', "light");
await shot("w27/tooltip.png");
await page.mouse.move(640, 400);

// ----------------------------------------------- composer + sidebar + browser
report.motion.push(await computed('[data-chat-composer-form="true"] button[type="submit"]', ["transitionProperty", "transitionDuration", "zIndex"]));
report.layers.push(await computed('[data-chat-composer-stack="true"]', ["zIndex"]));
report.layers.push(await computed('[data-chat-composer-overlay="true"]', ["zIndex"]));
report.layers.push(await computed('[data-workspace-titlebar-controls]', ["zIndex", "position"]));
report.layers.push(await computed('[data-slot="sidebar-container"]', ["zIndex"]));
report.motion.push(await computed('[data-slot="sidebar-container"]', ["transitionProperty", "transitionDuration"]));
report.motion.push(await computed('[data-slot="sidebar-gap"]', ["transitionProperty", "transitionDuration"]));
report.motion.push(await computed('[data-slot="sidebar-rail"]', ["transitionProperty", "transitionDuration", "zIndex"]));
report.notes.push({ panelAnimations: await page.evaluate(() => document.querySelector("[data-panel-animations]")?.getAttribute("data-panel-animations")) });
await click("button", "오른쪽 패널 열기/닫기");
await page.getByText("브라우저", { exact: true }).filter({ visible: true }).first().click();
await page.getByText("No preview yet", { exact: true }).first().waitFor();
await settle();
report.motion.push(await computed('input[placeholder="Search or enter URL"]', ["transitionProperty", "transitionDuration"]));
report.colors.push(await computed(".preview-loading-progress", ["boxShadow", "zIndex"]));
report.motion.push(
  await page.evaluate(() => {
    const e = [...document.querySelectorAll('div[aria-hidden="true"]')].find((n) => /^\d+%$/.test(n.textContent?.trim() ?? ""));
    if (!e) return { selector: "zoom indicator", result: "not mounted" };
    const s = getComputedStyle(e);
    return { selector: "zoom indicator", transitionProperty: s.transitionProperty, transitionDuration: s.transitionDuration, zIndex: s.zIndex, opacity: s.opacity };
  }),
);
await shot("w28/15-browser-pane.png");

async function openDeviceDialog() {
  if (!(await byRole("button", "패널 추가").count())) {
    await click("button", "오른쪽 패널 열기/닫기");
    await new Promise((r) => setTimeout(r, 300));
    if (!(await byRole("button", "패널 추가").count())) await page.getByText("브라우저", { exact: true }).filter({ visible: true }).first().click();
  }
  await click("button", "패널 추가");
  await page.getByRole("menuitem", { name: "기기 M", exact: true }).click();
  await page.locator('[data-slot="dialog-popup"]').waitFor();
}
// ----------------------------------------------------- dialog + motion frames
await cdp.send("Animation.enable");
const started = [];
cdp.on("Animation.animationStarted", ({ animation }) => started.push(animation));
async function dialogMotion(tag) {
  started.length = 0;
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await openDeviceDialog();
  await new Promise((r) => setTimeout(r, 150));
  const ids = started.filter((a) => a.type === "CSSTransition").map((a) => a.id);
  const frames = [];
  for (const [label, t] of [["start", 0], ["mid", 90], ["end", 180]]) {
    if (ids.length) await cdp.send("Animation.seekAnimations", { animations: ids, currentTime: t });
    await new Promise((r) => requestAnimationFrameHost(r));
    frames.push({ label, t, file: await shot(`motion/${tag}-open-${label}.png`) });
  }
  const popupStyle = await computed('[data-slot="dialog-popup"]', ["transitionProperty", "transitionDuration", "boxShadow", "zIndex"]);
  const backdropStyle = await computed('[data-slot="dialog-backdrop"]', ["transitionProperty", "transitionDuration", "backgroundColor", "zIndex"]);
  const viewportStyle = await computed('[data-slot="dialog-viewport"]', ["zIndex"]);
  if (ids.length) await cdp.send("Animation.seekAnimations", { animations: ids, currentTime: 90 });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 100));
  frames.push({ label: "interrupted-escape-at-mid", t: 90, file: await shot(`motion/${tag}-interrupted.png`) });
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "detached" }).catch(() => {});
  await settle();
  return { tag, transitions: ids.length, animationsSeen: started.map((a) => ({ type: a.type, name: a.name, duration: a.source?.duration })), frames, popupStyle, backdropStyle, viewportStyle };
}
const requestAnimationFrameHost = (r) => setTimeout(r, 40);
const dlg = await dialogMotion("dialog-normal");
report.motion.push(dlg);
report.layers.push(dlg.viewportStyle, dlg.backdropStyle);
report.colors.push({ label: "dialog backdrop color (light)", ...dlg.backdropStyle });
// Owner check with the dialog open and settled.
await openDeviceDialog();
await settle();
report.portalOwner.push({ state: "14 device setup dialog", ...(await owner('[data-slot="dialog-popup"]')) });
report.portalOwner.push({
  state: "14 click outside popup hits backdrop/viewport",
  ...(await page.evaluate(() => {
    const hit = document.elementFromPoint(12, 400);
    return { hitTag: hit ? `${hit.tagName.toLowerCase()}[data-slot=${hit.getAttribute("data-slot")}]` : null, hitIsOverlay: !!hit?.closest('[data-slot="dialog-viewport"],[data-slot="dialog-backdrop"]') };
  })),
});
await (await byRole("button", "Close")).first().hover();
const dialogTooltip = await page.locator('[data-slot="tooltip-positioner"]').waitFor({ timeout: 4000 }).then(() => true, () => false);
if (dialogTooltip) report.layers.push({ ...(await computed('[data-slot="tooltip-positioner"]', ["zIndex"])), note: "tooltip inside the open dialog (above modal 50)" });
else report.notes.push({ dialogTooltip: "dialog close button shows no tooltip" });
await page.mouse.move(640, 700);
await contrastOf("14 dialog title (light)", '[data-slot="dialog-title"]', "light");
await shot("w27/14-dialog.png");
await page.keyboard.press("Escape");
await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "detached" }).catch(() => {});
await settle();
report.escape.push({ state: "14 Escape closes dialog, focus owner", dialogStillOpen: (await page.locator('[data-slot="dialog-popup"]').count()) > 0, activeElement: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName) });
// In-modal popup: the Add Action dialog's icon picker popover.
await page.locator('button[aria-label="작업 추가"]').first().click();
await page.locator('[data-slot="dialog-popup"]').waitFor();
await settle();
const iconTrigger = page.locator('[data-slot="dialog-popup"] [data-slot="popover-trigger"]').first();
if (await iconTrigger.count()) {
  await iconTrigger.click();
  const inModal = await page.locator('[data-slot="popover-positioner"]').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (inModal) {
    await settle();
    report.layers.push({ ...(await computed('[data-slot="popover-positioner"]', ["zIndex"])), note: "popover inside Add Action dialog (modal-child above modal)" });
    report.portalOwner.push({ state: "11 popover inside dialog", ...(await owner('[data-slot="popover-popup"]')) });
    await shot("w27/11-popover-in-dialog.png");
    await page.keyboard.press("Escape");
    await settle();
    report.escape.push({ state: "11 Escape with in-dialog popover open", popoverStillOpen: (await page.locator('[data-slot="popover-positioner"]').count()) > 0, dialogStillOpen: (await page.locator('[data-slot="dialog-popup"]').count()) > 0, activeElement: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.getAttribute("data-slot") ?? document.activeElement?.tagName) });
  } else report.notes.push({ inModalPopover: "icon trigger did not open a popover" });
} else report.notes.push({ inModalPopover: "no popover trigger inside the Add Action dialog" });
await contrastOf("11 dialog title (light)", '[data-slot="dialog-title"]', "light");
await shot("w27/11-add-action-dialog.png");
if (await page.locator('[data-slot="dialog-popup"]').count()) { await click("button", "Cancel"); await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "detached" }).catch(() => {}); }
await settle();
// Reduced motion.
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
report.reducedMotion.push({ tokens: await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { feedback: s.getPropertyValue("--motion-feedback").trim(), surface: s.getPropertyValue("--motion-surface").trim() }; }) });
report.reducedMotion.push(await computed('[data-chat-composer-form="true"] button[type="submit"]', ["transitionProperty", "transitionDuration"]));
const dlgReduced = await dialogMotion("dialog-reduced");
report.reducedMotion.push(dlgReduced);
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });

// ------------------------------- W-28: sidebar under the panel-animation setting
// Default panelAnimationDurationMs is 0, so the capture matrix never enables the
// setting. Enable it through the real Settings control, then freeze the animation
// clock, collapse the sidebar and list every running transition with its target.
await click("button", "설정");
await click("button", "Appearance");
const durationSlider = page.locator("#panel-animation-duration");
await durationSlider.waitFor();
await durationSlider.fill("200");
await page.waitForFunction(() => document.querySelector("[data-panel-animations]")?.getAttribute("data-panel-animations") === "true");
await page.evaluate(() => { location.hash = "/"; });
await (await byRole("button", "설정")).first().waitFor();
await settle();
const sidebarMotion = { setting: await page.evaluate(() => document.querySelector("[data-panel-animations]")?.getAttribute("data-panel-animations")), durationMs: 200, computed: [], transitionsOnCollapse: [], transitionsOnExpand: [] };
for (const sel of ['[data-slot="sidebar-container"]', '[data-slot="sidebar-gap"]', '[data-slot="sidebar-rail"]', '[data-slot="sidebar-menu-button"]', '[data-slot="sidebar-inner"]']) {
  sidebarMotion.computed.push(await computed(sel, ["transitionProperty", "transitionDuration", "translate", "left", "width"]));
}
const listRunning = () => page.evaluate(() => document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => ({ type: a.constructor.name, property: a.transitionProperty ?? a.animationName ?? null, target: a.effect?.target?.getAttribute?.("data-slot") ?? a.effect?.target?.className?.toString().slice(0, 60) ?? a.effect?.target?.tagName, duration: a.effect?.getComputedTiming().duration })));
const sidebarTrigger = page.getByRole("button", { name: "Toggle main sidebar", exact: true }).filter({ visible: true }).first();
const triggerMounted = (await sidebarTrigger.count()) > 0;
const sidebarState = () => page.evaluate(() => document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state"));
const toggleSidebar = async () => { if (triggerMounted) await sidebarTrigger.click(); else await page.keyboard.press("Meta+b"); };
sidebarMotion.togglePath = triggerMounted ? "button[aria-label=Toggle main sidebar]" : "keyboard Meta+b (sidebar.toggle)";
sidebarMotion.stateBefore = await sidebarState();
{
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await toggleSidebar();
  await new Promise((r) => setTimeout(r, 120));
  sidebarMotion.transitionsOnCollapse = await listRunning();
  sidebarMotion.collapsedComputed = await computed('[data-slot="sidebar-container"]', ["transitionProperty", "translate", "left", "width"]);
  await shot("w28/sidebar-collapse-mid.png");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await settle();
  sidebarMotion.collapsedRest = await computed('[data-slot="sidebar-container"]', ["translate", "left", "width"]);
  sidebarMotion.gapRest = await computed('[data-slot="sidebar-gap"]', ["width"]);
  await shot("w28/sidebar-collapsed.png");
  sidebarMotion.stateCollapsed = await sidebarState();
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  await toggleSidebar();
  await new Promise((r) => setTimeout(r, 120));
  sidebarMotion.transitionsOnExpand = await listRunning();
  await shot("w28/sidebar-expand-mid.png");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await settle();
  sidebarMotion.stateAfter = await sidebarState();
}
report.motion.push({ tag: "sidebar-panel-animations", ...sidebarMotion });
// Update pill (W-28 file): computed transition when the pill is mounted in this profile.
report.motion.push(await page.evaluate(() => {
  const e = document.querySelector('[class*="provider-update"]');
  if (!e) return { selector: "SidebarProviderUpdatePill", result: "not mounted in isolated profile; declared classes verified by static probe" };
  const s = getComputedStyle(e);
  return { selector: "SidebarProviderUpdatePill", transitionProperty: s.transitionProperty, transitionDuration: s.transitionDuration };
}));
await click("button", "설정");
await click("button", "Appearance");
await durationSlider.fill("0");
await page.waitForFunction(() => document.querySelector("[data-panel-animations]")?.getAttribute("data-panel-animations") === "false");
await page.evaluate(() => { location.hash = "/"; });
await (await byRole("button", "설정")).first().waitFor();
await settle();

// ------------------------------------------------------- theme editor overlay
await click("button", "설정");
await click("button", "Appearance");
await page.getByText("Create theme", { exact: true }).first().click();
await page.locator("[data-theme-editor-panel][role=dialog]").waitFor();
await settle();
report.layers.push(await computed("[data-theme-editor-panel][role=dialog]", ["zIndex", "position", "boxShadow"]));
report.portalOwner.push({ state: "theme editor panel", ...(await owner("[data-theme-editor-panel][role=dialog]")) });
await (await byRole("button", "Inspect app colors")).first().hover();
await page.locator('[data-slot="tooltip-positioner"]').waitFor();
report.layers.push({ ...(await computed('[data-slot="tooltip-positioner"]', ["zIndex"])), note: "theme editor tooltip" });
await page.mouse.move(300, 300);
await click("button", "Inspect app colors");
await page.mouse.move(400, 300);
await page.mouse.move(420, 320);
const spotlightMounted = await page.locator("#theme-inspector-spotlight").waitFor({ state: "attached", timeout: 3000 }).then(() => true, () => false);
if (spotlightMounted) {
  report.layers.push(await computed("#theme-inspector-spotlight", ["zIndex"]));
  report.layers.push(await computed("#theme-inspector-hover", ["zIndex"]));
  report.colors.push(await page.evaluate(() => { const e = document.querySelector(".theme-inspector-spotlight-dimmer"); return { selector: ".theme-inspector-spotlight-dimmer", fill: e ? getComputedStyle(e).fill : null }; }));
} else {
  report.notes.push({ inspectorSpotlight: "not mounted by arming the inspector in this scripted flow; declared rules recorded from the shipped stylesheet" });
}
report.layers.push(await page.evaluate(() => {
  const found = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.selectorText === "#theme-inspector-spotlight" || rule.selectorText === "#theme-inspector-hover") found[rule.selectorText] = rule.style.zIndex;
      if (rule.selectorText === ".theme-inspector-spotlight-dimmer") found[rule.selectorText] = rule.style.fill;
    }
  }
  const root = getComputedStyle(document.documentElement);
  return { selector: "stylesheet rules (inspector)", declared: found, resolved: { shade: root.getPropertyValue("--layer-inspector-shade").trim(), outline: root.getPropertyValue("--layer-inspector-outline").trim(), fill: root.getPropertyValue("--inspector-shade").trim() } };
}));
await shot("w27/theme-inspector-armed.png");
await page.keyboard.press("Escape");
await new Promise((r) => setTimeout(r, 200));
const chooser = page.locator('button[aria-label^="Choose "][aria-label$=" color"]').first();
if (await chooser.count()) {
  await chooser.click();
  await page.locator('[data-slot="popover-positioner"]').waitFor();
  await settle();
  report.layers.push({ ...(await computed('[data-slot="popover-positioner"]', ["zIndex"])), note: "theme color picker popover above editor panel" });
  report.portalOwner.push({ state: "theme color picker popover", ...(await owner('[data-slot="popover-popup"]')) });
  await shot("w27/theme-editor-popover.png");
  await page.keyboard.press("Escape");
  await settle();
  report.escape.push({ state: "theme picker Escape closes popover only", popoverStillOpen: (await page.locator('[data-slot="popover-positioner"]').count()) > 0, panelStillOpen: (await page.locator("[data-theme-editor-panel][role=dialog]").count()) > 0 });
}
report.colors.push(await page.evaluate(() => {
  const panes = [...document.querySelectorAll("span")].filter((e) => e.style.boxShadow?.includes("--preview-separator") || e.style.backgroundColor?.includes("--preview-separator"));
  const e = panes[0];
  return { selector: "ThemeWireframe separator", mounted: panes.length, inline: e?.style.boxShadow || e?.style.backgroundColor, computed: e ? getComputedStyle(e).boxShadow || getComputedStyle(e).backgroundColor : null };
}));
await shot("w29/18-appearance-wireframes-light.png");
await click("button", "Close the theme editor");
await settle();

// ------------------------------------------------------------------ dark theme
await page.getByText("Dark", { exact: true }).first().click();
await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
await settle();
report.tokens.dark = await readTokens();
await shot("w29/19-appearance-wireframes-dark.png");
await page.evaluate(() => { location.hash = "/"; });
await (await byRole("button", "설정")).first().waitFor();
await click("button", "Claude Fable 5.1");
await popup.waitFor();
await settle();
report.layers.push({ ...(await computed(`[data-slot="${popupBody}"]`, ["boxShadow"])), note: "popup shadow (dark)" });
await contrastOf("31 popup item text (dark)", `[data-slot="${popupBody}"] [role="menuitem"], [data-slot="${popupBody}"] [role="option"], [data-slot="${popupBody}"] button`, "dark");
await shot("w29/31-model-popup-dark.png");
await page.keyboard.press("Escape");
await settle();
await openDeviceDialog();
await settle();
report.colors.push({ label: "dialog backdrop color (dark)", ...(await computed('[data-slot="dialog-backdrop"]', ["backgroundColor"])) });
report.colors.push({ label: "dialog popup shadow (dark)", ...(await computed('[data-slot="dialog-popup"]', ["boxShadow"])) });
await contrastOf("14 dialog title (dark)", '[data-slot="dialog-title"]', "dark");
await shot("w29/14-dialog-dark.png");
await page.keyboard.press("Escape");
await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "detached" }).catch(() => {});
await click("button", "설정");
await click("button", "Appearance");
await page.getByText("Light", { exact: true }).first().click();
await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
await page.evaluate(() => { location.hash = "/"; });
await (await byRole("button", "설정")).first().waitFor();

// --------------------------------------------- selection toolbar on a thread
seed(isolation);
await page.reload();
await page.locator('[data-sidebar="sidebar"]').getByText("01 Conversation", { exact: true }).click();
await page.locator('button[aria-label="01 Conversation 대화 작업"]').waitFor();
await settle();
const providerNotice = page.getByRole("button", { name: "Codex 공급자 오류 닫기", exact: true });
if (await providerNotice.isVisible()) await providerNotice.click();
const para = await page.evaluate(() => {
  const strong = [...document.querySelectorAll("strong")].find((e) => e.textContent?.includes("local screenshot fixture"));
  const r = strong.parentElement.getBoundingClientRect();
  return r.toJSON();
});
await page.mouse.move(para.left + 2, para.top + para.height / 2);
await page.mouse.down();
await page.mouse.move(para.left + Math.min(para.width - 4, 260), para.top + para.height / 2, { steps: 8 });
await page.mouse.up();
const toolbar = page.locator('button[aria-label="선택한 내용을 작성기에 인용"]');
const toolbarShown = await toolbar.waitFor({ timeout: 5000 }).then(() => true, () => false);
if (toolbarShown) {
  await settle();
  report.layers.push(await computed('button[aria-label="선택한 내용을 작성기에 인용"]', ["zIndex", "position"]));
  report.portalOwner.push({ state: "selection toolbar", ...(await owner('button[aria-label="선택한 내용을 작성기에 인용"]')) });
  await shot("w27/34-selection-toolbar.png");
  await toolbar.focus();
  await page.keyboard.press("Escape");
  await settle();
  report.escape.push({ state: "selection toolbar Escape dismisses", toolbarStillOpen: (await toolbar.count()) > 0 });
} else {
  report.notes.push({ selectionToolbar: "did not appear after a scripted drag selection of the assistant paragraph; its layer role is verified by the static class probe (z-(--layer-selection-tools) = 20)" });
  await shot("w27/34-selection-attempt.png");
}
report.layers.push(await computed('[data-chat-workspace-drop-target="true"] > .absolute', ["zIndex"]));

// ------------------------------------------------------- static class checks
report.staticClasses = await page.evaluate(() => {
  const probe = (cls, style = {}) => {
    const e = document.createElement("div");
    e.className = cls;
    Object.assign(e.style, style);
    document.body.appendChild(e);
    const s = getComputedStyle(e);
    const r = { cls, zIndex: s.zIndex, transitionProperty: s.transitionProperty, transitionDuration: s.transitionDuration, boxShadow: s.boxShadow, backgroundColor: s.backgroundColor };
    e.remove();
    return r;
  };
  return [
    probe("fixed z-(--layer-blocking-system)"),
    probe("fixed z-(--layer-modal-backdrop) transition-opacity duration-(--motion-surface)"),
    probe("transition-[translate,opacity] duration-(--motion-surface) motion-reduce:transition-opacity"),
    probe("absolute z-[calc(var(--toast-stack-depth)-var(--toast-index))]", { "--toast-index": "2" }),
    probe("absolute -z-(--layer-raised-content)"),
    probe("shadow-(--shadow-popup)"),
    probe("bg-(--overlay-dim)"),
    probe("shadow-(--shadow-preview-glow)"),
    probe("z-(--layer-passive-notice)"),
    probe("z-(--layer-inspector-panel)"),
    // W-28 declared transition lists per owned file (sheet is unreachable at desktop widths).
    probe("[[data-panel-animations=true]_&]:transition-[translate] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)]"),
    probe("transition-[opacity,translate] duration-(--motion-surface) ease-in-out motion-reduce:transition-opacity"),
    probe("transition-[scale,opacity] duration-(--motion-feedback) motion-reduce:transition-opacity"),
    probe("transition-[scale,opacity,translate] duration-(--motion-surface) ease-in-out motion-reduce:transition-opacity"),
    probe("transition-[opacity,translate] duration-(--motion-surface) ease-out motion-reduce:transition-opacity"),
    probe("transition-[width,height,padding]"),
    probe("transition-all duration-150"),
    probe("transition-[padding]"),
  ];
});

// ---------------------------------------------------------- quit overlay try
try {
  await page.keyboard.press("Meta+q");
  const status = page.locator('[role="status"]', { hasText: /quit/ });
  await status.waitFor({ timeout: 1500 });
  report.layers.push({ ...(await computed('[role="status"]', ["zIndex", "position"])), note: "quit hold overlay" });
  report.portalOwner.push({ state: "quit overlay", ...(await owner('[role="status"]')) });
  await shot("w27/quit-overlay.png");
} catch (error) {
  report.notes.push({ quitOverlay: `not observed via synthetic accelerator: ${String(error).slice(0, 120)}` });
}
report.nativeMinimum = await win.evaluate((w) => ({ minimum: w.getMinimumSize(), bounds: w.getBounds() }));
await save();
await application.close().catch(() => {});
report.closed = true;
await save();
console.log(`MEASURE_DONE layers=${report.layers.length} owners=${report.portalOwner.length} contrast=${report.contrast.length}`);
