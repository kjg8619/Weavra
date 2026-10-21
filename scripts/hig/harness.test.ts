import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { WebView } from "bun";
import { EventEmitter } from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { runInNewContext } from "node:vm";
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
  openProviderDiagnostic,
  setNativeTheme,
  readRenderedBackground,
  threadDeleteConfirmation,
  readCodeTranscript,
  assertCodeTranscriptParity,
  COMMAND_DIALOG_POPUP,
  switchCheckedState,
  SIDEBAR_VARIANT_MARKERS,
  TOAST_SELECTOR,
  iconTargetMeetsMinimum,
  assertIconTargetHits,
  COPY_ALIASES,
  copyNames,
  copyNamesForCheck,
  exactName,
  ariaLabelSelector,
  auditLocaleLabels,
  classifyLocaleText,
  panelMenuItem,
  localeSources,
  LOCALE_FIXTURE_VALUES,
  NAMED_ROW_PATTERNS,
  namedRowSubject,
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
import {
  assertProfile,
  seed,
  registerSeededThread,
  prepareCaptureProfile,
  freezeCaptureServerFrame,
} from "./seed.mjs";

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

describe("thread delete confirmation readiness", () => {
  const parent = 'Delete thread "03 Code blocks"?';
  const successor = "“03 Code blocks” 스레드를 삭제할까요?";
  const fixture = (title: string, action: string, actionRole = "button") => {
    const actions: string[] = [];
    const controls = [
      { role: "button", name: "Cancel", run: () => actions.push("cancel") },
      { role: actionRole, name: action, run: () => actions.push("delete:baseline-code") },
    ];
    const page = {
      getByRole: (role: string, options?: { name: string; exact: boolean }) => {
        const dialogs = role === "alertdialog" && (!options || options.name === title) ? [title] : [];
        return {
          waitFor: async () => {
            if (dialogs.length !== 1) throw new Error("Missing alertdialog");
          },
          count: async () => dialogs.length,
          getByRole: (childRole: string, childOptions: { name: string; exact: boolean }) => {
            const buttons = dialogs.flatMap(() =>
              controls.filter((control) =>
                control.role === childRole &&
                (childOptions.exact
                  ? control.name === childOptions.name
                  : control.name.includes(childOptions.name)),
              ),
            );
            return {
              count: async () => buttons.length,
              isEnabled: async () => true,
              waitFor: async () => {
                if (buttons.length !== 1) throw new Error("Missing confirm button");
              },
              click: async () => {
                if (buttons.length !== 1) throw new Error("Ambiguous confirm button");
                for (const button of buttons) button.run();
              },
            };
          },
        };
      },
    };
    return { page, actions };
  };
  test("accepts the parent Confirm action on the exact target dialog", async () => {
    const { page, actions } = fixture(parent, "Confirm");
    const confirmation = await threadDeleteConfirmation(page);
    validateVisibleState("44", { text: `${parent} Cancel Confirm` });
    await confirmation.button.click();
    expect(actions).toEqual(["delete:baseline-code"]);
  });
  test("accepts the successor thread deletion action on the exact target dialog", async () => {
    const { page, actions } = fixture(successor, "스레드 삭제");
    const confirmation = await threadDeleteConfirmation(page);
    validateVisibleState("44", { text: `${successor} 취소 스레드 삭제` });
    await confirmation.button.click();
    expect(actions).toEqual(["delete:baseline-code"]);
  });
  test("rejects missing actions, wrong targets, wrong actions and non-button labels", async () => {
    for (const [title, action, role] of [
      [parent, "Cancel", "button"],
      ['Delete thread "01 Conversation"?', "Confirm", "button"],
      ['Archive thread "03 Code blocks"?', "Confirm", "button"],
      [successor, "스레드 삭제하기", "button"],
      [successor, "스레드 삭제", "menuitem"],
    ]) {
      const { page, actions } = fixture(title, action, role);
      await expect(threadDeleteConfirmation(page)).rejects.toThrow();
      expect(actions).toEqual([]);
    }
  });
  test("rejects unrelated Confirm text as state 44 evidence", () => {
    expect(() => validateVisibleState("44", { text: "03 Code blocks Confirm" })).toThrow();
  });
});

