import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

export async function runToolbarMeasurement({ page, win, app, cdp, report, out, settled }) {
  report.measurements = [];
  report.failures = [];
  report.stressFindings = [];
  report.geometryScope = "Native geometry: supported widths only. 390 is an unsupported-native stress diagnostic; W-33 content parity at 390 remains a required shared-runner check.";
  report.images = [];
  const check = (rule, name, pass, detail = {}) => {
    const stressGeometry = detail.width === 390 && ["a","b","c","d","f","g-h","h","i","j"].includes(rule);
    const row = { rule, name, pass: Boolean(pass), applicability: stressGeometry ? "unsupported-native-diagnostic" : "required", ...detail };
    report.measurements.push(row);
    if (!row.pass) (stressGeometry ? report.stressFindings : report.failures).push(row);
  };
  const initRequests = () => report.requests.filter(row => row.tag === "vcs.init");
  const click = (name) => page.getByRole("button", { name, exact: true }).click();
  async function resize(width, height) {
    if (width !== 390) await win.evaluate((window, size) => window.setContentSize(size.width, size.height), { width, height });
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const toolbar = document.querySelector("[data-git-toolbar]");
      const container = toolbar?.closest('[class~="@container/header-actions"]');
      return container && toolbar.dataset.compact === String(
        container.getBoundingClientRect().width < 48 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
    });
    await settled();
  }
  async function shot(file) {
    const bytes = await page.screenshot({ path: `${out}/${file}`, scale: "css" });
    report.images.push({
      file, sha256: createHash("sha256").update(bytes).digest("hex"),
      native: await win.evaluate(window => ({
        minimum: window.getMinimumSize(), bounds: window.getBounds(), content: window.getContentBounds(),
      })),
    });
  }
  async function theme(mode) {
    await page.evaluate(mode => window.desktopBridge.setTheme(mode), mode);
    await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, mode === "dark");
    await settled();
  }
  async function sidebar(legacy) {
    await page.evaluate(() => { document.documentElement.style.fontSize = "100%"; });
    await resize(1280, 800);
    const route = await page.evaluate(() => location.hash);
    await click("설정"); await click("General");
    const section = page.locator("#legacy-features");
    const disclosure = section.getByRole("button", { name: "Legacy features", exact: true });
    if (await disclosure.getAttribute("aria-expanded") !== "true") await disclosure.click();
    await section.getByRole("button", { name: "Legacy features", expanded: true, exact: true }).waitFor();
    await settled();
    const toggle = section.getByRole("switch", { name: "Sidebar (legacy)", exact: true });
    await toggle.scrollIntoViewIfNeeded(); await settled();
    const value = await toggle.evaluate(node =>
      node.getAttribute("aria-checked") === "true" || node.hasAttribute("data-checked"));
    if (value !== legacy) await toggle.click();
    await toggle.and(page.locator(legacy
      ? '[aria-checked="true"], [data-checked]'
      : '[aria-checked="false"], [data-unchecked]')).waitFor();
    await page.evaluate(route => { location.hash = route; }, route);
    await page.locator('[data-sidebar="sidebar"]').locator(legacy
      ? '[data-testid="new-thread-button"]'
      : '[data-testid="sidebar-row-card"], [data-testid="sidebar-row-slim"]').first().waitFor();
    await page.locator("[data-git-toolbar]").waitFor();
    await settled();
  }
  async function measure(context, menu = false) {
    await settled();
    const geometry = await page.evaluate(menu => {
      const rgba = value => {
        const context = document.createElement("canvas").getContext("2d");
        context.fillStyle = value; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const blend = (a, b) => a.slice(0, 3).map((value, index) =>
        value * a[3] / 255 + b[index] * (1 - a[3] / 255));
      const background = node => {
        const layers = [];
        for (let parent = node; parent; parent = parent.parentElement)
          layers.unshift(rgba(getComputedStyle(parent).backgroundColor));
        return layers.reduce((result, layer) => blend(layer, result), [255, 255, 255]);
      };
      const foreground = (color, node) => {
        const result = rgba(color);
        for (let parent = node; parent; parent = parent.parentElement)
          result[3] *= parseFloat(getComputedStyle(parent).opacity);
        return result;
      };
      const luminance = rgb => rgb.slice(0,3).map(value => {
        const value01 = value / 255;
        return value01 <= .04045 ? value01 / 12.92 : ((value01 + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const contrast = (a, b) => {
        const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
        return (values[0] + .05) / (values[1] + .05);
      };
      const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const nodes = [...document.querySelectorAll(
        '[data-git-toolbar] button,button[data-icon-control][aria-label^="오른쪽 패널 열기/닫기"],button[aria-label="터미널 서랍 열기/닫기"]' +
        (menu ? ',[role="menuitem"]' : ''),
      )].filter(node => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
      const controls = nodes.map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        const bg = background(node);
        const inset = node.hasAttribute("data-icon-control") ? 1 : 4;
        const points = [[rect.x+rect.width/2,rect.y+rect.height/2],[rect.left+inset,rect.top+inset],
          [rect.right-inset,rect.top+inset],[rect.left+inset,rect.bottom-inset],[rect.right-inset,rect.bottom-inset]];
        const icons = [...node.querySelectorAll("svg")].map(icon => ({
          rect: icon.getBoundingClientRect().toJSON(),
          contrast: contrast(blend(foreground(getComputedStyle(icon).color, icon), bg), bg),
        }));
        const labels = [], accessibilityOnlyLabels = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if (!text.textContent.trim()) continue;
          const textStyle = getComputedStyle(text.parentElement);
          const parentBox = text.parentElement.getBoundingClientRect();
          if (textStyle.position === "absolute" && parentBox.width <= 1 && parentBox.height <= 1 &&
              (textStyle.clip !== "auto" || textStyle.clipPath !== "none")) {
            accessibilityOnlyLabels.push({text:text.textContent,rect:parentBox.toJSON(),clip:textStyle.clip,clipPath:textStyle.clipPath});
            continue;
          }
          const range = document.createRange(); range.selectNodeContents(text);
          const box = range.getBoundingClientRect();
          if (box.width <= 1 || box.height <= 1) continue;
          const lines = new Map();
          for (let index=0; index<text.data.length; index++) {
            const glyph = document.createRange(); glyph.setStart(text,index); glyph.setEnd(text,index+1);
            const r = glyph.getClientRects()[0];
            if (r) lines.set(Math.round(r.top), (lines.get(Math.round(r.top)) ?? "")+text.data[index]);
          }
          labels.push({
            text: text.textContent, rect: box.toJSON(), fontSize: parseFloat(textStyle.fontSize),
            foreground: textStyle.color,
            contrast: contrast(blend(foreground(textStyle.color, text.parentElement), bg), bg),
            lines: [...lines.values()], wordBreak: textStyle.wordBreak,
            clipped: box.left < rect.left-.5 || box.right > rect.right+.5 ||
              box.top < rect.top-.5 || box.bottom > rect.bottom+.5,
            ellipsis: textStyle.textOverflow === "ellipsis",
            shapeIntersections: icons.map(icon => intersect(box,icon.rect)),
          });
        }
        return {
          name: node.getAttribute("aria-label") ?? node.textContent.trim(), rect: rect.toJSON(),
          touched: node.hasAttribute("data-icon-control") || node.closest("[data-git-toolbar]") !== null || node.getAttribute("role")==="menuitem",
          disabled: node.matches(":disabled,[aria-disabled=true],[data-disabled]"),
          hits: points.map(([x,y]) => {const hit=document.elementFromPoint(x,y);return hit===node||node.contains(hit);}),
          inside: rect.left>=0 && rect.top>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight,
          labels, accessibilityOnlyLabels, icons, borderVisible: parseFloat(style.borderWidth)>0 && rgba(style.borderColor)[3]>0,
          borderContrast: contrast(blend(foreground(style.borderColor,node),background(node.parentElement)),background(node.parentElement)),
          focusVisible: node.matches(":focus-visible"), shadow: style.boxShadow,
          ringContrast: contrast(rgba(style.getPropertyValue("--tw-ring-color") || style.color),background(node.parentElement)),
          ringSpreads: [...style.boxShadow.matchAll(/\)\s*(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)].map(match=>Number(match[4])),
          outlineWidth: parseFloat(style.outlineWidth), outlineContrast: contrast(rgba(style.outlineColor),background(node.parentElement)),
        };
      });
      return {
        controls, pageOverflow: document.documentElement.scrollWidth > innerWidth,
        timelineScrollOwners: [...document.querySelectorAll('[data-assistant-citation-viewport] *')]
          .filter(node => node.checkVisibility() && /auto|scroll/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight)
          .map(node => ({tag:node.tagName,class:node.className,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight})),
        compact: document.querySelector("[data-git-toolbar]").dataset.compact,
        overlaps: controls.flatMap((a,index) => controls.slice(index+1).map(b=>({
          names:[a.name,b.name],area:intersect(a.rect,b.rect),
        }))),
      };
    }, menu);
    report.measurements.push({ kind:"geometry", ...context, geometry });
    check("f","no-primary-page-overflow",!geometry.pageOverflow,context);
    check("f","one-timeline-scroll-owner",geometry.timelineScrollOwners.length<=1,{...context,owners:geometry.timelineScrollOwners});
    for (const row of geometry.controls) {
      if (!row.touched) continue;
      const detail={...context,control:row.name};
      check("a","minimum-target",row.rect.width>=36 && row.rect.height>=36,{...detail,rect:row.rect});
      if (!row.disabled) check("a","five-point-hit",row.hits.every(Boolean),{...detail,hits:row.hits});
      check("f","inside-viewport",row.inside,detail);
      for (const label of row.labels) {
        check("b","label-size",label.fontSize>=14,{...detail,label});
        check("c","label-contrast",label.contrast>=4.5,{...detail,label});
        check("d","no-Korean-orphan",label.lines.length<2 || !/^[가-힣][.?!]?$/.test(label.lines.at(-1).trim()),{...detail,label});
        check("i","label-not-clipped-or-ellipsized",!label.clipped&&!label.ellipsis,{...detail,label});
        check("j","label-shape-separation",label.shapeIntersections.every(area=>area===0),{...detail,label});
      }
      for (const icon of row.icons) check("h","icon-contrast",icon.contrast>=3,{...detail,icon});
      if (row.borderVisible) check("h","border-contrast",row.borderContrast>=3,{...detail,ratio:row.borderContrast});
      if (row.focusVisible) check("g-h","visible-focus",
        (row.outlineWidth>=2&&row.outlineContrast>=3)||(Math.max(...row.ringSpreads)>=3&&row.ringContrast>=3),
        {...detail,shadow:row.shadow,ratio:row.ringContrast,spreads:row.ringSpreads});
    }
    for (const overlap of geometry.overlaps) check("j","sibling-hit-areas",overlap.area===0,{...context,...overlap});
    if (context.state === "repository-menu") {
      const items=geometry.controls.filter(control=>control.labels.length>0);
      const enabled=items.filter(control=>!control.disabled).flatMap(control=>control.labels.map(label=>label.foreground));
      const disabled=items.filter(control=>control.disabled).flatMap(control=>control.labels.map(label=>label.foreground));
      check("e","disabled-actions-have-distinct-legible-ink",enabled.length>0&&disabled.length>0&&disabled.every(color=>!enabled.includes(color)),{...context,enabled,disabled});
      check("e","one-existing-enabled-command-after-init",items.filter(control=>!control.disabled).length===1,{...context,count:items.filter(control=>!control.disabled).length});
    }
  }
  const draft = "HIG21 저장하지 않은 초안과 선택을 유지해요";
  const editor = page.locator('[data-testid="composer-editor"]');
  await editor.fill(draft); await page.keyboard.press("Tab");
  for (const legacy of [false,true]) {
    await sidebar(legacy);
    for (const mode of ["light","dark"]) {
      await theme(mode);
      for (const scale of [100,150]) {
        await page.evaluate(scale => {document.documentElement.style.fontSize=`${scale}%`;},scale);
        await resize(1280,800);
        const breakpoint = await page.evaluate(() => {
          const container = document.querySelector("[data-git-toolbar]").closest('[class~="@container/header-actions"]');
          return Math.round(48*parseFloat(getComputedStyle(document.documentElement).fontSize)+innerWidth-container.getBoundingClientRect().width);
        });
        report.measurements.push({kind:"breakpoint",legacy,mode,scale,breakpoint});
        for (const [width,height] of [[840,620],[1024,768],[breakpoint-1,800],[breakpoint,800],[breakpoint+1,800],[1280,800],[1920,1080],[2560,1440],[390,844]]) {
          await resize(width,height);
          const context={legacy,mode,scale,width,height};
          await measure(context);
          if ([840,1280,1920,390].includes(width)) await shot(`${legacy?"legacy":"current"}-${mode}-${scale}-${width}.png`);
          check("e","resize-theme-keep-draft",await editor.innerText()===draft,context);
          check("e","no-auto-initialization",initRequests().length===0,context);
          if (width===840) {
            await click("Git 작업");
            await page.getByRole("menuitem",{name:"Git 초기화",exact:true}).waitFor();
            await measure({...context,state:"overflow"},true);
            await shot(`${legacy?"legacy":"current"}-${mode}-${scale}-840-overflow.png`);
            await page.keyboard.press("Escape");
            await page.getByRole("menuitem",{name:"Git 초기화",exact:true}).waitFor({state:"hidden"});
          }
        }
      }
    }
  }
  await page.evaluate(() => {document.documentElement.style.fontSize="100%";});
  await resize(1280,800);
  await page.keyboard.press("Tab");
  await page.getByRole("button",{name:"Git 초기화",exact:true}).focus();
  await measure({state:"wide-keyboard"});
  await shot("wide-keyboard.png");
  await resize(840,620);
  check("g","focus-crosses-to-overflow",await page.getByRole("button",{name:"Git 작업",exact:true}).evaluate(node=>node===document.activeElement));
  await measure({state:"compact-keyboard"});
  await shot("compact-keyboard.png");
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem",{name:"Git 초기화",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem",{name:"Git 초기화",exact:true}).waitFor({state:"hidden"});
  check("g","escape-returns-to-overflow",await page.getByRole("button",{name:"Git 작업",exact:true}).evaluate(node=>node===document.activeElement));
  await shot("escape-focus-return.png");
  await page.keyboard.press("Enter");
  const initOption=page.getByRole("menuitem",{name:"Git 초기화",exact:true});
  await initOption.waitFor();
  const closedByResize=initOption.waitFor({state:"hidden"});
  await resize(1280,800);
  await closedByResize;
  check("g","open-menu-closes-on-wide-resize",await initOption.count()===0);
  check("g","focus-crosses-to-direct-action",await page.getByRole("button",{name:"Git 초기화",exact:true}).evaluate(node=>node===document.activeElement));
  const panel=page.getByRole("button",{name:"오른쪽 패널 열기/닫기",exact:true});
  await page.keyboard.press("Tab"); await panel.focus();
  await measure({state:"panel-keyboard"}); await shot("panel-keyboard.png");
  const before=await panel.getAttribute("aria-pressed");
  await panel.click();
  await page.waitForFunction(before=>document.querySelector('button[aria-label="오른쪽 패널 열기/닫기"]').getAttribute("aria-pressed")!==before,before);
  await panel.click(); await settled();
  check("e","panel-restores-own-state",await panel.getAttribute("aria-pressed")===before);
  check("e","panel-does-not-initialize",initRequests().length===0);
  await resize(840,620); await click("Git 작업");
  await page.getByRole("menuitem",{name:"Git 초기화",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('button[aria-label="Git 작업 옵션"]'));
  await settled();
  check("e","one-explicit-initialization",initRequests().length===1,{requests:initRequests()});
  check("e","explicit-destination-is-fixture",initRequests()[0]?.cwd===report.isolation.workspace+"/baseline-project",{requests:initRequests()});
  await measure({state:"repository-initialized",width:840,height:620});
  await click("Git 작업 옵션");
  await page.getByRole("menu").waitFor(); await measure({state:"repository-menu",width:840,height:620},true);
  await shot("repository-menu.png");
  await page.keyboard.press("Escape"); await settled();
  await shot("repository-menu-closed.png");
  check("e","zero-model-runtime-outbound",report.requests.every(row=>
    !/thread\.turn\.start|weavra\.control|planner\./.test(row.tag)) && report.blockedOutbound===0);
  report.summary={
    rows:report.measurements.length,failures:report.failures.length,unsupportedStressFindings:report.stressFindings.length,images:report.images.length,
    checks:Object.fromEntries([...new Set(report.measurements.filter(row=>row.rule).map(row=>row.rule))]
      .map(rule=>[rule,{
        total:report.measurements.filter(row=>row.rule===rule).length,
        failed:report.measurements.filter(row=>row.rule===rule&&!row.pass&&row.applicability==="required").length,
        diagnosticFailed:report.measurements.filter(row=>row.rule===rule&&!row.pass&&row.applicability==="unsupported-native-diagnostic").length,
      }])),
  };
  await fs.writeFile(`${out}/summary.json`,JSON.stringify(report.summary,null,2));
  console.log(`TOOLBAR_MEASURE rows=${report.summary.rows} failures=${report.summary.failures} images=${report.summary.images}`);
  if (report.failures.length) throw new Error(`Toolbar measurement failed: ${report.failures.length} checks`);
}
