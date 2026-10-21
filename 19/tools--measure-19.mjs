import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
const side = process.argv[2] ?? "after";
const ruleAOnly = process.argv.includes("--rule-a");
if (!["before", "after"].includes(side)) throw new Error("Expected before or after");
const pk = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const wt = `/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-${side === "before" ? "19-before" : "19"}`;
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19/scripts/hig";
const out = `${pk}/measure-${ruleAOnly ? "rule-a-" : ""}${side}`;
const bundle = `${pk}/${side}/app/weavra-desktop.app`;
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { setNativeTheme, readRenderedBackground } = await import(`${qa}/cases.mjs`);
const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const hash = b => createHash("sha256").update(b).digest("hex");
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-m19-"));
const iso = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const dir of [iso.home, iso.workspace, iso.app]) await fs.mkdir(dir);
prepareCaptureProfile(iso);
const report = {
  scope: ruleAOnly ? "rule-a-with-supporting-geometry-and-contrast" : "appearance-self-measurement",
  excluded: ruleAOnly ? ["System native theme scenario held for runner fix", "import/editor journey outside rule-a retest"] : [],
  side, revision: (await Bun.$`git -C ${wt} rev-parse HEAD`.text()).trim(),
  scriptSha256: hash(await fs.readFile(new URL(import.meta.url))),
  asarSha256: hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  rows: [], screenshots: [], failures: [], counters: { model: 0, execution: 0, externalNetwork: 0 },
};
const check = (name, ok, data = {}) => {
  report.rows.push({ check: name, pass: ok, ...data });
  if (!ok && side === "after") report.failures.push({ name, ...data });
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
  await root.scrollIntoViewIfNeeded();
  await settle();
  const result = await root.evaluate(root => {
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
    const nodes = [...root.querySelectorAll('button[aria-pressed],button[aria-label^="Use "],button[aria-label^="Choose "],button[aria-label^="Follow "]')].filter(n => n.checkVisibility() && Number(getComputedStyle(n).opacity) > 0);
    const owner = n => {
      for (let p=n.parentElement;p;p=p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
      return document.documentElement;
    };
    const rows = nodes.map(n => {
      const r = n.getBoundingClientRect(), s = getComputedStyle(n), bg = background(n);
      const o = owner(n).getBoundingClientRect();
      const label = [...n.querySelectorAll("span")].find(x => x.textContent.trim() && !x.querySelector("span") && !x.closest("[aria-hidden]"));
      const lineMap = new Map(), walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t=walker.nextNode();t;t=walker.nextNode()) for(let i=0;i<t.data.length;i++) {
        const range=document.createRange();range.setStart(t,i);range.setEnd(t,i+1);const rr=range.getClientRects()[0];
        if(rr)lineMap.set(Math.round(rr.top),(lineMap.get(Math.round(rr.top))??"")+t.data[i]);
      }
      const lines=[...lineMap.values()], text = n.textContent.trim();
      const canvas=document.createElement("canvas").getContext("2d");canvas.font=s.font;
      return {
        name:n.getAttribute("aria-label"),rect:r.toJSON(),text,lines,
        selected:n.getAttribute("aria-pressed")==="true",check:Boolean(n.querySelector("[data-slot=selection-check],svg.lucide-check")),
        shadow:s.boxShadow,background:s.backgroundColor,foreground:ink(n),bg,
        labelWidth:Math.max(0,...lines.map(l=>canvas.measureText(l).width)),
        fontSize:parseFloat(getComputedStyle(label??n).fontSize),
        textContrast:contrast(blend(ink(label??n),bg),bg),
        borderWidth:parseFloat(s.borderWidth),border:s.borderColor,
        borderContrast:Math.min(contrast(blend(rgba(s.borderColor),bg),bg),contrast(blend(rgba(s.borderColor),background(n.parentElement)),background(n.parentElement))),
        focus:n===document.activeElement,focusVisible:n.matches(":focus-visible"),
        outline:parseFloat(s.outlineWidth),outlineContrast:contrast(rgba(s.outlineColor).slice(0,3),background(n.parentElement)),
        icons:[...n.querySelectorAll("svg")].map(i=>({contrast:contrast(blend(ink(i),background(i.parentElement)),background(i.parentElement)),size:i.getBoundingClientRect().width})),
        orphan:lines.length>1 && /^[가-힣]$/.test(lines.at(-1).trim()),
        clipped:n.scrollWidth>n.clientWidth+.5 || (label && label.scrollWidth>label.clientWidth+.5),
        ellipsis:s.textOverflow==="ellipsis",transition:s.transitionProperty,
        cornerRadius:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius],
        inside:r.left>=o.left && r.right<=o.right && r.top>=Math.max(0,o.top) && r.bottom<=Math.min(innerHeight,o.bottom),
        hits:[[r.x+r.width/2,r.y+r.height/2],[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4]].map(([x,y])=>{const h=document.elementFromPoint(x,y);return n===h||n.contains(h);}),
        hitDetails:[[r.x+r.width/2,r.y+r.height/2],[r.left+4,r.top+4],[r.right-4,r.top+4],[r.left+4,r.bottom-4],[r.right-4,r.bottom-4]].map(([x,y])=>{
          const h=document.elementFromPoint(x,y);
          return {x,y,matched:n===h||n.contains(h),tag:h?.tagName,name:h?.getAttribute("aria-label"),className:h?.getAttribute("class")};
        }),
      };
    });
    const owners = new Set();
    for(let p=root.parentElement;p;p=p.parentElement) if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight)owners.add(p);
    return {rows,owners:owners.size,pageOverflow:document.documentElement.scrollWidth>innerWidth,rootOverflow:root.scrollWidth>root.clientWidth};
  });
  check("f/one-scroll-owner",result.owners===1,{...context,owners:result.owners});
  check("f/no-horizontal-overflow",!result.pageOverflow&&!result.rootOverflow,{...context,pageOverflow:result.pageOverflow,rootOverflow:result.rootOverflow});
  for(const row of result.rows){
    const data={...context,row}; report.rows.push({...data,kind:"computed"});
    check("a/target",row.rect.height>=36&&row.rect.width>=36,data);
    if(row.inside)check("a/five-point-hit",row.hits.every(Boolean),data);
    if(row.text) {
      check("b/text-size",row.fontSize>=14,data);check("c/text-contrast",row.textContrast>=4.5,data);
      check("d/orphan",!row.orphan,data);check("i/no-clipping",!row.clipped&&!row.ellipsis,data);
    }
    if(row.borderWidth>0)check("h/control-border",row.borderContrast>=3,data);
    check("h/icons",row.icons.every(i=>i.contrast>=3),data);
    if(row.focusVisible)check("g-h/focus",row.outline>=2&&row.outlineContrast>=3,data);
    if(row.selected)check("e/selected-wash-check",row.check&&!row.shadow.includes("inset")&&row.background!=="rgba(0, 0, 0, 0)",data);
    check("f/strict-fit",row.inside,data);
  }
  for(let a=0;a<result.rows.length;a++)for(let b=a+1;b<result.rows.length;b++){
    const x=result.rows[a].rect,y=result.rows[b].rect;
    const area=Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
    check("j/no-overlap",area===0,{...context,area,names:[result.rows[a].name,result.rows[b].name]});
  }
}
try {
  await page.reload();
  await win.evaluate(w=>w.setContentSize(1280,800));await page.setViewportSize({width:1280,height:800});
  await page.getByText("컴퓨터 연결하기",{exact:true}).waitFor({timeout:30000});
  await click("button","계속하기");await click("button","계속하기");await click("button","프로젝트 가져오지 않기");
  await click("button","프로젝트 추가",page.locator('[data-sidebar="sidebar"]'));
  await fs.mkdir(`${iso.workspace}/baseline-project`);
  await page.getByText("로컬 폴더",{exact:true}).click();
  const folder=page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]');
  await page.waitForFunction(()=>document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value==="~/");
  await folder.fill(iso.workspace+"/");await page.getByText("baseline-project",{exact:true}).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button",{name:"프로젝트 변경",exact:true}).waitFor();await page.keyboard.press("Escape");
  seed(iso);await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks",{exact:true}).waitFor();
  await click("button","설정");await click("button","Appearance");
  const modes=page.getByRole("group",{name:"Appearance mode",exact:true});
  for(const theme of ["light","dark"]){
    await click("button",`Use ${theme} mode`);
    await page.waitForFunction(d=>document.documentElement.classList.contains("dark")===d,theme==="dark");
    for(const [width,height]of [[840,620],[1280,800],[1920,1080]]){
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w,size)=>w.setContentSize(...size),[width,height]);await page.setViewportSize({width,height});
      for(const scale of side==="after"?[100,150]:[100]){
        const ctx={theme,width,height,scale};const prefix=`${width}x${height}/${theme}/${scale}`;
        await page.evaluate(s=>{document.documentElement.style.fontSize=`${s}%`;},scale);
        await modes.scrollIntoViewIfNeeded();await shot(`${prefix}-default.png`);await measure(modes,{...ctx,state:"default"});
        const selected=page.getByRole("button",{name:`Use ${theme} mode`,exact:true});
        await selected.focus();await page.keyboard.press("Tab");
        const selection=await selected.getAttribute("aria-pressed");
        check("e-g/focus-independent",selection==="true",ctx);
        await measure(modes,{...ctx,state:"other-focused"});await shot(`${prefix}-other-focused.png`);
        await page.evaluate(()=>{document.documentElement.style.filter="grayscale(1)";});
        await shot(`${prefix}-grayscale.png`);await page.evaluate(()=>{document.documentElement.style.filter="";});
        await selected.hover();await measure(modes,{...ctx,state:"hover"});
        await page.mouse.down();await measure(modes,{...ctx,state:"pressed"});await page.mouse.up();
        const card=page.locator('[data-theme-library-card="default"]');
        await measure(card,{...ctx,state:"preview"});await shot(`${prefix}-preview.png`);
      }
    }
  }
  if (!ruleAOnly) {
  await page.evaluate(()=>{document.documentElement.style.fontSize="100%";});
  await win.evaluate(w=>w.setContentSize(1280,800));await page.setViewportSize({width:1280,height:800});
  await click("button","Follow the system appearance");
  await page.evaluate(()=>window.desktopBridge.setTheme("system"));
  for(const [index,mode] of ["light","dark","light"].entries()){
    await setNativeTheme(app,page,mode);
    console.log("SYSTEM",mode,await app.evaluate(({nativeTheme})=>({source:nativeTheme.themeSource,dark:nativeTheme.shouldUseDarkColors})),await page.evaluate(()=>({media:matchMedia("(prefers-color-scheme: dark)").matches,mode:localStorage.getItem("t3code:theme-appearance-mode"),classes:document.documentElement.className})));
    await page.waitForFunction(d=>document.documentElement.classList.contains("dark")===d,mode==="dark");
    check("e/system-live-selection",await page.getByRole("button",{name:"Follow the system appearance",exact:true}).getAttribute("aria-pressed")==="true",{mode});
    await modes.scrollIntoViewIfNeeded();await shot(`system-${index}-${mode}.png`);
  }
  await click("button","Add theme");
  const dialog=page.getByRole("dialog");
  await dialog.getByRole("textbox",{name:"Theme JSON",exact:true}).fill(JSON.stringify({version:1,id:"hig19-custom",name:"HIG19 custom",appearance:"dark",colors:{accent:"#327a45"}}));
  await click("button","Add theme",dialog);await dialog.waitFor({state:"hidden"});
  const imported=page.locator('[data-theme-library-card="hig19-custom"]');
  await imported.waitFor();await measure(imported,{theme:"custom",width:1280,height:800,scale:100,state:"imported"});
  await shot("imported-custom.png");
  const paletteBefore=await page.evaluate(readRenderedBackground);
  await click("button","Create theme");await page.getByLabel("Create theme",{exact:true}).waitFor();
  await settle();
  const paletteAfter=await page.evaluate(readRenderedBackground);
  check("e/editor-rendered-palette",JSON.stringify(paletteBefore)===JSON.stringify(paletteAfter),{paletteBefore,paletteAfter});
  await shot("custom-editor.png");
  await click("button","Close the theme editor");
  check("g/editor-close-preserves-selection",await imported.getByRole("button",{name:"Use HIG19 custom dark mode",exact:true}).getAttribute("aria-pressed")==="true");
  }
  check("zero-model-execution-network",Object.values(report.counters).every(n=>n===0),{counters:report.counters});
} catch(error) {
  report.failures.push({error:String(error),stack:error.stack});console.error(error);
} finally {
  await app.close();report.cleanup={closed:true};
  const computed=report.rows.filter(row=>row.kind==="computed").map(row=>row.row);
  report.summary={
    rows:report.rows.length,screenshots:report.screenshots.length,failures:report.failures.length,
    checks:Object.fromEntries([...new Set(report.rows.filter(row=>row.check).map(row=>row.check))].map(name=>[name,{
      total:report.rows.filter(row=>row.check===name).length,
      failed:report.rows.filter(row=>row.check===name&&!row.pass).length,
    }])),
    hitFailuresByControl:Object.fromEntries([...new Set(report.failures.filter(row=>row.name==="a/five-point-hit").map(row=>row.row.name))].map(name=>[name,report.failures.filter(row=>row.name==="a/five-point-hit"&&row.row.name===name).length])),
    minimumTextContrast:Math.min(...computed.filter(row=>row.text).map(row=>row.textContrast)),
    minimumBorderContrast:Math.min(...computed.filter(row=>row.borderWidth>0).map(row=>row.borderContrast)),
    minimumTextSize:Math.min(...computed.filter(row=>row.text).map(row=>row.fontSize)),
  };
  await fs.writeFile(`${out}/measurements.json`,JSON.stringify(report,null,2));
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(report.summary,null,2));
}
console.log(`MEASURE_${side} rows=${report.rows.length} PNGs=${report.screenshots.length} failures=${report.failures.length}`);
if(report.failures.length)process.exitCode=1;