describe("code transcript theme parity", () => {
  async function cycle(mutation = "") {
    await using view = new WebView({ backend: "chrome" });
    await view.navigate("about:blank");
    await view.evaluate(`(() => {
      location.hash = "/thread/baseline-code";
      document.body.innerHTML = \`
        <div id="transcript" style="height:180px;overflow-y:auto">
          <div data-timeline-row-id="code-message">
            <h2>Example</h2>
            <pre id="greeting" style="height:200px">export function greeting() {}
console.log(greeting());</pre>
            <pre id="shell">printf 'local fixture only'</pre>
            <table><tbody><tr><td>Profile</td><td>Isolated</td></tr>
              <tr><td>Paid requests</td><td>Zero</td></tr></tbody></table>
            <div style="height:400px"></div>
          </div>
        </div>\`;
      const port = document.querySelector("#transcript");
      port.scrollTop = port.scrollHeight;
    })()`);
    const before = await view.evaluate(`(${readCodeTranscript.toString()})()`);
    await view.evaluate(`(${readCodeTranscript.toString()})(true)`);
    const baseline = await view.evaluate(`(${readCodeTranscript.toString()})()`);
    const rows: ReturnType<typeof readCodeTranscript>[] = [];
    for (const mode of ["light", "dark", "light"]) {
      rows.push(
        await view.evaluate(`(() => {
          document.documentElement.classList.toggle("dark", ${mode === "dark"});
          ${mode === "dark" ? mutation : ""}
          return (${readCodeTranscript.toString()})();
        })()`),
      );
    }
    const result = await executeCheck(
      "21",
      "theme-content-parity",
      async (assert: (label: string, actual: unknown, expected: unknown) => void) => {
        for (const row of rows) assertCodeTranscriptParity(assert, row, baseline);
      },
      async () => [{ file: "transcript.json", sha256: "a".repeat(64) }],
    );
    return { before, baseline, result };
  }
  test("anchors an end-scrolled parent and samples light dark light without visible-text timeout", async () => {
    const { before, baseline, result } = await cycle();
    expect(before.content.find((node: { tag: string }) => node.tag === "PRE").intersects).toBe(false);
    expect(baseline.content.find((node: { tag: string }) => node.tag === "PRE").intersects).toBe(true);
    // The table remains mounted below the viewport; it is content, not a readiness target.
    expect(baseline.content.find((node: { tag: string }) => node.tag === "TABLE").intersects).toBe(false);
    expect(result.status).toBe("PASS");
  }, 15_000);
  test("fails when shell content truly disappears", async () => {
    const { result } = await cycle('document.querySelector("#shell").remove();');
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("seeded code transcript contains local fixture only");
  }, 15_000);
  test("fails when all content remains but its order changes", async () => {
    const { result } = await cycle(
      'document.querySelector("#greeting").before(document.querySelector("#shell"));',
    );
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("theme preserves heading code and table order");
  }, 15_000);
  test("fails when the transcript is blank despite retained DOM text", async () => {
    const { result } = await cycle('document.querySelector("#transcript").style.opacity = "0";');
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("all content has painted nonzero rectangles");
  }, 15_000);
  test("fails when a content rectangle goes to zero", async () => {
    const { result } = await cycle('document.querySelector("#shell").style.display = "none";');
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("all content has painted nonzero rectangles");
  }, 15_000);
  test("fails when the still-visible code anchor drifts", async () => {
    const { result } = await cycle('document.querySelector("#transcript").scrollTop += 30;');
    expect(result.status).toBe("FAIL");
    expect(result.error).toContain("theme retains same code scroll anchor");
  }, 15_000);
});

