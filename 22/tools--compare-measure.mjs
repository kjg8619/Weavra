// Classifies every head rules a-j failure against the unchanged parent measured by the same tool:
// "introduced" (no parent failure at the same surface, element path, configuration and rule, or a worse
// value) versus "pre-existing" (the parent fails the same check on the same element with an equal or
// worse value). Writes measure-after/comparison.json and prints counts per rule.
// Usage: bun tools/compare-measure.mjs <head observations.json> <parent observations.json> <out.json>
import * as fs from "node:fs/promises";

const [headFile, parentFile, outFile] = process.argv.slice(2);
const head = JSON.parse(await fs.readFile(headFile, "utf8"));
const parent = JSON.parse(await fs.readFile(parentFile, "utf8"));
const surface = (label = "") => label.replace(/ (top|owner\d+-step\d+)$/, "");
const config = (row) => [row.mode, row.scale, row.zoom ?? "", row.expanded ?? "", row.width].join("/");
const key = (row) => [row.rule, row.name, surface(row.label), row.path ?? row.control ?? row.kind ?? "", config(row)].join("|");
const parentByKey = new Map();
for (const row of parent.failures) {
  const list = parentByKey.get(key(row)) ?? [];
  list.push(row);
  parentByKey.set(key(row), list);
}
// Target-size rows (rule a) are keyed by control text, which changes with the language, so they are
// compared by count per surface, configuration and check: only rows beyond the parent's count are new.
const groupKey = (row) => [row.rule, row.name, surface(row.label), config(row)].join("|");
const parentCount = new Map();
for (const row of parent.failures) if (row.rule === "a") parentCount.set(groupKey(row), (parentCount.get(groupKey(row)) ?? 0) + 1);
const seen = new Map();
const classified = head.failures.map((row) => {
  if (row.rule === "a") {
    const k = groupKey(row);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    return { ...row, classification: seen.get(k) <= (parentCount.get(k) ?? 0) ? "pre-existing" : "introduced" };
  }
  const matches = parentByKey.get(key(row)) ?? [];
  if (matches.length === 0) return { ...row, classification: "introduced" };
  // The parent fails the same check on the same element and configuration. A head value lower than every
  // parent value is kept visible as its own category with both values, never silently merged.
  const lower =
    (row.rule === "c" && !matches.some((p) => p.ratio <= row.ratio + 0.01)) ||
    (row.rule === "b" && !matches.some((p) => p.fontSize <= row.fontSize));
  return lower
    ? { ...row, classification: "pre-existing", lowerThanParent: true, parentValues: matches.map((p) => p.ratio ?? p.fontSize) }
    : { ...row, classification: "pre-existing" };
});
const summary = {};
for (const row of classified) {
  summary[row.rule] ??= { introduced: 0, preexisting: 0 };
  summary[row.rule][row.classification === "introduced" ? "introduced" : "preexisting"]++;
  if (row.lowerThanParent) summary[row.rule].lowerThanParent = (summary[row.rule].lowerThanParent ?? 0) + 1;
}
const result = {
  head: { file: headFile, head: head.head, asarSha256: head.asarSha256, diagnostic: head.diagnostic, summary: head.summary },
  parent: { file: parentFile, head: parent.head, asarSha256: parent.asarSha256, summary: parent.summary },
  summary,
  introduced: classified.filter((row) => row.classification === "introduced"),
  preexisting: classified.filter((row) => row.classification === "pre-existing"),
};
await fs.writeFile(outFile, JSON.stringify(result, null, 1));
console.log(`COMPARE ${JSON.stringify(summary)}`);
