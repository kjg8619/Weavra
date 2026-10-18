import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { DESKTOP_STATES, STRESS_STATES, LABELS, CASES, SIZES, chooseAlias } from "./cases.mjs";
import { seed, assertProfile, FIXTURE_VERSION } from "./seed.mjs";
import { bounded, sha256, validateProvenance } from "./assert.mjs";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repo = await NodeFSP.realpath(
  process.env.WEAVRA_CAPTURE_REPO ?? NodePath.resolve(here, "../.."),
);
const bundle = process.env.WEAVRA_CAPTURE_APP;
const output = process.env.WEAVRA_CAPTURE_OUT;
const { values } = NodeUtil.parseArgs({
  options: {
    revision: { type: "string" },
    matrix: { type: "string", default: "ledger-plus" },
    case: { type: "string", default: "01" },
  },
});
NodeAssert.ok(bundle && output && values.revision, "Explicit app, output and revision required");
NodeAssert.equal(values.matrix, "ledger-plus");
NodeAssert.ok(CASES[values.case], "Unknown task case");
await NodeFSP.mkdir(output); // Never merge a fresh run into stale evidence.
const git = async (...args) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
const revision = await git("rev-parse", "HEAD");
NodeAssert.equal(revision, values.revision, "Wrong source revision");
const trackedDiff = await git("diff", "HEAD", "--");
NodeAssert.equal(trackedDiff, "", "Commit source edits before capturing");
const { _electron } = await import(
  `${repo}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`
);
const provenance = {
  revision,
  trackedDiff,
  trackedDiffSha256: sha256(trackedDiff),
  asarSha256: sha256(await NodeFSP.readFile(NodePath.join(bundle, "Contents/Resources/app.asar"))),
  captureSha256: sha256(await NodeFSP.readFile(NodeURL.fileURLToPath(import.meta.url))),
  fixtureSha256: sha256(await NodeFSP.readFile(NodePath.join(here, "seed.mjs"))),
  registrySha256: sha256(await NodeFSP.readFile(NodePath.join(here, "cases.mjs"))),
  fixtureVersion: FIXTURE_VERSION,
  os: `${NodeOS.type()} ${NodeOS.release()} ${NodeOS.machine()}`,
  at: new Date().toISOString(),
  bundle: await NodeFSP.realpath(bundle),
};
const packet = {
  revision,
  provenance,
  manifest: [],
  runs: [],
  baselineFindings: [
    {
      id: "G-07",
      original: "47/48 can duplicate; 46 can omit prepare",
      disposition: "repaired-reference; no product change",
    },
    ...Object.values(CASES)
      .flatMap((c) => c.closes)
      .map((id) => ({ id, verdict: "NOT_REMEDIATED", reason: "Harness prerequisite only" })),
  ],
  counters: { model: 0, runtimeMutation: 0, blockedOutbound: 0 },
  outboundFrames: [],
  cleanup: { exited: false },
};
const save = () =>
  NodeFSP.writeFile(
    NodePath.join(output, "capture-manifest.json"),
    JSON.stringify(packet, null, 2),
  );

