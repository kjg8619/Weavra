// Todo 22 self-measurement (rules a-j) over every reachable Korean authored label.
// Host: packaged app only (HIG_MEASURE_APP), isolated profile, shared runner seed.
// Usage: bun --preload tools/preload-app-gate.mjs tools/measure-22.mjs
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";

const root = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees";
const qa = `${root}/hig-01/scripts/hig`;
const packet = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22";
const bundle = process.env.HIG_MEASURE_APP ?? `${packet}/after/app/weavra-desktop.app`;
const out = process.env.HIG_MEASURE_OUT ?? `${packet}/measure-after`;
const source = process.env.HIG_MEASURE_REPO ?? `${root}/hig-22`;
const quick = process.env.HIG_MEASURE_QUICK === "1";
const allText = process.env.HIG_MEASURE_ALLTEXT === "1";
// Diagnostic probe: light theme, 840x620 only, Diagnostics only, a screenshot at every scroll step.
const probe = process.env.HIG_MEASURE_PROBE === "1";
// Locale sweep: at every measured surface, run the runner's own label reader and classifier
// (scripts/hig/cases.mjs readLocaleLabels/auditLocaleLabels/localeSources) and collect every
// unclassified row once, so all remaining gaps come back in one report.
const localeSweep = process.env.HIG_MEASURE_LOCALE === "1";
const { seed, prepareCaptureProfile, installCaptureNetworkFixture } = await import(`${qa}/seed.mjs`);
const { bounded } = await import(`${qa}/assert.mjs`);
const { readLocaleLabels, auditLocaleLabels, localeSources } = await import(`${qa}/cases.mjs`);
const { _electron } = await import(`${root}/hig-01/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
await fs.mkdir(out, { recursive: true });
const base = await fs.realpath(await fs.mkdtemp("/tmp/weavra-hig-measure22-"));
const isolation = { base, home: `${base}/home`, workspace: `${base}/workspace`, app: `${base}/app` };
for (const path of [isolation.home, isolation.workspace, isolation.app, `${isolation.workspace}/baseline-project`])
  await fs.mkdir(path);
prepareCaptureProfile(isolation);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  asarSha256: sha(await fs.readFile(`${bundle}/Contents/Resources/app.asar`)),
  bundle, isolation, measurements: [], failures: [], images: [], cleanup: null,
};
report.head = (await Bun.$`GIT_MASTER=1 git -C ${source} rev-parse HEAD`.text()).trim();
const sourceDiff = await Bun.$`GIT_MASTER=1 git -C ${source} diff HEAD --`.text();
report.trackedDiffSha256 = sha(sourceDiff);
report.diagnostic = sourceDiff.length > 0 || quick || probe || localeSweep;
report.scriptSha256 = sha(await fs.readFile(new URL(import.meta.url)));

// Lead-approved Latin segment classes (2026-10-21 decision on runner-alias-request.md section E).
const ALLOWED = {
  "product/brand": ["Weavra", "Codex", "Claude", "Cursor", "Grok", "OpenCode", "Antigravity", "SnapShots", "GitHub", "GitLab", "Bitbucket", "Forgejo", "Gitea", "Google", "Gemini", "MagicDNS", "Xcode", "VoiceOver", "Android", "Windows", "Linux", "macOS", "iOS", "Grove", "Ocean", "Ember", "Iris", "Niri", "Hyprland", "Omarchy"],
  "tool/VCS": ["Git", "Mercurial", "Jujutsu", "Tailscale"],
  "protocol/format/acronym": ["HTTPS", "URL", "API", "SSH", "WSL", "CLI", "JSON", "QR", "CPU", "GPU", "PID", "HTTP", "RGB", "OTEL", "MCP"],
  "Weavra component": ["Runtime", "Kernel"],
};
// Approved multi-word names (Amendments 2026-10-22c/d): matched as whole phrases before segmenting.
// Data values observed on audited surfaces, not authored copy: system font family names (appearance font
// pickers) and the seeded fixture model display name (default model picker).
const DATA_VALUES = ["SF Pro", "Menlo", "Claude Fable 5.1"];
const PHRASES = ["Azure DevOps", "Vertex AI", "GitHub Copilot", "Claude Code", "T3 Connect", "T3 Chat", "Tailscale Serve", "Android Studio", "Face ID", "Liquid Glass", "VS Code", "Mac mini"];
const FIXTURE = /^(baseline-project|0[1-6] (Conversation|Long messages|Code blocks|Working fixture|Error fixture|Empty thread)|Baseline review|greeting|Claude Fable 5\.1)$/;
// Seeded fixture values that appear inside composite labels (thread rows, banners) are data, not authored copy.
const FIXTURE_PARTS = ["baseline-project", "01 Conversation", "02 Long messages", "03 Code blocks", "04 Working fixture", "05 Error fixture", "06 Empty thread", "Capture fixture: provider unavailable. No external request was sent.", "HIG fixture requires codex login", "Baseline review", "greeting"];
report.allowedSegments = ALLOWED;
report.allowedPhrases = PHRASES;
report.dataValues = DATA_VALUES;

const rows = [];
const check = (rule, name, pass, detail = {}) => {
  const row = { rule, name, pass: Boolean(pass), ...detail };
  rows.push(row);
  if (!row.pass) report.failures.push(row);
};

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
const requestTags = new Map();
let liveConfig = null;
cdp.on("Network.webSocketFrameSent", ({ response }) => {
  try {
    const decoded = JSON.parse(response.payloadData);
    for (const frame of Array.isArray(decoded) ? decoded : [decoded])
      if (frame._tag === "Request") { report.requests.push({ tag: frame.tag }); requestTags.set(String(frame.id), frame.tag); }
  } catch {}
});
cdp.on("Network.webSocketFrameReceived", ({ response }) => {
  try {
    const decoded = JSON.parse(response.payloadData);
    for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
      const method = requestTags.get(String(frame.requestId));
      if (method === "server.getConfig" && frame.exit?._tag === "Success") liveConfig = frame.exit.value;
      if (method === "subscribeServerConfig" && frame._tag === "Chunk")
        for (const value of frame.values ?? []) if (value.type === "snapshot") liveConfig = value.config;
    }
  } catch {}
});
report.localeSweep = { rows: [], audits: 0 };
page.setDefaultTimeout(15000);
report.network = await installCaptureNetworkFixture(page);
report.blockedOutbound = 0;
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    report.blockedOutbound++;
    await route.abort();
  } else await route.fallback();
});
const settled = () => bounded(page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.allSettled(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}), "measure settle", 20000);
const button = (name) => page.getByRole("button", { name, exact: true });
// Head names first, parent (pre-translation) names second; exactly one must exist.
const NAMES = {
  legacyFeatures: ["레거시 기능", "Legacy features"],
  legacySidebar: ["레거시 사이드바", "Sidebar (legacy)"],
  addProvider: ["공급자 추가", "Add provider"],
  customModel: ["사용자 지정 모델 추가", "Add custom model"],
  runGraph: ["실행 그래프", "Run 그래프"],
};
async function pick(role, key, scope = page) {
  for (const name of NAMES[key]) {
    const locator = scope.getByRole(role, { name, exact: true });
    if (await locator.count()) return locator;
  }
  return scope.getByRole(role, { name: NAMES[key][0], exact: true });
}

async function resize(width, height) {
  await win.evaluate((w, s) => w.setContentSize(s.width, s.height), { width, height });
  await page.setViewportSize({ width, height });
  await settled();
}
async function theme(mode) {
  await page.evaluate((m) => window.desktopBridge.setTheme(m), mode);
  await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, mode === "dark");
  await settled();
}
async function scale(percent) {
  await page.evaluate((p) => { document.documentElement.style.fontSize = `${p}%`; }, percent);
  await settled();
}
async function zoom(factor) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), factor);
  await page.waitForFunction((f) => Math.abs(window.devicePixelRatio / (window.__baseDpr ?? window.devicePixelRatio) - f) < 0.01 || true, factor);
  await settled();
}
async function route(hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await settled();
}
async function shot(name) {
  const file = `${name}.png`;
  const bytes = await page.screenshot({ path: `${out}/${file}`, scale: "css" });
  report.images.push({ file, sha256: sha(bytes) });
}

// One measurement pass over the visible viewport. Returns per-node observations.
async function measure(context) {
  await settled();
  if (localeSweep) {
    for (const selector of ["main", '[data-sidebar="sidebar"]', '[role="dialog"]', '[role="menu"]']) {
      const labels = await page.evaluate(readLocaleLabels, selector);
      if (!labels.length) continue;
      const { unclassified } = auditLocaleLabels(labels, localeSources(liveConfig));
      report.localeSweep.audits++;
      for (const row of unclassified) report.localeSweep.rows.push({ surface: context.label, position: context.position ?? "top", selector, ...row });
    }
  }
  const g = await page.evaluate(({ allowed, fixture, parts, allText, phrases }) => {
    const allow = new Map(Object.entries(allowed).flatMap(([cls, list]) => list.map((w) => [w, cls])));
    const fixtureRe = new RegExp(fixture);
    const rgba = (value) => {
      const c = document.createElement("canvas").getContext("2d");
      c.fillStyle = value; c.fillRect(0, 0, 1, 1);
      return [...c.getImageData(0, 0, 1, 1).data];
    };
    const blend = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] / 255 + b[i] * (1 - a[3] / 255));
    const background = (node) => {
      const layers = [];
      for (let p = node; p; p = p.parentElement) layers.unshift(rgba(getComputedStyle(p).backgroundColor));
      const opaque = layers.findLastIndex((l) => l[3] === 255);
      const start = opaque >= 0 ? opaque : 0;
      return layers.slice(start).reduce((r, l) => blend(l, r), [255, 255, 255]);
    };
    const fg = (color, node) => {
      const r = rgba(color);
      for (let p = node; p; p = p.parentElement) r[3] *= parseFloat(getComputedStyle(p).opacity);
      return r;
    };
    const lum = (rgb) => rgb.slice(0, 3).map((v) => {
      const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => { const v = [lum(a), lum(b)].sort((x, y) => y - x); return (v[0] + 0.05) / (v[1] + 0.05); };
    const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const vw = innerWidth, vh = innerHeight;
    const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
    const segments = (text) => [...(text ?? "").matchAll(/[A-Za-z][A-Za-z0-9.+-]*[A-Za-z0-9]|[A-Za-z]+/g)]
      .map((m) => m[0]).filter((w) => /[A-Za-z]{3}/.test(w));
    const classify = (text) => {
      text = text ?? "";
      for (const part of parts) text = (text ?? "").split(part).join(" ");
      const phraseHits = phrases.filter((phrase) => text.includes(phrase));
      for (const phrase of phraseHits) text = text.split(phrase).join(" ");
      // Data, not authored copy: URLs, versions, file names, env vars, package/process ids, paths.
      text = text
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/\b[\w.-]+\.(json|tsx?|md|wav|png|svg|toml|ya?ml)\b/g, " ")
        .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, " ")
        .replace(/(^|\s)[~./][^\s]*/g, " ")
        .replace(/\b[a-z0-9]+(?:[-_/@][a-z0-9.]+)+\b/g, " ")
        .replace(/\bv?\d+(?:\.\d+)+(?:-[\w.]+)?\b/g, " ");
      text = text.replace(/\b(gpt|claude|o\d|gemini)-[\w.-]+/gi, " ");
      if (!text || !/[A-Za-z]{3}/.test(text)) return { ok: true, matched: [] };
      if (fixtureRe.test(text.trim())) return { ok: true, matched: [{ segment: text.trim(), cls: "fixture" }] };
      const matched = [], bad = [];
      for (const s of segments(text)) {
        const cls = allow.get(s);
        if (cls) matched.push({ segment: s, cls }); else bad.push(s);
      }
      return { ok: bad.length === 0, matched, bad };
    };
    const isData = (el) => Boolean(el.closest("pre,code,kbd,[data-slot=kbd],textarea,input,[contenteditable=true],[data-message-id],[data-timeline-row],.chat-markdown,[role=log],[data-slot=terminal],.xterm,[data-raw-diagnostic],[data-license-body]")) ||
      (location.hash.includes("open-source-licenses") && Boolean(el.closest("main [data-slot=collapsible-trigger], main [data-slot=collapsible] a, main [data-slot=collapsible] button")));
    const authoredText = (el) => {
      const clone = el.cloneNode(true);
      for (const node of clone.querySelectorAll("pre,code,kbd,[data-slot=kbd],[aria-hidden=true]")) node.remove();
      return (clone.innerText ?? clone.textContent ?? "").trim();
    };
    const clipAncestor = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return p;
      }
      return null;
    };
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const raw = t.data;
      const hangul = /[가-힣]/.test(raw);
      if (!hangul && !(allText && /[A-Za-z가-힣]/.test(raw))) continue;
      const el = t.parentElement;
      if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const style = getComputedStyle(el);
      const range = document.createRange(); range.selectNodeContents(t);
      const box = range.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || !inView(box)) continue;
      // Screen-reader-only spans are AX text, not painted labels.
      const pb = el.getBoundingClientRect();
      if (style.position === "absolute" && pb.width <= 1 && pb.height <= 1) continue;
      const cx = Math.min(vw - 1, Math.max(0, box.left + box.width / 2)), cy = Math.min(vh - 1, Math.max(0, box.top + box.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      const onTop = Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
      if (!onTop) continue;
      const lines = new Map();
      const lineOf = new Array(raw.length).fill(null);
      for (let i = 0; i < raw.length; i++) {
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
        const rect = r.getClientRects()[0];
        if (rect && rect.width > 0) {
          const key = Math.round(rect.top + rect.height / 2);
          lineOf[i] = key;
          lines.set(key, (lines.get(key) ?? "") + raw[i]);
        }
      }
      const lineList = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      let midWord = false;
      for (let i = 0; i + 1 < raw.length; i++)
        if (lineOf[i] !== null && lineOf[i + 1] !== null && lineOf[i] !== lineOf[i + 1] &&
            /[가-힣]/.test(raw[i]) && /[가-힣]/.test(raw[i + 1])) midWord = true;
      const clip = clipAncestor(el);
      const cr = clip?.getBoundingClientRect();
      const vb = style.overflowX !== "visible" || style.overflowY !== "visible" ? pb : box;
      const clipped = Boolean(cr) && (vb.left < cr.left - 0.5 || vb.right > cr.right + 0.5 || vb.top < cr.top - 0.5 || vb.bottom > cr.bottom + 0.5) &&
        !(/auto|scroll/.test(getComputedStyle(clip).overflowY) || /auto|scroll/.test(getComputedStyle(clip).overflowX));
      const ellipsized = style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 0.5;
      const identityEllipsis = el.closest("[data-ellipsis=identity]") !== null;
      const inactive = el.closest(":disabled,[aria-disabled=true],[data-disabled]") !== null;
      const layer = el.closest("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-slot$=popup],[data-slot=tooltip-popup],[data-slot=toast-viewport]");
      const lineClamped = style.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 0.5;
      const bg = background(el);
      const text = raw.trim();
      const explanatory = !el.closest("button,[role=button],[role=menuitem],[role=option],[role=tab],label,h1,h2,h3,h4,th,kbd,[data-slot=badge]") &&
        (/(어요|아요|해요|에요|예요|세요|까요|니다|돼요|워요|와요|져요|봐요|줘요|겠어요|있어요|없어요)[.?!]?$/.test(text) || text.length >= 24);
      texts.push({
        // Only the painted part of each line counts for overlap: text hidden by its own clamp/ellipsis box or a
        // clipping ancestor is not on screen.
        lineRects: [...range.getClientRects()].map((r) => {
          let { left, top, right, bottom } = r;
          const limits = [];
          if (style.overflow !== "visible" || style.overflowX !== "visible" || lineClamped || style.textOverflow === "ellipsis") limits.push(pb);
          // Every clipping ancestor (scroll viewports, cards) bounds what is painted, not only the nearest one.
          for (let p = el.parentElement; p; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.overflowX !== "visible" || ps.overflowY !== "visible") limits.push(p.getBoundingClientRect()); }
          for (const l of limits) { left = Math.max(left, l.left); top = Math.max(top, l.top); right = Math.min(right, l.right); bottom = Math.min(bottom, l.bottom); }
          return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
        }).filter((r) => r.width > 1 && r.height > 1),
        text, hangul, fg: style.color, bg: `rgb(${bg.map((v) => Math.round(v)).join(",")})`, tag: el.tagName, rect: box.toJSON(), fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight,
        contrast: contrast(blend(fg(style.color, el), bg), bg), wordBreak: style.wordBreak, overflowWrap: style.overflowWrap,
        lines: lineList, midWord, clipped, ellipsized, lineClamped, explanatory, data: isData(el), identityEllipsis, inactive, _layer: layer,
        path: (() => { const p = []; for (let n = el; n && p.length < 5; n = n.parentElement) p.push(n.tagName.toLowerCase() + (n.getAttribute("data-slot") ? `[${n.getAttribute("data-slot")}]` : "")); return p.join("<"); })(),
        node: texts.length,
        _el: el,
      });
    }
    // j: painted text boxes must not overlap other painted text boxes or icons they do not contain.
    const icons = [...document.querySelectorAll("svg")].filter((s) => s.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .map((s) => ({ el: s, rect: s.getBoundingClientRect() })).filter((s) => s.rect.width > 2 && inView(s.rect))
      // Decorative hidden artwork (header gradient, backdrops) is not an icon.
      .filter((s) => !(s.el.closest("[aria-hidden=true]") && (s.rect.width > 64 || s.rect.height > 64)))
      .filter((s) => { const h = document.elementFromPoint(Math.min(vw - 1, s.rect.left + s.rect.width / 2), Math.min(vh - 1, s.rect.top + s.rect.height / 2)); return h && (h === s.el || s.el.contains(h) || h.closest("svg") === s.el || h.contains(s.el)); });
    // Sticky/fixed bars (page header, composer) paint over the content scrolling beneath them; text on different
    // pinned layers is occlusion, not overlap.
    const pinOf = (el) => { for (let n = el; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "sticky" || p === "fixed") return n; } return null; };
    const overlaps = [];
    const lineArea = (a, b) => a.lineRects.reduce((sum, ra) => sum + b.lineRects.reduce((s, rb) => s + area(ra, rb), 0), 0);
    for (let i = 0; i < texts.length; i++) {
      if (!texts[i].hangul) continue;
      for (let k = 0; k < texts.length; k++) {
        if (k === i || (texts[k].hangul && k < i)) continue;
        const a = texts[i], b = texts[k];
        if (a._layer !== b._layer || pinOf(a._el) !== pinOf(b._el)) continue;
        const ov = lineArea(a, b);
        if (ov > 0.5) overlaps.push({ a: a.text.slice(0, 40), b: b.text.slice(0, 40), area: ov, kind: "text-text", aPath: a.path, bPath: b.path, aLines: a.lineRects.slice(0, 3), bLines: b.lineRects.slice(0, 3) });
      }
      for (const icon of icons) {
        if (texts[i]._el.contains(icon.el) || pinOf(texts[i]._el) !== pinOf(icon.el)) continue;
        const ov = texts[i].lineRects.reduce((sum, r) => sum + area(r, icon.rect), 0);
        if (ov > 0.5) overlaps.push({ a: texts[i].text.slice(0, 40), b: "svg", area: ov, kind: "text-icon", aPath: texts[i].path, aLines: texts[i].lineRects.slice(0, 3), icon: { rect: icon.rect.toJSON(), html: icon.el.outerHTML.slice(0, 200), parent: icon.el.parentElement?.outerHTML.slice(0, 300) } });
      }
    }
    // AX names of interactive controls.
    const controls = [...document.querySelectorAll("button,a[href],[role=button],[role=switch],[role=checkbox],[role=combobox],[role=menuitem],[role=option],[role=tab],[role=link],input,select,textarea")]
      .filter((c) => c.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
      .map((c) => ({ el: c, rect: c.getBoundingClientRect() })).filter((c) => c.rect.width > 0 && inView(c.rect))
      .map(({ el, rect }) => {
        const name = (el.getAttribute("aria-label") ?? "").trim();
        const visible = authoredText(el);
        // Latin-only placeholders are example values (commands, ids), classified as data below.
        const placeholder = el.getAttribute("placeholder");
        const title = el.getAttribute("title");
        const inData = isData(el) && !["INPUT", "TEXTAREA"].includes(el.tagName);
        const korean = /[가-힣]/.test(name + visible + (placeholder ?? ""));
        const iconOnly = !visible && Boolean(el.querySelector("svg"));
        return {
          tag: el.tagName, role: el.getAttribute("role"), name, visible: visible.slice(0, 60), placeholder, title,
          rect: rect.toJSON(), korean, iconOnly, inData,
          disabled: el.matches(":disabled,[aria-disabled=true],[data-disabled]"),
          axName: classify(name), axVisible: classify(visible), axPlaceholder: classify(placeholder && /[가-힣]/.test(placeholder) ? placeholder : null), axTitle: classify(title),
        };
      });
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,label,[role=status],[role=alert],[data-slot=description],p")]
      .filter((n) => n.checkVisibility() && inView(n.getBoundingClientRect()) && !isData(n))
      .map((n) => ({ tag: n.tagName, text: n.innerText.trim().slice(0, 80), cls: classify(n.innerText.trim()) }))
      .filter((h) => h.text && !/[가-힣]/.test(h.text) && /[A-Za-z]{3}/.test(h.text));
    return {
      texts: texts.map(({ _el, _layer, ...rest }) => rest), overlaps, controls, englishOnly: headings,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 0.5,
      route: location.hash, theme: document.documentElement.className, fontSize: getComputedStyle(document.documentElement).fontSize,
    };
  }, { allowed: ALLOWED, fixture: FIXTURE.source, parts: FIXTURE_PARTS, allText, phrases: [...PHRASES, ...DATA_VALUES] });
  report.measurements.push({ ...context, texts: g.texts.length, controls: g.controls.length, route: g.route });
  check("f", "no-primary-page-overflow", !g.pageOverflow, { ...context, route: g.route });
  for (const t of g.texts) {
    if (t.data) continue;
    const detail = { ...context, text: t.text.slice(0, 80), path: t.path, rect: t.rect };
    if (context.scale === 100 && !context.zoom && !context.expanded && t.explanatory)
      check("b", "explanatory-text-14px", t.fontSize >= 14, { ...detail, fontSize: t.fontSize });
    if (t.inactive) rows.push({ rule: "c", name: "text-contrast-inactive-component", pass: true, applicability: "WCAG 1.4.3 inactive UI exception, recorded", ...detail, ratio: Number(t.contrast.toFixed(3)) });
    else check("c", "text-contrast", t.contrast >= 4.5, { ...detail, ratio: Number(t.contrast.toFixed(3)), fg: t.fg, bg: t.bg, hangul: t.hangul });
    if (t.hangul) {
      check("d", "keep-all-no-mid-word-break", !t.midWord, { ...detail, lines: t.lines, wordBreak: t.wordBreak });
      check("d", "no-orphan-syllable", t.lines.length < 2 || !/^[가-힣][.?!,)]*$/.test(t.lines.at(-1).trim()), { ...detail, lines: t.lines });
    }
    if (t.identityEllipsis && !t.clipped && !t.lineClamped) rows.push({ rule: "i", name: "identity-ellipsis-with-full-value", pass: true, ...detail, ellipsized: t.ellipsized });
    else check("i", "not-clipped-or-ellipsized", !t.clipped && !t.ellipsized && !t.lineClamped, { ...detail, clipped: t.clipped, ellipsized: t.ellipsized, lineClamped: t.lineClamped });
  }
  for (const o of g.overlaps) check("j", "text-box-overlap", false, { ...context, ...o });
  check("j", "text-box-overlap-total", g.overlaps.length === 0, { ...context, count: g.overlaps.length });
  for (const c of g.controls) {
    if (c.inData) continue;
    const detail = { ...context, control: c.name || c.visible, tag: c.tag, role: c.role, rect: c.rect };
    for (const [k, v] of [["name", c.axName], ["visible", c.axVisible], ["placeholder", c.axPlaceholder], ["title", c.axTitle]])
      if (!v.ok) check("ax", `latin-segment-classified-${k}`, false, { ...detail, bad: v.bad });
    if ((c.korean || allText) && !c.disabled) {
      if (c.iconOnly) check("a", "icon-control-36", c.rect.width >= 36 && c.rect.height >= 36, { ...detail, applicability: "copy-only-geometry-record" });
      else if (["BUTTON", "A"].includes(c.tag) || c.role === "button")
        check("a", "text-button-32", c.rect.height >= 32, { ...detail, applicability: "copy-only-geometry-record" });
    }
  }
  for (const h of g.englishOnly) if (!h.cls.ok) check("ax", "english-authored-text", false, { ...context, ...h });
  return g;
}

// Measure a scrollable page in viewport steps until its scroll owner reaches the end.
async function sweep(context, label) {
  const owners = await page.evaluate(() => {
    const list = [...document.querySelectorAll("main *, [role=dialog] *")].filter((e) =>
      /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4 && e.checkVisibility());
    list.forEach((e, i) => e.setAttribute("data-hig22-owner", String(i)));
    return list.map((e, i) => ({ i, h: e.scrollHeight, c: e.clientHeight }));
  });
  await measure({ ...context, label, position: "top" });
  if (!quick && context.shot) await shot(`${label}-${context.mode}-${context.scale}-${context.width}-top`);
  for (const owner of owners) {
    let step = 0;
    for (;;) {
      const done = await page.evaluate((i) => {
        const e = document.querySelector(`[data-hig22-owner="${i}"]`);
        if (!e) return true;
        if (e.scrollTop + e.clientHeight >= e.scrollHeight - 1) return true;
        e.scrollTop = Math.min(e.scrollHeight, e.scrollTop + e.clientHeight * 0.8);
        return false;
      }, owner.i);
      if (done || step > 40) break;
      step++;
      await measure({ ...context, label, position: `owner${owner.i}-step${step}` });
      if (probe) await shot(`${label}-${context.mode}-${context.scale}-${context.width}-owner${owner.i}-step${step}`);
    }
    if (!quick && context.shot) await shot(`${label}-${context.mode}-${context.scale}-${context.width}-end${owner.i}`);
  }
}

const SETTINGS = probe ? ["diagnostics"] : ["general", "appearance", "keybindings", "snap-shot", "providers", "integrations", "source-control", "storage", "connections", "archived", "diagnostics", "open-source-licenses"];

try {
  await page.reload();
  await resize(1280, 800);
  await page.getByText("컴퓨터 연결하기", { exact: true }).waitFor({ timeout: 30000 });
  await measure({ label: "onboarding-connection", mode: "system", scale: 100, width: 1280 });
  await button("계속하기").click();
  await settled();
  await measure({ label: "onboarding-agents", mode: "system", scale: 100, width: 1280 });
  await button("계속하기").click();
  await settled();
  await measure({ label: "onboarding-project", mode: "system", scale: 100, width: 1280 });
  await button("프로젝트 가져오지 않기").click();
  await page.getByText("무엇을 함께 해볼까요?", { exact: true }).waitFor();
  await measure({ label: "empty-projects", mode: "system", scale: 100, width: 1280 });
  await page.locator('[data-sidebar="sidebar"]').getByRole("button", { name: "프로젝트 추가", exact: true }).click();
  await settled();
  await measure({ label: "add-project", mode: "system", scale: 100, width: 1280 });
  await page.getByText("로컬 폴더", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')?.value === "~/");
  await page.locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]').fill(`${isolation.workspace}/`);
  await page.getByText("baseline-project", { exact: true }).click();
  await page.locator('button[aria-label="추가 (Enter)"],button[aria-label="추가 (⌘ Enter)"],button[aria-label="추가 (Ctrl Enter)"]').click();
  await button("프로젝트 변경").waitFor();
  await page.keyboard.press("Escape");
  seed(isolation);
  await page.reload();
  await page.locator('[data-sidebar="sidebar"]').getByText("03 Code blocks", { exact: true }).waitFor();
  const notice = button("Codex 공급자 오류 닫기");

  const modes = quick || probe || localeSweep ? ["light"] : ["light", "dark"];
  const scales = quick || localeSweep ? [100] : [100, 150];
  const sizes = quick || localeSweep ? [[1280, 800]] : probe ? [[840, 620]] : [[840, 620], [1280, 800], [1920, 1080]];
  for (const mode of modes) {
    await theme(mode);
    for (const sc of scales) {
      await scale(sc);
      for (const [width, height] of sizes) {
        await resize(width, height);
        const ctx = { mode, scale: sc, width, height, shot: width !== 1920 || sc === 100 };
        for (const section of SETTINGS) {
          await route(`/settings/${section}`);
          await sweep(ctx, `settings-${section}`);
        }
        for (const title of ["03 Code blocks", "01 Conversation", "05 Error fixture", "04 Working fixture", "06 Empty thread"]) {
          await route("/");
          await page.locator('[data-sidebar="sidebar"]').getByText(title, { exact: true }).click();
          await settled();
          await measure({ ...ctx, label: `thread-${title}` });
          if (!quick && ctx.shot) await shot(`thread-${title.slice(0, 2)}-${mode}-${sc}-${width}`);
        }
        if (await notice.isVisible()) await notice.click();
        // Right-panel surfaces through the panel menu.
        for (const [name, key] of [["파일", "F"], ["에이전트", "A"], [NAMES.runGraph, "G"], ["브라우저", "B"], ["터미널", "T"]]) {
          if (!(await button("패널 추가").isVisible())) {
            await button("오른쪽 패널 열기/닫기").click();
            await settled();
            await measure({ ...ctx, label: "panel-chooser" });
            await page.getByText("파일", { exact: true }).first().click();
            await settled();
          }
          await button("패널 추가").click();
          const names = Array.isArray(name) ? name : [name];
          await page.getByRole("menuitem").first().waitFor();
          let item = page.getByRole("menuitem").filter({ hasText: names[0] }).first();
          if (names[1] && !(await item.count())) item = page.getByRole("menuitem").filter({ hasText: names[1] }).first();
          await item.waitFor();
          await measure({ ...ctx, label: "panel-menu" });
          await item.click();
          await settled();
          await measure({ ...ctx, label: `panel-${names[0]}` });
          void key;
        }
        // Dialogs opened by keyboard; Escape must return focus to the opener (rules e/g).
        for (const [label, opener] of [
          ["add-action", page.locator('button[aria-label="작업 추가"]').first()],
        ]) {
          await opener.focus();
          await page.keyboard.press("Enter");
          const dialog = page.locator('[data-slot="dialog-popup"]:not([data-closed])');
          await dialog.waitFor();
          await sweep(ctx, `dialog-${label}`);
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "detached" });
          check("e", "escape-returns-focus-to-opener", await opener.evaluate((n) => n === document.activeElement), { ...ctx, label });
        }
        await route("/settings/providers");
        for (const [label, key] of [["custom-model", "customModel"], ["add-provider", "addProvider"]]) {
          const opener = (await pick("button", key)).first();
          if (!(await opener.count())) { check("e", `opener-present-${label}`, false, { ...ctx }); continue; }
          await opener.focus();
          await page.keyboard.press("Enter");
          await settled();
          await sweep(ctx, `dialog-${label}`);
          await page.keyboard.press("Escape");
          await settled();
          check("e", "escape-returns-focus-to-opener", await opener.evaluate((n) => n === document.activeElement), { ...ctx, label });
        }
        // Both sidebars.
        for (const legacy of [true, false]) {
          await route("/settings/general");
          const section = page.locator("#legacy-features");
          const disclosure = await pick("button", "legacyFeatures", section);
          if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
          await settled();
          const toggle = await pick("switch", "legacySidebar", section);
          await toggle.scrollIntoViewIfNeeded();
          const on = await toggle.evaluate((n) => n.getAttribute("aria-checked") === "true" || n.hasAttribute("data-checked"));
          if (on !== legacy) await toggle.click();
          await settled();
          await route("/");
          await page.locator('[data-sidebar="sidebar"]').getByText("04 Working fixture", { exact: true }).click();
          await settled();
          await measure({ ...ctx, label: legacy ? "sidebar-legacy" : "sidebar-current" });
          if (!quick && ctx.shot) await shot(`sidebar-${legacy ? "legacy" : "current"}-${mode}-${sc}-${width}`);
        }
      }
    }
  }
  if (!quick && !localeSweep && process.env.HIG_MEASURE_NO_Q8 !== "1") {
    // Q8: 200% renderer zoom and +40% Korean authored-copy length.
    await scale(100);
    for (const mode of modes) {
      await theme(mode);
      await resize(1920, 1080);
      await zoom(2);
      for (const section of SETTINGS) {
        await route(`/settings/${section}`);
        await sweep({ mode, scale: 100, zoom: 200, width: 1920, height: 1080, shot: true }, `zoom200-${section}`);
      }
      await zoom(1);
      for (const [width, height] of probe ? [[840, 620]] : [[840, 620], [1280, 800], [1920, 1080]]) {
        await resize(width, height);
        await scale(150);
        for (const section of SETTINGS) {
          await route(`/settings/${section}`);
          await page.evaluate(() => {
            const w = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
            const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
            for (const n of nodes) {
              const t = n.textContent.trim();
              if (/[가-힣]/.test(t) && !n.parentElement.closest("pre,code,input,textarea") && !n.parentElement.hasAttribute("data-hig22-expanded")) {
                // At least +40%, ending on a word boundary so the added copy never ends in a cut syllable.
                // The added copy also ends on a word of at least two characters, so a cut never leaves a one-syllable tail.
                let cut = t.indexOf(" ", Math.ceil(t.length * 0.4));
                while (cut !== -1 && t.slice(t.lastIndexOf(" ", cut - 1) + 1, cut).length < 2) cut = t.indexOf(" ", cut + 1);
                n.textContent += " " + (cut === -1 ? t : t.slice(0, cut));
                n.parentElement.setAttribute("data-hig22-expanded", "");
              }
            }
          });
          await sweep({ mode, scale: 150, expanded: 40, width, height, shot: width === 840 }, `expanded40-${section}`);
        }
        await scale(100);
      }
    }
  }
  check("e", "zero-model-runtime-outbound",
    report.requests.every((r) => !/thread\.turn\.start|weavra\.control|planner\./.test(r.tag)) && report.blockedOutbound === 0,
    { blockedOutbound: report.blockedOutbound });
} catch (error) {
  report.error = String(error);
  report.stack = error.stack;
  try { await page.screenshot({ path: `${out}/error.png`, scale: "css" }); } catch {}
  throw error;
} finally {
  await cdp.detach().catch(() => {});
  const child = app.process();
  await app.close();
  report.cleanup = { pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null };
  const byRule = {};
  for (const r of rows) {
    byRule[r.rule] ??= { total: 0, failed: 0 };
    byRule[r.rule].total++;
    if (!r.pass) byRule[r.rule].failed++;
  }
  report.summary = { rows: rows.length, failures: report.failures.length, images: report.images.length, byRule };
  await fs.writeFile(`${out}/observations.json`, JSON.stringify({ ...report, rows }, null, 1));
  await fs.writeFile(`${out}/summary.json`, JSON.stringify(report.summary, null, 2));
  console.log(`MEASURE22 rows=${rows.length} failures=${report.failures.length} images=${report.images.length} ${JSON.stringify(byRule)}`);
}
