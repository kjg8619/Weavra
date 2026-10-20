import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { EventEmitter } from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  expectedFiles,
  expectedCaptureFiles,
  chooseAlias,
  CASES,
  deliverScenarioEvent,
  readCompletedCopy,
  resolveShellBaseline,
  awaitFocusLoss,
  takeWindowFocus,
  recordScenarioArtifact,
  createRpcLedger,
  countInActiveDialog,
  savedActionIsVisible,
  COMMAND_DIALOG_POPUP,
  switchCheckedState,
  SIDEBAR_VARIANT_MARKERS,
  TOAST_SELECTOR,
  iconTargetMeetsMinimum,
  assertIconTargetHits,
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
import { assertProfile, seed, prepareCaptureProfile, freezeCaptureServerFrame } from "./seed.mjs";

describe("capture network notice isolation", () => {
  const liveProvider = {
    instanceId: "codex",
    status: "ready",
    version: "1.0.0",
    versionAdvisory: { status: "behind_latest", latestVersion: "999.0.0" },
    updateState: { status: "running" },
    usageLimits: { source: "live-network" },
  };
  test("a live update notice cannot enter the initial capture configuration", () => {
    const frame = {
      _tag: "Exit",
      requestId: 7,
      exit: {
        _tag: "Success",
        value: { providers: [liveProvider], settings: {}, remoteOpenTargets: ["live-remote"] },
      },
    };
    const frozen = freezeCaptureServerFrame(frame, "server.getConfig");
    expect(frozen.exit.value.providers).toEqual([
      { instanceId: "codex", status: "ready", version: "1.0.0" },
    ]);
    expect(frozen.exit.value.settings.enableProviderUpdateChecks).toBe(false);
    expect(frozen.exit.value.remoteOpenTargets).toEqual([]);
    expect(frame.exit.value.providers[0].versionAdvisory.status).toBe("behind_latest");
  });
  test("late update and remote observations are frozen on the subscription too", () => {
    const frame = {
      _tag: "Chunk",
      requestId: 9,
      values: [
        { type: "providerStatuses", payload: { providers: [liveProvider] } },
        { type: "environmentThemesUpdated", payload: { themes: ["live-remote"] } },
        { type: "usageLimitSourcesUpdated", payload: { sources: ["live-quota"] } },
      ],
    };
    const frozen = freezeCaptureServerFrame(frame, "subscribeServerConfig");
    expect(frozen.values[0].payload.providers[0].versionAdvisory).toBeUndefined();
    expect(frozen.values[0].payload.providers[0].updateState).toBeUndefined();
    expect(frozen.values[1].payload.themes).toEqual([]);
    expect(frozen.values[2].payload.sources).toEqual([]);
    expect(freezeCaptureServerFrame(frame, "orchestration.subscribeShell")).toBe(frame);
  });
  test("disables server-side checks before the disposable app starts", async () => {
    const base = await NodeFSP.realpath(await NodeFSP.mkdtemp("/tmp/weavra-hig-"));
    const isolation = {
      base,
      home: NodePath.join(base, "home"),
      workspace: NodePath.join(base, "workspace"),
      app: NodePath.join(base, "app"),
    };
    try {
      for (const path of [isolation.home, isolation.workspace, isolation.app])
        await NodeFSP.mkdir(path);
      prepareCaptureProfile(isolation);
      expect(
        JSON.parse(
          await NodeFSP.readFile(NodePath.join(isolation.app, "userdata/settings.json"), "utf8"),
        ),
      ).toEqual({ enableProviderUpdateChecks: false, usageLimitSources: {} });
    } finally {
      await NodeFSP.rm(base, { recursive: true });
    }
  });
});

describe("diagnostic copy synchronization", () => {
  const path = "/tmp/hig/workspace/" + "x".repeat(200);
  test("a write that completes after the click is read only once it lands", async () => {
    let clipboard = "";
    let complete!: () => void;
    const written = new Promise<void>((resolve) => (complete = resolve));
    const reading = readCompletedCopy(written, async () => clipboard, 1_000);
    await Promise.resolve();
    clipboard = `연결 주소: ws://x\n작업 공간 전체 경로: ${path}`;
    complete();
    expect((await reading).values).toContain(path);
  });
  test("a truncated or wrong write does not contain the exact path", async () => {
    const copied = await readCompletedCopy(
      Promise.resolve(),
      async () => `작업 공간 전체 경로: ${path.slice(0, -1)}\n기타: ${path}/extra`,
      1_000,
    );
    expect(copied.values).not.toContain(path);
  });
  test("a write that never completes fails instead of reading stale state", async () => {
    let read = false;
    await expect(
      readCompletedCopy(
        new Promise<void>(() => {}),
        async () => {
          read = true;
          return path;
        },
        1,
      ),
    ).rejects.toThrow("Timeout: diagnostic clipboard write completion");
    expect(read).toBe(false);
  });
  test("a rejected write fails", async () => {
    await expect(
      readCompletedCopy(Promise.reject(new Error("denied")), async () => path, 1_000),
    ).rejects.toThrow("denied");
  });
});

