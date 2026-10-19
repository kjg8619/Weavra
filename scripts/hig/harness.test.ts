import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  expectedFiles,
  expectedCaptureFiles,
  chooseAlias,
  CASES,
  deliverScenarioEvent,
} from "./cases.mjs";
import {
  bounded,
  pngDimensions,
  sha256,
  validateRecord,
  validateProvenance,
  validateDistinctStates,
  verifyCapture,
  validateVisibleState,
  executeCheck,
  selectedCases,
  validateCheckCoverage,
} from "./assert.mjs";
import { assertProfile, seed } from "./seed.mjs";

describe("executed scenario coverage", () => {
  const artifact = { file: "observed.json", sha256: "a".repeat(64) };
  const receipt = () => ({
    schemaVersion: 1,
    selection: "02",
    checks: CASES["02"].checks.map((checkId: string) => ({
      caseId: "02",
      checkId,
      status: "PASS",
      assertions: [{ label: "measured ownership", actual: true, expected: true }],
      artifacts: [artifact],
    })),
  });
  test("expands all into every declared case without dropping task one", () => {
    expect(selectedCases("all")).toEqual(Object.keys(CASES).sort());
  });
  test("rejects an unknown case instead of running another case", () => {
    expect(() => selectedCases("23")).toThrow("Unknown task case");
  });
  test("fails a named check when no executor is registered", async () => {
    const result = await executeCheck("02", "portal-owner", undefined, async () => [artifact]);
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("Unexecuted check");
  });
  test("fails an executor that returns without asserting", async () => {
    const result = await executeCheck(
      "02",
      "portal-owner",
      async () => {},
      async () => [artifact],
    );
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("No assertions executed");
  });
  test("fails a real assertion even if an observation exists", async () => {
    const result = await executeCheck(
      "02",
      "portal-owner",
      async (assert: (label: string, actual: unknown, expected: unknown) => void) =>
        assert("hit owner", "background", "modal"),
      async () => [artifact],
    );
    expect(result.status).toBe("FAIL");
    expect(result.assertions).toHaveLength(1);
  });
  test("rejects a group-only PASS without executed assertions", () => {
    const input = receipt();
    input.checks[0].assertions = [];
    expect(() => validateCheckCoverage(input)).toThrow("Unexecuted check");
  });
  test("rejects a missing check even if all remaining checks pass", () => {
    const input = receipt();
    input.checks.pop();
    expect(() => validateCheckCoverage(input)).toThrow("Missing or unexpected");
  });
  test("rejects duplicated checks used to fill the expected count", () => {
    const input = receipt();
    input.checks[1] = input.checks[0];
    expect(() => validateCheckCoverage(input)).toThrow("Duplicate scenario check");
  });
  test("replays assertion values rather than trusting a PASS string", () => {
    const input = receipt();
    input.checks[0].assertions[0].actual = false;
    expect(() => validateCheckCoverage(input)).toThrow("measured ownership");
  });
  test("rejects a successful assertion without its source artifact", () => {
    const input = receipt();
    input.checks[0].artifacts = [];
    expect(() => validateCheckCoverage(input)).toThrow("No source artifacts");
  });
  test("cannot use a single case receipt for the final wave", () => {
    const input = { ...receipt(), selection: "all" };
    expect(() => validateCheckCoverage(input)).toThrow("Missing or unexpected");
  });
});

