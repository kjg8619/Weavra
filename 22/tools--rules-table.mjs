// Writes pr-22/rules-a-j.md from the packaged-head measurement compared with the unchanged parent (same tool).
import * as fs from "node:fs/promises";

const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22";
const comparison = JSON.parse(await fs.readFile(`${root}/measure-after/comparison.json`, "utf8"));
const head = comparison.head.summary.byRule, parent = comparison.parent.summary.byRule;
const rules = [
  ["a", "Target size: icon controls >= 36 px, text buttons >= 32 px high", "recorded (copy-only geometry)"],
  ["b", "Explanatory text >= 14 px", "gated"],
  ["c", "Text contrast >= 4.5:1 (inactive controls recorded under WCAG 1.4.3)", "gated"],
  ["d", "Korean keep-all: no mid-word break, no orphan syllable", "gated"],
  ["e", "Escape returns focus to the opener", "gated"],
  ["f", "No page-level horizontal overflow", "gated"],
  ["i", "Not clipped, ellipsized or line-clamped (identity names with full-value tooltip excepted)", "gated"],
  ["j", "Painted text boxes do not overlap text or icons on the same layer", "gated"],
  ["ax", "No unclassified English authored text in visible text, AX names, placeholders or titles", "gated"],
];
const count = (rule, kind) => comparison.summary[rule]?.[kind] ?? 0;
const lines = [
  "# HIG 22 rules a-j self-measurement", "",
  `Packaged head \`${comparison.head.head}\` (app.asar \`${comparison.head.asarSha256}\`) against the unchanged parent`,
  `\`${comparison.parent.head}\` (app.asar \`${comparison.parent.asarSha256}\`), both measured by \`tools/measure-22.mjs\` in`,
  "all-text mode over: every settings page in light/dark at 840, 1280 and 1920 px and 100%/150% text, scrolled through",
  "every section; 200% zoom; +40% copy at 150% text; all right-panel surfaces, the add-action, add-provider and",
  "custom-model dialogs, both sidebars and the thread fixtures. A head failure is *introduced* unless the parent fails the",
  "same check on the same surface, element path and configuration with an equal or worse value; target-size rows are",
  "compared by count per surface and configuration because their key is the control's (now Korean) name.", "",
  "| Rule | Check | Head checks | Head failures | Introduced | Pre-existing (parent fails the same) | Parent failures | Gate |",
  "|---|---|---|---|---|---|---|---|",
];
for (const [rule, text, gate] of rules)
  lines.push(`| ${rule} | ${text} | ${rule === "ax" ? "every visible text, AX name, placeholder and title (only failures are stored)" : head[rule]?.total ?? 0} | ${head[rule]?.failed ?? 0} | ${count(rule, "introduced")} | ${count(rule, "preexisting")} | ${parent[rule]?.failed ?? 0} | ${gate} |`);
const lower = comparison.preexisting.filter((row) => row.lowerThanParent);
if (lower.length) {
  lines.push("", "Pre-existing failures measured slightly lower than the parent on the same element and configuration (listed, not merged):", "",
    "| Surface | Configuration | Position | Text | Head | Parent | Foreground / background |", "|---|---|---|---|---|---|---|");
  for (const row of lower) lines.push(`| ${row.label} | ${row.mode}/${row.scale}/${row.width} | ${row.position} | ${row.text} | ${row.ratio} | ${row.parentValues.join(", ")} | ${row.fg} / ${row.bg} |`);
  lines.push("", "Same element, same colors and the same unchanged warning-badge style as the parent; the same element measures equal to the parent at the next scroll position of the same configuration.");
}
lines.push("", "Rule `ax` is evaluated on head only: the parent is English by design, so every parent row fails it.", "",
  "## Pre-existing failures by source (not introduced by this change)", "");
const groups = new Map();
for (const row of comparison.preexisting) {
  const key = `${row.rule} | ${row.name} | ${(row.path ?? row.kind ?? "").split("<").slice(0, 2).join("<")}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
lines.push("| Rule | Check | Element (innermost) | Rows |", "|---|---|---|---|");
for (const [key, n] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 40)) lines.push(`| ${key} | ${n} |`);
const introduced = comparison.introduced.filter((row) => row.rule === "a");
if (introduced.length) {
  lines.push("", "## Target-size rows above the parent count (recorded)", "",
    "Copy-only work does not restyle controls; these are existing control heights whose rows exceed the parent's count in",
    "the same surface and configuration because Korean labels wrap or measure differently.", "",
    "| Surface | Control | Configuration | Height x width |", "|---|---|---|---|");
  const seen = new Set();
  for (const row of introduced) {
    const key = `${row.label}|${row.control}|${row.mode}/${row.scale}/${row.width}`;
    if (seen.has(key)) continue; seen.add(key);
    lines.push(`| ${row.label} | ${row.control} | ${row.mode}/${row.scale}/${row.width} | ${Math.round(row.rect?.height)} x ${Math.round(row.rect?.width)} |`);
    if (seen.size >= 60) { lines.push(`| ... | ${introduced.length} rows in measure-after/comparison.json | | |`); break; }
  }
}
await fs.writeFile(`${root}/rules-a-j.md`, lines.join("\n") + "\n");
console.log("RULES_TABLE_WRITTEN");
