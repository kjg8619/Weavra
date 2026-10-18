import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import { expectedCaptureFiles, DESKTOP_STATES, STRESS_STATES } from "./cases.mjs";
import { bounded } from "../problem-cycle-browser.mjs";

export { bounded };
export const sha256 = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
// Runs in the renderer. Text in a mounted but clipped pane is not screenshot evidence.
export function observeVisibleState({ target, boundary }) {
  const visible = (element, rect) => {
    if (!element.checkVisibility()) return false;
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let p = element.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        const box = p.getBoundingClientRect();
        clip = {
          left: Math.max(clip.left, box.left),
          top: Math.max(clip.top, box.top),
          right: Math.min(clip.right, box.right),
          bottom: Math.min(clip.bottom, box.bottom),
        };
      }
    }
    const hit = document.elementFromPoint(
      (rect.left + rect.right) / 2,
      (rect.top + rect.bottom) / 2,
    );
    return (
      (hit === element || element.contains(hit) || hit?.contains(element)) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > clip.left &&
      rect.left < clip.right &&
      rect.top >= clip.top - 1 &&
      rect.bottom <= clip.bottom + 1
    );
  };
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some((r) => visible(node.parentElement, r)))
      texts.push(node.textContent);
  }
  const node = document.querySelector(target);
  const rect = node.getBoundingClientRect();
  let port = node.parentElement;
  while (
    port &&
    !(
      /(auto|scroll)/.test(getComputedStyle(port).overflowY) &&
      port.scrollHeight > port.clientHeight
    )
  )
    port = port.parentElement;
  const clip = port?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
  const edge = boundary === "end" ? rect.bottom : rect.top;
  const desired = boundary === "end" ? clip.bottom : clip.top;
  const limit = port
    ? boundary === "end"
      ? port.scrollTop <= 1
      : port.scrollTop + port.clientHeight >= port.scrollHeight - 1
    : false;
  return {
    text: texts.join(" ").replace(/\s+/g, " "),
    route: location.hash,
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    selectedAppearance: document
      .querySelector('[aria-label="Appearance mode"] [aria-pressed="true"]')
      ?.getAttribute("aria-label"),
    customModel: document.querySelector('input[id$="-custom-model"]')?.value,
    filesPane: [...document.querySelectorAll('button[aria-label="Refresh workspace files"]')].some(
      (e) => visible(e, e.getBoundingClientRect()),
    ),
    terminal: [...document.querySelectorAll("canvas")].some((e) =>
      visible(e, e.getBoundingClientRect()),
    ),
    boundary: boundary
      ? {
          position: boundary,
          aligned: Math.abs(edge - desired) <= 2 || limit,
          visible: rect.bottom > clip.top && rect.top < clip.bottom,
          edge,
          desired,
        }
      : null,
  };
}
/** @param {{ target?: string, boundary?: string | null, theme?: string | null }} contract */
export function validateVisibleState(id, observation, contract = {}) {
  const { target = "body", boundary = null, theme = null } = contract;
  const state = [...DESKTOP_STATES, ...STRESS_STATES].find((s) => s.id === id);
  NodeAssert.ok(state, `Unknown state: ${id}`);
  if (!boundary || boundary !== "end")
    NodeAssert.ok(
      observation.text.includes(state.expected),
      `Visible state mismatch ${id}: ${state.expected}`,
    );
  if (boundary) {
    NodeAssert.equal(observation.boundary?.position, boundary, `Wrong boundary ${id}`);
    NodeAssert.ok(
      observation.boundary?.aligned && observation.boundary?.visible,
      `Section boundary mismatch ${id}: ${JSON.stringify(observation.boundary)}`,
    );
  }
  if (["46", "47", "48"].includes(id)) {
    const expected = { 46: "#weavra-controls", 47: "#weavra-evidence", 48: "#weavra-fitness" }[id];
    NodeAssert.ok(
      target === expected || (id === "48" && target === "#project-actions"),
      `Wrong section ${id}`,
    );
  }
  if (id === "10") NodeAssert.ok(observation.filesPane, "Files pane not visible");
  if (id === "16") NodeAssert.ok(observation.terminal, "Terminal not initialized");
  if (id === "18" || id === "19")
    NodeAssert.equal(
      observation.selectedAppearance,
      `Use ${id === "18" ? "light" : "dark"} mode`,
      "Wrong selected appearance",
    );
  if (id === "28")
    NodeAssert.equal(
      observation.customModel,
      "capture-fixture-unsaved",
      "Custom model form not populated",
    );
  const settings = {
    17: "general",
    18: "appearance",
    19: "appearance",
    20: "keybindings",
    21: "snap-shot",
    22: "providers",
    23: "integrations",
    24: "source-control",
    25: "storage",
    26: "connections",
    27: "archive",
    28: "providers",
  };
  if (settings[id])
    NodeAssert.equal(observation.route, `#/settings/${settings[id]}`, `Wrong settings page ${id}`);
  if (theme) NodeAssert.equal(observation.theme, theme, `Wrong theme ${id}`);
  const threads = {
    34: "messages",
    35: "long",
    36: "code",
    37: "working",
    38: "error",
    39: "empty",
    41: "code",
    42: "code",
    43: "code",
  };
  if (threads[id])
    NodeAssert.ok(
      observation.route.includes(`baseline-${threads[id]}`),
      `Wrong selected thread ${id}`,
    );
  if (id === "38")
    NodeAssert.ok(
      observation.text.includes("Demonstrate a recoverable provider failure."),
      "Missing error recovery context",
    );
  return observation;
}
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
  if (["36", "41", "42", "43"].includes(record.stateId))
    NodeAssert.ok(record.paint?.colors >= 16, `Unpainted code fixture: ${record.file}`);
  validateVisibleState(record.stateId, record.visibleState, record.stateContract);
}
export function validateProvenance(provenance, revision) {
  NodeAssert.equal(provenance.revision, revision, "Stale source revision");
  NodeAssert.ok(
    (provenance.appRevision ?? revision).startsWith(provenance.packagedRevision),
    "Stale packaged build",
  );
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
  const expected = expectedCaptureFiles();
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
  const original = await verifyCapture(NodePath.join(directory, "before/capture"));
  NodeAssert.deepEqual(
    original.manifest.map((r) => r.file).sort(),
    after.manifest.map((r) => r.file).sort(),
    "Before/after sets differ",
  );
  for (const r of original.manifest)
    pngDimensions(await NodeFSP.readFile(NodePath.join(directory, "before/capture", r.file)));
  const diff = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, "diff/pairs.json"), "utf8"),
  );
  for (const file of expectedCaptureFiles()) {
    NodeAssert.ok(
      diff.pairs.some((pair) => pair.file === file),
      `Missing pair: ${file}`,
    );
  }
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