async function workspaceDigest(directory) {
  const rows = [];
  async function visit(dir) {
    for (const entry of (await NodeFSP.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else rows.push([NodePath.relative(directory, file), sha256(await NodeFSP.readFile(file))]);
    }
  }
  await visit(directory);
  return sha256(JSON.stringify(rows));
}

// Selection must identify exactly one visible control across all explicit aliases.
async function named(page, role, key, scope = page) {
  const aliases = LABELS[key] ?? [key];
  const locators = aliases.map((name) =>
    scope.getByRole(role, { name, exact: true }).filter({ visible: true }),
  );
  const counts = await Promise.all(locators.map((l) => l.count()));
  return locators[chooseAlias(counts)];
}
async function text(page, value) {
  const target = page.getByText(value, { exact: true }).filter({ visible: true });
  NodeAssert.equal(await target.count(), 1, `Ambiguous text target: ${value}`);
  return target;
}

// Observe DOM changes and actual animation frames, not guessed delays.
async function ready(page, expected, target = "body") {
  await bounded(
    page.evaluate(
      async ({ expected, target }) => {
        await document.fonts.ready;
        await new Promise((resolve, reject) => {
          let prior = null;
          let stable = 0;
          let raf;
          const deadline = setTimeout(() => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            reject(new Error(`Readiness timeout: ${target}`));
          }, 15000);
          const sample = () => {
            const node = document.querySelector(target);
            const rect = node?.getBoundingClientRect();
            const content = document.body.innerText;
            const measured = [
              ...document.querySelectorAll("[data-index], pre, [data-virtual-index]"),
            ].map((e) => {
              const r = e.getBoundingClientRect();
              return [e.getAttribute("data-index"), r.x, r.y, r.width, r.height];
            });
            const current = JSON.stringify([
              rect?.toJSON(),
              measured,
              document.documentElement.className,
              content,
            ]);
            const complete =
              node && rect.width > 0 && rect.height > 0 && content.includes(expected);
            stable = complete && current === prior ? stable + 1 : 0;
            prior = current;
            if (stable >= 2) {
              clearTimeout(deadline);
              observer.disconnect();
              resolve();
            } else raf = requestAnimationFrame(sample);
          };
          const observer = new MutationObserver(() => {
            stable = 0;
          });
          observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          raf = requestAnimationFrame(sample);
        });
      },
      { expected, target },
    ),
    `State readiness ${expected}`,
    20000,
  );
  return { stableFrames: 2, fonts: true, virtualMeasurement: true };
}

