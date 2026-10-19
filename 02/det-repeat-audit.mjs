import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCapture, verifyScenarioReceipt } from "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig/assert.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const after = await verifyCapture(join(root, "after/capture"));
const rounds = [];
const intersection = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
for (const packet of [join(root, "repeat-01/pr-02"), root]) {
  const qa = join(packet, "qa");
  const { receipt } = await verifyScenarioReceipt(qa, after);
  const captured = await verifyCapture(join(qa, dirname(receipt.capture.file)));
  const notices = [];
  let foreground = 0;
  for (const run of captured.runs) {
    assert(run.networkFixture.settingsSnapshots > 0);
    assert.equal(run.networkFixture.unexpectedUpdateChecks, false);
    const settings = JSON.parse(await fs.readFile(join(run.isolation.app, "userdata/settings.json"), "utf8"));
    assert.equal(settings.enableProviderUpdateChecks, false, "Update checks were re-enabled");
  }
  for (const row of captured.manifest) {
    const controls = row.controls.filter((control) => control.visible && control.iconControl);
    notices.push({
      file: row.file,
      mountedNotifications: row.controls.filter((control) =>
        control.visible && control.name === "Dismiss notification").length,
    });
    for (const control of controls) {
      assert(control.rect.width >= 36 && control.rect.height >= 36, row.file);
      if (!control.disabled && control.hits[0]) {
        assert.deepEqual(control.hits, [true, true, true, true, true], `${row.file}: ${control.name}`);
        foreground++;
      }
    }
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++)
      assert(intersection(controls[i].rect, controls[j].rect) <= 0.5, `${row.file}: overlap`);
  }
  assert(notices.every((row) => row.mountedNotifications === 0), "Unsolicited notice in capture");
  const browser = captured.manifest.find((row) => row.file === "1920x1080/15_right_browser.png");
  const names = ["Open in system browser", "Annotate preview", "Capture screenshot", "Float preview over chat"];
  const toolbar = browser.controls.filter((control) => names.includes(control.name));
  assert.equal(toolbar.length, names.length);
  rounds.push({
    capture: receipt.capture.file,
    startedAt: receipt.startedAt,
    revision: receipt.revision,
    asarSha256: receipt.asarSha256,
    fixtureVersion: captured.provenance.fixtureVersion,
    checks: receipt.checks.map(({ checkId, status, assertions }) => ({ checkId, status, assertions: assertions.length })),
    profiles: captured.runs.map((run) => ({ base: run.isolation.base, policy: run.networkFixture })),
    foreground, notices, toolbar,
  });
}
assert.notEqual(rounds[0].capture, rounds[1].capture, "Acceptance did not create a fresh capture");
assert.deepEqual(rounds[0].notices, rounds[1].notices, "Notification state differs");
assert.deepEqual(rounds[0].toolbar, rounds[1].toolbar, "Browser toolbar geometry/hits differ");
assert.equal(rounds[0].asarSha256, rounds[1].asarSha256);
assert.equal(rounds[0].fixtureVersion, "hig-offline-projection-v4");
const result = { status: "PASS", distinctFreshCaptures: true, identicalNotificationState: true, identicalBrowserToolbar: true, rounds };
await fs.writeFile(join(root, "determinism.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, captures: rounds.map((r) => r.capture), foreground: rounds.map((r) => r.foreground), toolbar: rounds.map((r) => r.toolbar.map(({name, hits}) => ({name, hits}))) }, null, 2));
