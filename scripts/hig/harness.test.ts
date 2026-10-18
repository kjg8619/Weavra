import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expectedFiles, chooseAlias } from "./cases.mjs";
import {
  bounded,
  pngDimensions,
  sha256,
  validateRecord,
  validateProvenance,
  validateDistinctStates,
  verifyCapture,
} from "./assert.mjs";
import { assertProfile, seed } from "./seed.mjs";

function image(width = 1280, height = 800) {
  const png = Buffer.alloc(24);
  png.write("89504e470d0a1a0a", 0, "hex");
  png.write("IHDR", 12);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}
function record() {
  return {
    file: "1280x800/01_first_launch_onboarding_connection.png",
    sha256: sha256(image()),
    viewport: { width: 1280, height: 800 },
    stateId: "01",
    target: "body",
    body: "fixture",
    readiness: { stableFrames: 2 },
    targetRect: { width: 100, height: 100 },
    targetVisible: true,
    stress: false,
  };
}
function provenance() {
  return {
    revision: "a".repeat(40),
    packagedRevision: "a".repeat(12),
    trackedDiff: "",
    asarSha256: "b".repeat(64),
    captureSha256: "c".repeat(64),
    fixtureVersion: "v1",
  };
}

describe("state-bound capture evidence", () => {
  test("contains exactly 92 desktop files and two stress files", () => {
    // Given the immutable legacy state IDs, when expanded at both sizes,
    const files = expectedFiles();
    // Then neither desktop 42/43 nor a missing numbered state is invented.
    expect(new Set(files).size).toBe(94);
    expect(files.filter((f: string) => !f.startsWith("390x844/"))).toHaveLength(92);
    expect(files.filter((f: string) => f.startsWith("390x844/"))).toEqual([
      "390x844/42_narrow_chat_dark.png",
      "390x844/43_narrow_chat_light.png",
    ]);
  });
  test("rejects an image with the wrong dimensions", () => {
    const bytes = image(1920, 1080);
    const row = { ...record(), sha256: sha256(bytes) };
    expect(() => validateRecord(row, bytes)).toThrow("Wrong dimensions");
  });
  test("rejects a changed image under an old hash", () => {
    const bytes = image();
    bytes[23] = 1;
    expect(() => validateRecord(record(), bytes)).toThrow("Wrong hash");
  });
  test("rejects a non-PNG frame", () => {
    expect(() => pngDimensions(Buffer.alloc(24))).toThrow("PNG signature");
  });
  test("rejects unpainted code despite visible DOM geometry", () => {
    expect(() =>
      validateRecord({ ...record(), stateId: "41", paint: { colors: 1 } }, image()),
    ).toThrow("Unpainted code fixture");
  });
  test("accepts painted code with matching image identity", () => {
    expect(() =>
      validateRecord({ ...record(), stateId: "41", paint: { colors: 32 } }, image()),
    ).not.toThrow();
  });
  test("rejects duplicate 47 and 48 evidence", () => {
    const rows = ["1280x800", "1920x1080"].flatMap((size) => [
      {
        file: `${size}/47_project_settings_evidence.png`,
        target: "#weavra-evidence",
        sha256: "same",
        body: "증거",
      },
      {
        file: `${size}/48_project_settings_model_fitness.png`,
        target: "#weavra-fitness",
        sha256: "same",
        body: "기록",
      },
    ]);
    expect(() => validateDistinctStates(rows)).toThrow("Duplicate 47/48");
  });
  test("rejects a fitness frame bound to the evidence target", () => {
    const rows = ["1280x800", "1920x1080"].flatMap((size) => [
      {
        file: `${size}/47_project_settings_evidence.png`,
        target: "#weavra-evidence",
        sha256: "one",
        body: "증거",
      },
      {
        file: `${size}/48_project_settings_model_fitness.png`,
        target: "#weavra-evidence",
        sha256: "two",
        body: "기록",
      },
    ]);
    expect(() => validateDistinctStates(rows)).toThrow();
  });
  test("rejects a stale packaged revision", () => {
    expect(() =>
      validateProvenance({ ...provenance(), packagedRevision: "d".repeat(12) }, "a".repeat(40)),
    ).toThrow("Stale packaged build");
  });
  test("rejects a source edit made after building", () => {
    expect(() =>
      validateProvenance({ ...provenance(), trackedDiff: "diff" }, "a".repeat(40)),
    ).toThrow("Dirty source build");
  });
  test("rejects a leaked non-sibling profile", async () => {
    const base = await NodeFSP.mkdtemp("/tmp/weavra-hig-");
    try {
      const home = NodePath.join(base, "home");
      const app = NodePath.join(base, "app");
      const workspace = NodePath.join(home, "workspace");
      await NodeFSP.mkdir(workspace, { recursive: true });
      await NodeFSP.mkdir(app);
      expect(() => assertProfile(base, home, workspace, app)).toThrow("workspace");
    } finally {
      await NodeFSP.rm(base, { recursive: true });
    }
  });
  test("rejects a missing required PNG", async () => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "hig-packet-"));
    try {
      await NodeFSP.writeFile(
        NodePath.join(dir, "capture-manifest.json"),
        JSON.stringify({
          revision: "a".repeat(40),
          provenance: provenance(),
          manifest: [],
        }),
      );
      await expect(verifyCapture(dir)).rejects.toThrow("Missing PNG");
    } finally {
      await NodeFSP.rm(dir, { recursive: true });
    }
  });
  test("fails when a subscribed readiness event never arrives", async () => {
    const never = new Promise<void>(() => {});
    await expect(bounded(never, "scripted readiness", 1)).rejects.toThrow(
      "Timeout: scripted readiness",
    );
  });
  test("rejects selector ambiguity rather than picking the first alias", () => {
    expect(() => chooseAlias([1, 1])).toThrow("ambiguity");
    expect(() => chooseAlias([2, 0])).toThrow("ambiguity");
    expect(() => chooseAlias([0, 0])).toThrow("missing");
    expect(chooseAlias([0, 1])).toBe(1);
  });
  test("rejects target rectangles outside the scrollport", () => {
    expect(() => validateRecord({ ...record(), targetVisible: false }, image())).toThrow(
      "outside scrollport",
    );
  });
  test("seeds an existing isolated database without dispatching a turn", async () => {
    const base = await NodeFSP.realpath(await NodeFSP.mkdtemp("/tmp/weavra-hig-"));
    const home = NodePath.join(base, "home");
    const workspace = NodePath.join(base, "workspace");
    const app = NodePath.join(base, "app");
    await NodeFSP.mkdir(home);
    await NodeFSP.mkdir(NodePath.join(workspace, "baseline-project"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(app, "userdata"), { recursive: true });
    const databasePath = NodePath.join(app, "userdata/state.sqlite");
    const db = new Database(databasePath);
    try {
      const tables = {
        projection_projects: "project_id,title,workspace_root",
        projection_threads:
          "thread_id,project_id,title,model_selection_json,runtime_mode,interaction_mode,latest_turn_id,created_at,updated_at",
        projection_thread_messages:
          "message_id,thread_id,turn_id,role,text,is_streaming,created_at,updated_at",
        projection_thread_sessions:
          "thread_id,status,provider_name,provider_instance_id,runtime_mode,active_turn_id,last_error,updated_at",
        projection_turns:
          "thread_id,turn_id,pending_message_id,assistant_message_id,state,requested_at,started_at,completed_at,checkpoint_files_json",
      };
      for (const [name, columns] of Object.entries(tables)) {
        db.run(
          `CREATE TABLE ${name} (${columns
            .split(",")
            .map((column) => `${column} TEXT`)
            .join(",")})`,
        );
      }
      db.query("INSERT INTO projection_projects VALUES (?,?,?)").run(
        "project-1",
        "baseline-project",
        NodePath.join(workspace, "baseline-project"),
      );
      // When the capture seed opens the existing database,
      const receipt = seed({ base, home, workspace, app });
      // Then only the explicitly synthetic projection is added.
      expect(receipt.authority).toBe("SYNTHETIC_PROJECTION_ONLY");
      expect(db.query("SELECT count(*) AS count FROM projection_threads").get()).toEqual({
        count: 6,
      });
      expect(db.query("SELECT count(*) AS count FROM projection_turns").get()).toEqual({
        count: 5,
      });
    } finally {
      db.close();
      await NodeFSP.rm(base, { recursive: true });
    }
  });
});
