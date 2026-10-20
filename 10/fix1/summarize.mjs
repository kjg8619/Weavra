import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const O = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-10-fix1-measure";
const reports = await Promise.all(["supported", "unsupported"].map(async (mode) => JSON.parse(await fs.readFile(`${O}/${mode}.json`, "utf8"))));
const measureHash = createHash("sha256").update(await fs.readFile(`${O}/measure.mjs`)).digest("hex");
for (const r of reports) {
  if (r.scriptSha256 !== measureHash) throw Error(`Stale measurement script: ${r.mode}`);
  if (r.error || !r.cleanup.exited || r.failures.length || Object.values(r.counters).some(Boolean)) throw Error(`Failed measurement: ${r.mode}`);
  for (const frame of r.frames) {
    const b = await fs.readFile(frame.file);
    if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || createHash("sha256").update(b).digest("hex") !== frame.sha256) throw Error(`Invalid PNG artifact: ${frame.file}`);
  }
}
const rows = reports.flatMap((r) => r.rows);
const table = [];
for (const theme of ["light", "dark"]) for (const width of [840, 1280, 1920]) for (const scale of [100, 150]) {
  const r = rows.filter((r) => r.theme === theme && r.width === width && r.scale === scale);
  const measurements = r.filter((r) => r.kind === "measurement");
  const checks = r.filter((r) => r.kind === "assert");
  const icon = measurements.filter((r) => r.icon);
  const controls = measurements.filter((r) => typeof r.icon === "boolean");
  const edges = controls.filter((r) => !r.icon && r.borderContrast && ["graph", "fitness", "unsupported"].includes(r.surface));
  const readability = checks.filter((r) => r.name === "text readability");
  const escapes = checks.filter((r) => r.name.startsWith("F1"));
  table.push({ theme, width, scale, escapesPassed: escapes.filter((r) => r.pass).length, escapesTotal: escapes.length,
    minIconWidth: Math.min(...icon.map((r) => r.rect.width)), minIconHeight: Math.min(...icon.map((r) => r.rect.height)),
    requiredClipping: checks.filter((r) => r.name === "F3 required text wraps" && !r.pass).length,
    minEdgeContrast: Math.min(...edges.map((r) => r.borderContrast)),
    maxExternalIntersection: Math.max(0, ...controls.flatMap((r) => r.external.map((r) => r.area))),
    textMinimum: Math.min(...measurements.filter((r) => !r.icon).map((r) => r.fontSize)),
    minTextContrast: Math.min(...measurements.filter((r) => !r.icon).map((r) => r.contrast)),
    diagnosticGroupGap: Math.min(...checks.filter((r) => r.name === "F2 diagnostic group gap >=8").map((r) => r.minimum)),
    fitnessGroupGap: Math.min(...checks.filter((r) => r.name === "F2 distinct group gap >=8").map((r) => r.gap)),
    readabilityFailures: readability.filter((r) => !r.pass).length,
    failureCount: checks.filter((r) => !r.pass).length });
}
const summary = { revisions: reports.map((r) => r.revision), asarHashes: reports.map((r) => r.asarSha256), table,
  modes: reports.map((r) => ({ mode: r.mode, error: r.error ?? null, failures: r.failures.length, rows: r.rows.length, counters: r.counters, cleanup: r.cleanup })),
  scriptHashes: Object.fromEntries(await Promise.all(["measure.mjs", "guarded-run.mjs", "capture-accept.sh"].map(async (f) => [f, createHash("sha256").update(await fs.readFile(`${O}/${f}`)).digest("hex")]))),
  frames: reports.flatMap((r) => r.frames) };
summary.fitnessRequests = reports.flatMap((r) => r.events.map((s) => JSON.parse(s))).filter((r) => r._tag === "Request" && r.tag === "weavra.fitness").map((r) => r.payload);
await fs.writeFile(`${O}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
