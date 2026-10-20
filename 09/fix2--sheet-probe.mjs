// Derived from qa-09-run/tools/qa-case-09.js, qa-sheet.
// Uses the same packaged Electron fixture; adds all matrix cells and all-row hits.
export async function measureSheet({ assert, page, context, settle, frame, home, thread, theme, named }) {
  const fs = await import("node:fs/promises");
  const results = [];
  const probe = () => {
    const menu = document.querySelector('[role="menu"][aria-label="패널 열기"]');
    if (!menu) return { found: false };
    const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom });
    const ancestors = [];
    for (let n = menu.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/auto|scroll|overlay/.test(cs.overflowY))
        ancestors.push({ ...rect(n.getBoundingClientRect()), scrollTop: n.scrollTop, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight });
    }
    const rows = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => {
      const r = el.getBoundingClientRect();
      let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n), p = n.getBoundingClientRect();
        if (cs.overflowY !== "visible") { top = Math.max(top, p.top); bottom = Math.min(bottom, p.bottom); }
        if (cs.overflowX !== "visible") { left = Math.max(left, p.left); right = Math.min(right, p.right); }
      }
      const hits = [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].map(([x,y]) => {
        const hit = document.elementFromPoint(r.left + r.width*x, r.top + r.height*y);
        return hit !== null && el.contains(hit);
      });
      return { text: el.innerText.replace(/\s+/g," ").trim(), rect: rect(r), fullyVisible: r.top >= top-.5 && r.bottom <= bottom+.5 && r.left >= left-.5 && r.right <= right+.5, hits };
    });
    return { found: true, viewport: [innerWidth, innerHeight], menu: rect(menu.getBoundingClientRect()), wrapper: rect(menu.parentElement.getBoundingClientRect()), scroll: ancestors[0], rows };
  };
  const scroll = (value) => {
    const menu = document.querySelector('[role="menu"][aria-label="패널 열기"]');
    for (let n = menu.parentElement; n; n = n.parentElement) {
      if (/auto|scroll|overlay/.test(getComputedStyle(n).overflowY)) { n.scrollTop = value; return; }
    }
  };
  const run = async (state) => {
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      for (const [width,height] of [[840,620],[1280,800],[1920,1080]]) {
        for (const scale of [1,1.5]) {
          await context.resize(width,height);
          await page.evaluate((s) => { document.documentElement.style.fontSize = s === 1 ? "" : `${16*s}px`; }, scale);
          await settle();
          await page.evaluate(scroll,0);
          await settle();
          const top = await page.evaluate(probe);
          assert(`${state}/${mode}/${width}/${scale} launcher exists`, top.found, true);
          const id = `${state}-${mode}-${width}x${height}-x${scale}`;
          await frame(`fix2-sheet-${id}-top`);
          const perRow = [];
          for (let i = 0; i < top.rows.length; i++) {
            await page.evaluate((index) => {
              document.querySelector('[role="menu"][aria-label="패널 열기"]').querySelectorAll('[role="menuitem"]')[index].scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
            }, i);
            await settle();
            const current = await page.evaluate(probe);
            perRow.push({ index: i, scrollTop: current.scroll.scrollTop, ...current.rows[i] });
          }
          await page.evaluate(scroll,Number.MAX_SAFE_INTEGER);
          await settle();
          const end = await page.evaluate(probe);
          await frame(`fix2-sheet-${id}-end`);
          // Compare the original centring on this same DOM only when it fits.
          // Restore before leaving the cell; screenshots above are always product CSS.
          const fitComparison = await page.evaluate(() => {
            const menu = document.querySelector('[role="menu"][aria-label="패널 열기"]'), wrap = menu.parentElement, root = wrap.parentElement;
            const fit = wrap.offsetHeight <= root.clientHeight - parseFloat(getComputedStyle(root).paddingTop) - parseFloat(getComputedStyle(root).paddingBottom);
            root.scrollTop = 0;
            const before = wrap.getBoundingClientRect();
            const rs = root.style.alignItems, mt = wrap.style.marginTop, mb = wrap.style.marginBottom;
            root.style.alignItems = "center"; wrap.style.marginTop = "0px"; wrap.style.marginBottom = "0px";
            const original = wrap.getBoundingClientRect();
            const delta = { x: before.x-original.x, y: before.y-original.y, width: before.width-original.width, height: before.height-original.height };
            const first = menu.querySelector('[role="menuitem"]'), r = first.getBoundingClientRect(), clip = root.getBoundingClientRect();
            const originalFirst = { top: r.top, scrollportTop: clip.top, fullyVisible: r.top >= clip.top-.5 && r.bottom <= clip.bottom+.5, centreHit: first.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) };
            root.style.alignItems = rs; wrap.style.marginTop = mt; wrap.style.marginBottom = mb;
            return { fits: fit, delta, originalFirst };
          });
          results.push({state,mode,width,height,scale,top,end,perRow,fitComparison});
          await fs.writeFile(`${process.env.QA09_OUT}/sheet.json`,JSON.stringify(results,null,2));
          assert(`${id} scroll origin`,top.scroll.scrollTop,0);
          assert(`${id} first row fully visible`,top.rows[0].fullyVisible,true);
          assert(`${id} all rows reachable`,perRow.every(r=>r.fullyVisible && r.hits.every(Boolean)),true);
          if (fitComparison.fits) assert(`${id} original fit geometry`,Object.values(fitComparison.delta).every(d=>Math.abs(d)<.01),true);
          if (width === 840 && scale === 1.5) assert(`${id} original centring negative control`,fitComparison.originalFirst.fullyVisible,false);
          await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
          await context.resize(1280,800);
          await settle();
        }
      }
    }
  };
  for (const state of ["draft","thread"]) {
    if (state === "draft") await home(); else await thread("03 Code blocks");
    const toggle = await named(page,"button","panel");
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await settle();
    await page.getByRole("heading",{name:"패널 열기"}).waitFor();
    await run(state);
  }
  assert("full sheet matrix",results.length,24);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await context.resize(1280,800);
  await theme("light");
  await home();
  const toggle = await named(page,"button","panel");
  if (await toggle.getAttribute("aria-pressed") === "true") await toggle.click();
  await settle();
}