describe("resumed shell baseline", () => {
  const thread = (id: string, state: string) => ({ id, latestTurn: { state } });
  const http = { snapshotSequence: 40, threads: [thread("baseline-working", "running")] };
  test("a resumed client uses the HTTP snapshot once the stream confirms synchronized", () => {
    const baseline = resolveShellBaseline({ httpSnapshot: http, synchronized: true });
    expect(baseline.snapshotSequence).toBe(40);
    expect(baseline.threads[0].id).toBe("baseline-working");
  });
  test("later stream events are applied in sequence and older ones ignored", () => {
    const baseline = resolveShellBaseline({
      httpSnapshot: http,
      synchronized: true,
      events: [
        { kind: "thread-upserted", sequence: 39, thread: thread("baseline-working", "stale") },
        { kind: "thread-upserted", sequence: 41, thread: thread("baseline-working", "error") },
      ],
    });
    expect(baseline.snapshotSequence).toBe(41);
    expect(baseline.threads[0].latestTurn.state).toBe("error");
    expect(http.threads[0].latestTurn.state).toBe("running");
  });
  test("a stream snapshot is used as-is", () => {
    expect(resolveShellBaseline({ streamSnapshot: http, synchronized: false }).threads).toHaveLength(1);
  });
  test("an HTTP snapshot the stream never confirmed is not a settled baseline", () => {
    expect(() => resolveShellBaseline({ httpSnapshot: http, synchronized: false })).toThrow(
      "Missing shell snapshot",
    );
  });
  test("synchronized without any snapshot still fails", () => {
    expect(() => resolveShellBaseline({ httpSnapshot: null, synchronized: true })).toThrow(
      "Missing shell snapshot",
    );
    expect(() =>
      resolveShellBaseline({ httpSnapshot: { threads: [] }, synchronized: true }),
    ).toThrow("Missing shell snapshot");
  });
});

describe("renderer focus loss", () => {
  test("a blur that arrives later passes once focus is really gone", async () => {
    let blur!: () => void;
    const blurred = new Promise<void>((resolve) => (blur = resolve));
    const waiting = awaitFocusLoss(blurred, async () => false, 1_000);
    await Promise.resolve();
    blur();
    await expect(waiting).resolves.toBeUndefined();
  });
  test("a window that never blurs times out", async () => {
    await expect(awaitFocusLoss(new Promise(() => {}), async () => false, 1)).rejects.toThrow(
      "Timeout: renderer window blur",
    );
  });
  test("a blur event while the document still has focus fails", async () => {
    await expect(awaitFocusLoss(Promise.resolve(), async () => true, 1_000)).rejects.toThrow(
      "still reports document focus",
    );
  });
});

