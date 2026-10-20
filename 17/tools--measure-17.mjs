// Fresh packaged-app measurements. Synthetic IPC state never requests OS permissions.
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodePng } from "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/png-decode.ts";
const side = process.argv[2] ?? "after";
if (!["before","after"].includes(side)) throw new Error("Expected before or after");
const wt = `/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-${side === "before" ? "16" : "17"}`;
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const pk = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17";
const out = `${pk}/${side === "after" ? "measure" : "supplemental/before"}`;
const bundle = `${pk}/${side}/app/weavra-desktop.app`;
const { seed, registerSeededThread, prepareCaptureProfile, installCaptureNetworkFixture, freezeCaptureServerFrame } = await import(`${qa}/seed.mjs`);
const { bounded } = await import(`${qa}/assert.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const sha = (b) => createHash("sha256").update(b).digest("hex");
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-m17-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const p of [iso.home, iso.workspace, iso.app]) await fs.mkdir(p);
prepareCaptureProfile(iso);
const report = {
  asarSha256: sha(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  synthetic: "Isolated local profile; actual archive return control, conversation draft, native action menu, and two real archived fixture conversations.",
  rows: [], screenshots: [], failures: [], counters: { model: 0, execution: 0, externalNetwork: 0 },
};
const fail = (message) => report.failures.push(message);
const app = await _electron.launch({
  executablePath: `${bundle}/Contents/MacOS/weavra-desktop`,
  args: [`--user-data-dir=${iso.home}/chromium`, "--disable-background-networking"],
  env: { PATH: process.env.PATH, HOME: iso.home, TMPDIR: base, LANG: "en_US.UTF-8",
    WEAVRA_HOME: `${iso.home}/.weavra`, WEAVRA_APP_HOME: iso.app,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    AWS_EC2_METADATA_DISABLED: "true" }, timeout: 45000,
});
const page = await app.firstWindow();
process.once("SIGTERM", () => { void app.close(); });
process.once("SIGINT", () => { void app.close(); });
page.setDefaultTimeout(15000);
const win = await app.browserWindow(page);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  if (response.payloadData.includes("thread.turn.start")) report.counters.model++;
  if (/"(?:terminal\.create|terminal\.write|workflow\.prepare|workflow\.confirm|planner\.start)"/.test(response.payloadData))
    report.counters.execution++;
});
await installCaptureNetworkFixture(page);
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (["http:", "https:"].includes(u.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    report.counters.externalNetwork++; await route.abort();
  } else await route.continue();
});
const click = (role, name, root = page) => root.getByRole(role, { name, exact: true }).click();
const settle = () => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations().filter((a) =>
    Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
const lum = (rgb) => rgb.map((v) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const ratio = (a, b) => { const [l, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (l + .05) / (d + .05); };
async function shot(file) {
  await settle();
  const path = `${out}/${file}`; await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const bytes = await page.screenshot({ path, scale: "css" });
  report.screenshots.push({ file, sha256: sha(bytes) });
}
async function measure(root, ctx) {
  await settle();
  const data = await root.evaluate((root) => {
    const color = (value) => {
      const c = document.createElement("canvas").getContext("2d");
      c.fillStyle = value; c.fillRect(0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data];
    };
    const detail = (n, kind) => {
      const st = getComputedStyle(n), r = n.getBoundingClientRect();
      const canvas = document.createElement("canvas").getContext("2d"); canvas.font = st.font;
      const lines = new Map(), walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.data.length; i++) {
        const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
        const q = range.getClientRects()[0]; if (!q) continue;
        const y = Math.round(q.top); lines.set(y, (lines.get(y) ?? "") + t.data[i]);
      }
      const lineText = [...lines.values()], text = n.textContent.trim();
      return { kind, name: n.getAttribute("aria-label") || text, rect: r.toJSON(),
        fg: color(st.color), border: color(st.borderTopColor), borderWidth: parseFloat(st.borderTopWidth),
        fontSize: parseFloat(st.fontSize), fontWeight: st.fontWeight, wordBreak: st.wordBreak,
        textWrap: st.textWrap, lines: lineText, textOverflow: st.textOverflow,
        scrollWidth: n.scrollWidth, clientWidth: n.clientWidth, opacity: st.opacity,
        korean: /[가-힣]/.test(text), labelWidth: canvas.measureText(text).width,
        orphan: lineText.length > 1 && /^[가-힣]$/.test(lineText.at(-1).trim()),
        midWord: lineText.some((s, i) => i > 0 && /[가-힣]$/.test(lineText[i - 1]) && /^[가-힣]/.test(s)),
        icons: [...n.querySelectorAll("svg")].map((svg) => color(getComputedStyle(svg).color)),
        hits: [[r.x + r.width / 2, r.y + r.height / 2], [r.left + 4, r.top + 4],
          [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]]
          .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return n === hit || n.contains(hit); }),
        disabled: n.matches(":disabled,[aria-disabled=true],[data-disabled]"),
        iconOnly: n.getAttribute("role") === "switch" || !text,
        focus: n === document.activeElement, focusVisible: n.matches(":focus-visible"),
        ring: color(st.getPropertyValue("--tw-ring-color") || st.outlineColor),
        shadow: st.boxShadow, transition: st.transitionProperty,
        outlineWidth: parseFloat(st.outlineWidth), outlineColor: color(st.outlineColor),
      };
    };
    const visible = (n) => {
      const r = n.getBoundingClientRect();
      if (!n.checkVisibility() || r.top < 0 || r.bottom > innerHeight || r.height <= 0) return false;
      for (let p = n.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p), q = p.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(st.overflowY) && (r.top < q.top || r.bottom > q.bottom)) return false;
      }
      return true;
    };
    return [
      ...[...root.querySelectorAll('button')].filter(visible).map((n) => detail(n, "control")),
      ...[...root.querySelectorAll('[data-slot="settings-row"] p')].filter(visible).map((n) => detail(n, n.tagName === "PRE" ? "code" : "text")),
    ];
  });
  const png = decodePng(await page.screenshot({ scale: "css" }));
  const pixel = (x, y) => {
    const index = (Math.min(png.height - 1, Math.max(0, Math.round(y))) * png.width +
      Math.min(png.width - 1, Math.max(0, Math.round(x)))) * 4;
    return [...png.rgba.slice(index, index + 3)];
  };
  for (const s of data) {
    // Sample padding, never a rounded corner, glyph, border, or focus stroke.
    const bg = s.kind === "text"
      ? pixel(s.rect.right - 3, s.rect.top + 3)
      : pixel(s.rect.left + s.rect.width / 2, s.rect.top + 5);
    const blend = (fg) => bg.map((v, i) => fg[i] * fg[3] / 255 + v * (1 - fg[3] / 255));
    const outside = pixel(s.rect.left + s.rect.width / 2, s.rect.top - 6);
    const row = { ...ctx, ...s, bg, contrast: ratio(blend(s.fg), bg),
      edgeContrast: Math.max(s.borderWidth ? ratio(blend(s.border), outside) : 1, ratio(bg, outside)),
      iconContrast: s.icons.map((fg) => ratio(blend(fg), bg)),
      ringContrast: s.focusVisible && s.outlineWidth >= 2
        ? ratio(pixel(s.rect.left + s.rect.width / 2, s.rect.top - 3), outside)
        : s.shadow !== "none"
        ? ratio(pixel(s.rect.left + s.rect.width / 2, s.rect.top - 2), outside)
        : ratio(s.outlineColor.slice(0, 3), outside) };
    report.rows.push(row);
    if (!s.iconOnly && row.contrast < 4.5) fail(`c ${JSON.stringify(ctx)} ${s.name}: ${row.contrast}`);
    if (s.kind === "text" && s.fontSize < 14) fail(`b ${s.name}: ${s.fontSize}`);
    if (s.korean && s.kind === "text" && (s.wordBreak !== "keep-all" || !s.textWrap.includes("pretty") || s.orphan || s.midWord))
      fail(`d ${JSON.stringify(ctx)} ${s.name}: ${JSON.stringify(s.lines)}`);
    // An icon-only button has no visible text to truncate; its aria-label is not paint.
    if (!s.iconOnly && (s.textOverflow === "ellipsis" || s.scrollWidth > s.clientWidth + .5)) fail(`i ${JSON.stringify(ctx)} ${s.name}`);
    if (s.kind === "control") {
      if (s.iconOnly ? s.rect.width < 36 || s.rect.height < 36 : s.rect.height < 32 || s.rect.width + .5 < s.labelWidth + 20)
        fail(`a target ${JSON.stringify(ctx)} ${s.name}: ${s.rect.width}x${s.rect.height}, label=${s.labelWidth}`);
      if (!s.disabled && !s.hits.every(Boolean)) fail(`a hit ${JSON.stringify(ctx)} ${s.name}`);
      if (s.iconOnly && row.edgeContrast < 3) fail(`h edge ${JSON.stringify(ctx)} ${s.name}: ${row.edgeContrast}`);
      if (row.iconContrast.some((r) => r < 3)) fail(`h icon ${JSON.stringify(ctx)} ${s.name}: ${row.iconContrast}`);
      const ringWidths = [...s.shadow.matchAll(/0px 0px 0px ([\d.]+)px/g)].map((m) => Number(m[1]));
      if (s.focusVisible && (row.ringContrast < 3 || (!ringWidths.some((n) => n >= 2) && s.outlineWidth < 2)))
        fail(`h focus ${JSON.stringify(ctx)} ${s.name}: ${row.ringContrast}/${s.shadow}`);
    }
  }
}
async function geometry(root, ctx) {
  const g = await root.evaluate((root) => {
    const rect = root.getBoundingClientRect();
    const painted = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    for (let p = root.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p), q = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(st.overflowY)) {
        painted.top = Math.max(painted.top, q.top); painted.bottom = Math.min(painted.bottom, q.bottom);
      }
    }
    const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const controls = [...root.querySelectorAll("button,[role=option],[role=menuitem],[role=menuitemradio]")].filter((n) => n.checkVisibility());
    const overlaps = controls.flatMap((a, i) => controls.slice(i + 1).filter((b) => !a.contains(b) && !b.contains(a))
      .map((b) => ({ a: a.getAttribute("aria-label") || a.textContent, b: b.getAttribute("aria-label") || b.textContent,
        area: area(a.getBoundingClientRect(), b.getBoundingClientRect()) }))).filter((r) => r.area > .5);
    const groups = [...root.querySelectorAll("[data-slot=settings-row]")].filter((n) => n.checkVisibility())
      .map((n) => [...n.querySelectorAll("button")].filter((n) => n.checkVisibility()).map((n) => n.getBoundingClientRect()))
      .filter((rs) => rs.length).map((rs) => ({ top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) }));
    const gaps = groups.slice(1).map((r, i) => r.top - groups[i].bottom);
    if (root.matches('[data-slot=settings-row]') && controls.length === 2) {
      const [a,b] = controls.map(n => n.getBoundingClientRect());
      gaps.push(Math.max(b.left-a.right,a.left-b.right,b.top-a.bottom,a.top-b.bottom));
    }
    const modal = root.getAttribute("role") === "dialog";
    const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
    const external = [...document.querySelectorAll('header.drag-region,[data-message-id],[data-testid=composer-editor]')]
      .filter((n) => !root.contains(n) && n.checkVisibility()).map((n) => {
        const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { name: n.tagName, area: area(painted, r),
          inert: Boolean(n.closest('[inert],[aria-hidden=true],[data-floating-ui-inert]')),
          blocked: hit === backdrop || root.contains(hit) };
      });
    const properModal = modal && Boolean(backdrop?.checkVisibility()) && external.every((e) => e.inert || e.blocked);
    const first = root.firstElementChild?.getBoundingClientRect();
    return { rect: rect.toJSON(), overlaps, gaps, external, modal, properModal,
      origin: root.scrollTop, firstTop: first?.top,
      inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
      viewport: { width: innerWidth, height: innerHeight } };
  });
  report.rows.push({ kind: "geometry", ...ctx, ...g });
  if (g.overlaps.length) fail(`a overlap ${JSON.stringify(ctx)} ${JSON.stringify(g.overlaps)}`);
  if (g.gaps.some((n) => n < 8)) fail(`a group separation ${JSON.stringify(ctx)} ${g.gaps}`);
  if ((ctx.state === "menu" || ctx.state === "first-use") && (!g.inside || g.origin !== 0 || g.firstTop < g.rect.top))
    fail(`f origin ${JSON.stringify(ctx)}`);
  if (g.scrollWidth > g.clientWidth + .5) fail(`f width ${JSON.stringify(ctx)}`);
  if (!g.properModal && g.external.some((e) => e.area > .5)) fail(`j ${JSON.stringify(ctx)} ${JSON.stringify(g.external)}`);
}

const fixtureRequests=new Map();let fixtureRequestId=900000;let activeFixtureSocket;
async function dispatchFixtureCommand(command) {
  if(!activeFixtureSocket)throw new Error('No fixture RPC connection');
  const id=String(fixtureRequestId++),pending=Promise.withResolvers();
  fixtureRequests.set(id,pending);
  activeFixtureSocket.send(JSON.stringify({_tag:'Request',id,tag:'orchestration.dispatchCommand',payload:command,headers:[]}));
  const exit=await bounded(pending.promise,"Fixture thread creation receipt");
  if(exit._tag!=='Success')throw new Error('Fixture create failed '+JSON.stringify(exit));
  return exit.value;
}
await page.routeWebSocket("**/*", (socket) => {
  const server = socket.connectToServer(), methods = new Map();
  activeFixtureSocket=server;
  socket.onClose(() => server.close()); server.onClose(() => socket.close());
  socket.onMessage(message => {
    const decoded=JSON.parse(String(message));
    for(const f of Array.isArray(decoded)?decoded:[decoded]) if(f._tag==='Request') methods.set(f.id,f.tag);
    server.send(message);
  });
  server.onMessage(message=>{
    const decoded=JSON.parse(String(message));
    const frames=[];
    for(const f of Array.isArray(decoded)?decoded:[decoded]) {
      const pending=fixtureRequests.get(String(f.requestId));
      if(pending&&f._tag==='Exit'){fixtureRequests.delete(String(f.requestId));pending.resolve(f.exit);}
      else frames.push(freezeCaptureServerFrame(f,methods.get(f.requestId)));
    }
    if(frames.length)socket.send(JSON.stringify(Array.isArray(decoded)?frames:frames[0]));
  });
});

const supplemental = { side, revision: (await Bun.$`git -C ${wt} rev-parse HEAD`.text()).trim(), asarSha256: report.asarSha256, screenshots: [], failures: [] };
const chooseThread = async title => {
  await page.locator('[data-sidebar="sidebar"]').getByText(title,{exact:true}).click();
  await page.waitForFunction(id=>location.hash.includes(id),title==='03 Code blocks'?'baseline-code':'baseline-messages');
  await page.locator('[data-testid="composer-editor"]').waitFor();
  await settle();
};
const openArchive = async () => {
  await click('button','설정'); await click('button','Archive');
  await page.getByRole('heading',{name:'No archived threads',exact:true}).waitFor(); await settle();
};
const section = () => page.getByRole('heading',{name:'No archived threads',exact:true}).locator('xpath=ancestor::section[1]');
const returnButton = () => page.getByRole('button',{name:'대화 목록으로 돌아가기',exact:true});
async function supplementalShot(file) {
  if(/(?:returned-list|archive-action-path)\.png$/.test(file)) {
    await page.mouse.move(500,500);
    const message=page.locator('[data-message-id]').first();
    await message.waitFor();
    await message.evaluate(n=>{
      for(let p=n.parentElement;p;p=p.parentElement)
        if(/auto|scroll/.test(getComputedStyle(p).overflowY)){
          p.scrollTop=0;return;
        }
      throw new Error('No conversation scroll owner');
    });
    await page.getByText('Show a TypeScript example and a shell command.',{exact:true}).waitFor();
    await page.locator('pre').first().waitFor();
    await page.waitForFunction(()=>{
      const message=document.querySelector('[data-message-id]');
      if(!message)return false;
      for(let p=message;p;p=p.parentElement)
        if(getComputedStyle(p).opacity!=='1')return false;
      return true;
    });
  }
  await shot(file);
  const record = report.screenshots.at(-1), dest = pk+'/supplemental/'+side+'/'+file;
  if (out !== pk+'/supplemental/'+side) {
    await fs.mkdir(dest.slice(0,dest.lastIndexOf('/')),{recursive:true});
    await fs.copyFile(out+'/'+file,dest);
  }
  supplemental.screenshots.push({...record,native:await win.evaluate(w=>({bounds:w.getBounds(),content:w.getContentBounds(),minimum:w.getMinimumSize()}))});
}
async function archiveThread(title) {
  const item=page.locator('[data-sidebar="sidebar"]').getByText(title,{exact:true});
  const confirmation=page.getByRole('alertdialog');
  const outcome=Promise.race([
    item.waitFor({state:'hidden'}).then(()=>false),
    confirmation.waitFor({state:'visible'}).then(()=>true),
  ]);
  await app.evaluate(({Menu}, title)=> {
    Menu.prototype.popup=function(){
      globalThis.hig17MenuItems=this.items.map(i=>({label:i.label,enabled:i.enabled,type:i.type}));
      const matches=this.items.filter(i=>i.label==='대화 보관');
      if(matches.length!==1)throw new Error('Archive menu unavailable for '+title);
      matches[0].click();
    };
  },title);
  await item.click({button:'right'});
  if(await outcome)await confirmation.getByRole('button',{name:'Confirm',exact:true}).click();
  await item.waitFor({state:'hidden'});
  report.rows.push({kind:'native-archive-menu',title,items:await app.evaluate(()=>globalThis.hig17MenuItems)});
}
try {
  await page.reload();
  await win.evaluate(w=>w.setContentSize(1280,800));
  await page.setViewportSize({width:1280,height:800});
  await page.getByText('컴퓨터 연결하기',{exact:true}).waitFor({timeout:30000});
  await click('button','계속하기'); await click('button','계속하기');
  await click('button','프로젝트 가져오지 않기');
  await click('button','프로젝트 추가',page.locator('[data-sidebar="sidebar"]'));
  await fs.mkdir(iso.workspace+'/baseline-project',{recursive:true});
  await page.getByText('로컬 폴더',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value==='~/');
  await page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]').fill(iso.workspace+'/');
  await page.getByText('baseline-project',{exact:true}).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole('button',{name:'프로젝트 변경',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  report.fixture=seed(iso); await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText('03 Code blocks',{exact:true}).waitFor();
  report.registrations=[];
  for(const id of ['baseline-code','baseline-messages'])
    report.registrations.push(await registerSeededThread(dispatchFixtureCommand,iso,id));
  seed(iso);await page.reload();
  await chooseThread('03 Code blocks');
  const selected=await page.evaluate(()=>location.hash);
  const draft='HIG17 unsent draft retained';
  await page.locator('[data-testid="composer-editor"]').fill(draft);
  for(const mode of ['light','dark']) {
    await click('button','설정'); await click('button','Appearance');
    await page.getByText(mode==='dark'?'Dark':'Light',{exact:true}).click();
    await page.waitForFunction(d=>document.documentElement.classList.contains('dark')===d,mode==='dark');
    await page.keyboard.press('Escape');
    await page.waitForFunction(route=>location.hash===route,selected);
    for(const size of (side==='after'?[[840,620],[1280,800],[1920,1080]]:[[1280,800],[1920,1080]])) {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w,[W,H])=>w.setContentSize(W,H),size);
      await page.setViewportSize({width:size[0],height:size[1]});
      const native=await win.evaluate(w=>({minimum:w.getMinimumSize(),bounds:w.getBounds(),content:w.getContentBounds()}));
      for(const scale of (side==='after'?[100,150]:[100])) {
        await page.evaluate(s=>{document.documentElement.style.fontSize=s+'%';},scale);
        await openArchive();
        const ctx={mode,size,scale,native};
        for(const state of (side==='after'?['empty','hover','focus','pressed']:['empty'])) {
          if(side==='after') {
            const b=returnButton(); await b.scrollIntoViewIfNeeded();
            if(state==='hover')await b.hover();
            if(state==='focus'){await b.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');}
            if(state==='pressed'){const r=await b.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();}
            await measure(section(),{...ctx,state});await geometry(section(),{...ctx,state});
            report.rows.push({kind:'ax',...ctx,state,snapshot:await section().ariaSnapshot()});
          }
          const file=size.join('x')+'/'+mode+'/'+scale+'-'+state+'.png';
          if(state==='empty'&&scale===100&&size[0]!==840)await supplementalShot(file); else await shot(file);
          if(state==='pressed'){await page.mouse.move(0,0);await page.mouse.up();}
        }
        if(side==='after') {
          await returnButton().focus();await page.keyboard.press('Enter');
          await page.waitForFunction(route=>location.hash===route,selected);
          const actualDraft=await page.locator('[data-testid="composer-editor"]').innerText();
          report.rows.push({kind:'return-context',...ctx,route:await page.evaluate(()=>location.hash),draft:actualDraft});
          if(actualDraft!==draft)fail('draft changed '+JSON.stringify(ctx));
          if(scale===100&&size[0]!==840)await supplementalShot(size.join('x')+'/'+mode+'/returned-list.png');
          for(const action of ['escape','tab-escape']) {
            await openArchive(); await returnButton().focus();
            if(action==='tab-escape')await page.keyboard.press('Tab');
            await settle();
            const transient=page.locator('[data-slot="tooltip-popup"],[role="menu"],[role="dialog"],[role="listbox"]').filter({visible:true});
            const transientBefore=await transient.count();
            await page.keyboard.press('Escape');
            await settle();
            if(await page.evaluate(()=>location.hash)!==selected) {
              const transientAfter=await transient.count();
              report.rows.push({kind:'escape-topmost',...ctx,state:action,transientBefore,transientAfter});
              if(!transientBefore||transientAfter)fail('e/g unexplained first Escape '+JSON.stringify(ctx));
              await page.keyboard.press('Escape');
            }
            await page.waitForFunction(route=>location.hash===route,selected);
            const editor=page.locator('[data-testid="composer-editor"]');await editor.waitFor();
            const value=await editor.innerText();
            const focused=await editor.evaluate(n=>n===document.activeElement||n.contains(document.activeElement));
            report.rows.push({kind:'escape-focus',...ctx,state:action,returned:value===draft,focused});
            if(value!==draft)fail('e/g return lost draft '+JSON.stringify(ctx));
          }
        } else {
          await page.keyboard.press('Escape');await page.waitForFunction(route=>location.hash===route,selected);
          await supplementalShot(size.join('x')+'/'+mode+'/returned-list.png');
        }
      }
      await page.evaluate(()=>{document.documentElement.style.fontSize='100%';});
      await supplementalShot(size.join('x')+'/'+mode+'/archive-action-path.png');
    }
  }
  await archiveThread('03 Code blocks'); await chooseThread('01 Conversation');await archiveThread('01 Conversation');
  await click('button','설정');await click('button','Archive');
  const rows=page.locator('[data-slot="settings-row"]').filter({has:page.getByRole('button',{name:'Unarchive',exact:true})});
  await rows.nth(1).waitFor();
  if(await returnButton().count())fail('populated archive retains empty CTA');
  for(const mode of ['light','dark']) {
    await click('button','Appearance');await page.getByText(mode==='dark'?'Dark':'Light',{exact:true}).click();
    await page.waitForFunction(d=>document.documentElement.classList.contains('dark')===d,mode==='dark');
    await click('button','Archive');await rows.nth(1).waitFor();
    for(const size of [[1280,800],[1920,1080]]) {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w,[W,H])=>w.setContentSize(W,H),size);await page.setViewportSize({width:size[0],height:size[1]});
      await supplementalShot(size.join('x')+'/'+mode+'/populated.png');
    }
  }
  const restore=page.locator('[data-slot="settings-row"]').filter({hasText:'03 Code blocks'});
  await restore.getByRole('button',{name:'Unarchive',exact:true}).click();await restore.waitFor({state:'hidden'});
  const routeBeforeUpdate=await page.evaluate(()=>location.hash);
  if(await rows.count()!==1)fail('restore did not preserve unrelated archived conversation');
  await page.keyboard.press('Escape');await chooseThread('03 Code blocks');
  const restored=await page.locator('pre').allTextContents();
  if(!restored.join('\n').includes('greeting'))fail('restored wrong conversation');
  report.rows.push({kind:'restore',routeBeforeUpdate,remaining:1,restored:'baseline-code',contentPreserved:true});
  report.applicability={disabled:'No disabled/loading/destructive return control; loading/error intentionally omit empty-state CTA.',modal:'No modal or popup added. Native menu item receipt records actual archive command; menu itself is OS-owned.',selection:'Unarchive remains in-place and does not change selected conversation.'};
  report.motion={properties:['opacity','transform'],note:'New return button lists compositor-only feedback properties; no new animated surface.'};
} catch(error) {
  report.debug={route:await page.evaluate(()=>location.hash),active:await page.evaluate(()=>document.activeElement?.outerHTML),menu:await app.evaluate(()=>globalThis.hig17MenuItems)};
  await shot('failure.png').catch(e=>fail('Failure screenshot '+e));report.error=String(error.stack??error);fail(report.error);
} finally {
  await app.close();report.cleanup='app.close completed';
  supplemental.closed=true;supplemental.failures=report.failures;
  await fs.mkdir(pk+'/supplemental/'+side,{recursive:true});
  await fs.writeFile(pk+'/supplemental/'+side+'/manifest.json',JSON.stringify(supplemental,null,2));
  await fs.writeFile(out+'/qa-measure.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({side,rows:report.rows.length,screenshots:report.screenshots.length,supplemental:supplemental.screenshots.length,failures:report.failures,counters:report.counters},null,2));
  process.exitCode=report.failures.length?1:0;
}