describe("scenario subscription transport", () => {
  test("preserves numeric subscription identities when delivering an event", () => {
    const frames: string[] = [];
    const subscriptions = [
      {
        closed: false,
        methods: new Map([[7, "subscribeServerConfig"]]),
        socket: { send: (frame: string) => frames.push(frame) },
      },
    ];
    deliverScenarioEvent(subscriptions, "subscribeServerConfig", { type: "providerStatuses" });
    expect(JSON.parse(frames[0] ?? "{}")).toEqual({
      _tag: "Chunk",
      requestId: 7,
      values: [{ type: "providerStatuses" }],
    });
  });
  test("rejects an event when no live subscriber can consume it", () => {
    expect(() => deliverScenarioEvent([], "subscribeServerConfig", {})).toThrow(
      "No live subscriber",
    );
  });
});

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
    visibleState: {
      text: "컴퓨터 연결하기 greeting",
      route: "#/threads/baseline-code",
    },
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
  test("requires both themes and both boundaries at every matrix size", () => {
    const files = expectedCaptureFiles();
    expect(new Set(files).size).toBe(152);
    for (const size of ["1280x800", "1920x1080", "840x620", "2560x1440"])
      for (const theme of ["light", "dark"])
        for (const id of ["46", "47", "48"])
          for (const boundary of ["top", "end"])
            expect(files).toContain(`matrix/${size}/${theme}/${id}/${boundary}-default.png`);
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
  test("rejects expected text mounted outside the visible viewport", () => {
    // Given a mounted fixture whose visible viewport is an empty chat,
    const observation = { text: "empty chat", route: "#/threads/baseline-messages" };
    // When bound to the conversation state, then it cannot authorize a screenshot.
    expect(() => validateVisibleState("34", observation)).toThrow("Visible state mismatch");
  });
  test("rejects a hidden Files pane even when its label remains visible", () => {
    const observation = { text: "파일", filesPane: false };
    expect(() => validateVisibleState("10", observation)).toThrow("Files pane not visible");
  });
  test("rejects System selection on the Light appearance page", () => {
    const observation = {
      text: "Color scheme",
      selectedAppearance: "Follow the system appearance",
    };
    expect(() => validateVisibleState("18", observation)).toThrow("Wrong selected appearance");
  });
  test("rejects a settings label visible only in another page's navigation", () => {
    const observation = { text: "Keybindings", route: "#/settings/general" };
    expect(() => validateVisibleState("20", observation)).toThrow("Wrong settings page");
  });
  test("rejects a different selected thread with matching fixture text", () => {
    const observation = { text: "local screenshot fixture", route: "#/threads/baseline-error" };
    expect(() => validateVisibleState("34", observation)).toThrow("Wrong selected thread");
  });
  test("rejects model fitness substituted for the Evidence section", () => {
    const observation = { text: "순위가 아닌 계약 준수 증거" };
    expect(() => validateVisibleState("47", observation, { target: "#weavra-evidence" })).toThrow(
      "Visible state mismatch",
    );
  });
  test("rejects an end frame before the section boundary", () => {
    const observation = {
      text: "기록 불러오기",
      boundary: { position: "end", aligned: false, visible: true },
    };
    expect(() =>
      validateVisibleState("48", observation, { target: "#weavra-fitness", boundary: "end" }),
    ).toThrow("Section boundary mismatch");
  });
  test("accepts a visible Evidence heading at the declared top boundary", () => {
    const observation = {
      text: "증거 요약",
      boundary: { position: "start", aligned: true, visible: true },
    };
    expect(() =>
      validateVisibleState("47", observation, { target: "#weavra-evidence", boundary: "start" }),
    ).not.toThrow();
  });
  test("rejects an error toast without visible conversation recovery context", () => {
    const observation = {
      text: "Capture fixture: provider unavailable.",
      route: "#/threads/baseline-error",
    };
    expect(() => validateVisibleState("38", observation)).toThrow("Missing error recovery context");
  });
  test("rejects a thread title without its visible rename input", () => {
    const observation = { text: "03 Code blocks", renameTitle: [] };
    expect(() => validateVisibleState("45", observation)).toThrow("Wrong visible rename editor");
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
        projection_thread_activities:
          "activity_id,thread_id,turn_id,tone,kind,summary,payload_json,created_at,sequence",
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
      expect(db.query("SELECT kind,tone FROM projection_thread_activities").get()).toEqual({
        kind: "tool.completed",
        tone: "error",
      });
    } finally {
      db.close();
      await NodeFSP.rm(base, { recursive: true });
    }
  });
});