describe("app window focus loss", () => {
  // A stand-in for BrowserWindow: one key window per "app", and focusing another
  // window of the app takes key status from the current one.
  class FakeWindow extends EventEmitter {
    static key: FakeWindow | null = null;
    static created = 0;
    constructor(
      readonly options: { title?: string } = {},
      readonly ignoresBlur = false,
    ) {
      super();
      if (options.title) FakeWindow.created++;
    }
    isFocused() {
      return FakeWindow.key === this;
    }
    blur() {
      if (this.ignoresBlur || !this.isFocused()) return;
      FakeWindow.key = null;
      this.emit("blur");
    }
    focus() {
      const previous = FakeWindow.key;
      FakeWindow.key = this;
      if (previous && previous !== this) previous.emit("blur");
    }
    webViewFocused = true;
    blurWebView() {
      this.webViewFocused = false;
    }
    async loadURL() {}
    show() {}
  }
  const reset = () => {
    FakeWindow.key = null;
    FakeWindow.created = 0;
    (globalThis as { __higFocusSink?: unknown }).__higFocusSink = undefined;
  };

  test("a focused window that accepts blur loses focus without a second window", async () => {
    reset();
    const main = new FakeWindow();
    main.focus();
    expect(await takeWindowFocus(main, 1_000)).toEqual({ before: true, sink: false, after: false });
    expect(FakeWindow.created).toBe(0);
    expect(main.webViewFocused).toBe(false);
  });
  test("a window still key after blur loses focus to a second window of the same app", async () => {
    reset();
    class StubbornWindow extends FakeWindow {
      constructor(options: { title?: string } = {}) {
        super(options, true);
      }
    }
    const main = new StubbornWindow();
    main.focus();
    expect(await takeWindowFocus(main, 1_000)).toEqual({ before: true, sink: true, after: false });
    expect(FakeWindow.created).toBe(1);
    expect(main.webViewFocused).toBe(false);
  });
  test("a window that never became key, because another app is frontmost, still has its web view blurred", async () => {
    reset();
    const main = new FakeWindow();
    expect(await takeWindowFocus(main, 1_000)).toEqual({ before: false, sink: false, after: false });
    expect(FakeWindow.created).toBe(0);
    expect(main.webViewFocused).toBe(false);
  });
  test("a window that keeps focus is reported, so the check fails instead of passing", async () => {
    reset();
    class KeyWindow extends FakeWindow {
      constructor(options: { title?: string } = {}) {
        super(options, true);
      }
      override focus() {
        if (this.options.title) return; // the second window never becomes key
        super.focus();
      }
    }
    const main = new KeyWindow();
    main.focus();
    expect((await takeWindowFocus(main, 1)).after).toBe(true);
  });
});

describe("scenario artifact names", () => {
  test("a second capture under the same name in one check fails immediately", () => {
    const artifacts: Array<{ file: string; sha256: string }> = [];
    recordScenarioArtifact(artifacts, "scenarios/06/footer-wrap/footer-current-840.png", "a");
    expect(() =>
      recordScenarioArtifact(artifacts, "scenarios/06/footer-wrap/footer-current-840.png", "b"),
    ).toThrow("Scenario artifact name collision");
    expect(artifacts).toEqual([
      { file: "scenarios/06/footer-wrap/footer-current-840.png", sha256: "a" },
    ]);
  });
  test("variant-specific names coexist", () => {
    const artifacts: Array<{ file: string; sha256: string }> = [];
    recordScenarioArtifact(artifacts, "scenarios/06/footer-wrap/footer-current-840.png", "a");
    recordScenarioArtifact(artifacts, "scenarios/06/footer-wrap/footer-legacy-840.png", "b");
    expect(artifacts.length).toBe(2);
  });
});

describe("provider readiness settling", () => {
  const method = "server.discoverSourceControl";
  test("waits for a response that lands after the dialog opens", async () => {
    const ledger = createRpcLedger();
    ledger.request("0:7", method);
    const waiting = ledger.settled(method, 1_000);
    await Promise.resolve();
    ledger.exit("0:7");
    await expect(waiting).resolves.toBeUndefined();
  });
  test("a request still in flight is not settled", async () => {
    const ledger = createRpcLedger();
    ledger.request("0:1", method);
    ledger.exit("0:1");
    ledger.request("0:2", method);
    await expect(ledger.settled(method, 1)).rejects.toThrow(`Timeout: ${method} settled`);
  });
  test("no request at all is not settled", async () => {
    const ledger = createRpcLedger();
    ledger.request("0:3", "server.getConfig");
    ledger.exit("0:3");
    await expect(createRpcLedger().settled(method, 1)).rejects.toThrow("Timeout");
    await expect(ledger.settled(method, 1)).rejects.toThrow("Timeout");
  });
  test("an interrupted request neither completes nor blocks forever", async () => {
    const ledger = createRpcLedger();
    ledger.request("0:4", method);
    ledger.cancel("0:4");
    await expect(ledger.settled(method, 1)).rejects.toThrow("Timeout");
    ledger.request("0:5", method);
    ledger.exit("0:5");
    await expect(ledger.settled(method, 1_000)).resolves.toBeUndefined();
  });
});

