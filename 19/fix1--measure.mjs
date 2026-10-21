import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19-fix1-measure";
const packet="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const wt="/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19";
const qa="/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const bundle=`${packet}/after/app/weavra-desktop.app`;
const {seed,prepareCaptureProfile,installCaptureNetworkFixture}=await import(`${qa}/seed.mjs`);
const {_electron}=await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const base=await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-fix19-"));
const iso={base,home:`${base}/home`,workspace:`${base}/workspace`,app:`${base}/app`};
for(const dir of [iso.home,iso.workspace,iso.app])await fs.mkdir(dir);
prepareCaptureProfile(iso);
const report={
  revision:(await Bun.$`git -C ${wt} rev-parse HEAD`.text()).trim(),
  asarSha256:hash(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  scriptSha256:hash(await fs.readFile(new URL(import.meta.url))),
  korean:[],focus:[],checks:[],screenshots:[],failures:[],
  counters:{model:0,execution:0,externalNetwork:0},
};
const check=(id,pass,data={})=>{report.checks.push({id,pass,...data});if(!pass)report.failures.push({id,...data});};
const app=await _electron.launch({
  colorScheme:null,executablePath:`${bundle}/Contents/MacOS/weavra-desktop`,
  args:[`--user-data-dir=${iso.home}/chromium`,"--disable-background-networking"],
  env:{PATH:process.env.PATH,HOME:iso.home,TMPDIR:base,LANG:"en_US.UTF-8",WEAVRA_HOME:`${iso.home}/.weavra`,WEAVRA_APP_HOME:iso.app,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0",AWS_EC2_METADATA_DISABLED:"true"},
  timeout:45000,
});
const page=await app.firstWindow(),win=await app.browserWindow(page);
page.setDefaultTimeout(20000);
await installCaptureNetworkFixture(page);
await page.route("**/*",async route=>{
  const url=new URL(route.request().url());
  if(["http:","https:"].includes(url.protocol)&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname)){
    report.counters.externalNetwork++;await route.abort();
  }else await route.continue();
});
const cdp=await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.webSocketFrameSent",({response})=>{
  if(response.payloadData.includes("thread.turn.start"))report.counters.model++;
  if(/"(?:terminal\.create|terminal\.write|workflow\.prepare|workflow\.confirm|planner\.start)"/.test(response.payloadData))report.counters.execution++;
});
const click=(name,parent=page)=>parent.getByRole("button",{name,exact:true}).click();
const settle=async()=>{
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=="running"||!Number.isFinite(a.effect?.getComputedTiming().endTime)));
};
async function shot(file){
  const path=`${root}/${file}`;await fs.mkdir(path.slice(0,path.lastIndexOf("/")),{recursive:true});
  const bytes=await page.screenshot({path,scale:"css"});
  report.screenshots.push({file,sha256:hash(bytes),native:await win.evaluate(w=>({minimum:w.getMinimumSize(),bounds:w.getBounds(),content:w.getContentBounds()}))});
}
const NAME="새벽 숲속의 고요한 보라색 테마 이름이 아주 길어질 때에도 줄바꿈이 자연스러워야 합니다";
const preference=()=>page.evaluate(()=>Object.fromEntries(["t3code:theme","t3code:theme-appearance-mode","t3code:theme-halves:v1"].map(key=>[key,localStorage.getItem(key)])));
try{
  await win.evaluate(w=>w.setContentSize(1280,800));await page.setViewportSize({width:1280,height:800});
  await page.reload();await page.getByText("컴퓨터 연결하기",{exact:true}).waitFor({timeout:30000});
  await click("계속하기");await click("계속하기");await click("프로젝트 가져오지 않기");
  await click("프로젝트 추가",page.locator('[data-sidebar="sidebar"]'));
  await fs.mkdir(`${iso.workspace}/baseline-project`);
  await page.getByText("로컬 폴더",{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value==="~/");
  await page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]').fill(iso.workspace+"/");
  await page.getByText("baseline-project",{exact:true}).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await page.getByRole("button",{name:"프로젝트 변경",exact:true}).waitFor();await page.keyboard.press("Escape");
  seed(iso);await page.reload();await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks",{exact:true}).waitFor();
  await click("설정");await click("Appearance");
  const fixtures=[
    {version:1,id:"hig19-ko",name:NAME,appearance:"dark",colors:{accent:"#327a45"}},
    ...[["alpha","Alpha","#327a45"],["beta","Beta","#a03a8a"]].map(([id,label,accent])=>({
      version:1,id:`hig19-key-${id}`,name:`Keyboard ${label}`,appearance:"light",colors:{accent},
      variants:{dark:{accent}},collection:{id:"hig19-keyboard",label:"HIG19 keyboard"},
    })),
  ];
  for(const fixture of fixtures){
    await click("Add theme");const dialog=page.getByRole("dialog");
    await dialog.getByRole("textbox",{name:"Theme JSON",exact:true}).fill(JSON.stringify(fixture));
    await click("Add theme",dialog);await dialog.waitFor({state:"hidden"});
  }
  const koreanCard=page.locator('[data-theme-library-card="hig19-ko"]');
  const koreanTitle=koreanCard.getByRole("button",{name:`Use ${NAME} theme`,exact:true});
  const variantCard=page.locator('[data-theme-library-card]').filter({has:page.locator('[data-theme-variant-trigger="dark"]')});
  check("fixture-unique",await variantCard.count()===1&&await koreanTitle.count()===1);
  await page.mouse.move(1,1); // CDP renderer pointer only; never the owner's OS pointer.
  for(const theme of ["light","dark"]){
    await click(`Use ${theme} mode`);
    await page.waitForFunction(d=>document.documentElement.classList.contains("dark")===d,theme==="dark");
    for(const [width,height]of [[840,620],[1280,800],[1920,1080]]){
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await win.evaluate((w,size)=>w.setContentSize(...size),[width,height]);await page.setViewportSize({width,height});
      for(const scale of [100,150]){
        const context={theme,width,height,scale},prefix=`${width}x${height}/${theme}/${scale}`;
        await page.evaluate(s=>{document.documentElement.style.fontSize=`${s}%`;},scale);
        await koreanTitle.scrollIntoViewIfNeeded();await settle();
        const row=await koreanTitle.evaluate(button=>{
          const text=button.textContent.trim(),style=getComputedStyle(button),rect=button.getBoundingClientRect();
          const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT),chars=[];
          let offset=0;
          for(let node=walker.nextNode();node;node=walker.nextNode()){
            for(let i=0;i<node.data.length;i++){
              const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
              const r=range.getClientRects()[0];
              if(r&&/\S/.test(node.data[i]))chars.push({index:offset+i,char:node.data[i],line:Math.round(r.top*2)/2,rect:r.toJSON()});
            }offset+=node.data.length;
          }
          const lines=[...new Set(chars.map(c=>c.line))].sort((a,b)=>a-b).map(y=>chars.filter(c=>c.line===y).map(c=>c.char).join(""));
          const brokenWords=[...text.matchAll(/\S+/g)].filter(m=>new Set(chars.filter(c=>c.index>=m.index&&c.index<m.index+m[0].length).map(c=>c.line)).size>1).map(m=>m[0]);
          const orphans=lines.filter(line=>/^[가-힣]$/.test(line));
          let owner=button.parentElement;
          while(owner&&!/auto|scroll/.test(getComputedStyle(owner).overflowY))owner=owner.parentElement;
          const o=owner?.getBoundingClientRect()??{left:0,top:0,right:innerWidth,bottom:innerHeight};
          return {text,wordBreak:style.wordBreak,textWrap:style.textWrap,overflowWrap:style.overflowWrap,fontSize:parseFloat(style.fontSize),lines,brokenWords,orphans,rect:rect.toJSON(),
            clipped:button.scrollWidth>button.clientWidth+.5||button.scrollHeight>button.clientHeight+.5,
            inside:rect.left>=o.left&&rect.right<=o.right&&rect.top>=Math.max(0,o.top)&&rect.bottom<=Math.min(innerHeight,o.bottom),
            primaryOverflow:document.documentElement.scrollWidth>innerWidth,chars};
        });
        report.korean.push({...context,...row});
        check("korean-keep-all",row.wordBreak==="keep-all"&&row.textWrap==="pretty",{...context});
        check("korean-zero-midword-breaks",row.brokenWords.length===0,{...context,brokenWords:row.brokenWords,lines:row.lines});
        check("korean-zero-orphans",row.orphans.length===0,{...context,orphans:row.orphans});
        check("korean-fit",row.inside&&!row.clipped&&!row.primaryOverflow&&row.fontSize>=14,{...context,inside:row.inside,clipped:row.clipped,rect:row.rect});
        await shot(`${prefix}/korean-title.png`);
        for(const mode of ["light","dark"]){
          const trigger=variantCard.locator(`[data-theme-variant-trigger="${mode}"]`);
          await trigger.scrollIntoViewIfNeeded();await trigger.focus();
          await page.waitForFunction(mode=>document.querySelector(`[data-theme-variant-trigger="${mode}"]`)?.getAttribute("aria-expanded")==="true",mode);
          const options=variantCard.locator(`button[aria-label*=" for ${mode} mode"]`);
          const option=options.filter({hasNot:page.locator("[data-slot=selection-check]")}).first();
          await option.focus();await settle();
          const selectedBefore=await preference();
          const focusedBefore=await option.getAttribute("aria-label");
          await shot(`${prefix}/${mode}-option-focused.png`);
          const closed=page.waitForFunction(mode=>{
            const trigger=document.querySelector(`[data-theme-variant-trigger="${mode}"]`);
            const options=[...trigger.closest('[aria-label="Light and dark theme variants"]').querySelectorAll(`button[aria-label*=" for ${mode} mode"]`)];
            return document.activeElement===trigger&&trigger.getAttribute("aria-expanded")==="false"&&options.every(b=>b.disabled&&b.tabIndex===-1&&getComputedStyle(b).opacity==="0");
          },mode,{timeout:6000});
          let presses=1;await page.keyboard.press("Escape");await settle();
          if(await trigger.getAttribute("aria-expanded")==="true"){presses++;await page.keyboard.press("Escape");}
          await closed;await settle();
          const state=await trigger.evaluate(button=>({focusOnOpener:document.activeElement===button,name:button.getAttribute("aria-label"),opacity:getComputedStyle(button).opacity,expanded:button.getAttribute("aria-expanded"),route:location.hash}));
          const afterEscape=await preference();
          const optionsAfter=await options.evaluateAll(buttons=>buttons.map(b=>({name:b.getAttribute("aria-label"),disabled:b.disabled,tabIndex:b.tabIndex,opacity:getComputedStyle(b).opacity})));
          check("escape-focus-opener",state.focusOnOpener&&state.opacity!=="0"&&state.expanded==="false"&&state.route.includes("appearance"),{...context,mode,state,presses});
          check("escape-selection-preserved",JSON.stringify(selectedBefore)===JSON.stringify(afterEscape),{...context,mode});
          check("closed-options-disabled",optionsAfter.every(o=>o.disabled&&o.tabIndex===-1&&o.opacity==="0"),{...context,mode,optionsAfter});
          await shot(`${prefix}/${mode}-after-escape.png`);
          await variantCard.evaluate(card=>{
            window.__hig19Fix1Clicks=[];
            card.addEventListener("click",event=>{
              const button=event.target.closest("button");
              if(button)window.__hig19Fix1Clicks.push({name:button.getAttribute("aria-label"),trigger:button.getAttribute("data-theme-variant-trigger")});
            },{capture:true,once:true});
          });
          const clicked=page.waitForFunction(()=>window.__hig19Fix1Clicks.length===1,null,{timeout:5000});
          await page.keyboard.press("Enter");await clicked;await settle();
          const clicks=await page.evaluate(()=>window.__hig19Fix1Clicks);
          check("enter-never-hidden-option",clicks.length===1&&clicks[0].trigger===mode&&clicks[0].name!==focusedBefore,{...context,mode,clicks,focusedBefore});
          report.focus.push({...context,mode,focusedBefore,presses,state,selectedBefore,afterEscape,optionsAfter,clicks});
        }
      }
    }
  }
  check("exact-matrix",report.korean.length===12&&report.focus.length===24);
  check("zero-forbidden-counters",Object.values(report.counters).every(n=>n===0),{counters:report.counters});
}catch(error){report.failures.push({error:String(error),stack:error.stack});console.error(error);}
finally{
  await app.close();report.cleanup={closed:true};
  report.summary={revision:report.revision,asarSha256:report.asarSha256,koreanContexts:report.korean.length,focusContexts:report.focus.length,orphans:report.korean.reduce((n,r)=>n+r.orphans.length,0),midWordBreaks:report.korean.reduce((n,r)=>n+r.brokenWords.length,0),checks:report.checks.length,failures:report.failures.length,screenshots:report.screenshots.length,counters:report.counters,cleanup:report.cleanup};
  await fs.writeFile(`${root}/measurements.json`,JSON.stringify(report,null,2));
  await fs.writeFile(`${root}/summary.json`,JSON.stringify(report.summary,null,2));
}
console.log(`FIX1_MEASURE ${JSON.stringify(report.summary)}`);
if(report.failures.length)process.exitCode=1;
