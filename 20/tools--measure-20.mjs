import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
const wt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-20";
const pk = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20";
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const out = process.env.HIG_MEASURE_OUT ?? `${pk}/measure-after`;
const bundle = process.env.WEAVRA_CAPTURE_APP ?? `${pk}/after/app/weavra-desktop.app`;
const { seed, prepareCaptureProfile, freezeCaptureServerFrame, registerSeededThread } = await import(`${qa}/seed.mjs`);
const { bounded } = await import(`${qa}/assert.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-m20-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const path of [iso.home, iso.workspace, iso.app, `${iso.workspace}/baseline-project`]) await fs.mkdir(path);
prepareCaptureProfile(iso);
const report = {
  scope: "Clean committed package: rules a-j and deletion safety; supplemental to shared acceptance",
  head: (await Bun.$`GIT_MASTER=1 git -C ${wt} rev-parse HEAD`.text()).trim(),
  diffSha256: hash(await Bun.$`GIT_MASTER=1 git -C ${wt} diff HEAD --`.text()),
  scriptSha256: hash(await fs.readFile(new URL(import.meta.url))),
  asarSha256: hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  rows: [], screenshots: [], failures: [], requests: [], fixtureRegistrations: [],
};
const check = (name, ok, data = {}) => {
  report.rows.push({ check: name, pass: Boolean(ok), ...data });
  if (!ok) report.failures.push({ name, ...data });
};
const app = await _electron.launch({
  colorScheme: null,
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
let connection;
let fixtureId = 900000;
const pending = new Map();
await page.routeWebSocket("**/*", socket => {
  const server = socket.connectToServer(), methods = new Map();
  connection = server;
  socket.onClose(() => server.close());
  server.onClose(() => socket.close());
  socket.onMessage(message => {
    const decoded = JSON.parse(String(message));
    for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
      if (frame._tag === "Request") {
        methods.set(frame.id, frame.tag);
        report.requests.push({ method: frame.tag, payload: frame.payload });
      }
    }
    server.send(message);
  });
  server.onMessage(message => {
    const decoded = JSON.parse(String(message)), forwarded = [];
    for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
      const fixture = pending.get(String(frame.requestId));
      if (fixture && frame._tag === "Exit") {
        pending.delete(String(frame.requestId)); fixture.resolve(frame.exit); continue;
      }
      forwarded.push(freezeCaptureServerFrame(frame, methods.get(frame.requestId)));
    }
    if (forwarded.length) socket.send(JSON.stringify(Array.isArray(decoded) ? forwarded : forwarded[0]));
  });
});
async function dispatch(command) {
  if (!connection) throw new Error("No isolated fixture RPC connection");
  const id = String(fixtureId++), receipt = Promise.withResolvers();
  pending.set(id, receipt);
  connection.send(JSON.stringify({ _tag: "Request", id, tag: "orchestration.dispatchCommand", payload: command, headers: [] }));
  const exit = await bounded(receipt.promise, "Disposable fixture command receipt", 20000);
  if (exit._tag !== "Success") throw new Error(JSON.stringify(exit));
  return exit.value;
}
let blockedOutbound = 0;
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    blockedOutbound++; await route.abort();
  } else await route.continue();
});
const click = (role, name, root = page) => root.getByRole(role, { name, exact: true }).click();
const settle = () => bounded(page.evaluate(async () => {
  await document.fonts.ready;
  let previous = null, stable = 0;
  while (stable < 2) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const active = document.getAnimations().filter(a =>
      (a.playState === "running" || a.playState === "pending") &&
      Number.isFinite(a.effect?.getComputedTiming().endTime));
    const popup = document.querySelector('[role="alertdialog"]');
    const sample = JSON.stringify({
      rect: popup?.getBoundingClientRect().toJSON(),
      transform: popup ? getComputedStyle(popup).transform : null,
      scale: popup ? getComputedStyle(popup).scale : null,
      starting: popup?.hasAttribute("data-starting-style"),
    });
    stable = active.length === 0 && sample === previous && !popup?.hasAttribute("data-starting-style") ? stable + 1 : 0;
    previous = sample;
  }
}), "Self-measurement settled frame", 20000);
const sidebar = () => page.locator('[data-sidebar="sidebar"]');
let currentLegacy = false;
async function thread(title = "03 Code blocks") {
  await page.evaluate(() => { location.hash = "/"; });
  await sidebar().getByText(title, { exact: true }).click();
  await page.waitForFunction(id => location.hash.includes(id), title === "03 Code blocks" ? "baseline-code" : "baseline-messages");
  await settle();
}
async function nativeMenu(label, title = "03 Code blocks", synthetic = false) {
  if (currentLegacy && label === "삭제") label = "Delete";
  await app.evaluate(({ Menu }, label) => {
    globalThis.hig20OriginalPopup ??= Menu.prototype.popup;
    Menu.prototype.popup = function () {
      const item = this.items.filter(item => item.label === label);
      if (item.length !== 1) throw new Error(`Menu ambiguity: ${label}`);
      item[0].click();
    };
  }, label);
  const row = sidebar().getByText(title, { exact: true });
  if (synthetic) await row.dispatchEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 180 });
  else await row.click({ button: "right" });
}
async function openDelete(title = "03 Code blocks") {
  await nativeMenu("삭제", title);
  await page.getByRole("alertdialog").waitFor();
  await settle();
}
async function closeDelete(key = "Escape") {
  if (key === "Cancel") await click("button", "취소", page.getByRole("alertdialog"));
  else await page.keyboard.press(key);
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  await settle();
}
async function shot(file) {
  const path = `${out}/${file}`;
  await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const bytes = await page.screenshot({ path, scale: "css" });
  report.screenshots.push({ file, sha256: hash(bytes), native: await win.evaluate(w => ({
    minimum: w.getMinimumSize(), bounds: w.getBounds(), content: w.getContentBounds(),
  })) });
}
async function measure(context) {
  const result = await page.getByRole("alertdialog").evaluate(root => {
    const rgba = value => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] / 255 + b[i] * (1 - a[3] / 255));
    const background = n => {
      const layers = [];
      for (let p = n; p; p = p.parentElement) layers.unshift(rgba(getComputedStyle(p).backgroundColor));
      return layers.reduce((bg, layer) => blend(layer, bg), [255, 255, 255]);
    };
    const lum = rgb => rgb.slice(0, 3).map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
      .reduce((v, s, i) => v + s * [.2126, .7152, .0722][i], 0);
    const contrast = (a, b) => { const l = [lum(a), lum(b)].sort((a, b) => b - a); return (l[0] + .05) / (l[1] + .05); };
    const geometry = node => {
      const r = node.getBoundingClientRect(), s = getComputedStyle(node), bg = background(node);
      const lines = new Map(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        for (let i = 0; i < text.data.length; i++) {
          const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
          const rect = range.getClientRects()[0];
          if (rect) lines.set(Math.round(rect.top), (lines.get(Math.round(rect.top)) ?? "") + text.data[i]);
        }
      }
      const points = [[r.x+r.width/2,r.y+r.height/2],[r.left+1,r.top+1],[r.right-1,r.top+1],[r.left+1,r.bottom-1],[r.right-1,r.bottom-1]];
      const glyphRects = [];
      const texts = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        const range = document.createRange(); range.selectNodeContents(text);
        glyphRects.push(...[...range.getClientRects()].map(rect => rect.toJSON()));
      }
      return {
        tag: node.tagName, text: node.textContent, rect: r.toJSON(), lines: [...lines.values()],
        fontSize: parseFloat(s.fontSize), textContrast: contrast(blend(rgba(s.color), bg), bg),
        borderWidth: parseFloat(s.borderWidth), border: s.borderColor,
        borderOutsideContrast: contrast(blend(rgba(s.borderColor), background(node.parentElement)), background(node.parentElement)),
        outlineWidth: parseFloat(s.outlineWidth), outlineContrast: contrast(rgba(s.outlineColor), background(node.parentElement)),
        boxShadow: s.boxShadow, focused: node === document.activeElement, focusVisible: node.matches(":focus-visible"),
        ringContrast: contrast(rgba(s.getPropertyValue("--tw-ring-color") || s.color), background(node.parentElement)),
        ringSpreads: [...s.boxShadow.matchAll(/\)\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map(m => Number(m[4])),
        radius: s.borderRadius, hits: points.map(([x,y]) => { const hit = document.elementFromPoint(x,y); return hit === node || node.contains(hit); }),
        clipped: node.scrollWidth > node.clientWidth || glyphRects.some(g => g.left < r.left || g.right > r.right || g.top < r.top || g.bottom > r.bottom),
        ellipsis: s.textOverflow === "ellipsis", transition: s.transitionProperty,
        inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      };
    };
    return {
      controls: [...root.querySelectorAll("button")].map(geometry),
      labels: [...root.querySelectorAll('[data-slot="alert-dialog-title"],[data-slot="alert-dialog-description"]')].map(geometry),
      modal: root.getBoundingClientRect().toJSON(),
      modalOverflow: root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      active: document.activeElement?.tagName,
    };
  });
  report.rows.push({ kind: "computed", ...context, result });
  check("f/modal-no-scroll", !result.modalOverflow, context);
  check("f/no-page-overflow", !result.pageOverflow, context);
  check("e/named-target-and-action", result.labels.some(l => l.text.includes(context.target ?? "03 Code blocks")) && result.controls.some(c => c.text === "스레드 삭제"), context);
  for (const row of [...result.controls, ...result.labels]) {
    const data = { ...context, row };
    check("b/text-size", row.fontSize >= 14, data);
    check("c/text-contrast", row.textContrast >= 4.5, data);
    check("d/no-orphan", row.lines.length < 2 || !/^[가-힣][.?!]?$/.test(row.lines.at(-1).trim()), data);
    check("f/strict-fit", row.inside, data);
    check("i/no-clipping-ellipsis", !row.clipped && !row.ellipsis, data);
    if (row.tag === "BUTTON") {
      check("a/target", row.rect.width >= 36 && row.rect.height >= 36, data);
      check("a/five-point-hit", row.hits.every(Boolean), data);
      check("h/control-border", row.borderWidth >= 1 && row.borderOutsideContrast >= 3, data);
    }
    if (row.focused && row.outlineWidth >= 2)
      check("g-h/neutral-focus-ring", row.outlineContrast >= 3, data);
    if (row.tag === "BUTTON" && row.focused && row.focusVisible)
      check("g-h/button-focus-indicator", (row.outlineWidth >= 2 && row.outlineContrast >= 3) || (row.ringContrast >= 3 && Math.max(...row.ringSpreads) >= 3), data);
  }
  for (let a = 0; a < result.controls.length; a++) for (let b = a+1; b < result.controls.length; b++) {
    const x = result.controls[a].rect, y = result.controls[b].rect;
    const area = Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left)) * Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
    check("j/no-control-overlap", area === 0, { ...context, area });
  }
  if (context.state === "initial") check("g/neutral-initial-focus", result.active !== "BUTTON", context);
}
try {
  await page.reload();
  await win.evaluate(w => w.setContentSize(1280, 800)); await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor({ timeout: 30000 });
  await click("button", "계속하기"); await click("button", "계속하기"); await click("button", "프로젝트 가져오지 않기");
  await click("button", "프로젝트 추가", sidebar());
  await page.getByText("로컬 폴더", { exact: true }).click();
  const folder = page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
  await folder.fill(iso.workspace + "/"); await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button", { name: "프로젝트 변경", exact: true }).waitFor(); await page.keyboard.press("Escape");
  seed(iso); await page.reload(); await thread();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.fill("HIG20 disposable unsent draft");
  await page.keyboard.press("Tab");
  const draft = await editor.innerText();
  for (const legacy of [false, true]) {
    await click("button", "설정"); await click("button", "General");
    const section = page.locator("#legacy-features");
    const disclosure = section.getByRole("button", { name: "Legacy features", exact: true });
    if (await disclosure.getAttribute("aria-expanded") !== "true") { await disclosure.click(); await settle(); }
    const toggle = section.getByRole("switch", { name: "Sidebar (legacy)", exact: true });
    await toggle.scrollIntoViewIfNeeded(); await settle();
    const checked = await toggle.getAttribute("aria-checked") === "true" || await toggle.getAttribute("data-checked") !== null;
    if (checked !== legacy) { await toggle.click(); await settle(); }
    await toggle.and(page.locator(legacy ? '[aria-checked="true"],[data-checked]' : '[aria-checked="false"],[data-unchecked]')).waitFor();
    currentLegacy = legacy;
    await thread();
    await sidebar().locator(legacy ? '[data-testid="new-thread-button"]' : '[data-testid="sidebar-row-card"],[data-testid="sidebar-row-slim"]').first().waitFor();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(mode => window.desktopBridge.setTheme(mode), theme);
      await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, theme === "dark");
      for (const [width,height] of [[840,620],[1280,800],[1920,1080]]) {
        await win.evaluate((w,size) => w.setContentSize(...size), [width,height]); await page.setViewportSize({ width,height });
        for (const scale of [100,150]) {
          await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale}%`; }, scale);
          await openDelete();
          const prefix = `${legacy?"legacy":"current"}/${width}x${height}/${theme}/${scale}`;
          await measure({ legacy, width,height,theme,scale,state:"initial" }); await shot(`${prefix}-initial.png`);
          await page.getByRole("alertdialog").getByRole("button",{name:"스레드 삭제",exact:true}).hover();
          await measure({legacy,width,height,theme,scale,state:"hover"});
          await page.keyboard.press("Enter"); await settle();
          check("g/unchosen-enter-no-delete", await page.getByRole("alertdialog").isVisible(), { legacy,width,height,theme,scale });
          await click("button","취소",page.getByRole("alertdialog")); await page.getByRole("alertdialog").waitFor({state:"hidden"}); await settle();
          check("g/cancel-keeps-draft", await editor.innerText() === draft, {legacy,width,height,theme,scale});
          check("g/cancel-keeps-two-threads", await sidebar().getByText("03 Code blocks",{exact:true}).count()===1 && await sidebar().getByText("01 Conversation",{exact:true}).count()===1, {legacy,width,height,theme,scale});
          await openDelete();
          await page.keyboard.press("Tab"); await measure({legacy,width,height,theme,scale,state:"keyboard"});
          await shot(`${prefix}-keyboard.png`);
          await closeDelete();
          check("g/escape-keeps-draft", await editor.innerText() === draft, {legacy,width,height,theme,scale});
          const focus = await page.evaluate(() => ({
            visible: document.activeElement?.checkVisibility(),
            text: document.activeElement?.textContent,
            name: document.activeElement?.getAttribute("aria-label"),
          }));
          check("g/focus-returns-to-thread", focus.visible && `${focus.text} ${focus.name}`.includes("03 Code blocks"), {legacy,width,height,theme,scale,focus});
        }
      }
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize="100%"; });
  await win.evaluate(w => w.setContentSize(1280,800)); await page.setViewportSize({width:1280,height:800});
  await thread();
  const commandRows = () => report.requests.filter(r => r.method === "orchestration.dispatchCommand");
  check("e/no-delete-before-activation", commandRows().every(r => (r.payload.request?.type ?? r.payload.type) !== "thread.delete"), {commands:commandRows()});
  for (const id of ["baseline-code","baseline-messages"]) report.fixtureRegistrations.push(await registerSeededThread(dispatch, iso, id));
  seed(iso); await page.reload(); await thread();
  await openDelete();
  const deleted = sidebar().getByText("03 Code blocks",{exact:true}).waitFor({state:"hidden"});
  await click("button","스레드 삭제",page.getByRole("alertdialog"));
  await deleted; await settle(); await shot("explicit-delete-result.png");
  check("e/one-explicit-delete-request", commandRows().filter(r => (r.payload.request?.type ?? r.payload.type) === "thread.delete").length === 1);
  check("e/explicit-delete-only-selected", await sidebar().getByText("03 Code blocks",{exact:true}).count()===0 && await sidebar().getByText("01 Conversation",{exact:true}).count()===1);
  const db = new Database(`${iso.app}/userdata/state.sqlite`, {readonly:true});
  try {
    const rows = db.query("SELECT thread_id,deleted_at FROM projection_threads WHERE thread_id IN ('baseline-code','baseline-messages')").all();
    check("e/persisted-selected-delete", rows.some(r=>r.thread_id==="baseline-code"&&r.deleted_at!==null) && rows.some(r=>r.thread_id==="baseline-messages"&&r.deleted_at===null), {rows});
  } finally { db.close(); }
  await dispatch({type:"thread.archive",commandId:crypto.randomUUID(),threadId:"baseline-messages"});
  await click("button","설정"); await click("button","Archive");
  const archiveRow = page.locator('[data-slot="settings-row"]').filter({hasText:"01 Conversation"});
  await archiveRow.waitFor();
  for (const theme of ["light","dark"]) {
    await page.evaluate(mode=>window.desktopBridge.setTheme(mode),theme);
    await page.waitForFunction(dark=>document.documentElement.classList.contains("dark")===dark,theme==="dark");
    await win.evaluate(w=>w.setContentSize(840,620)); await page.setViewportSize({width:840,height:620});
    for (const scale of [100,150]) {
      await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
      await app.evaluate(({Menu})=>{
        Menu.prototype.popup=function(){
          const item=this.items.filter(item=>item.label==="Delete");
          if(item.length!==1)throw new Error("Archive delete menu ambiguity");
          item[0].click();
        };
      });
      await archiveRow.click({button:"right"});await page.getByRole("alertdialog").waitFor();await settle();
      await measure({target:"01 Conversation",legacy:true,width:840,height:620,theme,scale,state:"archive"});
      await shot(`archive/840x620/${theme}/${scale}-archive.png`);
      await page.keyboard.press("Enter");
      check("g/archive-enter-no-delete",await page.getByRole("alertdialog").isVisible(),{theme,scale});
      await closeDelete("Cancel");
      check("g/archive-cancel-preserves-target",await archiveRow.count()===1,{theme,scale});
    }
  }
  check("zero-model-runtime-outbound", blockedOutbound===0 && report.requests.every(r => !/thread\.turn\.start|weavra\.control$|planner\.start/.test(r.method) && !/turn\.start/.test(r.payload.request?.type ?? r.payload.type ?? "")), {blockedOutbound});
} catch (error) {
  report.failures.push({error:String(error),stack:error.stack}); console.error(error);
  try { await shot("failure.png"); } catch {}
} finally {
  await app.close(); report.cleanup={closed:true};
  const computed = report.rows.filter(r=>r.kind==="computed").flatMap(r=>[...r.result.controls,...r.result.labels]);
  report.summary={
    rows:report.rows.length,screenshots:report.screenshots.length,failures:report.failures.length,
    minimumTextSize:Math.min(...computed.map(r=>r.fontSize)),
    minimumTextContrast:Math.min(...computed.map(r=>r.textContrast)),
    minimumBorderContrast:Math.min(...computed.filter(r=>r.tag==="BUTTON").map(r=>r.borderOutsideContrast)),
    checks:Object.fromEntries([...new Set(report.rows.filter(r=>r.check).map(r=>r.check))].map(name=>[name,{
      total:report.rows.filter(r=>r.check===name).length,failed:report.rows.filter(r=>r.check===name&&!r.pass).length,
    }])),
  };
  await fs.writeFile(`${out}/measurements.json`,JSON.stringify(report,null,2));
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(report.summary,null,2));
}
console.log(`SELF_MEASURE rows=${report.rows.length} PNGs=${report.screenshots.length} failures=${report.failures.length}`);
if(report.failures.length) process.exitCode=1;
