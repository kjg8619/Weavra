// Assigns every remaining head `ax` row to an approved exception class by an explicit rule, or leaves it unclassified.
// Usage: bun tools/ax-review-22.mjs measure-after/observations.json measure-after/ax-review.json
import * as fs from "node:fs/promises";

const [input, output] = process.argv.slice(2);
const observations = JSON.parse(await fs.readFile(input, "utf8"));
const rules = [
  {
    cls: "original diagnostic (raw error text in the Diagnostics failure table)",
    test: (row) => /diagnostics$/.test(row.label) && /<td<tr<tbody$/.test(row.path ?? "") && /^[A-Z][A-Za-z]*Error:/.test(row.text ?? ""),
  },
  { cls: "host name (data)", test: (row) => (row.bad ?? []).every((segment) => segment === "localhost") },
];
const rows = observations.failures.filter((row) => row.rule === "ax");
const byClass = {};
const unclassified = [];
for (const row of rows) {
  const rule = rules.find((candidate) => candidate.test(row));
  if (rule) byClass[rule.cls] = (byClass[rule.cls] ?? 0) + 1;
  else unclassified.push({ label: row.label, name: row.name, text: row.text ?? row.control, bad: row.bad, path: row.path });
}
await fs.writeFile(output, JSON.stringify({ head: observations.head, total: rows.length, byClass, unclassified }, null, 2));
console.log(`AX_REVIEW total=${rows.length} unclassified=${unclassified.length} ${JSON.stringify(byClass)}`);
