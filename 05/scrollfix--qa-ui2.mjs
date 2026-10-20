// Adapted from qa-05-run/tools/qa-ui2.txt. Adds scroll ownership, full
// draft/text-size matrix, per-character wrap checks, and old-layout comparison.
export async function measureUi2({ page, context, home, theme, settle, frame, assert }) {
  const out = { matrix: [], failures: [], counters: {} };
  const editor = '[data-testid="composer-editor"]';
  const section = 'section[aria-label="첫 요청 제안"]';
  const choices = `${section} [role="group"] button`;
  const calm = async () => {
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running"), null, { timeout: 5000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const clear = async () => {
    await page.locator(editor).click();
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await settle();
  };
  const geometry = () => page.evaluate((selector) => {
    const s = document.querySelector(selector);
    const overlay = s.closest('[data-chat-composer-overlay]');
    const stack = s.closest('[data-chat-composer-stack]');
    const rect = n => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    };
    return {
      section: rect(s),
      headline: rect(stack.firstElementChild),
      composer: rect(document.querySelector('[data-chat-composer-form]')),
      cards: [...s.querySelectorAll('button[data-suggestion]')].map(rect),
      choices: [...s.querySelectorAll('[role="group"] button')].map(rect),
      headerBottom: document.querySelector('[data-chat-header]').getBoundingClientRect().bottom,
      scrollTop: overlay.scrollTop,
      scrollHeight: overlay.scrollHeight,
      clientHeight: overlay.clientHeight,
    };
  }, section);
  await home();
  for (const mode of ["light", "dark"]) {
    await theme(mode);
    for (const scale of [100, 150]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = scale + "%"; }, scale);
      for (const [w, h] of [[840, 620], [1280, 800], [1920, 1080]]) {
        await context.resize(w, h);
        await settle();
        for (const draft of [false, true]) {
          await clear();
          if (draft) {
            await page.keyboard.type("내가 쓰던 초안");
            await settle();
            await page.locator(`${section} button[data-suggestion="how-to-run"]`).click();
            await settle();
          }
          await page.mouse.move(2, 2);
          await page.evaluate(selector => {
            document.querySelector(selector).closest('[data-chat-composer-overlay]').scrollTop = 0;
          }, section);
          await calm();
          const rec = { mode, scale, w, h, draft, natural: await geometry() };
          // Recreate only the four pre-fix layout declarations in this packaged
          // renderer, then restore every inline attribute. Text/colours are real.
          await page.evaluate(selector => {
            const s = document.querySelector(selector);
            const stack = s.closest('[data-chat-composer-stack]');
            const overlay = s.closest('[data-chat-composer-overlay]');
            const nodes = [overlay, stack.parentElement, stack, stack.firstElementChild];
            window.__qaOldLayout = nodes.map(n => [n, n.getAttribute("style")]);
            Object.assign(overlay.style, { display: "flex", alignItems: "center", overflow: "visible", pointerEvents: "none" });
            stack.parentElement.style.height = "auto";
            Object.assign(stack.style, { display: "block", height: "auto" });
            Object.assign(stack.firstElementChild.style, { position: "absolute", left: "0", right: "0", bottom: "100%" });
          }, section);
          await calm();
          rec.oldLayout = await geometry();
          await page.evaluate(() => {
            for (const [n, value] of window.__qaOldLayout) {
              if (value === null) n.removeAttribute("style");
              else n.setAttribute("style", value);
            }
            delete window.__qaOldLayout;
          });
          await calm();
          rec.oldLayoutFit = rec.oldLayout.headline.y >= rec.oldLayout.headerBottom &&
            rec.oldLayout.composer.bottom <= h;
          if (rec.oldLayoutFit) {
            const pairs = [[rec.natural.section, rec.oldLayout.section], [rec.natural.composer, rec.oldLayout.composer]];
            rec.fitMaxDelta = Math.max(...pairs.flatMap(([a, b]) => ["x", "y", "w", "h"].map(k => Math.abs(a[k] - b[k]))));
            if (rec.fitMaxDelta > 0.5) out.failures.push({ mode, scale, w, draft, why: "fitted layout moved", delta: rec.fitMaxDelta });
          }
          await page.locator(section).evaluate(n => n.scrollIntoView({ block: "start", inline: "nearest" }));
          await calm();
          rec.afterScrollIntoView = await geometry();
          const g = rec.afterScrollIntoView;
          if (g.section.y < g.headerBottom - 0.5) out.failures.push({ mode, scale, w, draft, why: "section above header", g });
          if (g.section.bottom > g.composer.y + 0.5) out.failures.push({ mode, scale, w, draft, why: "section overlaps composer", g });
          rec.controls = [];
          const buttons = page.locator(`${section} button`);
          for (let i = 0; i < await buttons.count(); i++) {
            await buttons.nth(i).evaluate(n => n.scrollIntoView({ block: "nearest", inline: "nearest" }));
            await calm();
            const m = await buttons.nth(i).evaluate((n, scale) => {
              const r = n.getBoundingClientRect();
              const inset = 3 * scale / 100;
              const points = [[r.x + r.width / 2, r.y + r.height / 2], [r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]];
              const hits = points.map(([x,y]) => { const hit = document.elementFromPoint(x,y); return hit === n || n.contains(hit); });
              const header = document.querySelector('[data-chat-header]').getBoundingClientRect();
              const composer = document.querySelector('[data-chat-composer-form]').getBoundingClientRect();
              return { text: n.textContent, x: r.x, y: r.y, w: r.width, h: r.height, points, hits, font: getComputedStyle(n).fontSize,
                belowHeader: r.top >= header.bottom - 0.5, aboveComposer: r.bottom <= composer.top + 0.5,
                inViewport: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
            }, scale);
            rec.controls.push(m);
            if (!m.hits.every(Boolean) || !m.belowHeader || !m.aboveComposer || !m.inViewport)
              out.failures.push({ mode, scale, w, draft, why: "unreachable control", m });
          }
          rec.wrap = await page.evaluate(selector => {
            return [...document.querySelectorAll(`${selector} button[data-suggestion] > span, ${selector} > p`)].map(n => {
              const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
              const midWord = [];
              let prev = null;
              for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                for (let i = 0; i < text.textContent.length; i++) {
                  const ch = text.textContent[i];
                  if (!ch.trim()) { prev = null; continue; }
                  const range = document.createRange();
                  range.setStart(text, i); range.setEnd(text, i + 1);
                  const r = range.getBoundingClientRect();
                  if (!r.width) continue;
                  if (prev && Math.abs(prev.y - r.y) > 3) midWord.push(prev.ch + "|" + ch);
                  prev = { ch, y: r.y };
                }
              }
              return { text: n.textContent, midWord, wordBreak: getComputedStyle(n).wordBreak, textWrap: getComputedStyle(n).textWrap };
            });
          }, section);
          if (rec.wrap.length !== 5 || rec.wrap.some(m => m.midWord.length || m.wordBreak !== "keep-all" || m.textWrap !== "pretty"))
            out.failures.push({ mode, scale, w, draft, why: "wrap regression", wrap: rec.wrap });
          const key = `${mode}-${w}-${scale}-${draft ? "draft" : "empty"}`;
          await frame("qa-ui2-" + key);
          await page.evaluate(selector => {
            const overlay = document.querySelector(selector).closest('[data-chat-composer-overlay]');
            overlay.scrollTop = overlay.scrollHeight;
          }, section);
          await calm();
          rec.atEnd = await geometry();
          if (rec.atEnd.composer.bottom > h + 0.5) out.failures.push({ mode, scale, w, draft, why: "composer end unreachable", end: rec.atEnd });
          if (rec.atEnd.scrollTop) await frame("qa-ui2-" + key + "-end");
          if (draft) { await page.locator(choices).nth(2).click(); await settle(); }
          out.matrix.push(rec);
        }
      }
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await theme("light"); await context.resize(1280, 800); await settle(); await clear();
  await (await import("node:fs/promises")).writeFile(process.env.QA_OUT_UI, JSON.stringify(out, null, 2));
  assert("all 24 layout combinations measured", out.matrix.length, 24);
  assert("no clipping, hit, fit-position or wrap failures", out.failures, []);
}
