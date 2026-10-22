// Every Latin segment in every captured state (all sizes), classified once, so no state is left unread.
// Input: the capture manifest of capture_pr 22 (each frame records its visible body text).
// Usage: bun tools/capture-latin-22.mjs <capture-manifest.json> <out-dir>
import * as fs from "node:fs/promises";

const [manifestPath, outDir] = process.argv.slice(2);
const root = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees";
const cases = await import(`${root}/hig-01/scripts/hig/cases.mjs`);
const seed = await fs.readFile(`${root}/hig-01/scripts/hig/seed.mjs`, "utf8");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const approved = new Map();
for (const [cls, list] of [...Object.entries(cases.LOCALE_SEGMENT_CLASSES), ...Object.entries(cases.LOCALE_PHRASE_CLASSES)])
  for (const name of list) for (const word of name.split(/\s+/)) approved.set(word, cls);
const keycaps = new Set(cases.LOCALE_KEYCAPS.flatMap((k) => (k instanceof RegExp ? [] : String(k).split(/[+\s]/))));
// Every seeded fixture string (thread titles, messages, code blocks, provider fixture text): a line that is part
// of one is fixture content, matched by exact seeded value, never by single common words.
const unescape = (s) => { try { return JSON.parse(`"${s.replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`); } catch { return s; } };
const seedStrings = [...seed.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => (m[1] !== undefined ? unescape(m[1]) : m[2].replace(/\$\{i \+ 1\}/g, "1")));
// Markdown headings of seeded messages ("## Example", "### Section 1") are fixture text too.
const seededHeadings = new Set(seedStrings.flatMap((s) => [...s.matchAll(/^#+\s+(.+)$/gm)].map((m) => m[1].trim())));
const norm = (s) => s.replace(/[*`]/g, "").replace(/[|#>]/g, " ").replace(/\s+/g, " ").trim();
const seedNorm = seedStrings.map(norm);
// A line is fixture content when it equals a seeded string, or every sentence of it (12+ characters) is part of one.
const isFixtureLine = (line) => {
  const n = norm(line);
  if (!n) return false;
  if (seededHeadings.has(n) || /^Section \d+$/.test(n)) return true;
  // A short single value equal to a seeded literal (a status such as "idle") is not proof of fixture prose.
  if (n.includes(" ") && n.length >= 8 && seedNorm.includes(n)) return true;
  const parts = n.split(/(?<=[.!?])\s+/).filter((p) => p.length >= 12);
  return parts.length > 0 && parts.join(" ").length >= n.length * 0.8 && parts.every((p) => seedNorm.some((s) => s.includes(p)));
};
// Seeded thread titles, commands and URLs inside a line are data: removed before segmenting.
const strip = ["01 Conversation", "02 Long messages", "03 Code blocks", "04 Working fixture", "05 Error fixture", "06 Empty thread", "baseline-project", "codex app-server", "codex login"];
// Original server diagnostics shown verbatim after a Korean status (approved exception class).
const originals = ["Codex CLI is not authenticated. Run `codex login` and try again."];
// This Mac's environment label: matched in memory only, never written out.
const host = (await Bun.$`scutil --get ComputerName`.nothrow().text()).trim();
// Product names and exception-table identifiers approved for this PR (Amendments 2026-10-22c/d/i).
const exceptions = new Map(Object.entries({
  "product name": ["ACP", "Registry", "Pi", "Agent", "Copilot", "Apple", "Silicon", "Intel", "GNOME", "Unix", "Chat", "T3", "Fable", "Opus", "Sonnet"],
  "identifier": ["R3", "CANDIDATE_ONLY", "REVISE", "BLOCK", "TARGET_CHANGED", "HEAD", "sha256", "SIGKILL", "CDP", "development"],
  "format or unit": ["YAML", "Markdown", "CSV", "KiB", "MiB", "GB", "MB", "KB", "ms", "px"],
  "font family (data)": ["SF", "Pro", "Menlo"],
  "macOS app name": ["Finder"],
  "host name (data)": ["localhost"],
  "keycap": ["Backspace"],
}).flatMap(([cls, list]) => list.map((w) => [w, cls])));

const dataPattern = (segment, line) =>
  /^[a-z0-9]+(?:[-_/@.][a-z0-9.]+)+$/i.test(segment) && /[-_/@.]/.test(segment) ? "identifier or path" :
  /^[A-Z][A-Za-z]*Error$/.test(segment) ? "error type" :
  /^[A-Z0-9_]+_[A-Z0-9_]+$/.test(segment) ? "identifier" :
  /^[0-9a-f]{12,}$/i.test(segment) ? "hash" :
  /\b\d+(\.\d+)+\b/.test(line) && /version|v\d/.test(line) ? "version text" : null;

const classify = (segment, line, stateId) => {
  if (originals.some((o) => line.includes(o))) return "original diagnostic";
  if (host && line.includes(host) && host.includes(segment)) return "environment label (data)";
  if (approved.has(segment)) return approved.get(segment);
  if (exceptions.has(segment)) return exceptions.get(segment);
  if (keycaps.has(segment)) return "keycap";
  // Diagnostics (state 29): table rows (tab-separated) and lines without Korean are recorded machine values.
  if (stateId === "29" && (!/[가-힣]/.test(line) || line.includes("\t"))) return "diagnostics data";
  // Open-source licenses (state 30): package names, SPDX expressions and asset credits are license data.
  if (stateId === "30") return "license data";
  // Clock text follows the OS locale and the 12/24-hour setting ("System default follows the OS clock").
  if (/^(AM|PM)$/.test(segment) && /\d{1,2}:\d{2}\s?(AM|PM)/.test(line)) return "OS clock format";
  if (isFixtureLine(line)) return "seeded fixture";
  const pattern = dataPattern(segment, line);
  if (pattern) return pattern;
  return null;
};

const inventory = {};
const unclassified = {};
for (const frame of manifest.manifest) {
  const stateId = frame.stateId;
  for (const raw of String(frame.body ?? "").split("\n")) {
    let line = raw;
    for (const s of strip) line = line.split(s).join(" ");
    line = line.replace(/https?:\/\/\S+/g, " ");
    for (const m of line.matchAll(/[A-Za-z][A-Za-z0-9._+/@-]*[A-Za-z0-9]|[A-Za-z]+/g)) {
      const segment = m[0];
      // Under three Latin letters (PR, OS, ID, avatar initials) is outside the audit, as in the runner rule.
      if (!/[A-Za-z]{3}/.test(segment)) continue;
      const cls = classify(segment, raw, stateId) ?? "unclassified";
      const key = cls === "environment label (data)" ? "<environment label>" : segment;
      const entry = (inventory[key] ??= { classes: {}, states: [] });
      entry.classes[cls] = (entry.classes[cls] ?? 0) + 1;
      if (!entry.states.includes(frame.file)) entry.states.push(frame.file);
      if (cls === "unclassified") {
        const u = (unclassified[segment] ??= { states: [], lines: [] });
        if (!u.states.includes(stateId)) u.states.push(stateId);
        if (u.lines.length < 3 && !u.lines.includes(line.trim().slice(0, 120))) u.lines.push(line.trim().slice(0, 120));
      }
    }
  }
}
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(`${outDir}/capture-latin-inventory.json`, JSON.stringify({ frames: manifest.manifest.length, revision: manifest.revision, inventory }, null, 1));
await fs.writeFile(`${outDir}/capture-latin-unclassified.json`, JSON.stringify(unclassified, null, 1));
console.log(`CAPTURE_LATIN frames=${manifest.manifest.length} segments=${Object.keys(inventory).length} unclassified=${Object.keys(unclassified).length}`);