describe("English-baseline / Korean-current copy aliases", () => {
  type Control = { role: string; name: string; run: () => void; visible?: boolean };
  type Locator = {
    matches: Control[];
    or: (other: Locator) => Locator;
    count: () => Promise<number>;
    isVisible: () => Promise<boolean>;
    click: () => Promise<void>;
  };
  // Mirrors Playwright: exact role/name matching, `or` unions, strict single-target actions.
  const locator = (matches: Control[]): Locator => ({
    matches,
    or: (other) => locator([...new Set([...matches, ...other.matches])]),
    count: async () => matches.length,
    isVisible: async () => {
      if (matches.length > 1) throw new Error("strict mode violation");
      return matches[0]?.visible !== false && matches.length === 1;
    },
    click: async () => {
      if (matches.length !== 1) throw new Error(`strict target count ${matches.length}`);
      matches[0]!.run();
    },
  });
  const fixture = (controls: Array<[string, string, string]>) => {
    const actions: string[] = [];
    const page = {
      getByRole: (role: string, options: { name: string; exact: boolean }) =>
        locator(
          controls
            .filter(([r, name]) => r === role && options.exact && name === options.name)
            .map(([r, name, action]) => ({ role: r, name, run: () => actions.push(action) })),
        ),
    };
    return { page, actions };
  };
  const click = (
    page: ReturnType<typeof fixture>["page"],
    check: string,
    role: string,
    english: string,
  ) => exactName(page, role, copyNamesForCheck(check, english)).click();

  test("keeps one alias row per request row plus the lead's state 13 row", () => {
    expect(COPY_ALIASES.length).toBe(41);
    expect(new Set(COPY_ALIASES.map(([english]) => english)).size).toBe(41);
    for (const [english, korean] of COPY_ALIASES) {
      expect(korean).not.toBe(english);
      expect(copyNames(english)).toEqual([english, korean]);
      expect(copyNames(english, { current: true })).toEqual([korean]);
    }
    expect(() => copyNames("Add provide")).toThrow("No copy alias row");
  });
  test("English-baseline fixtures pass before todo 22", async () => {
    const { page, actions } = fixture([
      ["button", "Add provider", "add-provider"],
      ["switch", "Sidebar (legacy)", "legacy-sidebar"],
      ["combobox", "Open links in", "open-links"],
    ]);
    await click(page, "18/six-adapters", "button", "Add provider");
    await click(page, "06/sidebar", "switch", "Sidebar (legacy)");
    await click(page, "14/keyboard-disclosure", "combobox", "Open links in");
    expect(actions).toEqual(["add-provider", "legacy-sidebar", "open-links"]);
    validateVisibleState("11", { text: "Add Action" });
    validateVisibleState("18", {
      text: "Color scheme",
      route: "#/settings/appearance",
      selectedAppearance: "Use light mode",
    });
    validateVisibleState("10", { text: "파일", filesPane: true });
  });
  test("Korean-current fixtures pass, including case 22", async () => {
    const { page, actions } = fixture([
      ["button", "공급자 추가", "add-provider"],
      ["button", "레거시 기능", "legacy-features"],
      ["switch", "레거시 사이드바", "legacy-sidebar"],
      ["button", "HIG saved action 실행", "run-saved"],
    ]);
    await click(page, "22/six-adapters", "button", "Add provider");
    await click(page, "22/both-sidebars", "button", "Legacy features");
    await click(page, "22/both-sidebars", "switch", "Sidebar (legacy)");
    await click(page, "06/sidebar", "switch", "Sidebar (legacy)");
    expect(actions).toEqual([
      "add-provider",
      "legacy-features",
      "legacy-sidebar",
      "legacy-sidebar",
    ]);
    expect(await savedActionIsVisible(page)).toBe(true);
    validateVisibleState("30", { text: "제3자 라이선스 고지" });
    validateVisibleState("19", {
      text: "색상 모드",
      route: "#/settings/appearance",
      selectedAppearance: "다크 모드 사용",
    });
  });
  test("a missing control or readiness text fails", async () => {
    const { page, actions } = fixture([["button", "공급자", "providers-nav"]]);
    await expect(click(page, "18/six-adapters", "button", "Add provider")).rejects.toThrow();
    await expect(click(page, "22/six-adapters", "button", "Add provider")).rejects.toThrow();
    expect(await savedActionIsVisible(page)).toBe(false);
    expect(actions).toEqual([]);
    expect(() => validateVisibleState("14", { text: "기기" })).toThrow("Visible state mismatch");
  });
  test("a wrong name, role or action fails", async () => {
    const { page, actions } = fixture([
      ["button", "Add providers", "wrong"],
      ["button", "공급자 추가하기", "wrong"],
      ["menuitem", "공급자 추가", "wrong"],
      ["button", "Run HIG saved action extra", "wrong"],
    ]);
    await expect(click(page, "18/six-adapters", "button", "Add provider")).rejects.toThrow();
    expect(await savedActionIsVisible(page)).toBe(false);
    expect(actions).toEqual([]);
    // Case 22 closes W-03: the English baseline no longer satisfies its named controls.
    const english = fixture([["button", "Legacy features", "legacy-features"]]);
    await expect(
      click(english.page, "22/both-sidebars", "button", "Legacy features"),
    ).rejects.toThrow();
    expect(english.actions).toEqual([]);
    // Both aliases at once is ambiguity, never a choice.
    const both = fixture([
      ["button", "Add provider", "a"],
      ["button", "공급자 추가", "b"],
    ]);
    await expect(click(both.page, "18/six-adapters", "button", "Add provider")).rejects.toThrow();
    expect(both.actions).toEqual([]);
    expect(() =>
      validateVisibleState("18", {
        text: "색상 모드",
        route: "#/settings/appearance",
        selectedAppearance: "다크 모드 사용",
      }),
    ).toThrow("Wrong selected appearance");
  });
  test("run graph panel opens by its English baseline or Korean current name", async () => {
    for (const [label, check] of [
      ["Run 그래프 G", "10/graph-no-snapshot"],
      ["실행 그래프 G", "10/graph-no-snapshot"],
      ["실행 그래프 G", "22/any"],
    ]) {
      const { page, actions } = fixture([
        ["menuitem", "브라우저 B", "browser"],
        ["menuitem", label, "graph"],
      ]);
      await panelMenuItem(page, copyNamesForCheck(check, "Run 그래프")).click();
      expect(actions).toEqual(["graph"]);
    }
    validateVisibleState("13", { text: "Run 그래프" });
    validateVisibleState("13", { text: "실행 그래프" });
  });
  test("a missing or wrongly named run graph panel fails", async () => {
    for (const controls of [
      [["menuitem", "브라우저 B", "browser"]],
      [["menuitem", "실행 그래프", "graph"]],
      [["menuitem", "Run Graph G", "graph"]],
      [["menuitem", "실행 그래프 보기 G", "graph"]],
      [["button", "실행 그래프 G", "graph"]],
    ] as Array<Array<[string, string, string]>>) {
      const { page, actions } = fixture(controls);
      await expect(panelMenuItem(page, copyNames("Run 그래프")).click()).rejects.toThrow();
      expect(actions).toEqual([]);
    }
    const english = fixture([["menuitem", "Run 그래프 G", "graph"]]);
    await expect(
      panelMenuItem(english.page, copyNamesForCheck("22/any", "Run 그래프")).click(),
    ).rejects.toThrow();
    expect(() => panelMenuItem(english.page, ["그래프"])).toThrow("No panel shortcut");
    expect(() => validateVisibleState("13", { text: "그래프" })).toThrow(
      "Visible state mismatch",
    );
  });
  test("renderer selectors list one exact aria-label per alias", () => {
    expect(ariaLabelSelector(copyNames("Appearance mode"), { suffix: " [aria-pressed]" })).toBe(
      '[aria-label="Appearance mode"] [aria-pressed], [aria-label="색상 모드 선택"] [aria-pressed]',
    );
    expect(
      ariaLabelSelector(copyNames("Dismiss notification", { current: true }), {
        prefix: "button",
      }),
    ).toBe('button[aria-label="알림 닫기"]');
  });
});

