// Motion frames for the shared dialog surface (Add Action dialog, right panel
// closed so the background is the empty composer only). Same isolated launch
// as the task-1 harness; normal and reduced motion; start/mid/end/interrupted.
import * as FSP from "node:fs/promises";
import * as Path from "node:path";
import * as Crypto from "node:crypto";

const WT = process.env.WEAVRA_CAPTURE_REPO;
const bundle = process.env.WEAVRA_CAPTURE_APP;
const out = process.env.WEAVRA_MEASURE_OUT;
if (!WT || !bundle || !out) throw new Error("WEAVRA_CAPTURE_REPO, WEAVRA_CAPTURE_APP, WEAVRA_MEASURE_OUT required");
const { assertProfile } = await import(`${WT}/scripts/hig/seed.mjs`);
const { _electron } = await import(`${WT}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
await FSP.mkdir(out, { recursive: true });
const sha256 = (b) => Crypto.createHash("sha256").update(b).digest("hex");
const report = { bundle, asarSha256: sha256(await FSP.readFile(Path.join(bundle, "Contents/Resources/app.asar"))), at: new Date().toISOString(), runs: [] };

const base = await FSP.realpath(await FSP.mkdtemp("/tmp/weavra-hig-"));
const isolation = { base, home: Path.join(base, "home"), workspace: Path.join(base, "workspace"), app: Path.join(base, "app") };
for (const d of [isolation.home, isolation.workspace, isolation.app]) await FSP.mkdir(d);
await FSP.mkdir(Path.join(isolation.workspace, "baseline-project"));
assertProfile(base, isolation.home, isolation.workspace, isolation.app);
const application = await _electron.launch({
  executablePath: Path.join(bundle, "Contents/MacOS/weavra-desktop"),
  args: [`--user-data-dir=${isolation.home}/chromium`, "--disable-background-networking"],
  env: { PATH: process.env.PATH, HOME: isolation.home, TMPDIR: base, LANG: "en_US.UTF-8", WEAVRA_HOME: `${isolation.home}/.weavra`, WEAVRA_APP_HOME: isolation.app, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", AWS_EC2_METADATA_DISABLED: "true" },
  timeout: 45000,
});
const page = await application.firstWindow();
page.setDefaultTimeout(15000);
const win = await application.browserWindow(page);
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) await route.abort();
  else await route.continue();
});
await win.evaluate((w) => w.setContentSize(1280, 800));
await page.setViewportSize({ width: 1280, height: 800 });
const click = (name, scope = page) => scope.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click();
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
const computed = (selector, props) => page.evaluate(({ selector, props }) => { const e = document.querySelector(selector); if (!e) return null; const s = getComputedStyle(e); const o = { selector }; for (const p of props) o[p] = s[p]; return o; }, { selector, props });

await page.getByText("컴퓨터 연결하기", { exact: true }).first().waitFor();
await settle();
await click("계속하기");
await click("계속하기");
await click("프로젝트 가져오지 않기");
await click("프로젝트 추가", page.locator('[data-sidebar="sidebar"]'));
await page.getByText("로컬 폴더", { exact: true }).first().click();
const address = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
await address.focus();
await address.fill(`${isolation.workspace}/`);
await page.getByText("baseline-project", { exact: true }).first().click();
await page.locator('button[aria-label="추가 (Enter)"], button[aria-label="추가 (⌘ Enter)"], button[aria-label="추가 (Ctrl Enter)"]').click();
await page.locator('button[aria-label="프로젝트 변경"]').waitFor();
await page.keyboard.press("Escape");
const notice = page.locator('button[aria-label="Dismiss notification"]');
if (await notice.isVisible()) await notice.click();
await settle();

const cdp = await page.context().newCDPSession(page);
await cdp.send("Animation.enable");
const started = [];
cdp.on("Animation.animationStarted", ({ animation }) => started.push(animation));
const rendered = () => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function record(tag) {
  started.length = 0;
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0 });
  const animationReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cdp.off("Animation.animationStarted", listener);
      reject(new Error("Dialog animation did not start"));
    }, 15000);
    const listener = ({ animation }) => {
      if (animation.type !== "CSSTransition" || animation.name !== "opacity") return;
      clearTimeout(timeout);
      cdp.off("Animation.animationStarted", listener);
      resolve();
    };
    cdp.on("Animation.animationStarted", listener);
  });
  await page.locator('button[aria-label="작업 추가"]').first().click();
  await page.locator('[data-slot="dialog-popup"]').waitFor();
  await animationReady;
  await rendered();
  const ids = started.filter((a) => a.type === "CSSTransition").map((a) => a.id);
  const frames = [];
  for (const [label, t] of [["start", 0], ["mid", 90], ["end", 180]]) {
    if (ids.length) await cdp.send("Animation.seekAnimations", { animations: ids, currentTime: t });
    await rendered();
    const file = `${tag}-open-${label}.png`;
    await page.screenshot({ path: Path.join(out, file), scale: "css" });
    frames.push({ label, t, file });
  }
  const popup = await computed('[data-slot="dialog-popup"]', ["transitionProperty", "transitionDuration", "boxShadow"]);
  const backdrop = await computed('[data-slot="dialog-backdrop"]', ["transitionProperty", "transitionDuration", "backgroundColor", "zIndex"]);
  if (ids.length) await cdp.send("Animation.seekAnimations", { animations: ids, currentTime: 90 });
  await page.keyboard.press("Escape");
  await rendered();
  const file = `${tag}-interrupted.png`;
  await page.screenshot({ path: Path.join(out, file), scale: "css" });
  frames.push({ label: "interrupted-escape-at-mid", t: 90, file });
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "detached" }).catch(() => {});
  await settle();
  report.runs.push({ tag, transitions: ids.length, animations: started.map((a) => ({ type: a.type, name: a.name, duration: a.source?.duration })), popup, backdrop, frames });
}
await record("dialog-normal");
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
report.reducedTokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { feedback: s.getPropertyValue("--motion-feedback").trim(), surface: s.getPropertyValue("--motion-surface").trim() }; });
await record("dialog-reduced");
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
await FSP.writeFile(Path.join(out, "motion.json"), JSON.stringify(report, null, 2));
await application.close().catch(() => {});
console.log(`MOTION_DONE runs=${report.runs.length}`);
