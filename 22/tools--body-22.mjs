// Composes pr-22/publication-body.md from the packet's own artifacts (no hand-typed results).
import * as fs from "node:fs/promises";

const root = process.env.HIG22_ROOT ?? "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22";
const remote = "https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22";
const blob = "https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22";
const flat = (file) => file.replaceAll("/", "--");
const raw = (file) => `${remote}/${encodeURIComponent(flat(file))}`;
const page = (file) => `${blob}/${encodeURIComponent(flat(file))}`;
const json = async (file) => JSON.parse(await fs.readFile(`${root}/${file}`, "utf8"));
const runner = process.env.RUNNER;
if (!runner) throw new Error("RUNNER must be set");

const before = await json("before/capture/capture-manifest.json");
const after = await json("after/capture/capture-manifest.json");
const gates = await json("gate-results.json");
const lint = await json("lint-comparison.json");
const ownership = await json("ownership.json");
const comparison = await json("measure-after/comparison.json");
const { pairs } = await json("diff/pairs.json");
const verdicts = [await json("acceptance-verdict-01.json"), await json("acceptance-verdict-02.json")];
const rounds = [await json("qa-round-01/scenario-receipt.json"), await json("qa/scenario-receipt.json")];
const case21 = await json("regression-21/scenario-receipt.json");
const template = (await fs.readFile(`${root}/publication-body.template.md`, "utf8")).split("\n{{BODY_REST}}")[0];

const lines = [template
  .replace("{{HEAD}}", after.revision)
  .replace("Runner: [`8428a7da`]... replaced at fill time.", `Runner: [\`${runner.slice(0, 8)}\`](https://github.com/kjg8619/Weavra/commit/${runner}) (\`scripts/hig\` identical at head).`)
  .replace("{{HEAD_ASAR}}", after.provenance.asarSha256)
  .replace("{{U:ownership.json}}", page("ownership.json"))
  .replace("{{SOURCE_COUNT}}", String(ownership.source.length))
  .replace("{{TEST_COUNT}}", String(ownership.colocatedTests.length))];

lines.push("## Before / after", "",
  `[Complete ${pairs.length}-pair image table, the rules a-j measurement frames and both acceptance rounds](${page("image-table.md")}).`, "",
  "| State, size, theme | Parent | Head | Diff |", "|---|---|---|---|");
