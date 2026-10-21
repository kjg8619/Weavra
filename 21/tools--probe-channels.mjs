import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

const root = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees";
const qa = `${root}/hig-01/scripts/hig`;
const packet = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21";
const bundle = process.env.HIG_PROBE_APP ?? `${packet.replace(/pr-21$/, "pr-20")}/after/app/weavra-desktop.app`;
const out = process.env.HIG_PROBE_OUT ?? `${packet}/probe-parent`;
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { bounded } = await import(`${qa}/assert.mjs`);
const { _electron } = await import(`${root}/hig-01/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-probe21-"));
const isolation = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const path of [isolation.home, isolation.workspace, isolation.app, `${isolation.workspace}/baseline-project`])
  await fs.mkdir(path);
prepareCaptureProfile(isolation);
const report = {
  asarSha256: createHash("sha256").update(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)).digest("hex"),
  isolation, samples: [], cleanup: null,
};
const source = process.env.HIG_PROBE_REPO ?? `${root}/hig-21`;
report.head = (await Bun.$`GIT_MASTER=1 git -C ${source} rev-parse HEAD`.text()).trim();
const sourceDiff = await Bun.$`GIT_MASTER=1 git -C ${source} diff HEAD --`.text();
report.trackedDiffSha256 = createHash("sha256").update(sourceDiff).digest("hex");
report.diagnostic = sourceDiff.length > 0;
report.scriptSha256 = createHash("sha256").update(await fs.readFile(new URL(import.meta.url))).digest("hex");
report.measureScriptSha256 = createHash("sha256").update(await fs.readFile(new URL("./measure-toolbar.mjs", import.meta.url))).digest("hex");
const app = await _electron.launch({
  colorScheme: null,
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
const page = await app.firstWindow();
const win = await app.browserWindow(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
report.requests = [];
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  const decoded = JSON.parse(response.payloadData);
  for (const frame of Array.isArray(decoded) ? decoded : [decoded])
    if (frame._tag === "Request") report.requests.push({
      tag: frame.tag,
      cwd: frame.payload?.cwd,
    });
});
page.setDefaultTimeout(15000);
report.network = await installCaptureNetworkFixture(page);
report.blockedOutbound = 0;
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    report.blockedOutbound++;
    await route.abort();
  } else await route.fallback();
});
const click = (name) => page.getByRole("button", { name, exact: true }).click();
const settled = () => bounded(page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}), "Probe layout completion", 20000);
async function sample(label) {
  await settled();
  const observation = await page.evaluate(() => {
    const first = document.querySelector("pre");
    const ancestors = [];
    for (let node = first; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({
        tag: node.tagName, class: node.className, style: node.getAttribute("style"),
        visibility: style.visibility, opacity: style.opacity, display: style.display,
        contentVisibility: style.contentVisibility, transform: style.transform,
        rect: node.getBoundingClientRect().toJSON(), scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      });
    }
    let list = null;
    let bootstrap = null;
    for (let node = first; node && (!list || !bootstrap); node = node.parentElement) {
      const fiberKey = Object.keys(node).find(key => key.startsWith("__reactFiber"));
      for (let fiber = fiberKey ? node[fiberKey] : null; fiber; fiber = fiber.return) {
        const context = fiber.memoizedProps?.value;
        if (!bootstrap && context?.values instanceof Map && context.state?.props?.data) {
          const state = context.state;
          bootstrap = {
            readyToRender: context.values.get("readyToRender"),
            didContainersLayout: state.didContainersLayout,
            didFinishInitialScroll: state.didFinishInitialScroll,
            queuedInitialLayout: state.queuedInitialLayout,
            initialScroll: state.initialScroll,
            initialScrollSession: state.initialScrollSession,
            scrollingTo: state.scrollingTo,
            pendingScrollToEnd: Boolean(state.pendingScrollToEnd),
            knownSizes: [...state.sizesKnown],
          };
        }
        const ref = fiber.memoizedProps?.listRef?.current;
        if (list || typeof ref?.getState !== "function") continue;
        const state = ref.getState();
        const hooks = [];
        for (let hook = fiber.memoizedState; hook && hooks.length < 12; hook = hook.next) {
          const value = hook.memoizedState;
          hooks.push(typeof value === "string" || typeof value === "boolean" || value === null
            ? value
            : Array.isArray(value) && value[0]?.rowId
              ? value[0]
              : typeof value);
        }
        list = {
          scroll: state.scroll, scrollLength: state.scrollLength,
          contentLength: state.contentLength, isAtEnd: state.isAtEnd,
          rows: state.data.map(row => row.id), hooks,
        };
      }
    }
    return {
      route: location.hash, theme: document.documentElement.className,
      nodes: [...document.querySelectorAll("pre,table")].map(node => ({
        text: node.textContent, painted: node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        rect: node.getBoundingClientRect().toJSON(),
      })),
      ancestors, list, bootstrap,
    };
  });
  observation.native = await win.evaluate(window => ({
    minimum: window.getMinimumSize(), bounds: window.getBounds(), content: window.getContentBounds(),
  }));
  await fs.writeFile(`${out}/${label}.ax.json`, JSON.stringify(await cdp.send("Accessibility.getFullAXTree")));
  const renderer = await page.screenshot({ path: `${out}/${label}.png`, scale: "css" });
  const native = Buffer.from(await win.evaluate(async window =>
    (await window.webContents.capturePage()).toPNG().toString("base64")), "base64");
  await fs.writeFile(`${out}/${label}.electron.png`, native);
  observation.renderer = { file: `${label}.png`, width: renderer.readUInt32BE(16), height: renderer.readUInt32BE(20), sha256: createHash("sha256").update(renderer).digest("hex") };
  observation.electron = { file: `${label}.electron.png`, width: native.readUInt32BE(16), height: native.readUInt32BE(20), sha256: createHash("sha256").update(native).digest("hex") };
  observation.afterCapture = await page.evaluate(() => [...document.querySelectorAll("pre,table")].map(node => ({ text: node.textContent, painted: node.checkVisibility({ opacityProperty: true, visibilityProperty: true }), rect: node.getBoundingClientRect().toJSON() })));
  report.samples.push({ label, ...observation });
  console.log(`PROBE ${label} painted=${observation.nodes.map(node => node.painted).join(",")}`);
}
async function theme(mode) {
  const route = await page.evaluate(() => location.hash);
  await click("설정");
  await click("Appearance");
  await page.getByText(mode === "dark" ? "Dark" : "Light", { exact: true }).click();
  await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, mode === "dark");
  await page.evaluate(route => { location.hash = route; }, route);
  await page.locator("pre").first().waitFor({ state: "attached" });
}
try {
  await page.reload();
  await win.evaluate(window => window.setContentSize(1280, 800));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor({ timeout: 30000 });
  await click("계속하기"); await click("계속하기"); await click("프로젝트 가져오지 않기");
  await page.getByText("무엇을 함께 해볼까요?", { exact: true }).waitFor();
  await page.locator('[data-sidebar="sidebar"]').getByRole("button", { name: "프로젝트 추가", exact: true }).click();
  await page.getByText("로컬 폴더", { exact: true }).click();
  const folder = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
  await folder.fill(`${isolation.workspace}/`);
  await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  seed(isolation);
  await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks", { exact: true }).click();
  await page.locator("pre").first().waitFor();
  const notice = page.getByRole("button", { name: "Codex 공급자 오류 닫기", exact: true });
  if (await notice.isVisible()) await notice.click();
  await sample("initial");
  await page.locator("pre").first().evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
  await sample("anchored");
  if (process.env.HIG_MEASURE_TOOLBAR === "1") {
    const { runToolbarMeasurement } = await import("./measure-toolbar.mjs");
    await runToolbarMeasurement({ page, win, app, cdp, report, out, settled });
  } else for (const width of (process.env.HIG_PROBE_WIDTHS ?? "840,1280,1920,390").split(",").map(Number)) {
    if (width !== 390) await win.evaluate((window, width) => window.setContentSize(width, width === 840 ? 620 : 800), width);
    await page.setViewportSize({ width, height: width === 840 ? 620 : 844 });
    await sample(`resized-${width}`);
    await page.locator("pre").first().evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
    for (const [index, mode] of ["light", "dark", "light"].entries()) {
      if (width === 390) await page.setViewportSize({ width: 1280, height: 800 });
      await theme(mode);
      if (width === 390) await page.setViewportSize({ width: 390, height: 844 });
      await sample(`${width}-${mode}-${index + 1}`);
    }
  }
} catch (error) {
  report.error = String(error);
  report.stack = error.stack;
  throw error;
} finally {
  await cdp.detach();
  const child = app.process();
  await app.close();
  report.cleanup = { pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null };
  await fs.writeFile(`${out}/observations.json`, JSON.stringify(report, null, 2));
}