async function runSize(width, height, includeStress = false) {
  const base = await NodeFSP.realpath(await NodeFSP.mkdtemp("/tmp/weavra-hig-"));
  const isolation = {
    base,
    home: NodePath.join(base, "home"),
    workspace: NodePath.join(base, "workspace"),
    app: NodePath.join(base, "app"),
  };
  for (const dir of [isolation.home, isolation.workspace, isolation.app]) await NodeFSP.mkdir(dir);
  await NodeFSP.mkdir(NodePath.join(isolation.workspace, "baseline-project"));
  assertProfile(base, isolation.home, isolation.workspace, isolation.app);
  const beforeDigest = await workspaceDigest(isolation.workspace);
  let application;
  const run = { width, height, isolation, cleanup: { exited: false } };
  packet.runs.push(run);
  try {
    application = await _electron.launch({
      executablePath: NodePath.join(bundle, "Contents/MacOS/weavra-desktop"),
      args: [`--user-data-dir=${isolation.home}/chromium`, "--disable-background-networking"],
      env: {
        PATH: `${NodePath.dirname(process.execPath)}:/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:/usr/bin:/bin`,
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
    const win = await application.browserWindow(page);
    const appInfo = await application.evaluate(({ app }) => {
      const pkg = require(`${app.getAppPath()}/package.json`);
      return {
        userData: app.getPath("userData"),
        appPath: app.getAppPath(),
        version: app.getVersion(),
        packagedRevision: pkg.t3codeCommitHash,
      };
    });
    NodeAssert.ok(
      appInfo.userData.startsWith(isolation.home + NodePath.sep),
      "Leaked Electron profile",
    );
    Object.assign(provenance, {
      packagedRevision: appInfo.packagedRevision,
      version: appInfo.version,
    });
    validateProvenance(provenance, revision);
    isolation.userData = appInfo.userData;
    packet.isolation ??= isolation;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketFrameSent", ({ response }) => {
      const payload = response.payloadData;
      // Retain only method/type identities; pairing tickets never enter evidence.
      const methods =
        payload.match(
          /(?:thread\.turn\.start|weavra\.[A-Za-z]+|workflow\.[a-z]+|planner\.[a-z]+)/g,
        ) ?? [];
      packet.outboundFrames.push(...methods);
      if (payload.includes("thread.turn.start")) packet.counters.model++;
      if (
        methods.some((m) =>
          /(?:workflow\.|planner\.|weavra\.task(?:Confirm|Prepare)|weavra\.controlCommand)/.test(m),
        )
      )
        packet.counters.runtimeMutation++;
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ) {
        packet.counters.blockedOutbound++;
        await route.abort();
      } else await route.continue();
    });
    // Record native minimum independently from renderer emulation.
    const minimum = await win.evaluate((window) => {
      const minimum = window.getMinimumSize();
      window.setSize(390, 400);
      return { minimum, bounds: window.getBounds(), contentBounds: window.getContentBounds() };
    });
    minimum.enforced =
      minimum.bounds.width >= minimum.minimum[0] && minimum.bounds.height >= minimum.minimum[1];
    packet.nativeMinimum ??= minimum;
    async function resize(w, h, stress = false) {
      if (!stress) {
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await win.evaluate((window, size) => window.setContentSize(size.w, size.h), { w, h });
      }
      await page.setViewportSize({ width: w, height: h });
    }
    await resize(width, height);
    async function snap(id, target = "body", suffix = null, stress = false) {
      const state = [...DESKTOP_STATES, ...STRESS_STATES].find((s) => s.id === id);
      NodeAssert.ok(state);
      const readiness = await ready(page, state.expected, target);
      const file = suffix ?? `${stress ? "390x844" : `${width}x${height}`}/${id}_${state.name}.png`;
      await NodeFSP.mkdir(NodePath.dirname(NodePath.join(output, file)), { recursive: true });
      const geometry = await page.evaluate(
        ({ target }) => {
          const e = document.querySelector(target);
          const r = e.getBoundingClientRect();
          const scrollports = [];
          for (let p = e.parentElement; p; p = p.parentElement) {
            if (
              /(auto|scroll)/.test(getComputedStyle(p).overflowY) &&
              p.scrollHeight > p.clientHeight
            ) {
              scrollports.push({
                rect: p.getBoundingClientRect().toJSON(),
                top: p.scrollTop,
                height: p.scrollHeight,
                client: p.clientHeight,
              });
            }
          }
          const viewport = { width: innerWidth, height: innerHeight };
          const clipped = scrollports.reduce(
            (a, p) => ({
              left: Math.max(a.left, p.rect.left),
              top: Math.max(a.top, p.rect.top),
              right: Math.min(a.right, p.rect.right),
              bottom: Math.min(a.bottom, p.rect.bottom),
            }),
            { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
          );
          const styles = getComputedStyle(e);
          const controlRects = [...e.querySelectorAll("button,input,textarea,[role=button]")].map(
            (control) => {
              const box = control.getBoundingClientRect();
              const inset = Math.min(4, box.width / 4, box.height / 4);
              const points = [
                [box.x + box.width / 2, box.y + box.height / 2],
                [box.left + inset, box.top + inset],
                [box.right - inset, box.top + inset],
                [box.left + inset, box.bottom - inset],
                [box.right - inset, box.bottom - inset],
              ];
              const visible =
                box.width > 0 &&
                box.height > 0 &&
                box.top >= clipped.top &&
                box.bottom <= clipped.bottom;
              return {
                name: control.getAttribute("aria-label") ?? control.textContent,
                rect: box.toJSON(),
                disabled: control.matches(":disabled"),
                visible,
                hits: visible
                  ? points.map(([x, y]) => {
                      const hit = document.elementFromPoint(x, y);
                      return hit === control || control.contains(hit);
                    })
                  : [],
              };
            },
          );
          return {
            viewport,
            dpr: devicePixelRatio,
            rootTheme: document.documentElement.className,
            targetRect: r.toJSON(),
            targetVisible:
              r.right > clipped.left &&
              r.left < clipped.right &&
              r.bottom > clipped.top &&
              r.top < clipped.bottom,
            body: e.innerText,
            scrollports,
            controls: controlRects,
            computed: {
              color: styles.color,
              backgroundColor: styles.backgroundColor,
              fontSize: styles.fontSize,
              fontFamily: styles.fontFamily,
              transition: styles.transitionProperty,
            },
            fontAvailability: {
              sans: document.fonts.check("14px sans-serif"),
              korean: document.fonts.check('14px "Apple SD Gothic Neo"'),
            },
            selection: {
              route: location.hash,
              activeElement: document.activeElement?.getAttribute("aria-label"),
            },
          };
        },
        { target },
      );
      NodeAssert.ok(geometry.body.length > 0, "Blank target body");
      const png = await page.screenshot({
        path: NodePath.join(output, file),
        scale: "css",
        animations: "disabled",
      });
      const native = await win.evaluate(async (window) =>
        (await window.webContents.capturePage()).toPNG().toString("base64"),
      );
      const electronFile = file.replace(".png", ".electron.png");
      await NodeFSP.writeFile(NodePath.join(output, electronFile), Buffer.from(native, "base64"));
      const nativeGeometry = await win.evaluate((window) => ({
        minimum: window.getMinimumSize(),
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
      }));
      const ax = await cdp.send("Accessibility.getFullAXTree");
      await NodeFSP.writeFile(
        NodePath.join(output, file.replace(".png", ".ax.json")),
        JSON.stringify(ax, null, 2),
      );
      const record = {
        file,
        stateId: id,
        target,
        ...geometry,
        native: nativeGeometry,
        stress,
        authority: "SYNTHETIC_PROJECTION_ONLY; REAL PACKAGED RENDERER",
        readiness,
        sha256: sha256(png),
        electronFile,
        electronSha256: sha256(Buffer.from(native, "base64")),
        expectedProject: Number(id) >= 7 ? (run.fixture?.projectId ?? "baseline-project") : null,
        expectedThread: /baseline-/.test(geometry.selection.route)
          ? geometry.selection.route
          : null,
      };
      packet.manifest.push(record);
      await save();
      console.log(`CAPTURE ${file}`);
    }
    async function click(role, key, scope) {
      await (await named(page, role, key, scope)).click();
    }
    async function theme(mode) {
      await click("button", "settings");
      await click("button", "appearance");
      await (await text(page, mode === "dark" ? "Dark" : "Light")).click();
      await bounded(
        page.evaluate(
          (mode) =>
            new Promise((resolve) => {
              const inspect = () => {
                if (
                  document.documentElement.classList.contains("dark") === (mode === "dark") &&
                  getComputedStyle(document.documentElement).getPropertyValue("--background")
                ) {
                  observer.disconnect();
                  resolve();
                }
              };
              const observer = new MutationObserver(inspect);
              observer.observe(document.documentElement, { attributes: true });
              inspect();
            }),
          mode,
        ),
        "Root theme and tokens",
      );
      await page.evaluate(() => {
        location.hash = "/";
      });
    }
    async function thread(title) {
      await (await text(page, title)).click();
      await page.locator(`button[aria-label=${JSON.stringify(`${title} 대화 작업`)}]`).waitFor();
      if (title === "03 Code blocks")
        await page.locator("pre").filter({ hasText: "greeting" }).waitFor();
    }
    async function panel(key, id) {
      await click("button", "addPanel");
      // Exact accessible names in menu include an optional shortcut description.
      const name = LABELS[key][0];
      const item = page
        .getByRole("menuitem")
        .filter({ has: page.getByText(name, { exact: true }) });
      NodeAssert.equal(await item.count(), 1, `Ambiguous panel: ${name}`);
      await item.click();
      await snap(id);
    }
    await ready(page, "컴퓨터 연결하기");
    await snap("01");
    await click("button", "continue");
    await snap("02");
    await click("button", "continue");
    await snap("03");
    await click("button", "skip");
    await snap("04");
    // Two intentional entry points exist. Scope to the sidebar, never choose first.
    await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
    await snap("05");
    await (await text(page, "로컬 폴더")).click();
    const address = page.locator('[data-slot="command-dialog-popup"] input');
    await address.fill(`${isolation.workspace}/`);
    await page.getByText("baseline-project", { exact: true }).waitFor();
    await snap("06");
    await (await text(page, "baseline-project")).click();
    const add = page.locator(
      'button[aria-label="추가 (⌘ Enter)"], button[aria-label="추가 (Ctrl Enter)"]',
    );
    NodeAssert.equal(await add.count(), 1, "Exact folder add action");
    await add.click();
    await page.locator('button[aria-label="프로젝트 변경"]').waitFor();
    await page.keyboard.press("Escape");
    const notice = page.locator('button[aria-label="Dismiss notification"]');
    if (await notice.isVisible()) await notice.click();
    await snap("07");
    await page.locator('button[aria-label="프로젝트 변경"]').click();
    await snap("08");
    await page.keyboard.press("Escape");
    await click("button", "panel");
    await snap("09");
    await (await text(page, "파일")).click();
    await page.locator('button[aria-label="Refresh workspace files"]').waitFor();
    await snap("10");
    await page.locator('button[aria-label="작업 추가"]').click();
    await snap("11");
    await click("button", "cancel");
    await panel("agents", "12");
    await panel("graph", "13");
    await panel("devices", "14");
    await click("button", "cancel");
    await panel("browser", "15");
    await panel("terminal", "16");
    await click("button", "settings");
    await snap("17");
    await click("button", "appearance");
    await snap("18");
    await (await text(page, "Dark")).click();
    await snap("19");
    await (await text(page, "Light")).click();
    for (const [id, key] of [
      ["20", "keybindings"],
      ["21", "snapshots"],
      ["22", "providers"],
      ["23", "integrations"],
      ["24", "source_control"],
      ["25", "storage"],
      ["26", "connections"],
      ["27", "archive"],
    ]) {
      await click("button", key);
      await snap(id);
    }
    await click("button", "providers");
    await click("button", "customModel");
    await snap("28");
    await click("button", "cancel");
    await click("button", "general");
    await click("link", "diagnostics");
    await snap("29");
    await click("button", "general");
    await click("link", "licenses");
    await snap("30");
    await page.evaluate(() => {
      location.hash = "/";
    });
    await click("button", "model");
    await snap("31");
    await page.keyboard.press("Escape");
    await click("button", "mode");
    await snap("32");
    await page.keyboard.press("Escape");
    run.fixture = seed(isolation);
    await page.reload();
    await snap("33");
    for (const [title, id] of [
      ["01 Conversation", "34"],
      ["02 Long messages", "35"],
      ["03 Code blocks", "36"],
      ["04 Working fixture", "37"],
      ["05 Error fixture", "38"],
      ["06 Empty thread", "39"],
    ]) {
      await thread(title);
      await snap(id);
    }
    await click("button", "panel");
    await (await text(page, "통제 작업")).click();
    await snap("40");
    await page.locator('button[aria-label="통제 작업 닫기"]').click();
    await theme("dark");
    await thread("03 Code blocks");
    await snap("41");
    if (includeStress) {
      await resize(390, 844, true);
      await thread("03 Code blocks");
      await snap("42", "body", null, true);
      await resize(width, height);
      await theme("light");
      await resize(390, 844, true);
      await thread("03 Code blocks");
      await snap("43", "body", null, true);
      await resize(width, height);
    } else await theme("light");
    async function nativeMenu(label) {
      await application.evaluate(({ Menu }, label) => {
        globalThis.higOriginalPopup ??= Menu.prototype.popup;
        Menu.prototype.popup = function () {
          const matches = this.items.filter((item) => item.label === label);
          if (matches.length !== 1) throw new Error(`Native menu ambiguity: ${label}`);
          matches[0].click();
        };
      }, label);
      await (await text(page, "03 Code blocks")).click({ button: "right" });
    }
    await nativeMenu("삭제");
    await snap("44");
    await click("button", "cancel");
    await nativeMenu("대화 이름 바꾸기");
    await page.locator('input[aria-label="대화 제목"]').waitFor();
    await snap("45");
    await page.keyboard.press("Escape");
    await nativeMenu("프로젝트 설정");
    async function scrollTo(selector, position = "start") {
      await page
        .locator(selector)
        .evaluate(
          (e, position) => e.scrollIntoView({ block: position, behavior: "instant" }),
          position,
        );
    }
    await scrollTo("#weavra-controls");
    await snap("46", "#weavra-controls");
    const prepare = await named(page, "button", "prepare");
    await prepare.scrollIntoViewIfNeeded();
    await snap(
      "46",
      "#weavra-controls",
      `matrix/${width}x${height}/light/46/prepare-end-default.png`,
    );
    await scrollTo("#weavra-evidence");
    await snap("47", "#weavra-evidence");
    await scrollTo("#weavra-fitness");
    await snap("48", "#weavra-fitness");
    const fitness = page.locator("#weavra-fitness");
    await fitness.getByRole("button", { name: "기록 불러오기", exact: true }).waitFor();
    await scrollTo("#project-actions");
    await snap(
      "48",
      "#project-actions",
      `matrix/${width}x${height}/light/48/actions-end-default.png`,
    );
    for (const mode of ["dark", "light"]) {
      if (mode === "dark") {
        await page.evaluate(() => {
          location.hash = "/";
        });
        await theme("dark");
        await nativeMenu("프로젝트 설정");
      } else continue;
      for (const [id, selector] of [
        ["46", "#weavra-controls"],
        ["47", "#weavra-evidence"],
        ["48", "#weavra-fitness"],
      ]) {
        await scrollTo(selector);
        await snap(id, selector, `matrix/${width}x${height}/${mode}/${id}/top-default.png`);
        await page
          .locator(selector)
          .evaluate((e) => e.scrollIntoView({ block: "end", behavior: "instant" }));
        await snap(id, selector, `matrix/${width}x${height}/${mode}/${id}/end-default.png`);
      }
    }
    await application.evaluate(({ Menu }) => {
      Menu.prototype.popup = globalThis.higOriginalPopup;
    });
    run.fileDigests = { before: beforeDigest, after: await workspaceDigest(isolation.workspace) };
    packet.fileDigests ??= run.fileDigests;
    NodeAssert.equal(
      run.fileDigests.before,
      run.fileDigests.after,
      "Workspace changed during capture",
    );
    await cdp.detach();
  } finally {
    if (application) {
      const child = application.process();
      const exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      await application.close();
      const exit =
        child.exitCode !== null || child.signalCode !== null
          ? { code: child.exitCode, signal: child.signalCode }
          : await bounded(exited, "Owned Electron exit", 15000);
      run.cleanup = { pid: child.pid, exited: true, ...exit };
    }
    await save();
  }
}
try {
  for (const [index, [w, h]] of SIZES.entries()) await runSize(w, h, index === 0);
  packet.cleanup.exited = packet.runs.every((run) => run.cleanup.exited);
  NodeAssert.equal(await git("diff", "HEAD", "--"), "", "Source changed during capture");
  NodeAssert.equal(packet.counters.model, 0);
  NodeAssert.equal(packet.counters.runtimeMutation, 0);
  await save();
  console.log(`DONE ${packet.manifest.length} PNGs; product findings retained`);
} catch (error) {
  packet.failure = String(error);
  await save();
  throw error;
}
