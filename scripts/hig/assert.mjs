import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import { expectedFiles } from "./cases.mjs";
import { bounded } from "../problem-cycle-browser.mjs";

export { bounded };
export const sha256 = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
export function pngDimensions(bytes) {
  NodeAssert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  NodeAssert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function validateRecord(record, bytes) {
  NodeAssert.equal(sha256(bytes), record.sha256, `Wrong hash: ${record.file}`);
  const dimensions = pngDimensions(bytes);
  NodeAssert.deepEqual(dimensions, record.viewport, `Wrong dimensions: ${record.file}`);
  NodeAssert.ok(record.stateId && record.target && record.body, `Unbound state: ${record.file}`);
  NodeAssert.equal(record.readiness.stableFrames, 2, `Unstable frame: ${record.file}`);
  NodeAssert.ok(
    record.targetRect.width > 0 && record.targetRect.height > 0,
    `Empty target: ${record.file}`,
  );
  if (!record.stress)
    NodeAssert.ok(record.targetVisible, `Target outside scrollport: ${record.file}`);
}
export function validateProvenance(provenance, revision) {
  NodeAssert.equal(provenance.revision, revision, "Stale source revision");
  NodeAssert.ok(revision.startsWith(provenance.packagedRevision), "Stale packaged build");
  NodeAssert.ok(provenance.packagedRevision.length >= 7, "Missing packaged revision");
  NodeAssert.equal(provenance.trackedDiff, "", "Dirty source build");
  NodeAssert.match(provenance.asarSha256, /^[a-f0-9]{64}$/);
  NodeAssert.match(provenance.captureSha256, /^[a-f0-9]{64}$/);
  NodeAssert.ok(provenance.fixtureVersion);
}
export function validateDistinctStates(records) {
  for (const size of ["1280x800", "1920x1080"]) {
    const evidence = records.find((r) => r.file === `${size}/47_project_settings_evidence.png`);
    const fitness = records.find((r) => r.file === `${size}/48_project_settings_model_fitness.png`);
    NodeAssert.ok(evidence && fitness, `Missing 47/48 at ${size}`);
    NodeAssert.equal(evidence.target, "#weavra-evidence");
    NodeAssert.equal(fitness.target, "#weavra-fitness");
    NodeAssert.notEqual(evidence.sha256, fitness.sha256, `Duplicate 47/48 evidence: ${size}`);
    NodeAssert.ok(evidence.body.includes("증거"), "Evidence body missing");
    NodeAssert.ok(fitness.body.includes("기록"), "Fitness body missing");
  }
}
export async function verifyCapture(directory) {
  const packet = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, "capture-manifest.json"), "utf8"),
  );
  validateProvenance(packet.provenance, packet.revision);
  const expected = expectedFiles();
  NodeAssert.equal(
    new Set(packet.manifest.map((r) => r.file)).size,
    packet.manifest.length,
    "Duplicate filename",
  );
  for (const file of expected) {
    const record = packet.manifest.find((r) => r.file === file);
    NodeAssert.ok(record, `Missing PNG: ${file}`);
  }
  for (const record of packet.manifest) {
    const absolute = NodePath.resolve(directory, record.file);
    NodeAssert.ok(
      absolute.startsWith(NodePath.resolve(directory) + NodePath.sep),
      "Escaped evidence path",
    );
    validateRecord(record, await NodeFSP.readFile(absolute));
    if (record.electronFile) {
      const native = await NodeFSP.readFile(NodePath.join(directory, record.electronFile));
      NodeAssert.equal(sha256(native), record.electronSha256, "Native capture hash");
      pngDimensions(native);
    }
  }
  validateDistinctStates(packet.manifest);
  NodeAssert.deepEqual(packet.nativeMinimum.minimum, [840, 620]);
  NodeAssert.equal(packet.nativeMinimum.enforced, true);
  NodeAssert.equal(packet.cleanup.exited, true, "Owned app leaked");
  NodeAssert.equal(packet.counters.model, 0, "Model calls in default capture");
  NodeAssert.equal(packet.counters.runtimeMutation, 0, "Runtime mutation in default capture");
  NodeAssert.equal(packet.counters.blockedOutbound, 0, "Unexpected external network attempt");
  NodeAssert.equal(packet.fileDigests.before, packet.fileDigests.after, "Workspace modified");
  NodeAssert.equal(
    await NodeFSP.realpath(packet.isolation.home),
    NodePath.join(packet.isolation.base, "home"),
  );
  NodeAssert.equal(
    await NodeFSP.realpath(packet.isolation.workspace),
    NodePath.join(packet.isolation.base, "workspace"),
  );
  NodeAssert.equal(
    await NodeFSP.realpath(packet.isolation.app),
    NodePath.join(packet.isolation.base, "app"),
  );
  NodeAssert.ok(
    packet.isolation.userData.startsWith(packet.isolation.home + NodePath.sep),
    "Leaked profile",
  );
  return packet;
}

export async function verifyPacket(directory, harnessOnly) {
  const after = await verifyCapture(NodePath.join(directory, "after/capture"));
  // Original recipe is retained unmodified. It has known duplicate/blank evidence,
  // so only the repaired set may be subjected to the new state-bound contract.
  const original = JSON.parse(
    await NodeFSP.readFile(
      NodePath.join(directory, "before/capture/capture-manifest.json"),
      "utf8",
    ),
  );
  NodeAssert.deepEqual(
    original.manifest.map((r) => r.file).sort(),
    expectedFiles().sort(),
    "Original set incomplete",
  );
  for (const r of original.manifest)
    pngDimensions(await NodeFSP.readFile(NodePath.join(directory, "before/capture", r.file)));
  const diff = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, "diff/pairs.json"), "utf8"),
  );
  NodeAssert.equal(diff.pairs.length, 94);
  NodeAssert.equal(diff.failures.length, 0);
  for (const pair of diff.pairs) {
    NodeAssert.ok(pair.result.dimensionsMatch);
    NodeAssert.equal(typeof pair.result.diffRatio, "number");
    NodeAssert.equal(typeof pair.result.similarityScore, "number");
    NodeAssert.ok(Array.isArray(pair.result.hotspots));
    NodeAssert.equal(typeof pair.result.alphaChannelIntact, "boolean");
  }
  const result = {
    authority: "CAPTURE_HARNESS_ONLY",
    harness: "PASS",
    product: "NOT_REMEDIATED",
    closes: [],
    prerequisite: "G-07",
    baselineFindings: after.baselineFindings,
    images: after.manifest.length,
    pairs: diff.pairs.length,
    revision: after.revision,
    harnessOnly,
  };
  NodeAssert.ok(
    harnessOnly,
    "Product acceptance requires the task-specific interactive scenario receipt; harness-only is not product PASS",
  );
  await NodeFSP.writeFile(
    NodePath.join(directory, "harness-verdict.json"),
    JSON.stringify(result, null, 2),
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const { values } = NodeUtil.parseArgs({
    options: {
      "verify-packet": { type: "string" },
      "harness-only": { type: "boolean", default: false },
    },
  });
  NodeAssert.ok(
    values["verify-packet"],
    "Usage: NodeAssert.mjs --verify-packet DIR --harness-only",
  );
  console.log(
    JSON.stringify(
      await verifyPacket(NodePath.resolve(values["verify-packet"]), values["harness-only"]),
      null,
      2,
    ),
  );
}