describe("authored locale audit", () => {
  const sources = localeSources({
    keybindingsConfigPath: "/tmp/home/.weavra/keybindings.json",
    providers: [{ instanceId: "codex", driver: "codex" }],
  });
  const row = (fields: Record<string, unknown>) => ({
    tag: "BUTTON",
    role: null,
    text: "",
    name: null,
    placeholder: null,
    keycaps: [],
    font: null,
    ...fields,
  });
  const audit = (fields: Record<string, unknown>, from = sources) =>
    auditLocaleLabels([row(fields)], from);
  const passes = (fields: Record<string, unknown>, from = sources) =>
    expect(audit(fields, from).unclassified).toEqual([]);
  const fails = (fields: Record<string, unknown>, from = sources) =>
    expect(audit(fields, from).unclassified.length).toBeGreaterThan(0);

  test("leftover authored English still fails", () => {
    const { unclassified } = auditLocaleLabels(
      [
        row({ text: "레거시 기능" }),
        row({ tag: "LABEL", text: "Sidebar (legacy)" }),
        row({ text: "공급자 추가", name: "Add provider" }),
      ],
      sources,
    );
    expect(unclassified.map((r) => r.text)).toEqual(["Sidebar (legacy)", "Add provider"]);
  });
  test("Korean labels keep only classified Latin segments, recorded with class and source", () => {
    const { unclassified, exceptions } = auditLocaleLabels(
      [
        row({ tag: "LABEL", text: "Tailscale HTTPS 사용" }),
        row({ tag: "H2", text: "Codex 로그인 필요" }),
        row({ name: "03 Code blocks 대화 작업" }),
        row({ tag: "H3", text: "Weavra Runtime" }),
        row({ name: "T3 Chat 테마 사용" }),
        row({ name: "Azure DevOps 설정 안내" }),
        row({ text: "CPU 사용량 Ember 복제 macOS" }),
      ],
      sources,
    );
    expect(unclassified).toEqual([]);
    expect(exceptions.flatMap((r) => r.segments)).toEqual([
      { segment: "Tailscale", class: "tool/VCS", source: "lead allowlist" },
      { segment: "HTTPS", class: "protocol/format/acronym", source: "lead allowlist" },
      { segment: "Codex", class: "product/brand", source: "lead allowlist" },
      { segment: "03 Code blocks", class: "fixture value", source: "seed.mjs" },
      { segment: "Weavra", class: "product/brand", source: "lead allowlist" },
      { segment: "Runtime", class: "Weavra component", source: "lead allowlist" },
      { segment: "T3 Chat", class: "built-in theme", source: "lead allowlist" },
      { segment: "Azure DevOps", class: "product/brand", source: "lead allowlist" },
      { segment: "CPU", class: "protocol/format/acronym", source: "lead allowlist" },
      { segment: "Ember", class: "built-in theme", source: "lead allowlist" },
      { segment: "macOS", class: "product/brand", source: "lead allowlist" },
    ]);
  });
  test("plain English words fail in every field and context", () => {
    const context = {
      role: "combobox",
      keycaps: ["Enter"],
      font: { resolvable: false, mac: true },
    };
    for (const word of ["Settings", "Save", "Run", "Open", "Delete", "Run 그래프", "Serve 시작"]) {
      fails({ ...context, text: word });
      fails({ ...context, name: word });
      fails({ ...context, placeholder: word });
      fails({ keycaps: [word] });
    }
    for (const value of ["Chat 테마", "Vertex 설정", "Codexes", "codex 로그인", "Code blocks"])
      fails({ text: value });
  });
  test("keycaps count only inside a keycap or a keycap control's trailing chord", () => {
    passes({ text: "대기 메시지 반영", keycaps: ["⇧", "⌘", "Enter"] });
    passes({ name: "대화: 대기 메시지 반영 단축키 편집: ⇧⌘Enter", keycaps: ["Enter"] });
    passes({ name: "추가 (Ctrl Enter)", keycaps: ["Ctrl", "Enter"] });
    fails({ text: "Enter 키를 눌러 보내요" });
    fails({ text: "Enter 키를 눌러 보내요", keycaps: ["Enter"] });
    fails({ name: "단축키 편집: ⇧⌘Enter" });
    fails({ name: "Enter 키로 보내기", keycaps: ["Enter"] });
    fails({ keycaps: ["enter"] });
    fails({ keycaps: ["arrowdown"] });
  });
  test("data is accepted only in its own field and only when its source agrees", () => {
    passes({ tag: "INPUT", placeholder: "codex" });
    passes({ tag: "INPUT", placeholder: "~/.codex-t3/personal" });
    passes({ tag: "INPUT", placeholder: "http://127.0.0.1:4096" });
    passes({ tag: "INPUT", placeholder: "https://..." });
    passes({ name: "keybindings.json 열기" });
    passes({ role: "combobox", text: "Menlo", font: { resolvable: true, mac: true } });
    passes({ role: "combobox", text: "SF Pro", font: { resolvable: false, mac: true } });
    // Source disagrees.
    fails({ tag: "INPUT", placeholder: "codex" }, localeSources({ providers: [] }));
    fails({ tag: "INPUT", placeholder: "~/.gemini" });
    fails({ name: "settings.json 열기" });
    fails({ role: "combobox", text: "SF Pro", font: { resolvable: false, mac: false } });
    fails({ role: "combobox", text: "Default", font: { resolvable: false, mac: true } });
    // Pattern-shaped token outside its scoped field.
    fails({ text: "codex" });
    fails({ name: "~/.codex" });
    fails({ text: "http://127.0.0.1:4096" });
    fails({ tag: "H2", text: "keybindings.json" });
    fails({ text: "Menlo" });
    fails({ tag: "INPUT", placeholder: "my-project-id" });
    fails({ tag: "INPUT", placeholder: "https://example.com" });
  });
  test("fixture text in composite rows matches seeded values exactly", async () => {
    passes({ tag: "DIV", role: "button", text: "작업 중\n04 Working fixture\n3분 전" });
    fails({ tag: "DIV", role: "button", text: "04 Working fixtures\n3분 전" });
    fails({ tag: "DIV", role: "button", text: "01 Conversation\n3d ago" });
    const seedSource = await NodeFSP.readFile(new URL("./seed.mjs", import.meta.url), "utf8");
    for (const value of LOCALE_FIXTURE_VALUES) expect(seedSource).toContain(`"${value}"`);
  });
  test("late lead additions pass only as exact names or phrases", () => {
    passes({ text: "RGB 색상 OTEL 내보내기 Niri Hyprland Omarchy" });
    passes({ name: "VS Code에서 열기" });
    passes({ text: "Mac mini 호스트" });
    passes({ tag: "H3", text: "활성 MCP" });
    fails({ text: "활성 Mcp" });
    fails({ text: "Code 열기" });
    fails({ text: "mini 모드" });
  });
  test("custom-model preset labels pass only inside the custom-model editor", () => {
    passes({ text: "Reasoning", presetScope: true });
    passes({ text: "Extra High", presetScope: true });
    passes({ tag: "SPAN", text: "Fast Mode", presetScope: true });
    fails({ text: "Reasoning" });
    fails({ text: "Plan" });
    fails({ text: "Reasoning effort", presetScope: true });
    fails({ text: "Settings", presetScope: true });
    fails({ tag: "INPUT", placeholder: "Low", presetScope: true });
  });
  test("every runner literal naming Run is an English baseline alias row", async () => {
    const english = new Set(COPY_ALIASES.map(([name]) => name));
    for (const file of ["cases.mjs", "capture.mjs", "assert.mjs"]) {
      const source = await NodeFSP.readFile(new URL(`./${file}`, import.meta.url), "utf8");
      for (const [literal] of source.matchAll(/"[^"\n]*\bRun\b[^"\n]*"/g))
        expect(english.has(literal.slice(1, -1))).toBe(true);
    }
  });
});

