import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import {
  expectedCaptureFiles,
  DESKTOP_STATES,
  STRESS_STATES,
  CASES,
  DELETE_THREAD_CONFIRMATIONS,
} from "./cases.mjs";
import { bounded } from "../problem-cycle-browser.mjs";

export { bounded };
export const sha256 = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

export function selectedCases(value) {
  if (value === "all") return Object.keys(CASES).sort();
  NodeAssert.ok(Object.hasOwn(CASES, value), `Unknown task case: ${value}`);
  return [value];
}

// A group is a coverage obligation, not evidence that anything ran.
export async function executeCheck(caseId, checkId, execute, observe) {
  /** @type {{caseId: string, checkId: string, status: string, assertions: Array<{label: string, actual: unknown, expected: unknown}>, artifacts: Array<{file: string, sha256: string}>, error?: string}} */
  const row = { caseId, checkId, status: "FAIL", assertions: [], artifacts: [] };
  const assert = (label, actual, expected) => {
    const assertion = { label, actual, expected };
    row.assertions.push(assertion);
    NodeAssert.deepEqual(actual, expected, label);
  };
  try {
    NodeAssert.equal(typeof execute, "function", `Unexecuted check: ${caseId}/${checkId}`);
    await execute(assert);
    NodeAssert.ok(row.assertions.length > 0, `No assertions executed: ${caseId}/${checkId}`);
    row.status = "PASS";
  } catch (error) {
    row.error = String(error);
  }
  try {
    row.artifacts = await observe();
    NodeAssert.ok(row.artifacts.length > 0, `No artifacts: ${caseId}/${checkId}`);
  } catch (error) {
    row.status = "FAIL";
    row.error = [row.error, String(error)].filter(Boolean).join("\n");
  }
  return row;
}

export function validateCheckCoverage(receipt) {
  NodeAssert.equal(receipt.schemaVersion, 1, "Unknown scenario receipt schema");
  const cases = selectedCases(receipt.selection);
  const expected = cases.flatMap((id) => CASES[id].checks.map((check) => `${id}/${check}`));
  const actual = receipt.checks.map((check) => `${check.caseId}/${check.checkId}`);
  NodeAssert.equal(new Set(actual).size, actual.length, "Duplicate scenario check");
  NodeAssert.deepEqual([...actual].sort(), expected.sort(), "Missing or unexpected scenario check");
  for (const check of receipt.checks) {
    const key = `${check.caseId}/${check.checkId}`;
    NodeAssert.equal(
      check.status,
      "PASS",
      `Scenario failed: ${key}: ${check.error ?? "no result"}`,
    );
    NodeAssert.ok(check.assertions.length > 0, `Unexecuted check: ${key}`);
    for (const assertion of check.assertions)
      NodeAssert.deepEqual(assertion.actual, assertion.expected, `${key}: ${assertion.label}`);
    NodeAssert.ok(check.artifacts.length > 0, `No source artifacts: ${key}`);
  }
  return cases;
}

async function boundArtifact(directory, reference) {
  NodeAssert.equal(typeof reference.file, "string", "Missing artifact path");
  NodeAssert.match(reference.sha256, /^[a-f0-9]{64}$/, "Missing artifact hash");
  const root = await NodeFSP.realpath(directory);
  const absolute = await NodeFSP.realpath(NodePath.resolve(root, reference.file));
  NodeAssert.ok(absolute.startsWith(root + NodePath.sep), "Escaped evidence path");
  const bytes = await NodeFSP.readFile(absolute);
  NodeAssert.equal(sha256(bytes), reference.sha256, `Stale artifact: ${reference.file}`);
  return bytes;
}