describe("dialog-scoped folder count", () => {
  // Models the page: nine visible matches page-wide, `inDialog` of them inside the popup.
  const page = (inDialog: number) => ({
    locator: (selector: string) => ({
      getByText: (text: string, options: { exact: boolean }) => ({
        filter: (filter: { visible: boolean }) => ({
          count: async () => {
            expect([selector, text, options.exact, filter.visible]).toEqual([
              COMMAND_DIALOG_POPUP,
              "baseline-project",
              true,
              true,
            ]);
            return inDialog;
          },
        }),
      }),
    }),
    getByText: () => ({ filter: () => ({ count: async () => 9 }) }),
  });
  test("counts only the active dialog's row", async () => {
    expect(await countInActiveDialog(page(1), "baseline-project")).toBe(1);
  });
  test("a missing or duplicated dialog row is still observable", async () => {
    expect(await countInActiveDialog(page(0), "baseline-project")).toBe(0);
    expect(await countInActiveDialog(page(2), "baseline-project")).toBe(2);
  });
});

describe("saved action visibility", () => {
  const page = (controls: readonly { role: string; name: string; visible: boolean }[]) => ({
    getByRole: (role: string, options: { name: string; exact: boolean }) => ({
      isVisible: async () =>
        controls.some(
          (control) =>
            control.role === role &&
            (options.exact ? control.name === options.name : control.name.includes(options.name)) &&
            control.visible,
        ),
    }),
  });
  test("finds the persisted action through its baseline Run accessible name", async () => {
    expect(
      await savedActionIsVisible(
        page([{ role: "button", name: "Run HIG saved action", visible: true }]),
      ),
    ).toBe(true);
  });
  test("rejects a different action, menu item or bare-name control", async () => {
    expect(
      await savedActionIsVisible(
        page([
          { role: "button", name: "Run HIG saved action extra", visible: true },
          { role: "menuitem", name: "Run HIG saved action", visible: true },
          { role: "button", name: "HIG saved action", visible: true },
        ]),
      ),
    ).toBe(false);
  });
  test("does not count an invisible saved action", async () => {
    expect(
      await savedActionIsVisible(
        page([{ role: "button", name: "Run HIG saved action", visible: false }]),
      ),
    ).toBe(false);
  });
});

describe("sidebar variant switch state", () => {
  const state = (
    ariaChecked: string | null,
    dataChecked: string | null,
    dataUnchecked: string | null,
  ) => switchCheckedState({ ariaChecked, dataChecked, dataUnchecked });
  test("reads the Base UI data-checked state the product switch actually exposes", () => {
    expect(state(null, "", null)).toBe(true);
    expect(state(null, null, "")).toBe(false);
  });
  test("aria-checked wins when present", () => {
    expect(state("true", null, "")).toBe(true);
    expect(state("false", "", null)).toBe(false);
  });
  test("missing or contradictory state is unknown, so the variant assertion still fails", () => {
    expect(state(null, null, null)).toBeNull();
    expect(state(null, "", "")).toBeNull();
  });
  test("each sidebar variant has its own render marker", () => {
    expect(SIDEBAR_VARIANT_MARKERS.current).not.toContain("new-thread-button");
    expect(SIDEBAR_VARIANT_MARKERS.legacy).not.toContain("sidebar-row");
  });
});

describe("toast observation", () => {
  test("targets rendered toasts rather than a slot the product never emits", () => {
    expect(TOAST_SELECTOR).not.toContain("toast-root");
    expect(TOAST_SELECTOR).toContain('[data-slot="toast-viewport"] > *');
    expect(TOAST_SELECTOR).toContain('[data-slot="toast-popup"]');
  });
});

describe("touched icon targets", () => {
  test("fails the scenario when the center hits but an inset corner misses", async () => {
    const result = await executeCheck(
      "02",
      "icon-targets",
      async (assert: (label: string, actual: unknown, expected: unknown) => void) =>
        assertIconTargetHits(assert, "foreground icon", {
          visible: true,
          disabled: false,
          hits: [true, false, true, true, true],
        }),
      async () => [{ file: "observed.json", sha256: "a".repeat(64) }],
    );
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("five icon hit points");
  });
  test("rejects undersized disabled controls rather than exempting them", () => {
    expect(iconTargetMeetsMinimum({ disabled: true, rect: { width: 32, height: 32 } })).toBe(false);
  });
  test("requires both dimensions to meet the minimum", () => {
    expect(iconTargetMeetsMinimum({ rect: { width: 36, height: 32 } })).toBe(false);
    expect(iconTargetMeetsMinimum({ rect: { width: 32, height: 36 } })).toBe(false);
  });
  test("accepts the exact minimum even when disabled", () => {
    expect(iconTargetMeetsMinimum({ disabled: true, rect: { width: 36, height: 36 } })).toBe(true);
  });
});

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