describe("named row controls", () => {
  test("Worked for disclosure matches either anchored form", () => {
    for (const name of ["Worked for 1ms", "작업 시간 1ms"])
      expect(NAMED_ROW_PATTERNS.workedFor.test(name)).toBe(true);
    for (const name of ["작업시간 1ms", "Worked 1ms", "총 작업 시간 1ms", "worked for 1ms"])
      expect(NAMED_ROW_PATTERNS.workedFor.test(name)).toBe(false);
  });
  test("when-clause controls resolve to the command they name", () => {
    expect(namedRowSubject("editWhen", "Edit when clause for Chat: send")).toBe("Chat: send");
    expect(namedRowSubject("editWhen", "대화: 보내기 실행 조건 편집")).toBe("대화: 보내기");
    expect(NAMED_ROW_PATTERNS.editWhen.test("대화: 보내기 실행 조건 편집")).toBe(true);
    for (const name of ["실행 조건 편집", "대화: 보내기 실행 조건 편집하기", "Edit when clause"]) {
      expect(NAMED_ROW_PATTERNS.editWhen.test(name)).toBe(false);
      expect(namedRowSubject("editWhen", name)).toBe(null);
    }
    // The subject must appear in the control's own keybinding row.
    const subject = namedRowSubject("editWhen", "대화: 보내기 실행 조건 편집");
    expect("대화: 새 대화 ⌘N".includes(subject!)).toBe(false);
  });
  test("source details controls resolve to the source they name", () => {
    expect(namedRowSubject("sourceDetails", "Toggle GitHub details")).toBe("GitHub");
    expect(namedRowSubject("sourceDetails", "GitHub 세부 정보 열기/닫기")).toBe("GitHub");
    for (const name of ["세부 정보 열기/닫기", "GitHub 세부 정보 열기", "Toggle details"]) {
      expect(NAMED_ROW_PATTERNS.sourceDetails.test(name)).toBe(false);
      expect(namedRowSubject("sourceDetails", name)).toBe(null);
    }
  });
});