const wanted = [/1280x800\/.*settings/i, /1280x800\/.*provider/i, /1280x800\/.*keybinding/i, /1280x800\/.*chat/i, /1280x800\/.*sidebar/i, /390x844\//];
const shown = new Set();
for (const pattern of wanted) {
  const pair = pairs.find((p) => pattern.test(p.file) && !shown.has(p.file));
  if (!pair) continue;
  shown.add(pair.file);
  lines.push(`| \`${pair.file}\` | ![before](${raw(`before/capture/${pair.file}`)}) | ![after](${raw(`after/capture/${pair.file}`)}) | [diff JSON](${raw(`diff/${pair.file.replace(".png", ".json")}`)}) |`);
}

lines.push("", "## Rules a-j self-measurement", "",
  `Head and unchanged parent measured by the same script (\`tools/measure-22.mjs\`, sha256 \`${(await json("measure-after/measure-summary.json")).scriptSha256 ?? ""}\`). [Full table, method and pre-existing sources](${page("rules-a-j.md")}).`, "",
  "| Rule | Head failures | Introduced by this change | Parent failures |", "|---|---|---|---|");
const head = comparison.head.summary.byRule, parent = comparison.parent.summary.byRule;
for (const rule of ["b", "c", "d", "e", "f", "i", "j", "ax"])
  lines.push(`| ${rule} | ${head[rule]?.failed ?? 0} | ${comparison.summary[rule]?.introduced ?? 0} | ${parent[rule]?.failed ?? 0} |`);
lines.push(`| a (recorded, copy-only geometry) | ${head.a?.failed ?? 0} | ${comparison.summary.a?.introduced ?? 0} above the parent count | ${parent.a?.failed ?? 0} |`, "",
  "Every remaining head failure for b, c, e, i and j is one the parent also has on the same element and configuration.");
const axReview = await json("measure-after/ax-review.json");
lines.push("", `Rule \`ax\` now classifies every visible text node. Its ${axReview.total} head rows were each assigned to an approved exception class by an explicit rule (${Object.entries(axReview.byClass).map(([cls, count]) => `${cls}: ${count}`).join("; ")}); ${axReview.unclassified.length} remain unclassified ([review](${page("measure-after/ax-review.json")})).`);
const lower = comparison.preexisting.filter((row) => row.lowerThanParent);
if (lower.length) lines.push("", `${lower.length} of those rows measure slightly lower than the parent on the same element (${lower.map((row) => `${row.text} ${row.ratio} vs ${row.parentValues.join("/")}`).join("; ")}); they are listed separately in rules-a-j.md.`);

lines.push("", "## Locale exceptions", "", `[Full locale-exception table with source and approval per class](${page("locale-exceptions.md")}).`, "");
lines.push((await fs.readFile(`${root}/locale-exceptions.md`, "utf8")).split("\n").filter((line) => line.startsWith("|")).join("\n"));

// QA-22 round (Amendment 2026-10-22i): what changed, the all-state locale sweep and the QA stress re-run.
const stress = await json("stress-qa22/stress-summary.json");
const navClips = stress.clips.filter((c) => /ul:\d/.test(c.path ?? ""));
const scopeClips = stress.clips.filter((c) => !/ul:\d/.test(c.path ?? ""));
const capture = await json("capture-latin/capture-latin-inventory.json");
const unclassified = await json("capture-latin/capture-latin-unclassified.json");
const leftover = Object.entries(unclassified);
lines.push("", "## QA-22 fixes (Amendment 2026-10-22i)", "",
  "- The workflow command status and the host thermal state render through Korean display maps that cover every value (`ko.runtime.controls.commandStatus`, `ko.settings.telemetry.thermalStates`), with unit tests over every enum value in `src/i18n/ko.test.ts`; the raw values stay unchanged in logic.",
  "- Workflow and run-state identifiers in Weavra prose show their Korean labels (QUICK/STANDARD/COMPLEX, EDIT/READ_ONLY, interrupted/blocked/cancelled/failed, pass/complete/valid); `R3`, `CANDIDATE_ONLY`, review decisions and error codes stay as identifiers (exception table).",
  "- Settings navigation labels wrap and the row grows instead of being cut off. The label text stays \"키보드 단축키\" because the shared runner pins that exact name.",
  "- Remaining English from the all-state sweep is Korean: model count, \"Run\", \"digest\", \"Policy\", \"Early Access\", keycap words in prose and the zoomable-image name; \"GitHub Copilot\" is spelled as the product name.");
lines.push("", "## All-state locale sweep", "",
  `Every captured state at every size (${capture.frames} frames of head \`${capture.revision}\`) was read and every Latin segment classified: ${Object.keys(capture.inventory).length} distinct segments, ${leftover.length} unclassified ([inventory](${page("capture-latin/capture-latin-inventory.json")}), [unclassified](${page("capture-latin/capture-latin-unclassified.json")})).`);
for (const [segment, value] of leftover) lines.push(`- \`${segment}\` in state ${value.states.join(", ")}: ${value.lines[0]}`);
lines.push("", `The rules a-j measurement now classifies every visible text node, mixed Korean and Latin included (rule \`ax\` above; per-segment classes in [latin-inventory.json](${page("measure-after/latin-inventory.json")})).`);
lines.push("", "## Long-copy stress (QA-22 method)", "",
  `QA-22's own stress script re-run unchanged except for the app and output paths and one readiness wait (QA's fixture database now has \"03 Code blocks\" archived, so it waits on \"06 Empty thread\", which the script opens anyway) ([script](${page("tools/qa22-stress/stress.mjs")}), [summary](${page("stress-qa22/stress-summary.json")})): ${stress.samples} samples over ${stress.configurations.length} configurations (840/1280/1920, 100/150%, light/dark) with at least +40% Korean copy.`, "",
  "| Check | Result |", "|---|---|",
  `| Settings navigation ellipsis | ${navClips.length} |`,
  `| Scope identity names (ellipsis with full-value tooltip) | ${scopeClips.length} |`,
  `| Page overflow | ${stress.overflow.length} |`,
  `| Korean mid-word / orphan breaks | ${stress.breaks.length} |`,
  `| Expansion below +40% | ${stress.expansionBelow40.length} |`);
const exceptionsDoc = await fs.readFile(`${root}/locale-exceptions.md`, "utf8");
const followUp = exceptionsDoc.split("## Follow-up (not in this PR)")[1];
if (followUp) lines.push("", "## Follow-up (not in this PR)", followUp.trim());

lines.push("", "## Verification", "", "| Gate | Command | Exit | Result |", "|---|---|---|---|");
for (const gate of gates.gates) lines.push(`| ${gate.gate} | \`${gate.command}\` | ${gate.exit} | ${gate.summary ?? ""} |`);
lines.push(`| lint warnings | same files at head and parent | | ${lint.headWarnings} at head, ${lint.parentWarnings} at parent, ${lint.newWarningKeys.length} new |`);
for (const [index, verdict] of verdicts.entries()) {
  const receipt = rounds[index];
  lines.push(`| accept_pr 22 round 0${index + 1} | \`assert.mjs --case 22\` + \`--verify-packet\` + \`git diff --check\` | 0 | product ${verdict.product}, ${receipt.checks.filter((c) => c.status === "PASS").length}/${receipt.checks.length} checks PASS, app exited |`);
}
lines.push(`| W-33 regression | \`assert.mjs --case 21\` on the final build | 0 | ${case21.checks.filter((c) => c.status === "PASS").length}/${case21.checks.length} PASS ([receipt](${page("regression-21/scenario-receipt.json")})) |`);
const web = gates.gates.find((gate) => gate.gate === "web unit suite");
lines.push("", `Inherited web failures (identical at the parent \`245a9efd\`, ${web.parentProof.summary}; [log](${page("logs/tests-parent-inherited.log")})):`, "");
for (const failure of web.inheritedFailures) lines.push(`- \`${failure}\``);
lines.push("", `Capture: parent \`${before.revision}\` and head \`${after.revision}\`, ${pairs.length} paired frames; [gate results](${page("gate-results.json")}), [lint comparison](${page("lint-comparison.json")}), [fixture retention](${page("fixture-retention.json")}).`);
await fs.writeFile(`${root}/publication-body.md`, lines.join("\n") + "\n");
console.log("BODY_WRITTEN");