export async function verifyScenarioReceipt(directory, after) {
  const receipt = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, "scenario-receipt.json"), "utf8"),
  );
  const cases = validateCheckCoverage(receipt);
  NodeAssert.equal(
    receipt.revision,
    after.revision,
    "Scenario source revision differs from capture",
  );
  NodeAssert.equal(
    receipt.asarSha256,
    after.provenance.asarSha256,
    "Scenario package differs from capture",
  );
  NodeAssert.equal(receipt.cleanup.exited, true, "Scenario app leaked");
  NodeAssert.equal(receipt.counters.model, 0, "Unexpected paid model request");
  NodeAssert.equal(receipt.counters.blockedOutbound, 0, "Unexpected external network attempt");
  NodeAssert.ok(receipt.startedAt && receipt.completedAt, "Incomplete scenario run");
  NodeAssert.ok(!receipt.failure, `Failed scenario run: ${receipt.failure}`);
  const captured = JSON.parse((await boundArtifact(directory, receipt.capture)).toString("utf8"));
  const captureDirectory = NodePath.dirname(receipt.capture.file);
  NodeAssert.deepEqual(
    receipt.checks,
    captured.checks.map((check) => ({
      ...check,
      artifacts: check.artifacts.map((artifact) => ({
        ...artifact,
        file: `${captureDirectory}/${artifact.file}`,
      })),
    })),
    "Receipt assertions differ from executed capture",
  );
  NodeAssert.equal(captured.revision, receipt.revision, "Scenario capture source differs");
  NodeAssert.equal(
    captured.provenance.asarSha256,
    receipt.asarSha256,
    "Scenario capture package differs",
  );
  await verifyCapture(NodePath.join(directory, captureDirectory));
  const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
  for (const file of ["assert.mjs", "cases.mjs", "capture.mjs", "seed.mjs"]) {
    NodeAssert.equal(
      receipt.sources[file],
      sha256(await NodeFSP.readFile(NodePath.join(here, file))),
      `Stale scenario implementation: ${file}`,
    );
  }
  for (const check of receipt.checks)
    for (const artifact of check.artifacts) await boundArtifact(directory, artifact);
  return { receipt, cases };
}