describe("rendered palette preservation", () => {
  async function comparePalette(after: string) {
    await using view = new WebView({ backend: "chrome" });
    await view.navigate("about:blank");
    const readColor = (value: string) =>
      view.evaluate(`(() => {
        document.documentElement.style.setProperty("--background", ${JSON.stringify(value)});
        return (${readRenderedBackground.toString()})();
      })()`);
    const beforeColor = await readColor("oklch(14.5% 0 none)");
    const afterColor = await readColor(after);
    return executeCheck(
      "19",
      "custom-theme-preview",
      async (assert: (label: string, actual: unknown, expected: unknown) => void) =>
        assert("opening custom editor preserves palette", afterColor, beforeColor),
      async () => [{ file: "palette.json", sha256: "a".repeat(64) }],
    );
  }
  test("passes equivalent CSS colors rendered by headless Chromium", async () => {
    expect((await comparePalette("oklch(0.144788 0 0)")).status).toBe("PASS");
  }, 15_000);
  test("fails when the rendered background really changes", async () => {
    expect((await comparePalette("oklch(0.3 0 0)")).status).toBe("FAIL");
  }, 15_000);
});

describe("native System color scheme", () => {
  const fixture = (clearOverride = true) => {
    let override: string | null = "light";
    const nativeTheme = {
      themeSource: "light",
      get shouldUseDarkColors() {
        return this.themeSource === "dark";
      },
    };
    const matchMedia = () => ({
      matches: override === null ? nativeTheme.shouldUseDarkColors : override === "dark",
    });
    return {
      nativeTheme,
      application: {
        evaluate: async (
          action: (electron: { nativeTheme: typeof nativeTheme }, mode: string) => boolean,
          mode: string,
        ) => action({ nativeTheme }, mode),
      },
      page: {
        emulateMedia: async (options: { colorScheme: string | null }) => {
          if (clearOverride) override = options.colorScheme;
        },
        waitForFunction: async (predicate: (dark: boolean) => boolean, dark: boolean) => {
          if (!runInNewContext(`(${predicate})(${dark})`, { matchMedia }))
            throw new Error("Renderer color scheme differs from native theme");
        },
      },
      rendererDark: () => matchMedia().matches,
    };
  };
  test("follows native light dark light despite the default light media override", async () => {
    const { application, page, nativeTheme, rendererDark } = fixture();
    for (const mode of ["light", "dark", "light"]) {
      expect(await setNativeTheme(application, page, mode)).toBe(mode === "dark");
      expect(rendererDark()).toBe(nativeTheme.shouldUseDarkColors);
    }
  });
  test("fails when renderer emulation remains light after the native theme turns dark", async () => {
    const { application, page } = fixture(false);
    await expect(setNativeTheme(application, page, "dark")).rejects.toThrow(
      "Renderer color scheme differs from native theme",
    );
  });
});

describe("provider diagnostic disclosure", () => {
  const name = "원문 진단 및 복구 안내";
  const fixture = (opens = true, role = "button", diagnosticName = name) => {
    const menu = { role: "button", name: "All environments", expanded: false, id: "environment-menu" };
    const diagnostic = {
      role,
      name: diagnosticName,
      expanded: false,
      id: "provider-instance-codex-diagnostic",
    };
    let focused = menu;
    const locator = (matches: () => typeof menu[]) => ({
      filter: () => locator(matches),
      first: () => locator(() => matches().slice(0, 1)),
      count: async () => matches().length,
      waitFor: async () => {
        if (matches().length !== 1) throw new Error("No unique expanded diagnostic");
      },
      focus: async () => {
        const control = matches()[0];
        if (!control) throw new Error("No matching control");
        focused = control;
      },
      getAttribute: async (attribute: string) => {
        const control = matches()[0];
        if (!control) throw new Error("Stale collapsed locator");
        return attribute === "aria-controls" ? control.id : String(control.expanded);
      },
    });
    return {
      menu,
      diagnostic,
      page: {
        locator: () => locator(() => [menu, diagnostic].filter((control) => !control.expanded)),
        getByRole: (
          selectedRole: string,
          options: { name: string; exact: boolean; expanded?: boolean },
        ) =>
          locator(() =>
            [menu, diagnostic].filter(
              (control) =>
                control.role === selectedRole &&
                (options.exact ? control.name === options.name : control.name.includes(options.name)) &&
                (options.expanded === undefined || control.expanded === options.expanded),
            ),
          ),
        keyboard: {
          press: async () => {
            if (opens) focused.expanded = true;
          },
        },
      },
    };
  };
  const assert = (_label: string, actual: unknown, expected: unknown) =>
    expect(actual).toEqual(expected);
  const act = async (_label: string, action: () => Promise<void>) => action();
  test("opens the diagnostic rather than an earlier environment menu and re-queries expanded state", async () => {
    const { page, menu, diagnostic } = fixture();
    const target = await openProviderDiagnostic(page, assert, act, "diagnostic");
    expect(target).toBe('[id="provider-instance-codex-diagnostic"]');
    expect(diagnostic.expanded).toBe(true);
    expect(menu.expanded).toBe(false);
  });
  test("fails when keyboard activation does not open the diagnostic", async () => {
    await expect(openProviderDiagnostic(fixture(false).page, assert, act, "diagnostic")).rejects.toThrow();
  });
  test("rejects a different role or an inexact accessible name", async () => {
    for (const page of [fixture(true, "menuitem").page, fixture(true, "button", `${name} extra`).page])
      await expect(openProviderDiagnostic(page, assert, act, "diagnostic")).rejects.toThrow();
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
  test("registers only the selected projection fixture through thread creation", async () => {
    const base = await NodeFSP.realpath(await NodeFSP.mkdtemp("/tmp/weavra-hig-"));
    const isolation = {
      base,
      home: `${base}/home`,
      workspace: `${base}/workspace`,
      app: `${base}/app`,
    };
    for (const directory of [isolation.home, isolation.workspace, `${isolation.app}/userdata`])
      await NodeFSP.mkdir(directory, { recursive: true });
    const db = new Database(`${isolation.app}/userdata/state.sqlite`);
    const commands: unknown[] = [];
    try {
      db.run(`CREATE TABLE projection_threads
        (thread_id TEXT,project_id TEXT,title TEXT,model_selection_json TEXT,runtime_mode TEXT,
         interaction_mode TEXT,branch TEXT,worktree_path TEXT,created_at TEXT)`);
      db.query("INSERT INTO projection_threads VALUES (?,?,?,?,?,?,?,?,?)").run(
        "selected",
        "project-b",
        "Selected fixture",
        '{"instanceId":"codex","model":"fixture-model"}',
        "approval-required",
        "default",
        null,
        null,
        "2026-10-20T00:00:00.000Z",
      );
      const receipt = await registerSeededThread(
        async (command: unknown) => {
          commands.push(command);
          return { sequence: 7 };
        },
        isolation,
        "selected",
      );
      expect(commands).toEqual([
        {
          type: "thread.create",
          commandId: "hig-register-selected",
          threadId: "selected",
          projectId: "project-b",
          title: "Selected fixture",
          modelSelection: { instanceId: "codex", model: "fixture-model" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-10-20T00:00:00.000Z",
          historyImport: true,
        },
      ]);
      expect(receipt).toEqual({ threadId: "selected", sequence: 7 });
      expect(db.query("SELECT count(*) AS count FROM projection_threads").get()).toEqual({
        count: 1,
      });
    } finally {
      db.close();
      await NodeFSP.rm(base, { recursive: true });
    }
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