export async function runCases(selection, evidence) {
  selectedCases(selection);
  const repo = process.env.WEAVRA_CAPTURE_REPO;
  const app = process.env.WEAVRA_CAPTURE_APP;
  NodeAssert.ok(repo && app, "Explicit WEAVRA_CAPTURE_REPO and WEAVRA_CAPTURE_APP required");
  const exec = NodeUtil.promisify(NodeChildProcess.execFile);
  const revision = (await exec("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
  NodeAssert.equal(
    (await exec("git", ["-C", repo, "diff", "HEAD", "--"])).stdout,
    "",
    "Commit source edits before scenario acceptance",
  );
  const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
  const sources = Object.fromEntries(
    await Promise.all(
      ["assert.mjs", "cases.mjs", "capture.mjs", "seed.mjs"].map(async (file) => [
        file,
        sha256(await NodeFSP.readFile(NodePath.join(here, file))),
      ]),
    ),
  );
  await NodeFSP.mkdir(evidence, { recursive: true });
  const run = `run-${NodeCrypto.randomUUID()}`;
  const output = NodePath.join(evidence, run);
  const receipt = {
    schemaVersion: 1,
    selection,
    revision,
    asarSha256: sha256(await NodeFSP.readFile(NodePath.join(app, "Contents/Resources/app.asar"))),
    sources,
    startedAt: new Date().toISOString(),
    checks: [],
    cleanup: { exited: false },
    counters: { model: 0, runtimeMutation: 0, blockedOutbound: 0 },
  };
  // Invalidate the previous receipt before attempting another app launch.
  const receiptPath = NodePath.join(evidence, "scenario-receipt.json");
  await NodeFSP.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  try {
    await exec(
      process.execPath,
      [
        NodePath.join(here, "capture.mjs"),
        "--revision",
        revision,
        "--matrix",
        "ledger-plus",
        "--case",
        selection,
        "--scenarios",
      ],
      {
        env: { ...process.env, WEAVRA_CAPTURE_OUT: output },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const capture = await verifyCapture(output);
    Object.assign(receipt, {
      checks: capture.checks.map((check) => ({
        ...check,
        artifacts: check.artifacts.map((artifact) => ({
          ...artifact,
          file: `${run}/${artifact.file}`,
        })),
      })),
      cleanup: capture.cleanup,
      counters: capture.counters,
      completedAt: new Date().toISOString(),
      capture: {
        file: `${run}/capture-manifest.json`,
        sha256: sha256(await NodeFSP.readFile(NodePath.join(output, "capture-manifest.json"))),
      },
    });
    validateCheckCoverage(receipt);
  } catch (error) {
    receipt.failure = String(error);
    if (error && typeof error === "object" && "stderr" in error)
      receipt.failure += `\n${error.stderr}`;
    throw error;
  } finally {
    await NodeFSP.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  }
  return receipt;
}
// Runs in the renderer. Text in a mounted but clipped pane is not screenshot evidence.
export function observeVisibleState({ target, boundary }) {
  const visible = (element, rect) => {
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
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
    renameTitle: [...document.querySelectorAll('input[aria-label="대화 제목"]')]
      .filter((e) => visible(e, e.getBoundingClientRect()))
      .map((e) => e.value),
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
  if (id === "44")
    NodeAssert.ok(
      DELETE_THREAD_CONFIRMATIONS.some(
        ({ title, action }) => observation.text.includes(title) && observation.text.includes(action),
      ),
      "Wrong thread delete confirmation",
    );
  else if (id !== "45" && (!boundary || boundary !== "end"))
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
  if (id === "45")
    NodeAssert.deepEqual(
      observation.renameTitle,
      ["03 Code blocks"],
      "Wrong visible rename editor",
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
    27: "archived",
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
      observation.text.includes("Recovery context") &&
        observation.text.includes("No model request was made."),
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
  NodeAssert.notEqual(packet.diagnostic, true, "Diagnostic capture is not acceptance evidence");
  NodeAssert.ok(!packet.failure, `Failed capture: ${packet.failure}`);
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
  await NodeFSP.rm(
    NodePath.join(directory, harnessOnly ? "harness-verdict.json" : "acceptance-verdict.json"),
    { force: true },
  );
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
  const files = after.manifest.flatMap((record) =>
    [record.file, record.electronFile].filter(Boolean),
  );
  NodeAssert.equal(
    new Set(diff.pairs.map((pair) => pair.file)).size,
    diff.pairs.length,
    "Duplicate diff pair",
  );
  NodeAssert.deepEqual(
    diff.pairs.map((pair) => pair.file).sort(),
    [...files].sort(),
    "Missing or unexpected diff pair",
  );
  NodeAssert.equal(diff.failures.length, 0);
  for (const pair of diff.pairs) {
    for (const [side, records] of [
      ["before", original.manifest],
      ["after", after.manifest],
    ]) {
      const record = records.find(
        (row) => row.file === pair.file || row.electronFile === pair.file,
      );
      NodeAssert.ok(record, `Unbound diff pair: ${pair.file}`);
      NodeAssert.equal(
        pair[`${side}Sha256`],
        record.file === pair.file ? record.sha256 : record.electronSha256,
        `Stale ${side} diff: ${pair.file}`,
      );
      const bytes = await boundArtifact(NodePath.join(directory, side, "capture"), {
        file: pair.file,
        sha256: pair[`${side}Sha256`],
      });
      NodeAssert.deepEqual(
        pair[`${side}Dimensions`],
        pngDimensions(bytes),
        `Wrong diff dimensions: ${pair.file}`,
      );
    }
    NodeAssert.ok(pair.result.dimensionsMatch);
    NodeAssert.ok(
      Number.isFinite(pair.result.diffRatio) &&
        pair.result.diffRatio >= 0 &&
        pair.result.diffRatio <= 1,
    );
    NodeAssert.ok(Number.isFinite(pair.result.similarityScore));
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
  if (NodePath.basename(NodePath.resolve(directory)) === "pr-01")
    NodeAssert.equal(
      harnessOnly,
      true,
      "Task 01 establishes harness evidence, not product remediation",
    );
  if (!harnessOnly) {
    const { receipt, cases } = await verifyScenarioReceipt(NodePath.join(directory, "qa"), after);
    const packetCase = NodePath.basename(NodePath.resolve(directory)).match(/^pr-(\d{2})$/)?.[1];
    if (packetCase) NodeAssert.deepEqual(cases, [packetCase], "Scenario case differs from packet");
    else NodeAssert.equal(receipt.selection, "all", "Final packet requires every case");
    Object.assign(result, {
      authority: "PACKAGED_SCENARIO_ACCEPTANCE",
      product: "PASS",
      closes: [...new Set(cases.flatMap((id) => CASES[id].closes))].sort(),
      cases,
      checks: receipt.checks.length,
      receiptSha256: sha256(
        await NodeFSP.readFile(NodePath.join(directory, "qa/scenario-receipt.json")),
      ),
    });
  }
  await NodeFSP.writeFile(
    NodePath.join(directory, harnessOnly ? "harness-verdict.json" : "acceptance-verdict.json"),
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
      case: { type: "string" },
      evidence: { type: "string" },
    },
  });
  NodeAssert.ok(
    Boolean(values["verify-packet"]) !== Boolean(values.case),
    "Usage: assert.mjs --case NN|all --evidence DIR OR --verify-packet DIR [--harness-only]",
  );
  console.log(
    JSON.stringify(
      values.case
        ? (NodeAssert.ok(
            values.evidence && !values["harness-only"],
            "Case execution requires --evidence and cannot be harness-only",
          ),
          await runCases(values.case, NodePath.resolve(values.evidence)))
        : await verifyPacket(NodePath.resolve(values["verify-packet"]), values["harness-only"]),
      null,
      2,
    ),
  );
}
