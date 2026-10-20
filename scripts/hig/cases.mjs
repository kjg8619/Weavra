// IDs are evidence identities, never capture-order counters.
export function iconTargetMeetsMinimum(control) {
  return control.rect.width >= 36 && control.rect.height >= 36;
}

export function assertIconTargetHits(assert, label, control) {
  if (control.visible && !control.disabled && control.hits[0])
    assert(`${label}: five icon hit points`, control.hits, [true, true, true, true, true]);
}

export const SIZES = [
  [1280, 800],
  [1920, 1080],
];
const rows = [
  ["01", "first_launch_onboarding_connection", "컴퓨터 연결하기"],
  ["02", "onboarding_agents", "선택한 컴퓨터에서 사용할 수 있는 에이전트예요."],
  ["03", "onboarding_project_selection", "프로젝트 선택하기"],
  ["04", "empty_projects", "무엇을 함께 해볼까요?"],
  ["05", "add_project_import_modal", "로컬 폴더"],
  ["06", "local_folder_picker", "baseline-project"],
  ["07", "chat_empty_project", "baseline-project"],
  ["08", "project_selection", "baseline-project"],
  ["09", "right_panel_menu", "패널 열기"],
  ["10", "right_files", "파일"],
  ["11", "add_action_dialog", "Add Action"],
  ["12", "right_agents", "아직 에이전트가 없어요"],
  ["13", "right_run_graph", "Run 그래프"],
  ["14", "device_setup_dialog", "Set up devices"],
  ["15", "right_browser", "No preview yet"],
  ["16", "right_terminal", "baseline-project"],
  ["17", "settings_general", "Restore device defaults"],
  ["18", "settings_appearance_light", "Color scheme"],
  ["19", "settings_appearance_dark", "Color scheme"],
  ["20", "settings_keybindings", "Keybindings"],
  ["21", "settings_snapshots", "SnapShots"],
  ["22", "settings_providers", "Providers"],
  ["23", "settings_integrations", "Integrations"],
  ["24", "settings_source_control", "Source Control"],
  ["25", "settings_storage", "Storage"],
  ["26", "settings_connections", "Connections"],
  ["27", "settings_archive", "Archive"],
  ["28", "add_custom_model_form", "Cancel"],
  ["29", "settings_diagnostics", "Diagnostics"],
  ["30", "settings_licenses", "Third-party notices"],
  ["31", "chat_model_selector", "Claude"],
  ["32", "chat_permission_menu", "전체 접근"],
  ["33", "project_list_with_threads", "01 Conversation"],
  ["34", "chat_messages", "local screenshot fixture"],
  ["35", "chat_long_messages", "Baseline review"],
  ["36", "chat_code_blocks", "greeting"],
  ["37", "chat_streaming_working", "Inspecting the local workspace"],
  ["38", "chat_error", "Capture fixture: provider unavailable."],
  ["39", "chat_empty_existing_thread", "06 Empty thread"],
  ["40", "right_controlled_tasks", "baseline-project 통제 설정"],
  ["41", "chat_code_blocks_dark", "greeting"],
  ["44", "delete_thread_confirmation", "Confirm"],
  ["45", "rename_thread_inline", "03 Code blocks"],
  ["46", "project_settings_control", "Runtime 실행 제어"],
  ["47", "project_settings_evidence", "증거 요약"],
  ["48", "project_settings_model_fitness", "순위가 아닌 계약 준수 증거"],
];
export const DESKTOP_STATES = rows.map(([id, name, expected]) => ({ id, name, expected }));
export const STRESS_STATES = [
  { id: "42", name: "narrow_chat_dark", expected: "greeting" },
  { id: "43", name: "narrow_chat_light", expected: "greeting" },
];
export function expectedFiles() {
  return [
    ...SIZES.flatMap(([w, h]) =>
      DESKTOP_STATES.map(({ id, name }) => `${w}x${h}/${id}_${name}.png`),
    ),
    ...STRESS_STATES.map(({ id, name }) => `390x844/${id}_${name}.png`),
  ];
}
export function expectedCaptureFiles() {
  return [
    ...expectedFiles(),
    ...[...SIZES, [840, 620], [2560, 1440]].flatMap(([w, h]) =>
      ["light", "dark"].flatMap((theme) => [
        ...["46", "47", "48"].flatMap((id) =>
          ["top", "end"].map(
            (position) => `matrix/${w}x${h}/${theme}/${id}/${position}-default.png`,
          ),
        ),
        `matrix/${w}x${h}/${theme}/48/actions-end-default.png`,
      ]),
    ),
    ...SIZES.map(([w, h]) => `matrix/${w}x${h}/light/46/prepare-end-default.png`),
  ];
}

// Exact aliases only. Translation never changes the state ID or semantic target.
export const LABELS = {
  continue: ["계속하기"],
  skip: ["프로젝트 가져오지 않기"],
  import: ["프로젝트 추가", "새 프로젝트"],
  local: ["로컬 폴더"],
  cancel: ["Cancel", "취소"],
  settings: ["설정"],
  threadNotifications: ["Thread notifications"],
  notificationsOnly: ["Notifications only"],
  inAppNotifications: ["In-app notifications"],
  general: ["General", "일반"],
  appearance: ["Appearance", "모양"],
  light: ["Light", "라이트"],
  dark: ["Dark", "다크"],
  keybindings: ["Keybindings", "키보드 단축키"],
  snapshots: ["SnapShots", "스냅샷"],
  providers: ["Providers", "공급자"],
  integrations: ["Integrations", "연동"],
  source_control: ["Source Control", "소스 제어"],
  storage: ["Storage", "저장 공간"],
  connections: ["Connections", "연결"],
  archive: ["Archive", "보관함"],
  customModel: ["Add custom model", "사용자 지정 모델 추가"],
  diagnostics: ["View diagnostics", "진단 보기"],
  licenses: ["View licenses", "라이선스 보기"],
  model: ["Claude Fable 5.1"],
  mode: ["실행 모드"],
  panel: ["오른쪽 패널 열기/닫기"],
  addPanel: ["패널 추가"],
  files: ["파일"],
  agents: ["에이전트"],
  graph: ["Run 그래프"],
  devices: ["기기"],
  browser: ["브라우저"],
  terminal: ["터미널"],
  controlled: ["통제 작업"],
  prepare: ["워크플로 준비"],
  fitnessLoad: ["기록 불러오기"],
  actions: ["Actions", "작업"],
};
export function chooseAlias(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total !== 1) throw new Error(`Selector ambiguity/missing target: ${counts.join(",")}`);
  return counts.findIndex((count) => count === 1);
}

// Assertions are selected by task, not inferred from screenshot names.
// A product case never inherits task 01's harness-only verdict.
export const CASES = {
  "01": {
    closes: [],
    prerequisite: "G-07",
    states: DESKTOP_STATES.map((s) => s.id),
    targets: ["#weavra-controls", "#weavra-evidence", "#weavra-fitness", "#project-actions"],
    checks: [
      "provenance",
      "isolation",
      "state-identity",
      "visible-body",
      "native-minimum",
      "no-model",
      "complete-pairs",
    ],
  },
  "02": {
    closes: ["W-27", "W-28", "W-29"],
    states: [
      "05",
      "07",
      "11",
      "15",
      "16",
      "18",
      "19",
      "34",
      "35",
      "36",
      "37",
      "38",
      "39",
      "40",
      "41",
    ],
    checks: [
      "portal-owner",
      "escape-focus-return",
      "compositor-motion",
      "reduced-motion",
      "semantic-colors",
      "contrast",
      "icon-targets",
      "frozen-network-notices",
    ],
  },
  "03": {
    closes: ["W-06", "W-31", "W-32"],
    states: ["01", "46", "47", "48"],
    checks: [
      "unsupported",
      "disconnected",
      "stale",
      "missing-scope",
      "fresh",
      "foreign-owner",
      "confirmation-binding",
      "no-reconnect-replay",
      "diagnostic-copy",
      "unknown-disclosure",
      "request-counters",
    ],
  },
  "04": {
    closes: ["W-01", "W-02"],
    states: ["05", "06", "07", "22", "34", "38"],
    checks: [
      "auth-error",
      "turn-error",
      "independent-causes",
      "event-deduplication",
      "focused-completion",
      "unfocused-single-notice",
      "modal-update-suppression",
      "no-replay",
    ],
  },
  "05": {
    closes: ["W-04", "W-05", "W-10"],
    states: ["01", "03", "04", "07", "08", "32", "33"],
    checks: [
      "read-only-default",
      "saved-mode-preserved",
      "three-suggestions",
      "no-send-on-suggestion",
      "selected-project",
      "explicit-escalation",
    ],
  },
  "06": {
    closes: ["W-09", "W-16"],
    states: ["07", "33", "37", "40"],
    checks: [
      "both-sidebars",
      "phase-activity-freshness",
      "unknown-counts",
      "stalled-recovery",
      "footer-wrap",
      "reduced-motion",
    ],
  },
  "07": {
    closes: ["W-07"],
    states: ["04", "05", "06"],
    checks: ["prerequisite-destination", "unsupported-import", "folder-route", "keyboard-route"],
  },
  "08": {
    closes: ["W-08"],
    states: ["07", "15", "28", "34"],
    checks: [
      "persistent-label",
      "composer-focus",
      "model-id-label",
      "address-label",
      "path-label",
      "attachment-drop",
      "keyboard-attachment",
    ],
  },
  "09": {
    closes: ["W-11", "W-12"],
    states: ["09", "10"],
    checks: [
      "locked-destination-reason",
      "files-loading",
      "files-empty",
      "files-no-results",
      "files-error",
      "refresh",
      "pane-isolation",
    ],
  },
  10: {
    closes: ["W-14", "W-15"],
    states: ["13", "29", "47", "48"],
    checks: [
      "graph-no-snapshot",
      "fitness-no-record",
      "read-only-next-step",
      "no-evaluation-request",
      "contrast",
      "text-size",
    ],
  },
  11: {
    closes: ["W-13"],
    states: ["11"],
    checks: [
      "empty-command",
      "whitespace-command",
      "no-save-on-invalid",
      "inline-validation",
      "valid-action",
    ],
  },
  12: {
    closes: ["W-17", "W-18"],
    states: ["20"],
    checks: ["condition-ast-equivalence", "alias-grouping", "keyboard-layout-parity", "no-rebind"],
  },
  13: {
    closes: ["W-19"],
    states: ["21"],
    checks: ["snapshot-hierarchy", "capture-attachment-explanation", "toggle-preservation"],
  },
  14: {
    closes: ["W-21"],
    states: ["23"],
    checks: [
      "selected-destination-visible",
      "long-destination",
      "selection-preserved",
      "keyboard-disclosure",
    ],
  },
  15: {
    closes: ["W-22"],
    states: ["24"],
    checks: [
      "installed-ready",
      "unauthenticated",
      "authenticated",
      "unavailable",
      "no-authentication-side-effect",
    ],
  },
  16: {
    closes: ["W-23"],
    states: ["26"],
    checks: [
      "empty-connection-action",
      "capability-copy-parity",
      "unavailable-disabled",
      "direct-remote",
    ],
  },
  17: {
    closes: ["W-24"],
    states: ["27"],
    checks: ["empty-archive-route", "return-to-conversation", "archive-restore"],
  },
  18: {
    closes: ["W-20", "W-25"],
    states: ["22", "28"],
    checks: [
      "status-summary-complete",
      "raw-diagnostic",
      "six-adapters",
      "one-scroll-owner",
      "form-actions-reachable",
      "draft-preserved",
    ],
  },
  19: {
    closes: ["W-26"],
    states: ["18", "19"],
    checks: [
      "selection-wash-check",
      "focus-not-selection",
      "system-live-theme",
      "custom-theme-preview",
    ],
  },
  20: {
    closes: ["W-30"],
    states: ["44"],
    checks: [
      "named-delete-consequence",
      "target-identity",
      "enter-no-delete",
      "escape-cancel",
      "focus-return",
    ],
  },
  21: {
    closes: ["W-33", "W-34"],
    states: ["36", "41", "42", "43"],
    checks: [
      "theme-content-parity",
      "renderer-electron-parity",
      "virtual-anchor",
      "native-minimum",
      "git-overflow",
      "hit-test",
      "draft-preserved",
    ],
  },
  22: {
    closes: ["W-03"],
    states: DESKTOP_STATES.map((s) => s.id),
    checks: [
      "authored-locale",
      "raw-diagnostics-allowlist",
      "both-sidebars",
      "six-adapters",
      "long-korean-copy",
      "keyboard-ax",
    ],
  },
};

// Scenario code runs only inside the disposable packaged-app capture session.
// Every check owns its assertion rows and hashed raw observations. A missing
// executor is an explicit FAIL; it cannot inherit a case/group verdict.
// Reads the clipboard only after the observed write settles; a write that never
// completes times out, and each copied `label: value` line yields its exact value.
export async function readCompletedCopy(written, readText, timeoutMs = 10_000) {
  const { bounded } = await import("./assert.mjs");
  await bounded(written, "diagnostic clipboard write completion", timeoutMs);
  const text = await readText();
  const values = text.split(/\r?\n/).map((line) => {
    const at = line.indexOf(": ");
    return at < 0 ? line : line.slice(at + 2);
  });
  return { text, values };
}

// The shell stream sends `snapshot` only to a client without state. A resumed client
// loads the authoritative HTTP snapshot and the stream confirms it with `synchronized`;
// later events apply on top. Anything else is not a settled shell baseline.
/** @param {{ streamSnapshot?: any, httpSnapshot?: any, synchronized?: boolean, events?: any[] }} input */
export function resolveShellBaseline({ streamSnapshot, httpSnapshot, synchronized, events = [] }) {
  const base = streamSnapshot ?? (synchronized ? httpSnapshot : null);
  if (!base || !Array.isArray(base.threads) || !Number.isInteger(base.snapshotSequence))
    throw new Error("Missing shell snapshot for completion fixture");
  const snapshot = structuredClone(base);
  for (const event of events) {
    if (!(event.sequence > snapshot.snapshotSequence)) continue;
    if (event.kind === "thread-upserted") {
      const at = snapshot.threads.findIndex((row) => row.id === event.thread.id);
      if (at < 0) snapshot.threads.push(event.thread);
      else snapshot.threads[at] = event.thread;
    } else if (event.kind === "thread-removed")
      snapshot.threads = snapshot.threads.filter((row) => row.id !== event.threadId);
    snapshot.snapshotSequence = event.sequence;
  }
  return snapshot;
}

// Resolves once the renderer reports a real blur and document focus is gone.
export async function awaitFocusLoss(blurred, readHasFocus, timeoutMs = 10_000) {
  const { bounded } = await import("./assert.mjs");
  await bounded(blurred, "renderer window blur", timeoutMs);
  if (await readHasFocus()) throw new Error("Renderer still reports document focus after blur");
}

// Tracks request/response pairs per RPC method so a check can wait until a
// query has answered and none is still in flight. Zero requests is not settled.
export function createRpcLedger() {
  const pending = new Map();
  const completed = new Map();
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const isSettled = (method) =>
    (completed.get(method) ?? 0) > 0 && ![...pending.values()].includes(method);
  return {
    request(key, method) {
      pending.set(key, method);
      notify();
    },
    cancel(key) {
      if (pending.delete(key)) notify();
    },
    exit(key) {
      const method = pending.get(key);
      if (method === undefined) return;
      pending.delete(key);
      completed.set(method, (completed.get(method) ?? 0) + 1);
      notify();
    },
    async settled(method, timeoutMs = 15_000) {
      const { bounded } = await import("./assert.mjs");
      let listener;
      try {
        await bounded(
          new Promise((resolve) => {
            listener = () => isSettled(method) && resolve();
            listeners.add(listener);
            listener();
          }),
          `${method} settled`,
          timeoutMs,
        );
      } finally {
        listeners.delete(listener);
      }
    },
  };
}

// Stacked toasts are the viewport's direct children; anchored toasts render as toast-popup.
export const TOAST_SELECTOR = '[data-slot="toast-viewport"] > *, [data-slot="toast-popup"]';

// Product switches expose their state as aria-checked or as Base UI's
// data-checked/data-unchecked. Contradictory or missing state is unknown (null).
export function switchCheckedState({ ariaChecked, dataChecked, dataUnchecked }) {
  if (ariaChecked === "true" || ariaChecked === "false") return ariaChecked === "true";
  if (dataChecked !== null && dataUnchecked === null) return true;
  if (dataUnchecked !== null && dataChecked === null) return false;
  return null;
}

// Elements only the requested sidebar implementation renders.
export const SIDEBAR_VARIANT_MARKERS = {
  legacy: '[data-testid="new-thread-button"]',
  current: '[data-testid="sidebar-row-card"], [data-testid="sidebar-row-slim"]',
};

export const COMMAND_DIALOG_POPUP = '[data-slot="command-dialog-popup"]';

// Counts visible exact-text matches inside the active command dialog only, so
// sidebar rows, breadcrumbs and blurred background headings cannot inflate it.
export function countInActiveDialog(page, text) {
  return page
    .locator(COMMAND_DIALOG_POPUP)
    .getByText(text, { exact: true })
    .filter({ visible: true })
    .count();
}

export function deliverScenarioEvent(sockets, method, value) {
  let delivered = 0;
  for (const entry of sockets) {
    if (entry.closed) continue;
    for (const [id, tag] of entry.methods)
      if (tag === method) {
        entry.socket.send(JSON.stringify({ _tag: "Chunk", requestId: id, values: [value] }));
        delivered++;
      }
  }
  if (!delivered) throw new Error(`No live subscriber for scenario event: ${method}`);
  return delivered;
}

export async function runScenarios(context) {
  const { freezeCaptureServerFrame } = await import("./seed.mjs");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { executeCheck, sha256, bounded } = await import("./assert.mjs");
  const {
    page,
    cdp,
    output,
    packet,
    selected,
    theme: changeTheme,
    click,
    named,
    thread: navigateThread,
    nativeMenu,
  } = context;
  const rows = [];
  let observations = [];
  let actions = [];
  let artifacts = [];
  let current;
  let wire = null;
  let responseTransform = null;
  let providerFixture = null;
  const replies = new Map();
  let requests = [];
  let liveConfig = null;
  let onConfig;
  const streamSamples = new Map();
  const shellState = { synchronized: false, events: [], http: null };
  const rpc = createRpcLedger();
  let focusEmulation = null;
  await page.route(
    (url) => url.pathname.endsWith("/api/orchestration/shell"),
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (response.ok()) shellState.http = structuredClone(body);
      await route.fulfill({ response, json: body });
    },
  );
  await page.route("**/api/auth/session", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (wire?.variant === "missing-scope")
      body.scopes = (body.scopes ?? []).filter((scope) => scope !== "orchestration:operate");
    await route.fulfill({ response, json: body });
  });
  const sockets = [];
  await page.routeWebSocket("**/*", (socket) => {
    const server = socket.connectToServer();
    const methods = new Map();
    const synthetic = new Set();
    const entry = { socket, server, methods };
    sockets.push(entry);
    socket.onClose(() => {
      entry.closed = true;
      server.close();
    });
    server.onClose(() => {
      entry.closed = true;
      socket.close();
    });
    socket.onMessage((message) => {
      const decoded = JSON.parse(String(message));
      const frames = Array.isArray(decoded) ? decoded : [decoded];
      for (const frame of frames) {
        if (frame._tag === "Interrupt") {
          methods.delete(frame.requestId);
          rpc.cancel(`${sockets.indexOf(entry)}:${frame.requestId}`);
        }
        if (frame._tag === "Request") {
          methods.set(frame.id, frame.tag);
          requests.push({ method: frame.tag, command: frame.payload?.request?.type ?? null });
          if (replies.has(frame.tag)) {
            synthetic.add(String(frame.id));
            Promise.resolve(replies.get(frame.tag)(frame.payload)).then((exit) =>
              socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit })),
            );
            continue;
          }
          if (wire)
            wire.requests.push({
              method: frame.tag,
              command: frame.payload?.request?.type ?? null,
            });
          if (wire && frame.tag === "weavra.controlObserve") {
            synthetic.add(String(frame.id));
            wire.observers.push({ socket, id: frame.id });
            socket.send(
              JSON.stringify({
                _tag: "Chunk",
                requestId: frame.id,
                values: [wire.observation, wire.observation],
              }),
            );
            continue;
          }
          if (wire && frame.tag === "weavra.control") {
            synthetic.add(String(frame.id));
            const request = frame.payload.request;
            const preview = {
              previewId: "hig-preview",
              previewDigest: `sha256:${"a".repeat(64)}`,
              ownerId: "hig-owner",
              projectRevision: 0,
              expiresAt: Date.now() + 300000,
              goal: request.goal,
              workflow: "STANDARD",
              executionMode: "READ_ONLY",
              risk: "R1",
              allowedPaths: ["src"],
              checks: [{ id: "unit", kind: "test", required: true }],
              acceptanceCriteria: [
                {
                  id: "AC-1",
                  statement: "Inspect isolated fixture",
                  checkIds: ["unit"],
                  reviewRequired: true,
                },
              ],
              taskContractDigest: `sha256:${"a".repeat(64)}`,
              recipe: null,
              configuration: {
                mutationMode: "strict",
                verifierTrustMode: "strict",
                verifierSandboxMode: "disabled",
                contextPackMode: "bounded",
                verificationRepairMode: "disabled",
                lspEnabled: false,
              },
            };
            // This boundary fixture is never forwarded to Runtime. It proves
            // renderer guards, not Runtime completion or real-model quality.
            if (request.type !== "workflow.prepare")
              throw new Error(`Unexpected synthetic control mutation: ${request.type}`);
            wire.observation.state.preview = preview;
            wire.observation.state.nextRequestId = "hig-owner:2";
            socket.send(
              JSON.stringify({
                _tag: "Exit",
                requestId: frame.id,
                exit: {
                  _tag: "Success",
                  value: {
                    protocolVersion: 1,
                    type: "control_response",
                    id: request.id,
                    command: request.type,
                    ownerId: "hig-owner",
                    runId: null,
                    stateRevision: null,
                    projectRevision: 0,
                    eventId: null,
                    timestamp: Date.now(),
                    success: true,
                    data: { kind: "prepared", preview },
                  },
                },
              }),
            );
            for (const observer of wire.observers)
              observer.socket.send(
                JSON.stringify({
                  _tag: "Chunk",
                  requestId: observer.id,
                  values: [wire.observation],
                }),
              );
            continue;
          }
        }
        if (frame._tag === "Request") {
          rpc.request(`${sockets.indexOf(entry)}:${frame.id}`, frame.tag);
          if (frame.tag === "orchestration.subscribeShell")
            Object.assign(shellState, { synchronized: false, events: [] });
        }
        if (!synthetic.has(String(frame.requestId))) server.send(JSON.stringify(frame));
      }
    });
    server.onMessage((message) => {
      const decoded = JSON.parse(String(message));
      const frames = Array.isArray(decoded) ? decoded : [decoded];
      for (let frame of frames) {
        frame = freezeCaptureServerFrame(frame, methods.get(frame.requestId));
        if (providerFixture && methods.get(frame.requestId) === "server.getConfig")
          if (frame.exit?._tag === "Success") frame.exit.value.providers = providerFixture;
        if (providerFixture && methods.get(frame.requestId) === "subscribeServerConfig")
          if (frame._tag === "Chunk")
            for (const value of frame.values) {
              if (value.type === "snapshot") value.config.providers = providerFixture;
              if (value.type === "providerStatuses") value.payload.providers = providerFixture;
            }
        const config = (value) => ({
          ...value,
          environment: {
            ...value.environment,
            capabilities: { ...value.environment.capabilities, weavraControl: wire.supported },
          },
        });
        if (
          wire &&
          methods.get(frame.requestId) === "subscribeServerConfig" &&
          frame._tag === "Chunk"
        )
          frame.values = frame.values.map((value) =>
            value.type === "snapshot" ? { ...value, config: config(value.config) } : value,
          );
        if (
          wire &&
          methods.get(frame.requestId) === "server.getConfig" &&
          frame.exit?._tag === "Success"
        )
          frame.exit.value = config(frame.exit.value);
        const method = methods.get(frame.requestId);
        if (frame._tag === "Exit") rpc.exit(`${sockets.indexOf(entry)}:${frame.requestId}`);
        if (frame._tag === "Chunk")
          for (const value of frame.values)
            if (value.kind === "snapshot" || value.type === "snapshot") {
              streamSamples.set(method, structuredClone(value));
              if (method === "orchestration.subscribeShell") shellState.events = [];
            } else if (method === "orchestration.subscribeShell") {
              if (value.kind === "synchronized") shellState.synchronized = true;
              else if (Number.isInteger(value.sequence))
                shellState.events.push(structuredClone(value));
            }
        if (responseTransform && frame._tag === "Chunk")
          frame.values = frame.values.map((value) => responseTransform(method, value));
        if (responseTransform && frame.exit?._tag === "Success")
          frame.exit.value = responseTransform(method, frame.exit.value);
        if (method === "server.getConfig" && frame.exit?._tag === "Success")
          liveConfig = frame.exit.value;
        if (method === "subscribeServerConfig" && frame._tag === "Chunk")
          for (const value of frame.values)
            if (value.type === "snapshot") liveConfig = value.config;
        if (liveConfig) onConfig?.();
        socket.send(JSON.stringify(frame));
      }
    });
  });
  async function save(file, bytes) {
    const relative = `scenarios/${current}/${file}`;
    await fs.mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await fs.writeFile(path.join(output, relative), bytes);
    artifacts.push({ file: relative, sha256: sha256(bytes) });
  }
  async function frame(label) {
    await save(`${label}.png`, await page.screenshot({ scale: "css" }));
    await save(
      `${label}.ax.json`,
      JSON.stringify(await cdp.send("Accessibility.getFullAXTree"), null, 2),
    );
  }
  async function sample(label, evaluate, argument) {
    const result = await page.evaluate(evaluate, argument);
    observations.push({ label, result });
    return result;
  }
  async function act(label, action) {
    actions.push({ label, status: "STARTED" });
    const row = actions.at(-1);
    await action();
    row.status = "COMPLETED";
  }
  async function settle() {
    await bounded(
      page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.allSettled(
          document
            .getAnimations()
            .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
            .map((a) => a.finished),
        );
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }),
      "Scenario settled frame",
    );
  }
  async function home() {
    await act("return to conversation", () =>
      page.evaluate(() => {
        location.hash = "/";
      }),
    );
    await page.waitForFunction(() => location.hash.startsWith("#/draft/"));
    await context.ready(page, "baseline-project");
  }
  async function thread(title) {
    await navigateThread(title);
    const states = {
      "01 Conversation": ["baseline-messages", "local screenshot fixture"],
      "02 Long messages": ["baseline-long", "Baseline review"],
      "03 Code blocks": ["baseline-code", "greeting"],
      "04 Working fixture": ["baseline-working", "Inspecting the local workspace"],
      "05 Error fixture": ["baseline-error", "Recovery context"],
      "06 Empty thread": ["baseline-empty", "06 Empty thread"],
    };
    const [identity, expected] = states[title];
    await page.waitForFunction((id) => location.hash.includes(id), identity);
    await context.ready(page, expected);
  }
  async function theme(mode) {
    const route = await page.evaluate(() => location.hash);
    await changeTheme(mode);
    await page.waitForFunction(
      ({ route, mode }) =>
        location.hash === route &&
        document.documentElement.classList.contains("dark") === (mode === "dark"),
      { route, mode },
    );
    await settle();
  }
  async function settings(section) {
    await home();
    await act(`open settings ${section}`, async () => {
      await click("button", "settings");
      await click("button", section);
    });
    await settle();
  }
  async function unique(selector) {
    const target = page.locator(selector).filter({ visible: true });
    await target.waitFor({ state: "visible" });
    if ((await target.count()) !== 1) throw new Error(`Ambiguous scenario target: ${selector}`);
    return target;
  }
  async function owner(assert, label, selector) {
    await page.locator(selector).filter({ visible: true }).waitFor({ state: "visible" });
    await settle();
    if (current.startsWith("02/")) await iconTargets(assert, label);
    const geometry = await sample(
      label,
      (selector) => {
        const targets = [...document.querySelectorAll(selector)].filter((node) =>
          node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        );
        return targets.map((node) => {
          const rect = node.getBoundingClientRect();
          const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
          const inset = Math.min(rect.width / 4, rect.height / 4, Math.max(4, radius));
          const points = [
            [rect.x + rect.width / 2, rect.y + rect.height / 2],
            [rect.left + inset, rect.top + inset],
            [rect.right - inset, rect.top + inset],
            [rect.left + inset, rect.bottom - inset],
            [rect.right - inset, rect.bottom - inset],
          ];
          return {
            rect: rect.toJSON(),
            hits: points.map(([x, y]) => {
              const hit = document.elementFromPoint(x, y);
              return hit === node || node.contains(hit);
            }),
            focusInside: node.contains(document.activeElement),
            active: document.activeElement?.outerHTML,
          };
        });
      },
      selector,
    );
    assert(`${label}: unique visible owner`, geometry.length, 1);
    assert(
      `${label}: positive geometry`,
      geometry[0].rect.width > 0 && geometry[0].rect.height > 0,
      true,
    );
    assert(`${label}: five hit points`, geometry[0].hits, [true, true, true, true, true]);
    await frame(label);
    return geometry[0];
  }
  async function iconTargets(assert, label) {
    const controls = await sample(`${label}: icon targets`, () =>
      [...document.querySelectorAll("button[data-icon-control]")]
        .filter((node) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const inset = Math.min(4, rect.width / 4, rect.height / 4);
          const points = [
            [rect.x + rect.width / 2, rect.y + rect.height / 2],
            [rect.left + inset, rect.top + inset],
            [rect.right - inset, rect.top + inset],
            [rect.left + inset, rect.bottom - inset],
            [rect.right - inset, rect.bottom - inset],
          ];
          return {
            name: node.getAttribute("aria-label") ?? node.textContent,
            rect: rect.toJSON(),
            disabled: node.matches(":disabled"),
            visible: true,
            hits: points.map(([x, y]) => {
              const hit = document.elementFromPoint(x, y);
              return hit === node || node.contains(hit);
            }),
          };
        }),
    );
    for (const control of controls) {
      assert(
        `${label}: ${control.name} >=36x36 (disabled=${control.disabled})`,
        iconTargetMeetsMinimum(control),
        true,
      );
      assertIconTargetHits(assert, `${label}: ${control.name}`, control);
    }
  }
  async function motionProperties(assert, label, selector, reduced = false) {
    await page.locator(selector).waitFor({ state: "attached" });
    const records = await sample(
      label,
      (selector) =>
        [...document.querySelectorAll(selector)].map((node) => {
          const s = getComputedStyle(node);
          return {
            selector,
            property: s.transitionProperty,
            duration: s.transitionDuration,
            animations: node.getAnimations().map((animation) => ({
              duration: animation.effect?.getComputedTiming().duration,
              keyframes: animation.effect?.getKeyframes(),
            })),
          };
        }),
      selector,
    );
    assert(`${label}: observed controls`, records.length > 0, true);
    for (const record of records) {
      assert(
        `${label}: compositor transition (${record.property})`,
        record.property
          .split(",")
          .every((part) =>
            ["none", "opacity", "transform", "translate", "scale", "rotate"].includes(part.trim()),
          ),
        true,
      );
      if (reduced) {
        assert(
          `${label}: reduced opacity-only cue`,
          record.property.split(",").every((part) => ["none", "opacity"].includes(part.trim())),
          true,
        );
        assert(
          `${label}: reduced duration`,
          record.duration.split(",").every((duration) => parseFloat(duration) <= 0.08),
          true,
        );
      }
    }
  }
  async function contrast(assert, selector, label) {
    await unique(selector);
    const samples = await sample(
      label,
      (selector) => {
        const node = document.querySelector(selector);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const rgba = (color) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => (i === 3 ? v / 255 : v));
        };
        const layers = [];
        for (let e = node; e; e = e.parentElement) {
          const style = getComputedStyle(e);
          layers.push({
            color: rgba(style.backgroundColor),
            image: style.backgroundImage,
            opacity: style.opacity,
          });
        }
        let bg = [255, 255, 255];
        for (const layer of layers.toReversed())
          bg = bg.map((v, i) => layer.color[i] * layer.color[3] + v * (1 - layer.color[3]));
        const fg = rgba(getComputedStyle(node).color);
        const composited = bg.map((v, i) => fg[i] * fg[3] + v * (1 - fg[3]));
        const luminance = (rgb) =>
          rgb
            .map((v) => {
              const n = v / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [light, dark] = [luminance(bg), luminance(composited)].sort((a, b) => b - a);
        return {
          text: node.textContent,
          rect: node.getBoundingClientRect().toJSON(),
          foreground: fg,
          background: bg,
          layers,
          ratio: (light + 0.05) / (dark + 0.05),
        };
      },
      selector,
    );
    const backgrounds = await context.win.evaluate(async (window, rect) => {
      const values = [];
      for (const fraction of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const region = {
          x: Math.round(rect.left + rect.width * fraction),
          y: Math.floor(rect.top),
          width: 1,
          height: 1,
        };
        const bitmap = (await window.webContents.capturePage(region)).toBitmap();
        for (let i = 0; i < bitmap.length; i += 4)
          values.push({ region, rgb: [bitmap[i + 2], bitmap[i + 1], bitmap[i]] });
      }
      return values;
    }, samples.rect);
    const luminance = (rgb) =>
      rgb
        .map((v) => {
          const n = v / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratios = backgrounds.map(({ rgb }) => {
      const foreground = rgb.map(
        (v, i) => samples.foreground[i] * samples.foreground[3] + v * (1 - samples.foreground[3]),
      );
      const [light, dark] = [luminance(rgb), luminance(foreground)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    });
    observations.push({ label: `${label}: composited samples`, backgrounds, ratios });
    assert(`${label}: sampled composited background`, backgrounds.length > 0, true);
    assert(
      `${label}: worst sampled text contrast ${Math.min(...ratios)}`,
      Math.min(...ratios) >= 4.5,
      true,
    );
    await frame(label);
  }
  async function openAction() {
    await home();
    await act("open Add Action", async () =>
      (await unique('button[aria-label="작업 추가"]')).click(),
    );
    await unique('[data-slot="dialog-popup"]');
    await settle();
  }
  async function labelledField(assert, selector, value) {
    const field = await unique(selector);
    for (const text of ["", value]) {
      await act(`type into ${selector}`, () => field.fill(text));
      const state = await sample(
        "persistent field label",
        (selector) => {
          const node = document.querySelector(selector);
          const ids = (node.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
          const labels = [
            ...(node.labels ?? []),
            ...ids.map((id) => document.getElementById(id)).filter(Boolean),
          ];
          return {
            value: node.value ?? node.textContent,
            labels: labels.map((label) => ({
              text: label.textContent,
              visible: label.checkVisibility(),
              rect: label.getBoundingClientRect().toJSON(),
            })),
          };
        },
        selector,
      );
      assert(
        "purpose remains visible while typing",
        state.labels.some(
          (label) =>
            label.visible &&
            label.text.trim().length > 0 &&
            label.rect.width > 0 &&
            label.rect.height > 0,
        ),
        true,
      );
    }
    await frame("typed-field");
  }
  async function modelForm() {
    await settings("providers");
    await act("open custom model form", () => click("button", "customModel"));
    await unique('input[id$="-custom-model"]');
  }
  async function nativeBounds(assert) {
    const native = await context.win.evaluate((window) => {
      window.setSize(390, 400);
      return {
        minimum: window.getMinimumSize(),
        outer: window.getBounds(),
        client: window.getContentBounds(),
      };
    });
    observations.push({ native });
    assert("native minimum unchanged", native.minimum, [840, 620]);
    assert(
      "native rejects unsupported dimensions",
      native.outer.width >= 840 && native.outer.height >= 620,
      true,
    );
    await context.resize(1920, 1080);
  }
  async function codeCycle(assert, check) {
    await home();
    await thread("03 Code blocks");
    const samples = [];
    for (const [width, height] of [
      [840, 620],
      [1280, 800],
      [1920, 1080],
      [2560, 1440],
      [390, 844],
    ]) {
      await context.resize(width, height, width === 390);
      for (const mode of ["light", "dark", "light"]) {
        // Settings navigation at stress width is not a supported native route.
        if (width === 390) await context.resize(1280, 800);
        await theme(mode);
        if (width === 390) await context.resize(width, height, true);
        await context.ready(page, "greeting");
        samples.push(
          await sample(`code-${width}-${mode}`, () => ({
            route: location.hash,
            text: [...document.querySelectorAll("pre, table")].map((node) => node.textContent),
            code: [...document.querySelectorAll("pre")].map((node) => ({
              text: node.textContent,
              rect: node.getBoundingClientRect().toJSON(),
            })),
            viewport: { width: innerWidth, height: innerHeight },
            pageWidth: document.documentElement.scrollWidth,
          })),
        );
        await frame(`code-${width}-${mode}-${samples.length}`);
      }
    }
    await context.resize(1920, 1080);
    await check(samples);
    assert("complete theme-size matrix", samples.length, 15);
  }
  async function openProjectSettings() {
    await home();
    await thread("03 Code blocks");
    await nativeMenu("프로젝트 설정");
    await page.locator("#weavra-controls").waitFor();
  }
  async function observedText(assert, selector, label, predicate) {
    await page.locator(selector).waitFor({ state: "attached" });
    const text = await sample(
      label,
      (selector) =>
        [...document.querySelectorAll(selector)]
          .filter((node) => node.checkVisibility())
          .map((node) => node.textContent)
          .join("\n"),
      selector,
    );
    assert(`${label}: visible body`, text.trim().length > 0, true);
    assert(label, predicate(text), true);
    await frame(label);
  }
  async function unchangedRequests(assert, action) {
    const before = { ...packet.counters };
    await act("exercise guarded action", action);
    await settle();
    assert("no model dispatch", packet.counters.model, before.model);
    assert("no Runtime mutation", packet.counters.runtimeMutation, before.runtimeMutation);
    observations.push({ requestsBefore: before, requestsAfter: { ...packet.counters } });
  }
  async function settingsDisclosure(assert, section, label) {
    await settings(section);
    const controls = page.locator('button[aria-expanded="false"]').filter({ visible: true });
    const count = await controls.count();
    assert(`${label}: disclosure exists`, count > 0, true);
    const control = controls.first();
    await act(`${label}: open disclosure with keyboard`, async () => {
      await control.focus();
      await page.keyboard.press("Enter");
    });
    assert(`${label}: expanded`, await control.getAttribute("aria-expanded"), "true");
    await frame(label);
  }
  async function runtimeVariant(variant) {
    const state = {
      ownerId: "hig-owner",
      nextRequestId: "hig-owner:1",
      projectRevision: 0,
      stateRevision: null,
      ownedRunId: null,
      busy: false,
      cancelling: false,
      startFailure: null,
      preview: null,
      browserPreview: null,
      factPreview: null,
      pendingApproval: null,
      projectFacts: { status: "available", entries: [] },
      snapshot: {
        status: {
          source: "durable-canonical-state",
          ownerObserved: false,
          state: "missing",
          writerPresent: false,
          run: null,
        },
        graph: null,
        graphAvailable: false,
        evidence: null,
        configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
      },
    };
    const capabilities = {
      authority: "Runtime/Kernel",
      control: "workflow-control-v1",
      ownerId: "hig-owner",
      commands: [
        "control.hello",
        "control.snapshot",
        "workflow.prepare",
        "workflow.confirm",
        "workflow.cancel",
        "approval.resolve",
        "browser.inspect",
        "browser.prepare",
        "browser.confirm",
        "facts.prepare",
        "facts.confirm",
      ],
      maxRequestBytes: 32768,
      maxResponseBytes: 65536,
      resultLimit: 64,
      previewTtlMs: 300000,
      runtimeVersion: "hig-synthetic",
      readiness: "READY",
      recipes: [],
    };
    wire = {
      authority: "SYNTHETIC_WIRE_OBSERVATION; NOT_RUNTIME_EXECUTION",
      variant,
      supported: variant !== "unsupported",
      requests: [],
      observers: [],
      observation: {
        status: variant === "disconnected" ? "DISCONNECTED" : "CONNECTED",
        stale: ["stale", "disconnected"].includes(variant),
        state,
        capabilities,
        observedAt: Date.now(),
        errorCode: null,
      },
    };
    if (variant === "foreign-owner") {
      state.snapshot.status = {
        source: "durable-canonical-state",
        ownerObserved: false,
        state: "available",
        writerPresent: true,
        run: {
          runId: "hig-foreign-run",
          status: "RUNNING",
          phase: "IMPLEMENT",
          workflow: "STANDARD",
          risk: "R1",
          executionMode: "EDIT",
          codeRevision: 0,
          currentStep: { stepId: "implement", attempt: 0 },
          activeAgentCount: 1,
          taskContractDigest: `sha256:${"a".repeat(64)}`,
          createdAt: 1,
          updatedAt: 1,
        },
      };
    }
    await page.reload();
    await openProjectSettings();
    await page.locator("#weavra-controls").scrollIntoViewIfNeeded();
    await settle();
    observations.push({
      fixture: variant,
      authority: wire.authority,
      observation: structuredClone(wire.observation),
    });
    return wire;
  }
  async function blockedPrepare(assert, variant) {
    const fixture = await runtimeVariant(variant);
    const prepare = await named(page, "button", "prepare", page.locator("#weavra-controls"));
    await prepare.scrollIntoViewIfNeeded();
    assert(`${variant}: DOM disabled`, await prepare.isDisabled(), true);
    const ax = await page.locator("#weavra-controls").ariaSnapshot();
    observations.push({ variant, ax });
    assert(`${variant}: AX disabled`, ax.includes("[disabled]"), true);
    await act(`${variant}: pointer and keyboard activation attempts`, async () => {
      await prepare.dispatchEvent("click");
      await prepare.dispatchEvent("keydown", { key: "Enter", code: "Enter" });
      await prepare.evaluate((button) => button.closest("form").requestSubmit());
    });
    await settle();
    assert(
      `${variant}: no prepare/confirm/planner requests`,
      fixture.requests.filter(
        (r) =>
          r.method === "weavra.control" ||
          r.method.includes("taskPrepare") ||
          r.method.includes("taskConfirm"),
      ).length,
      0,
    );
    await frame(variant);
    observations.push({ requests: fixture.requests });
  }
  async function filesPanel() {
    await openPanel("파일");
    await page.getByRole("button", { name: "Refresh workspace files", exact: true }).waitFor();
  }
  async function openPanel(name) {
    const toggle = await named(page, "button", "panel");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    const tab = page.locator("[data-active-tab]").getByRole("button", { name, exact: true });
    if (await tab.count()) await tab.click();
    else {
      const add = page.getByRole("button", { name: "패널 추가", exact: true });
      if (await add.isVisible()) {
        await add.click();
        const shortcut = { 파일: "F", 브라우저: "B", "Run 그래프": "G", 터미널: "T", 기기: "M" }[
          name
        ];
        await page.getByRole("menuitem", { name: `${name} ${shortcut}`, exact: true }).click();
      } else await page.getByText(name, { exact: true }).filter({ visible: true }).click();
    }
    await settle();
  }
  async function sourceControlVariant(assert, variant) {
    let observed = null;
    responseTransform = (method, value) => {
      if (method !== "server.discoverSourceControl") return value;
      const result = {
        ...value,
        sourceControlProviders: value.sourceControlProviders.map((provider) => ({
          ...provider,
          status: variant === "unavailable" ? "missing" : "available",
          auth: {
            ...provider.auth,
            status:
              variant === "authenticated"
                ? "authenticated"
                : variant === "unauthenticated"
                  ? "unauthenticated"
                  : "unknown",
          },
        })),
      };
      observed = result;
      return result;
    };
    await page.reload();
    await settings("source_control");
    await page.getByText("Bitbucket", { exact: true }).scrollIntoViewIfNeeded();
    assert("discovery fixture reached actual consumer", observed !== null, true);
    observations.push({ authority: "SYNTHETIC_DISCOVERY_RESPONSE", variant, observed });
    const text = await page.locator("main").innerText();
    assert("tool installation axis visible", /도구 설치됨|설치 필요/.test(text), true);
    assert(
      "separate authentication axis visible",
      /로그인됨|로그인 필요|확인 안 됨/.test(text),
      true,
    );
    if (variant === "authenticated")
      assert("authenticated value shown", /로그인됨/.test(text), true);
    if (variant === "unauthenticated")
      assert("missing login not reported as ready", /로그인 필요/.test(text), true);
    if (variant === "unavailable")
      assert("missing tool explicitly identified", /설치 필요/.test(text), true);
    await frame(`source-control-${variant}`);
  }
  async function bothSidebars(assert, audit) {
    for (const legacy of [false, true]) {
      await settings("general");
      const section = page.locator("#legacy-features");
      const disclosure = section.getByRole("button", { name: "Legacy features", exact: true });
      if ((await disclosure.getAttribute("aria-expanded")) !== "true") {
        await act("open Legacy features", () => disclosure.click());
        await section
          .getByRole("button", { name: "Legacy features", expanded: true, exact: true })
          .waitFor();
      }
      // The panel animates open; clicking mid-expansion lands pointerup elsewhere.
      await settle();
      const toggle = section.getByRole("switch", { name: "Sidebar (legacy)", exact: true });
      await toggle.scrollIntoViewIfNeeded();
      await settle();
      const toggleState = async () =>
        switchCheckedState(
          await toggle.evaluate((node) => ({
            ariaChecked: node.getAttribute("aria-checked"),
            dataChecked: node.getAttribute("data-checked"),
            dataUnchecked: node.getAttribute("data-unchecked"),
          })),
        );
      if ((await toggleState()) !== legacy) await act("switch sidebar variant", () => toggle.click());
      await toggle
        .and(
          page.locator(
            legacy ? '[aria-checked="true"], [data-checked]' : '[aria-checked="false"], [data-unchecked]',
          ),
        )
        .waitFor();
      assert("requested sidebar variant selected", await toggleState(), legacy);
      await home();
      await thread("04 Working fixture");
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      await sidebar.waitFor();
      await sidebar
        .locator(SIDEBAR_VARIANT_MARKERS[legacy ? "legacy" : "current"])
        .first()
        .waitFor();
      await audit(sidebar, legacy);
      await frame(legacy ? "legacy-sidebar" : "current-sidebar");
    }
  }
  async function localeAudit(assert, selector, label) {
    const labels = await sample(
      label,
      (selector) =>
        [...document.querySelectorAll(selector)]
          .flatMap((root) => [
            ...root.querySelectorAll("button,label,h1,h2,h3,h4,[role=status],input,textarea"),
          ])
          .filter((node) => node.checkVisibility())
          .map((node) => ({
            tag: node.tagName,
            text: node.textContent?.trim(),
            name: node.getAttribute("aria-label"),
            placeholder: node.getAttribute("placeholder"),
          })),
      selector,
    );
    const proper =
      /^(Weavra|Codex|Claude|Cursor|Grok|OpenCode|Antigravity|SnapShots|GitHub|GitLab|Bitbucket|Git|Mercurial|Jujutsu|baseline-project|0[1-6] (Conversation|Long messages|Code blocks|Working fixture|Error fixture|Empty thread))$/;
    const unclassified = labels.flatMap((row) =>
      [row.text, row.name, row.placeholder]
        .filter((value) => value && /[A-Za-z]{3}/.test(value) && !proper.test(value))
        .map((text) => ({ ...row, text })),
    );
    observations.push({
      label,
      unclassified,
      exceptions: labels.filter((row) => proper.test(row.text ?? "")),
    });
    assert(
      `${label}: every authored label is Korean or a classified proper name`,
      unclassified,
      [],
    );
  }
  function emit(method, value) {
    deliverScenarioEvent(sockets, method, value);
    observations.push({ authority: "SYNTHETIC_SUBSCRIPTION_EVENT", method, value });
  }
  async function providerEvent(status = "error", update = false, progress = false) {
    if (!liveConfig?.providers?.length) throw new Error("No live provider inventory for event");
    const providers = structuredClone(liveConfig.providers);
    const codex = providers.find((provider) => provider.instanceId === "codex");
    if (!codex) throw new Error("Fixture Codex provider missing");
    delete codex.versionAdvisory;
    delete codex.updateState;
    Object.assign(codex, {
      status,
      installed: true,
      auth: { status: status === "ready" ? "authenticated" : "unauthenticated" },
      message: status === "ready" ? "HIG fixture ready" : "HIG fixture requires codex login",
      checkedAt: new Date().toISOString(),
    });
    if (update)
      codex.versionAdvisory = {
        status: "behind_latest",
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        canUpdate: true,
        updateCommand: "printf 'HIG update must not execute'",
        checkedAt: new Date().toISOString(),
        message: "HIG provider update available",
      };
    if (progress)
      codex.updateState = {
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        message: "HIG synthetic update progress; no update process was launched",
        output: null,
      };
    const event = { version: 1, type: "providerStatuses", payload: { providers } };
    providerFixture = providers;
    emit("subscribeServerConfig", event);
    await settle();
    return event;
  }
  async function notificationFixture(focused) {
    await page.evaluate(() => {
      globalThis.higNotifications = [];
      globalThis.Notification = class extends EventTarget {
        static permission = "granted";
        static async requestPermission() {
          return "granted";
        }
        constructor(title, options) {
          super();
          this.tag = options.tag;
          globalThis.higNotifications.push({ title, ...options });
          dispatchEvent(new Event("hig-notification-observed"));
        }
        close() {}
      };
    });
    // Both notification channels default to off, which would make "no popup"
    // pass vacuously. Turn them on through the product's own settings controls.
    await settings("general");
    await act("enable desktop and in-app thread notifications", async () => {
      await click("combobox", "threadNotifications");
      await click("option", "notificationsOnly");
      const inApp = await named(page, "switch", "inAppNotifications");
      // The product switch exposes its state as data-checked, not aria-checked.
      if ((await inApp.getAttribute("data-checked")) === null) await inApp.click();
    });
    await (await named(page, "combobox", "threadNotifications"))
      .filter({ hasText: "Notifications only" })
      .waitFor({ state: "visible" });
    await page
      .locator('[role="switch"][aria-label="In-app notifications"][data-checked]')
      .waitFor({ state: "visible" });
    await home();
    await thread("01 Conversation");
    if (focused) {
      await context.win.evaluate((window) => window.focus());
      await page.waitForFunction(() => document.hasFocus());
    } else {
      // Playwright emulates page focus, so document.hasFocus() never drops and no
      // blur fires. Turn emulation off for this check, then focus a separate
      // window so the renderer really loses OS focus.
      focusEmulation = await page.context().newCDPSession(page);
      await focusEmulation.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await context.application.evaluate(async ({ BrowserWindow }) => {
        // A window focused before it has loaded and shown is ignored by macOS.
        const sink = new BrowserWindow({ width: 320, height: 200, show: false, title: "hig-focus-sink" });
        globalThis.__higFocusSink = sink;
        await sink.loadURL("about:blank");
        const focused = new Promise((resolve) => sink.once("focus", resolve));
        sink.show();
        sink.focus();
        await focused;
      });
      await awaitFocusLoss(
        page.waitForFunction(() => !document.hasFocus(), null, { timeout: 0 }),
        () => page.evaluate(() => document.hasFocus()),
      );
    }
    const snapshot = resolveShellBaseline({
      streamSnapshot: streamSamples.get("orchestration.subscribeShell")?.snapshot,
      httpSnapshot: shellState.http,
      synchronized: shellState.synchronized,
      events: shellState.events,
    });
    observations.push({
      shellBaseline: streamSamples.has("orchestration.subscribeShell") ? "stream-snapshot" : "http-synchronized",
      snapshotSequence: snapshot.snapshotSequence,
    });
    const working = structuredClone(snapshot.threads.find((row) => row.id === "baseline-working"));
    if (!working?.latestTurn) throw new Error("Missing running fixture turn");
    const sequence = snapshot.snapshotSequence + 1000;
    working.latestTurn.state = "completed";
    working.latestTurn.completedAt = new Date().toISOString();
    if (working.session) {
      working.session.status = "idle";
      working.session.activeTurnId = null;
    }
    const event = { kind: "thread-upserted", sequence, thread: working };
    emit("orchestration.subscribeShell", event);
    await settle();
    return event;
  }
  async function snoozeDialog() {
    await home();
    await thread("03 Code blocks");
    await context.application.evaluate(({ Menu }) => {
      Menu.prototype.popup = function () {
        const walk = (items) => items.flatMap((item) => [item, ...walk(item.submenu?.items ?? [])]);
        const matches = walk(this.items).filter((item) => item.label === "직접 지정…");
        if (matches.length !== 1) throw new Error("Custom snooze menu missing or ambiguous");
        matches[0].click();
      };
    });
    await page
      .locator('[data-sidebar="sidebar"]')
      .getByText("03 Code blocks", { exact: true })
      .click({ button: "right" });
    await page.getByRole("dialog", { name: "직접 미루기", exact: true }).waitFor();
    await page.getByRole("tab", { name: "기간", exact: true }).click();
    await settle();
  }
  async function imageDialog() {
    await home();
    const image = await fs.readFile(path.join(output, "1280x800/36_chat_code_blocks.png"));
    await page.locator('[data-chat-composer-form="true"] input[type="file"]').setInputFiles([
      { name: "hig-image.png", mimeType: "image/png", buffer: image },
      { name: "hig-image-2.png", mimeType: "image/png", buffer: image },
    ]);
    const preview = page.getByRole("button", { name: "hig-image.png 미리보기", exact: true });
    await preview.waitFor();
    await preview.click();
    await page.getByRole("dialog", { name: "image 크게 보기", exact: true }).waitFor();
    await page
      .getByRole("region", { name: "hig-image.png, zoomable image", exact: true })
      .waitFor();
    await settle();
  }
  async function motionFrames(assert, mode) {
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await home();
    await page.evaluate(() => {
      globalThis.higAnimationReady = new Promise((resolve) => {
        const observe = () => {
          const animations = document
            .getAnimations()
            .filter((animation) =>
              animation.effect?.target?.matches(
                '[data-slot="dialog-popup"],[data-slot="dialog-backdrop"]',
              ),
            );
          if (!animations.length) {
            globalThis.higAnimationFrame = requestAnimationFrame(observe);
            return;
          }
          globalThis.higAnimations = animations;
          for (const animation of animations) animation.pause();
          resolve();
        };
        globalThis.higAnimationFrame = requestAnimationFrame(observe);
      });
    });
    try {
      const opener = await unique('button[aria-label="작업 추가"]');
      await opener.click();
      await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "attached" });
      await bounded(
        page.evaluate(() => globalThis.higAnimationReady),
        `${mode}: dialog transition creation`,
        15000,
      );
      const animations = await page.evaluate(() => {
        return globalThis.higAnimations.map((a) => ({
          duration: a.effect.getComputedTiming().duration,
          properties: [
            ...new Set(
              a.effect
                .getKeyframes()
                .flatMap((frame) =>
                  Object.keys(frame).filter(
                    (key) => !["offset", "computedOffset", "easing", "composite"].includes(key),
                  ),
                ),
            ),
          ],
        }));
      });
      observations.push({ mode, animations });
      assert(`${mode}: actual transitions captured`, animations.length > 0, true);
      assert(
        `${mode}: animations change only compositor properties`,
        animations.every((a) =>
          a.properties.every((p) =>
            ["opacity", "transform", "translate", "scale", "rotate"].includes(p),
          ),
        ),
        true,
      );
      for (const [name, fraction] of [
        ["start", 0],
        ["mid", 0.5],
        ["end", 1],
      ]) {
        await page.evaluate((fraction) => {
          for (const animation of globalThis.higAnimations)
            animation.currentTime =
              Number(animation.effect.getComputedTiming().duration) * fraction;
        }, fraction);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        await frame(`${mode}-${name}`);
      }
      await page.evaluate(() => {
        for (const animation of globalThis.higAnimations)
          animation.currentTime = Number(animation.effect.getComputedTiming().duration) / 2;
      });
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        cancelAnimationFrame(globalThis.higAnimationFrame);
        for (const animation of document.getAnimations())
          if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      });
      await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "hidden" });
      await frame(`${mode}-interrupted`);
      assert(
        `${mode}: interruption dismisses top owner`,
        await page.locator('[data-slot="dialog-popup"]').isVisible(),
        false,
      );
    } finally {
      await page.evaluate(() => {
        cancelAnimationFrame(globalThis.higAnimationFrame);
        for (const animation of document.getAnimations())
          if (animation.playState === "paused") animation.play();
      });
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
  }
  async function motionConsumers(assert, reduced) {
    await home();
    await motionProperties(
      assert,
      "ComposerPrimaryActions",
      '[data-chat-composer-form="true"] button[type="submit"]',
      reduced,
    );
    await providerEvent("ready", true, true);
    await motionProperties(
      assert,
      "SidebarProviderUpdatePill",
      '[class~="group/provider-update"]',
      reduced,
    );
    await openPanel("브라우저");
    await motionProperties(assert, "PreviewChromeRow", "[data-preview-url-input]", reduced);
    const count = await page.evaluate(() => {
      const indicators = [...document.querySelectorAll("div[aria-hidden]")].filter(
        (node) => /^\d+%$/.test(node.textContent.trim()) && node.classList.contains("top-3"),
      );
      for (const node of indicators) node.setAttribute("data-hig-motion", "zoom-indicator");
      return indicators.length;
    });
    assert("one real ZoomIndicator consumer", count, 1);
    await motionProperties(assert, "ZoomIndicator", '[data-hig-motion="zoom-indicator"]', reduced);
    await frame(reduced ? "reduced-consumers" : "normal-consumers");
  }
  async function toolErrorContrast(assert, mode) {
    const { Database } = await import("bun:sqlite");
    const database = new Database(path.join(context.isolation.app, "userdata/state.sqlite"), {
      readonly: true,
      create: false,
    });
    try {
      assert(
        "failed tool belongs to the seeded error turn",
        database
          .query("SELECT thread_id,turn_id FROM projection_thread_activities WHERE activity_id = ?")
          .get("hig-tool-error"),
        { thread_id: "baseline-error", turn_id: "turn-error" },
      );
      await home();
      await thread("05 Error fixture");
      const icons = page.locator('[class*="text-tool-error-icon"]').filter({ visible: true });
      if ((await icons.count()) === 0) {
        const disclosure = page.getByRole("button", { name: /^Worked for / });
        assert("one work disclosure belongs to the error fixture", await disclosure.count(), 1);
        await disclosure.click();
      }
      await icons.first().waitFor({ state: "visible" });
      await icons.first().scrollIntoViewIfNeeded();
      const samples = await sample(`tool-error-${mode}`, () => {
        const context = document.createElement("canvas").getContext("2d");
        return [...document.querySelectorAll('[class*="text-tool-error-icon"]')]
          .filter((node) => node.checkVisibility())
          .map((node) => {
            const style = getComputedStyle(node);
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = style.color;
            context.fillRect(0, 0, 1, 1);
            return {
              selector: node.className,
              color: style.color,
              rgba: [...context.getImageData(0, 0, 1, 1).data],
              rect: node.getBoundingClientRect().toJSON(),
            };
          });
      });
      await frame(`tool-error-${mode}`);
      assert("failed tool consumer rendered", samples.length > 0, true);
      for (const sample of samples) {
        const background = await context.win.evaluate(async (window, rect) => {
          const pixel = (
            await window.webContents.capturePage({
              x: Math.max(0, Math.floor(rect.left - 2)),
              y: Math.floor(rect.top + rect.height / 2),
              width: 1,
              height: 1,
            })
          ).toBitmap();
          return [pixel[2], pixel[1], pixel[0]];
        }, sample.rect);
        const alpha = sample.rgba[3] / 255;
        const foreground = background.map(
          (channel, index) => sample.rgba[index] * alpha + channel * (1 - alpha),
        );
        const luminance = (rgb) =>
          rgb
            .map((value) => {
              const n = value / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        const ratio = (light + 0.05) / (dark + 0.05);
        observations.push({
          role: "tool-error-icon",
          authority: "SYNTHETIC_PROJECTION_ONLY; REAL PACKAGED RENDERER",
          source: "app/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
          mode,
          ...sample,
          background,
          foreground,
          ratio,
        });
        assert(`${mode}: tool-error icon contrast ${ratio}`, ratio >= 3, true);
      }
    } finally {
      database.close();
    }
  }
  const executors = {
    "01/provenance": async (assert) => {
      assert("source commit", packet.provenance.revision, packet.revision);
      assert(
        "packaged revision",
        packet.provenance.appRevision.startsWith(packet.provenance.packagedRevision),
        true,
      );
      assert("clean source", packet.provenance.trackedDiff, "");
      observations.push({ provenance: packet.provenance });
    },
    "01/isolation": async (assert) => {
      for (const run of packet.runs) {
        for (const name of ["home", "workspace", "app"])
          assert(
            `isolated ${name}`,
            await fs.realpath(run.isolation[name]),
            path.join(run.isolation.base, name),
          );
        assert(
          "owned profile",
          run.isolation.userData.startsWith(run.isolation.home + path.sep),
          true,
        );
      }
      observations.push({ isolation: packet.runs.map((run) => run.isolation) });
    },
    "01/state-identity": async (assert) => {
      const { validateRecord } = await import("./assert.mjs");
      for (const record of packet.manifest) {
        validateRecord(record, await fs.readFile(path.join(output, record.file)));
        assert(
          `state ${record.file}`,
          [...DESKTOP_STATES, ...STRESS_STATES].some((state) => state.id === record.stateId),
          true,
        );
      }
      observations.push({
        records: packet.manifest.map(({ file, stateId, sha256 }) => ({ file, stateId, sha256 })),
      });
    },
    "01/visible-body": async (assert) => {
      const { validateVisibleState } = await import("./assert.mjs");
      for (const record of packet.manifest) {
        validateVisibleState(record.stateId, record.visibleState, record.stateContract);
        assert(
          `${record.file}: nonempty visible content`,
          record.visibleState.text.length > 0,
          true,
        );
      }
      observations.push({
        visibility: packet.manifest.map(({ file, visibleState }) => ({ file, visibleState })),
      });
    },
    "01/native-minimum": async (assert) => {
      assert("configured native minimum", packet.nativeMinimum.minimum, [840, 620]);
      assert("native minimum enforced", packet.nativeMinimum.enforced, true);
      observations.push({ nativeMinimum: packet.nativeMinimum });
    },
    "01/no-model": async (assert) => {
      assert("no model", packet.counters.model, 0);
      assert("no runtime mutation", packet.counters.runtimeMutation, 0);
      assert("no outbound attempts", packet.counters.blockedOutbound, 0);
      observations.push({
        counters: { ...packet.counters },
        outboundFrames: [...packet.outboundFrames],
      });
    },
    "01/complete-pairs": async (assert) => {
      assert(
        "all expected captures",
        expectedCaptureFiles().every((file) => packet.manifest.some((row) => row.file === file)),
        true,
      );
      assert(
        "no duplicate captures",
        new Set(packet.manifest.map((row) => row.file)).size,
        packet.manifest.length,
      );
      observations.push({ files: packet.manifest.map((row) => row.file) });
    },
    "02/frozen-network-notices": async (assert) => {
      await home();
      await openPanel("브라우저");
      await settle();
      assert(
        "live update checks are disabled",
        liveConfig.settings.enableProviderUpdateChecks,
        false,
      );
      assert(
        "live provider notices are absent",
        liveConfig.providers.every(
          (provider) => !provider.versionAdvisory && !provider.updateState,
        ),
        true,
      );
      assert(
        "no unsolicited live update toast",
        await page.locator('[data-slot="toast-close"]').count(),
        0,
      );
      await iconTargets(assert, "frozen-browser-toolbar");
      await frame("frozen-browser-toolbar");
    },
    "02/icon-targets": async (assert) => {
      const required = [
        "메시지 보내기",
        "생성 중지",
        "파일 첨부",
        "Close",
        "Back",
        "Forward",
        "Refresh",
      ];
      const measured = [];
      for (const row of packet.manifest) {
        for (const control of row.controls.filter(
          (c) => c.visible && (c.iconControl || required.includes(c.name)),
        )) {
          assert(
            `${row.file}: ${control.name} >=36x36 (disabled=${control.disabled})`,
            iconTargetMeetsMinimum(control),
            true,
          );
          assertIconTargetHits(assert, `${row.file}: ${control.name}`, control);
          measured.push({ file: row.file, ...control });
        }
      }
      for (const name of required)
        assert(
          `required icon target measured: ${name}`,
          measured.some((c) => c.name === name),
          true,
        );
      assert(
        "disabled icon targets measured",
        measured.some((c) => c.disabled),
        true,
      );
      observations.push({ iconTargets: measured });
      await home();
      await iconTargets(assert, "empty composer");
      await frame("icon-targets");
    },
    "02/portal-owner": async (assert) => {
      for (const mode of ["light", "dark"]) {
        await home();
        await theme(mode);
        await act("open import command palette", () =>
          click("button", "import", page.locator('[data-sidebar="sidebar"]')),
        );
        await settle();
        const command = await owner(
          assert,
          `command-${mode}`,
          '[data-slot="command-dialog-popup"]',
        );
        assert("command owns keyboard focus", command.focusInside, true);
        const outside = await sample("modal backdrop hit", () => {
          const hit = document.elementFromPoint(12, 400);
          return Boolean(
            hit?.closest(
              '[data-slot="command-dialog-viewport"],[data-slot="command-dialog-backdrop"],[data-slot="dialog-backdrop"]',
            ),
          );
        });
        assert("background controls cannot overtake modal", outside, true);
        await page.keyboard.press("Escape");
        await openAction();
        await owner(assert, `dialog-${mode}`, '[data-slot="dialog-popup"]');
        await act("open dialog icon popover", async () =>
          (await unique('[data-slot="dialog-popup"] [data-slot="popover-trigger"]')).click(),
        );
        await settle();
        await owner(assert, `modal-child-${mode}`, '[data-slot="popover-popup"]');
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await home();
        await act("open model selector", () => click("button", "model"));
        await settle();
        await owner(assert, `model-${mode}`, '[data-slot="popover-popup"]');
        await page.keyboard.press("Escape");
        await snoozeDialog();
        await act("open real select inside snooze dialog", () =>
          page.getByRole("combobox", { name: "단위", exact: true }).click(),
        );
        await settle();
        await owner(assert, `select-in-dialog-${mode}`, '[data-slot="select-popup"]');
        await page.keyboard.press("Escape");
        assert(
          "Escape select leaves containing dialog",
          await page.getByRole("dialog", { name: "직접 미루기", exact: true }).isVisible(),
          true,
        );
        await page.keyboard.press("Escape");
        await imageDialog();
        await owner(assert, `image-modal-${mode}`, '[data-slot="dialog-popup"]');
        await page.keyboard.press("Escape");
        await settings("appearance");
        await page.getByRole("button", { name: "Create theme", exact: true }).click();
        await settle();
        await owner(assert, `theme-editor-${mode}`, '[data-theme-editor-panel][role="dialog"]');
        await page.getByRole("button", { name: "Inspect app colors", exact: true }).click();
        assert(
          "theme inspector is armed",
          await page
            .getByRole("button", { name: "Cancel inspecting app colors", exact: true })
            .isVisible(),
          true,
        );
        await frame(`theme-inspector-${mode}`);
        await page.getByRole("button", { name: "Close the theme editor", exact: true }).click();
        await home();
        await thread("01 Conversation");
        const paragraph = page.locator("[data-assistant-citation-source] p").first();
        await paragraph.scrollIntoViewIfNeeded();
        const box = await paragraph.boundingBox();
        assert("assistant selection paragraph has geometry", box !== null, true);
        await page.mouse.move(box.x + 3, box.y + 8);
        await page.mouse.down();
        await page.mouse.move(box.x + Math.min(box.width - 3, 280), box.y + 8, { steps: 8 });
        await page.mouse.up();
        await page
          .getByRole("button", { name: "선택한 내용을 작성기에 인용", exact: true })
          .waitFor();
        await owner(
          assert,
          `selection-toolbar-${mode}`,
          'button[aria-label="선택한 내용을 작성기에 인용"]',
        );
        await page.keyboard.press("Tab");
        await page.keyboard.press("Escape");
        await page
          .getByRole("button", { name: "선택한 내용을 작성기에 인용", exact: true })
          .waitFor({ state: "hidden" });
        await page.evaluate(() => {
          globalThis.higFocusOwner = document.activeElement;
        });
        await (await named(page, "button", "panel")).hover();
        await page.locator('[data-slot="tooltip-popup"]').waitFor();
        const tooltip = await sample(`tooltip-${mode}`, () => {
          const node = document.querySelector('[data-slot="tooltip-positioner"]');
          return {
            pointerEvents: getComputedStyle(node).pointerEvents,
            zIndex: Number(getComputedStyle(node).zIndex),
            rect: node.getBoundingClientRect().toJSON(),
            focusUnchanged: document.activeElement === globalThis.higFocusOwner,
          };
        });
        assert("tooltip remains a passive surface", tooltip.pointerEvents, "none");
        assert("tooltip does not steal keyboard focus", tooltip.focusUnchanged, true);
        await frame(`tooltip-${mode}`);
        await page.mouse.move(640, 400);
        await context.win.evaluate((window) =>
          window.webContents.send("desktop:quit-shortcut", { state: "down", mode: "double-click" }),
        );
        await page.getByRole("status").filter({ hasText: "again to quit" }).waitFor();
        const quit = await sample(`quit-overlay-${mode}`, () => {
          const node = [...document.querySelectorAll('[role="status"]')].find((e) =>
            e.textContent.includes("again to quit"),
          );
          const style = getComputedStyle(node);
          return {
            layer: Number(style.zIndex),
            pointerEvents: style.pointerEvents,
            rect: node.getBoundingClientRect().toJSON(),
          };
        });
        assert("quit hint owns blocking-system layer", quit.layer, 80);
        assert("quit hint is not a pointer trap", quit.pointerEvents, "none");
        await frame(`quit-overlay-${mode}`);
        await context.win.evaluate((window) =>
          window.webContents.send("desktop:quit-shortcut", { state: "up" }),
        );
      }
    },
    "02/escape-focus-return": async (assert) => {
      await openAction();
      const opener = await unique('[data-slot="dialog-popup"] [data-slot="popover-trigger"]');
      await act("open modal child from keyboard", async () => {
        await opener.focus();
        await page.keyboard.press("Enter");
      });
      await unique('[data-slot="popover-popup"]');
      await act("Escape top child only", () => page.keyboard.press("Escape"));
      await page.locator('[data-slot="popover-popup"]').waitFor({ state: "hidden" });
      assert(
        "parent dialog remains visible",
        await page.locator('[data-slot="dialog-popup"]').isVisible(),
        true,
      );
      assert(
        "focus returns to child opener",
        await opener.evaluate((e) => e === document.activeElement),
        true,
      );
      await frame("child-escape");
      await act("Escape parent", () => page.keyboard.press("Escape"));
      await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement === document.querySelector('button[aria-label="작업 추가"]'),
      );
      assert(
        "focus returns to action opener",
        await page
          .locator('button[aria-label="작업 추가"]')
          .evaluate((e) => e === document.activeElement),
        true,
      );
    },
    "02/compositor-motion": async (assert) => {
      await settings("appearance");
      await act("enable real panel animation setting", async () =>
        (await unique("#panel-animation-duration")).fill("200"),
      );
      await page.locator('[data-panel-animations="true"]').waitFor({ state: "attached" });
      await home();
      await motionProperties(assert, "sidebar-gap-motion", '[data-slot="sidebar-gap"]');
      await motionProperties(assert, "sidebar-container-motion", '[data-slot="sidebar-container"]');
      await motionConsumers(assert, false);
      await openAction();
      await motionProperties(assert, "dialog-motion", '[data-slot="dialog-popup"]');
      await motionProperties(assert, "dialog-backdrop-motion", '[data-slot="dialog-backdrop"]');
      await page.keyboard.press("Escape");
      await motionFrames(assert, "normal");
    },
    "02/reduced-motion": async (assert) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      try {
        await openAction();
        await motionProperties(assert, "dialog-reduced", '[data-slot="dialog-popup"]', true);
        await motionProperties(assert, "backdrop-reduced", '[data-slot="dialog-backdrop"]', true);
        await page.keyboard.press("Escape");
        await home();
        await motionProperties(assert, "sidebar-reduced", '[data-slot="sidebar-container"]', true);
        await motionConsumers(assert, true);
      } finally {
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      await motionFrames(assert, "reduced");
    },
    "02/semantic-colors": async (assert) => {
      for (const mode of ["light", "dark"]) {
        await home();
        await theme(mode);
        const tokens = await sample(`tokens-${mode}`, () => {
          const style = getComputedStyle(document.documentElement);
          return Object.fromEntries(
            [
              "--layer-content",
              "--layer-sticky",
              "--layer-passive-notice",
              "--layer-modal-backdrop",
              "--layer-modal",
              "--layer-modal-child",
              "--layer-tooltip",
              "--layer-blocking-system",
              "--overlay-shade",
              "--shadow-popup",
              "--shadow-modal",
              "--annotation-background",
              "--annotation-foreground",
              "--terminal-background",
              "--terminal-foreground",
              "--app-scrollbar-thumb",
              "--tool-error-icon",
            ].map((key) => [key, style.getPropertyValue(key).trim()]),
          );
        });
        for (const [key, value] of Object.entries(tokens))
          assert(`${mode}: ${key} resolves`, value.length > 0, true);
        assert(
          "passive notification below modal backdrop",
          Number(tokens["--layer-passive-notice"]) < Number(tokens["--layer-modal-backdrop"]),
          true,
        );
        assert(
          "modal above backdrop",
          Number(tokens["--layer-modal"]) > Number(tokens["--layer-modal-backdrop"]),
          true,
        );
        assert(
          "modal child above modal",
          Number(tokens["--layer-modal-child"]) > Number(tokens["--layer-modal"]),
          true,
        );
        await frame(`tokens-${mode}`);
      }
    },
    "02/contrast": async (assert) => {
      for (const mode of ["light", "dark"]) {
        await home();
        await theme(mode);
        await toolErrorContrast(assert, mode);
        await openAction();
        await contrast(assert, '[data-slot="dialog-title"]', `dialog-title-${mode}`);
        await page.keyboard.press("Escape");
        await home();
        await act("show tooltip", async () => (await named(page, "button", "panel")).hover());
        await contrast(assert, '[data-slot="tooltip-popup"]', `tooltip-${mode}`);
        await page.mouse.move(640, 400);
      }
    },
    "03/unsupported": async (assert) => blockedPrepare(assert, "unsupported"),
    "03/disconnected": async (assert) => blockedPrepare(assert, "disconnected"),
    "03/stale": async (assert) => blockedPrepare(assert, "stale"),
    "03/missing-scope": async (assert) => blockedPrepare(assert, "missing-scope"),
    "03/fresh": async (assert) => {
      const fixture = await runtimeVariant("fresh");
      await page
        .getByRole("textbox", { name: "워크플로 목표", exact: true })
        .fill("Inspect the isolated fixture only");
      const prepare = await named(page, "button", "prepare", page.locator("#weavra-controls"));
      assert("fresh preparation is available", await prepare.isEnabled(), true);
      await act("explicitly prepare synthetic draft", () => prepare.click());
      await page.getByLabel("Runtime 계획 미리보기", { exact: true }).waitFor();
      assert(
        "one explicit prepare request",
        fixture.requests.filter((r) => r.command === "workflow.prepare").length,
        1,
      );
      assert(
        "no confirmation or execution",
        fixture.requests.filter((r) => r.command && r.command !== "workflow.prepare").length,
        0,
      );
      observations.push({ requests: fixture.requests });
    },
    "03/foreign-owner": async (assert) => {
      await runtimeVariant("foreign-owner");
      await page
        .getByRole("textbox", { name: "워크플로 목표", exact: true })
        .fill("Inspect orphan ownership");
      assert(
        "foreign owner still permits Runtime recovery judgment",
        await (
          await named(page, "button", "prepare", page.locator("#weavra-controls"))
        ).isEnabled(),
        true,
      );
      await observedText(assert, "#weavra-controls", "foreign-owner-explanation", (text) =>
        /소유|INTERRUPTED/.test(text),
      );
    },
    "03/no-reconnect-replay": async (assert) => {
      await blockedPrepare(assert, "disconnected");
      const fixture = wire;
      fixture.observation.status = "CONNECTED";
      fixture.observation.stale = false;
      for (const observer of fixture.observers)
        observer.socket.send(
          JSON.stringify({ _tag: "Chunk", requestId: observer.id, values: [fixture.observation] }),
        );
      await page
        .getByRole("textbox", { name: "워크플로 목표", exact: true })
        .waitFor({ state: "visible" });
      await settle();
      assert(
        "no queued intent replay after reconnect",
        fixture.requests.filter((r) => r.method === "weavra.control").length,
        0,
      );
      observations.push({ requests: fixture.requests });
    },
    "03/request-counters": async (assert) => {
      for (const variant of ["unsupported", "disconnected", "stale", "missing-scope"])
        await blockedPrepare(assert, variant);
      assert("no model request across unavailable variants", packet.counters.model, 0);
    },
    "03/confirmation-binding": async (assert) => {
      const fixture = await runtimeVariant("fresh");
      await page
        .getByRole("textbox", { name: "워크플로 목표", exact: true })
        .fill("Inspect fixture with bound confirmation");
      await (await named(page, "button", "prepare", page.locator("#weavra-controls"))).click();
      const confirm = page.getByRole("button", { name: "확인 후 시작", exact: true });
      await confirm.waitFor();
      await confirm.scrollIntoViewIfNeeded();
      await act("open confirmation against fresh preview", () => confirm.click());
      await page.getByRole("alertdialog").waitFor();
      fixture.observation.stale = true;
      fixture.observation.state.projectRevision = 1;
      for (const observer of fixture.observers)
        observer.socket.send(
          JSON.stringify({ _tag: "Chunk", requestId: observer.id, values: [fixture.observation] }),
        );
      await settle();
      await act("accept now-stale confirmation", () =>
        click("button", "Confirm", page.getByRole("alertdialog")),
      );
      await settle();
      assert(
        "stale binding prevents confirm request",
        fixture.requests.filter((r) => r.command === "workflow.confirm").length,
        0,
      );
      assert(
        "only explicitly requested prepare occurred",
        fixture.requests.filter((r) => r.command).length,
        1,
      );
      observations.push({ requests: fixture.requests });
    },
    "03/diagnostic-copy": async (assert) => {
      await openProjectSettings();
      const disclose = page
        .locator("#weavra-controls")
        .getByRole("button", { name: /진단|연결 정보|자세히/ });
      assert("labelled diagnostic disclosure", await disclose.count(), 1);
      await unchangedRequests(assert, () => disclose.click());
      await observedText(
        assert,
        "#weavra-controls",
        "diagnostic-identities",
        (text) => text.includes(context.isolation.workspace) && /프로젝트|환경/.test(text),
      );
      const copy = page.locator("#weavra-controls").getByRole("button", { name: /복사/ });
      assert("diagnostic copy action", (await copy.count()) > 0, true);
      // Subscribe to the renderer's own clipboard write before clicking; the product writes asynchronously.
      await page.evaluate(() => {
        const clipboard = navigator.clipboard;
        const write = clipboard.writeText.bind(clipboard);
        globalThis.__higClipboardWrite = new Promise((resolve, reject) => {
          clipboard.writeText = async (value) => {
            clipboard.writeText = write;
            try {
              await write(value);
              resolve();
            } catch (error) {
              reject(error);
              throw error;
            }
          };
        });
      });
      const written = page.evaluate(() => globalThis.__higClipboardWrite);
      await copy.first().click();
      const copied = await readCompletedCopy(written, () =>
        context.application.evaluate(({ clipboard }) => clipboard.readText()),
      );
      const fixturePath = await fs.realpath(
        path.join(context.isolation.workspace, "baseline-project"),
      );
      assert("copy preserves exact fixture path", copied.values.includes(fixturePath), true);
      observations.push({ copiedFixturePath: copied.text });
    },
    "03/unknown-disclosure": async (assert) => {
      await openProjectSettings();
      const disclosure = page.locator("#weavra-controls").locator("button[aria-expanded]");
      assert(
        "unknown details are collapsed",
        (await disclosure.filter({ visible: true }).count()) > 0,
        true,
      );
      const control = disclosure.filter({ visible: true }).first();
      assert(
        "unknown detail is initially collapsed",
        await control.getAttribute("aria-expanded"),
        "false",
      );
      await unchangedRequests(assert, () => control.click());
      await observedText(
        assert,
        "#weavra-controls",
        "unknown-detail-preserved",
        (text) => /확인 안|UNKNOWN|알 수 없/.test(text) && !/UNKNOWN\s*[:=]\s*0/.test(text),
      );
    },
    "04/auth-error": async (assert) => {
      await home();
      await thread("01 Conversation");
      await providerEvent("error");
      await page
        .getByText("HIG fixture requires codex login", { exact: true })
        .filter({ visible: true })
        .waitFor();
      const geometry = await sample("provider error ownership", () => {
        const alert = [...document.querySelectorAll('[role="alert"]')].find((node) =>
          node.textContent.includes("HIG fixture requires codex login"),
        );
        const parentPositions = [];
        for (let node = alert; node && !node.matches("main"); node = node.parentElement)
          parentPositions.push(getComputedStyle(node).position);
        return { parentPositions, text: alert.textContent };
      });
      assert(
        "provider feedback is in conversation flow",
        geometry.parentPositions.some((p) => p === "absolute" || p === "fixed"),
        false,
      );
      assert("auth cause has independent recovery", /login|설정|로그인/.test(geometry.text), true);
    },
    "04/turn-error": async (assert) => {
      await home();
      await thread("05 Error fixture");
      await providerEvent("ready");
      const geometry = await sample("turn error ownership", () => {
        const error = [...document.querySelectorAll('[role="alert"]')].find((node) =>
          node.textContent.includes("Capture fixture: provider unavailable"),
        );
        if (!error) return null;
        const rect = error.getBoundingClientRect();
        const composer = document
          .querySelector('[data-chat-composer-form="true"]')
          .getBoundingClientRect();
        return {
          rect: rect.toJSON(),
          composer: composer.toJSON(),
          intersection:
            Math.max(0, Math.min(rect.right, composer.right) - Math.max(rect.left, composer.left)) *
            Math.max(0, Math.min(rect.bottom, composer.bottom) - Math.max(rect.top, composer.top)),
        };
      });
      assert("turn failure remains after auth recovery", geometry !== null, true);
      assert("turn failure does not cover composer", geometry.intersection <= 0.5, true);
    },
    "04/independent-causes": async (assert) => {
      await home();
      await thread("05 Error fixture");
      await providerEvent("error");
      assert(
        "auth cause represented once",
        await page
          .getByText("HIG fixture requires codex login", { exact: true })
          .filter({ visible: true })
          .count(),
        1,
      );
      assert(
        "turn cause independently retained",
        (await page.locator("main").innerText()).includes("Capture fixture: provider unavailable"),
        true,
      );
      await frame("independent-causes");
    },
    "04/event-deduplication": async (assert) => {
      await home();
      await thread("01 Conversation");
      const event = await providerEvent("error");
      emit("subscribeServerConfig", event);
      emit("subscribeServerConfig", event);
      await settle();
      assert(
        "same provider event renders one cause",
        await page
          .getByText("HIG fixture requires codex login", { exact: true })
          .filter({ visible: true })
          .count(),
        1,
      );
      assert(
        "repeated event does not authenticate",
        requests.some((r) => /auth.*start|login/i.test(r.method)),
        false,
      );
    },
    "04/focused-completion": async (assert) => {
      await notificationFixture(true);
      assert(
        "focused app emits no OS notice",
        await page.evaluate(() => globalThis.higNotifications.length),
        0,
      );
      const notices = await sample(
        "focused notices",
        (selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent),
        TOAST_SELECTOR,
      );
      assert(
        "focused background completion stays out of popup",
        notices.some((text) => /Thread completed|완료/.test(text)),
        false,
      );
    },
    "04/unfocused-single-notice": async (assert) => {
      try {
        const event = await notificationFixture(false);
        await page.waitForFunction(() => globalThis.higNotifications.length > 0);
        emit("orchestration.subscribeShell", event);
        await settle();
        const notices = await page.evaluate(() => globalThis.higNotifications);
        observations.push({ notificationBoundary: notices });
        assert("one notice per unfocused completion event", notices.length, 1);
        assert(
          "notice belongs to correct thread",
          notices[0].tag.endsWith(":baseline-working"),
          true,
        );
      } finally {
        await context.application.evaluate(() => {
          globalThis.__higFocusSink?.destroy();
          globalThis.__higFocusSink = null;
        });
        if (focusEmulation) {
          await focusEmulation.send("Emulation.setFocusEmulationEnabled", { enabled: true });
          await focusEmulation.detach();
          focusEmulation = null;
        }
        await context.win.evaluate((window) => window.focus());
      }
    },
    "04/modal-update-suppression": async (assert) => {
      await openAction();
      const before = await page
        .locator('[data-slot="dialog-popup"]')
        .evaluate((node) => node.contains(document.activeElement));
      await providerEvent("ready", true);
      assert(
        "update never steals modal focus",
        await page
          .locator('[data-slot="dialog-popup"]')
          .evaluate((node) => node.contains(document.activeElement)),
        before,
      );
      const notices = await page.locator(TOAST_SELECTOR).allTextContents();
      assert(
        "routine provider update has no popup",
        notices.some((text) => /update|업데이트/i.test(text)),
        false,
      );
      await frame("update-during-modal");
    },
    "04/no-replay": async (assert) => {
      await openAction();
      await providerEvent("ready", true);
      await page.keyboard.press("Escape");
      await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "hidden" });
      await settle();
      const notices = await page.locator(TOAST_SELECTOR).allTextContents();
      assert(
        "closing modal does not replay suppressed update",
        notices.some((text) => /update|업데이트/i.test(text)),
        false,
      );
      await settings("providers");
      assert(
        "update remains discoverable in provider context",
        /2\.0\.0|업데이트|update/i.test(await page.locator("main").innerText()),
        true,
      );
      assert(
        "no unsolicited update request",
        requests.some((r) => /updateProvider|provider\.update/.test(r.method)),
        false,
      );
    },
    "08/persistent-label": async (assert) => {
      await home();
      await labelledField(assert, '[data-testid="composer-editor"]', "지속되는 입력 목적");
    },
    "08/composer-focus": async (assert) => {
      await home();
      const selector = '[data-testid="composer-editor"]';
      await labelledField(assert, selector, "IME 보존");
      const labelId = await page.locator(selector).getAttribute("aria-labelledby");
      assert("composer has associated label", Boolean(labelId), true);
      await act("activate composer label", () =>
        page.locator(`[id=${JSON.stringify(labelId)}]`).click(),
      );
      assert(
        "label focuses editor",
        await page
          .locator(selector)
          .evaluate((e) => e === document.activeElement || e.contains(document.activeElement)),
        true,
      );
      const before = packet.counters.model;
      await act("composition Enter is not submit", async () => {
        await page.locator(selector).dispatchEvent("compositionstart", { data: "한" });
        await page
          .locator(selector)
          .dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
        await page.locator(selector).dispatchEvent("compositionend", { data: "한" });
      });
      await settle();
      assert("IME dispatch count unchanged", packet.counters.model, before);
    },
    "08/model-id-label": async (assert) => {
      await modelForm();
      await labelledField(assert, 'input[id$="-custom-model"]', "hig-long-model-id-".repeat(12));
    },
    "08/address-label": async (assert) => {
      await home();
      await openPanel("브라우저");
      await labelledField(
        assert,
        'input[placeholder="Search or enter URL"]',
        "https://example.invalid/" + "long/".repeat(30),
      );
    },
    "08/path-label": async (assert) => {
      await home();
      await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
      await page.getByText("로컬 폴더", { exact: true }).filter({ visible: true }).click();
      await labelledField(
        assert,
        '[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]',
        context.isolation.workspace + "/",
      );
    },
    "08/attachment-drop": async (assert) => {
      await home();
      const editor = await unique('[data-testid="composer-editor"]');
      const data = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["HIG isolated attachment"], "hig-attachment.txt", { type: "text/plain" }),
        );
        return transfer;
      });
      try {
        await unchangedRequests(assert, () => editor.dispatchEvent("drop", { dataTransfer: data }));
        assert(
          "dropped file appears in draft",
          (await page.getByText("hig-attachment.txt", { exact: true }).count()) > 0,
          true,
        );
      } finally {
        await data.dispose();
      }
    },
    "08/keyboard-attachment": async (assert) => {
      await home();
      const attach = page.getByRole("button", { name: "파일 첨부", exact: true });
      await attach.focus();
      const chooser = page.waitForEvent("filechooser");
      await act("keyboard opens attachment chooser", () => page.keyboard.press("Enter"));
      await (
        await chooser
      ).setFiles({
        name: "hig-keyboard.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("HIG keyboard attachment"),
      });
      assert(
        "keyboard file appears in draft",
        (await page.getByText("hig-keyboard.txt", { exact: true }).count()) > 0,
        true,
      );
      assert("attachment does not send", packet.counters.model, 0);
    },
    "09/locked-destination-reason": async (assert) => {
      await home();
      await click("button", "panel");
      const disabled = page.locator('[role="menuitem"][aria-disabled="true"]');
      assert("unavailable destinations retained", (await disabled.count()) > 0, true);
      for (const item of await disabled.all()) {
        const reason = await item.getAttribute("aria-describedby");
        assert("disabled destination has associated reason", Boolean(reason), true);
        assert(
          "reason is present and readable",
          (await page.locator(`[id=${JSON.stringify(reason)}]`).innerText()).trim().length > 0,
          true,
        );
      }
    },
    "09/files-loading": async (assert) => {
      let resolve;
      const pending = new Promise((done) => {
        resolve = done;
      });
      replies.set("projects.listEntries", () => pending);
      try {
        await filesPanel();
        await observedText(
          assert,
          '[aria-label="baseline-project files"]',
          "files-loading",
          (text) => /불러오는|로딩|Loading/.test(text),
        );
      } finally {
        resolve({ _tag: "Success", value: { entries: [], truncated: false } });
      }
    },
    "09/files-empty": async (assert) => {
      replies.set("projects.listEntries", () => ({
        _tag: "Success",
        value: { entries: [], truncated: false },
      }));
      await filesPanel();
      await settle();
      await observedText(assert, '[aria-label="baseline-project files"]', "files-empty", (text) =>
        /비어|파일이 없|No files/.test(text),
      );
    },
    "09/files-no-results": async (assert) => {
      replies.set("projects.listEntries", () => ({
        _tag: "Success",
        value: { entries: [{ path: "visible.txt", kind: "file" }], truncated: false },
      }));
      replies.set("projects.searchEntries", () => ({
        _tag: "Success",
        value: { entries: [], truncated: false },
      }));
      await filesPanel();
      const input = page.getByPlaceholder("Search files", { exact: true });
      await input.fill("absent-query");
      await observedText(
        assert,
        '[aria-label="baseline-project files"]',
        "files-no-results",
        (text) => /검색 결과|일치|No results|No matches/.test(text),
      );
      await input.fill("");
      await page.getByText("visible.txt", { exact: true }).waitFor();
      assert(
        "clearing search restores actual entries",
        await page.getByText("visible.txt", { exact: true }).isVisible(),
        true,
      );
    },
    "09/files-error": async (assert) => {
      replies.set("projects.listEntries", () => ({
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: {
              _tag: "ProjectListEntriesError",
              message: "HIG directory access denied",
              failure: "directory_list_failed",
            },
          },
        ],
      }));
      await filesPanel();
      await observedText(
        assert,
        '[aria-label="baseline-project files"]',
        "files-error",
        (text) =>
          /HIG directory access denied|불러오지 못|읽을 수 없/.test(text) &&
          !/폴더가 비어|No files/.test(text),
      );
    },
    "09/refresh": async (assert) => {
      let calls = 0;
      replies.set("projects.listEntries", () => {
        calls++;
        return {
          _tag: "Success",
          value: {
            entries: calls > 1 ? [{ path: "refreshed.txt", kind: "file" }] : [],
            truncated: false,
          },
        };
      });
      await filesPanel();
      await settle();
      const before = calls;
      await act("refresh actual Files request", () =>
        page.getByRole("button", { name: "Refresh workspace files", exact: true }).click(),
      );
      await page.getByText("refreshed.txt", { exact: true }).waitFor();
      assert("refresh reached data boundary", calls > before, true);
    },
    "09/pane-isolation": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const before = await page.locator("pre").allTextContents();
      await filesPanel();
      await page.getByPlaceholder("Search files", { exact: true }).fill("not-in-chat");
      assert(
        "Files query does not filter conversation",
        await page.locator("pre").allTextContents(),
        before,
      );
      assert(
        "selected thread unchanged",
        (await page.evaluate(() => location.hash)).includes("baseline-code"),
        true,
      );
    },
    "05/read-only-default": async (assert) => {
      await home();
      const mode = await named(page, "combobox", "mode");
      assert(
        "fresh unset draft requires approval",
        (await mode.innerText()).includes("승인 필요"),
        true,
      );
      await frame("fresh-mode");
    },
    "05/saved-mode-preserved": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const mode = await named(page, "combobox", "mode");
      const before = await mode.innerText();
      await page.reload();
      await (await named(page, "combobox", "mode")).waitFor();
      assert(
        "saved fixture mode survives restart",
        await (await named(page, "combobox", "mode")).innerText(),
        before,
      );
      assert("seeded approval-required stays selected", before.includes("승인 필요"), true);
    },
    "05/three-suggestions": async (assert) => {
      for (const selectedThread of [null, "06 Empty thread"]) {
        await home();
        if (selectedThread) await thread(selectedThread);
        const suggestions = await sample("empty suggestions", () => {
          const editor = document.querySelector('[data-testid="composer-editor"]');
          const main = editor.closest("main") ?? document.querySelector("main");
          return [...main.querySelectorAll("button")]
            .filter(
              (button) =>
                button.hasAttribute("data-suggestion") || button.getAttribute("aria-describedby"),
            )
            .map((button) => ({
              name: button.textContent,
              description: (button.getAttribute("aria-describedby") ?? "")
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" "),
            }));
        });
        assert(
          "one to three distinct suggested requests",
          suggestions.length >= 1 && suggestions.length <= 3,
          true,
        );
        assert(
          "suggestions explain factual purpose",
          suggestions.every((row) => row.name.trim() && row.description.trim()),
          true,
        );
        await frame(selectedThread ? "existing-empty" : "new-empty");
      }
    },
    "05/no-send-on-suggestion": async (assert) => {
      await home();
      const suggestion = page
        .locator("main button[data-suggestion], main button[aria-describedby]")
        .filter({ visible: true });
      assert("suggestion exists", (await suggestion.count()) > 0, true);
      const editor = await unique('[data-testid="composer-editor"]');
      const before = await editor.innerText();
      await unchangedRequests(assert, () => suggestion.first().click());
      assert(
        "suggestion inserted into draft",
        (await editor.innerText()).length > before.length,
        true,
      );
    },
    "05/selected-project": async (assert) => {
      await home();
      const trigger = page.getByRole("button", { name: "프로젝트 변경", exact: true });
      await act("open current project selector", () => trigger.click());
      const selected = page.locator('[role="menuitemradio"][aria-checked="true"]');
      assert("one checked current project", await selected.count(), 1);
      assert(
        "selected project matches workspace",
        (await selected.innerText()).includes("baseline-project"),
        true,
      );
      const before = await selected.innerText();
      await page.keyboard.press("ArrowDown");
      assert("focus does not activate project", await selected.innerText(), before);
      await page.keyboard.press("Escape");
    },
    "05/explicit-escalation": async (assert) => {
      await home();
      const mode = await named(page, "combobox", "mode");
      await act("open execution mode choice", () => mode.click());
      const full = page
        .locator('[data-slot="select-item"]')
        .filter({ has: page.getByText("전체 접근", { exact: true }) });
      await full.waitFor();
      const before = await mode.innerText();
      await full.focus();
      assert("focus does not grant full access", await mode.innerText(), before);
      await unchangedRequests(assert, () => page.keyboard.press("Escape"));
    },
    "06/both-sidebars": async (assert) =>
      bothSidebars(assert, async (sidebar) => {
        assert(
          "working fixture visible in this sidebar",
          await sidebar.getByText("04 Working fixture", { exact: true }).isVisible(),
          true,
        );
        assert(
          "selected fixture agrees with detail",
          (await page.evaluate(() => location.hash)).includes("baseline-working"),
          true,
        );
      }),
    "06/phase-activity-freshness": async (assert) =>
      bothSidebars(assert, async (sidebar) => {
        const text = await sidebar.innerText();
        observations.push({ text });
        assert(
          "phase or observation uncertainty is explicit",
          /단계 확인 안 됨|IMPLEMENT|구현|검증|마지막 관측/.test(text),
          true,
        );
        assert(
          "detail and selected thread agree",
          (await page.locator("main").innerText()).includes("Inspecting the local workspace"),
          true,
        );
      }),
    "06/unknown-counts": async (assert) =>
      bothSidebars(assert, async (sidebar) => {
        const text = await sidebar.innerText();
        observations.push({ text });
        assert(
          "missing fixture phase is not fabricated",
          /단계 확인 안 됨|마지막 관측/.test(text),
          true,
        );
        assert(
          "unknown is not rewritten to zero",
          !/확인 안 됨\s*[:=]\s*0|UNKNOWN\s*[:=]\s*0/.test(text),
          true,
        );
      }),
    "06/stalled-recovery": async (assert) => {
      await home();
      await thread("05 Error fixture");
      const sidebar = page.locator('[data-sidebar="sidebar"]');
      const text = await sidebar.innerText();
      assert("failure remains visible beside matching thread", text.includes("실패"), true);
      const before = await page.locator("main").innerText();
      assert("matching recovery content reachable", before.includes("Recovery context"), true);
      await unchangedRequests(assert, async () => {
        await thread("01 Conversation");
        await thread("05 Error fixture");
      });
      assert(
        "reopening does not erase unresolved recovery",
        (await page.locator("main").innerText()).includes("Recovery context"),
        true,
      );
    },
    "06/footer-wrap": async (assert) => {
      await bothSidebars(assert, async () => {
        for (const [width, height] of [
          [840, 620],
          [1280, 800],
          [1920, 1080],
        ]) {
          await context.resize(width, height);
          const lines = await sample(`sidebar-footer-${width}`, () => {
            const footer = document.querySelector('[data-sidebar="footer"]');
            if (!footer) return [];
            const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
            const result = [];
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.textContent.trim()) continue;
              const grouped = new Map();
              for (let i = 0; i < node.textContent.length; i++) {
                const range = document.createRange();
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const rect = range.getBoundingClientRect();
                if (rect.width && rect.height) {
                  const y = Math.round(rect.y);
                  grouped.set(y, (grouped.get(y) ?? "") + node.textContent[i]);
                }
              }
              result.push({ text: node.textContent, lines: [...grouped.values()] });
            }
            return result;
          });
          assert("footer text observed", lines.length > 0, true);
          assert(
            "no isolated final Korean syllable",
            lines.every(
              (row) => row.lines.length < 2 || !/^[가-힣]$/.test(row.lines.at(-1).trim()),
            ),
            true,
          );
          await frame(`footer-${width}`);
        }
      });
    },
    "06/reduced-motion": async (assert) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      try {
        await bothSidebars(assert, async (sidebar) => {
          const animations = await sample("sidebar reduced animations", () =>
            document
              .getAnimations()
              .filter((a) => a.effect?.target?.closest('[data-sidebar="sidebar"]'))
              .map((a) => ({
                duration: a.effect.getComputedTiming().duration,
                iterations: a.effect.getComputedTiming().iterations,
                properties: a.effect.getKeyframes().flatMap((frame) => Object.keys(frame)),
              })),
          );
          assert(
            "reduced motion stops indefinite spatial animation",
            animations.every(
              (a) =>
                a.iterations !== Infinity ||
                !a.properties.some((p) => ["transform", "translate", "rotate"].includes(p)),
            ),
            true,
          );
          assert(
            "status information remains visible",
            (await sidebar.innerText()).includes("04 Working fixture"),
            true,
          );
        });
      } finally {
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
    },
    "07/prerequisite-destination": async (assert) => {
      await home();
      await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
      const disabled = page.locator('[data-slot="command-dialog-popup"] [aria-disabled="true"]');
      assert("unavailable import sources represented", (await disabled.count()) > 0, true);
      const target = disabled.first();
      const described = await target.getAttribute("aria-describedby");
      assert("disabled source has reachable reason", Boolean(described), true);
      const details = page.locator(`[id=${JSON.stringify(described)}]`);
      const link = details.getByRole("link").or(details.getByRole("button"));
      assert("reason has exact setup action", await link.count(), 1);
      await unchangedRequests(assert, () => link.click());
      assert(
        "exact settings destination",
        /^#\/settings\/(providers|source-control)$/.test(await page.evaluate(() => location.hash)),
        true,
      );
    },
    "07/unsupported-import": async (assert) => {
      await home();
      await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
      const disabled = page.locator('[data-slot="command-dialog-popup"] [aria-disabled="true"]');
      assert("unsupported source exists", (await disabled.count()) > 0, true);
      // Provider readiness arrives from server.discoverSourceControl after the dialog opens.
      await rpc.settled("server.discoverSourceControl");
      await settle();
      const before = await page.locator('[data-slot="command-dialog-popup"]').innerText();
      await unchangedRequests(assert, async () => {
        await disabled.first().dispatchEvent("click");
        await disabled.first().dispatchEvent("keydown", { key: "Enter", code: "Enter" });
      });
      assert(
        "blocked source does not import",
        await page.locator('[data-slot="command-dialog-popup"]').innerText(),
        before,
      );
    },
    "07/folder-route": async (assert) => {
      await home();
      await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
      await act("open local folder source", () =>
        page.getByText("로컬 폴더", { exact: true }).filter({ visible: true }).click(),
      );
      const address = await unique(
        '[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]',
      );
      await unchangedRequests(assert, () => address.fill(context.isolation.workspace + "/"));
      assert(
        "actual isolated folder is discoverable",
        await countInActiveDialog(page, "baseline-project"),
        1,
      );
    },
    "07/keyboard-route": async (assert) => {
      await home();
      await click("button", "import", page.locator('[data-sidebar="sidebar"]'));
      const folder = page.getByText("로컬 폴더", { exact: true }).filter({ visible: true });
      await act("keyboard activates local source", async () => {
        await folder.focus();
        await page.keyboard.press("Enter");
      });
      assert(
        "keyboard reaches folder input",
        await page
          .locator('[data-slot="command-dialog-popup"] input[data-slot="autocomplete-input"]')
          .isVisible(),
        true,
      );
    },
    "10/graph-no-snapshot": async (assert) => {
      await home();
      await openPanel("Run 그래프");
      await observedText(
        assert,
        "main",
        "graph-next-step",
        (text) => /통제|설정/.test(text) && !/\bCOMPLETED\b/.test(text),
      );
      const action = page.getByRole("button", { name: /통제.*설정|프로젝트 설정/ });
      assert("read-only graph next destination", await action.count(), 1);
      await unchangedRequests(assert, () => action.click());
      assert(
        "destination preserves project",
        await page.locator("#weavra-controls").isVisible(),
        true,
      );
    },
    "10/fitness-no-record": async (assert) => {
      await openProjectSettings();
      await page.locator("#weavra-fitness").scrollIntoViewIfNeeded();
      await observedText(
        assert,
        "#weavra-fitness",
        "fitness-empty-help",
        (text) => /기록/.test(text) && /별도|평가|모델/.test(text) && /권한|승인/.test(text),
      );
    },
    "10/read-only-next-step": async (assert) => {
      await openProjectSettings();
      const fitness = page.locator("#weavra-fitness");
      await fitness.scrollIntoViewIfNeeded();
      const help = fitness.getByRole("button", { name: /도움|안내|기록.*만/ });
      assert("fitness help action exists", await help.count(), 1);
      await unchangedRequests(assert, () => help.click());
      await observedText(assert, "#weavra-fitness", "fitness-help", (text) =>
        /별도|승인/.test(text),
      );
    },
    "10/no-evaluation-request": async (assert) => {
      await openProjectSettings();
      const load = await named(page, "button", "fitnessLoad", page.locator("#weavra-fitness"));
      await load.scrollIntoViewIfNeeded();
      await unchangedRequests(assert, () => load.click());
      assert(
        "no evaluation command exists",
        await page
          .locator("#weavra-fitness")
          .getByRole("button", { name: /평가 시작|Evaluate/ })
          .count(),
        0,
      );
    },
    "10/contrast": async (assert) => {
      for (const mode of ["light", "dark"]) {
        await home();
        await theme(mode);
        await openProjectSettings();
        const text = page.locator("#weavra-fitness p").filter({ visible: true }).first();
        await text.scrollIntoViewIfNeeded();
        await text.evaluate((e) => {
          e.dataset.higContrast = "fitness";
        });
        await contrast(assert, '[data-hig-contrast="fitness"]', `fitness-contrast-${mode}`);
      }
    },
    "10/text-size": async (assert) => {
      await openProjectSettings();
      const sizes = await sample("evidence text sizes", () =>
        [...document.querySelectorAll("#weavra-fitness p,#weavra-fitness label")]
          .filter((node) => node.checkVisibility())
          .map((node) => ({
            text: node.textContent,
            size: parseFloat(getComputedStyle(node).fontSize),
          })),
      );
      assert("explanatory text measured", sizes.length > 0, true);
      assert(
        "explanatory text at least fourteen pixels",
        sizes.every((row) => row.size >= 14),
        true,
      );
    },
    "13/snapshot-hierarchy": async (assert) => {
      await settings("snapshots");
      const headings = await page.getByRole("heading").allTextContents();
      observations.push({ headings });
      assert(
        "content heading describes outcome rather than repeating navigation",
        headings.filter((h) => h.trim() === "SnapShots").length <= 1,
        true,
      );
      assert(
        "capture and attachment outcome present",
        headings.some((h) => /캡처|첨부/.test(h)),
        true,
      );
    },
    "13/capture-attachment-explanation": async (assert) => {
      await settings("snapshots");
      await observedText(
        assert,
        "main",
        "snapshot-explanation",
        (text) => /활성.*창/.test(text) && /대화.*첨부|첨부.*대화/.test(text) && /권한/.test(text),
      );
      assert("opening settings did not request model", packet.counters.model, 0);
    },
    "13/toggle-preservation": async (assert) => {
      await settings("snapshots");
      const switches = page.getByRole("switch");
      assert("snapshot toggle is present", (await switches.count()) > 0, true);
      const before = await switches.first().getAttribute("aria-checked");
      await settings("general");
      await settings("snapshots");
      assert(
        "navigation preserves snapshot toggle",
        await page.getByRole("switch").first().getAttribute("aria-checked"),
        before,
      );
    },
    "17/empty-archive-route": async (assert) => {
      await settings("archive");
      const destination = page.getByRole("button", { name: /대화.*돌아|대화 목록|대화로/ });
      assert("archive has direct next action", await destination.count(), 1);
      await unchangedRequests(assert, () => destination.click());
      assert(
        "returns to conversation list",
        !(await page.evaluate(() => location.hash)).includes("/settings/"),
        true,
      );
    },
    "17/return-to-conversation": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const route = await page.evaluate(() => location.hash);
      const editor = await unique('[data-testid="composer-editor"]');
      await editor.fill("HIG archive return draft");
      await settings("archive");
      const destination = page.getByRole("button", { name: /대화.*돌아|대화 목록|대화로/ });
      await act("return from empty archive", () => destination.click());
      assert(
        "return preserves selected conversation",
        await page.evaluate(() => location.hash),
        route,
      );
      assert(
        "return preserves unsent draft",
        await page.locator('[data-testid="composer-editor"]').innerText(),
        "HIG archive return draft",
      );
    },
    "14/selected-destination-visible": async (assert) => {
      await settings("integrations");
      const trigger = page.getByRole("combobox", { name: "Open links in", exact: true });
      await trigger.scrollIntoViewIfNeeded();
      const geometry = await trigger.evaluate((e) => ({
        text: e.textContent,
        width: e.clientWidth,
        scrollWidth: e.scrollWidth,
        rect: e.getBoundingClientRect().toJSON(),
      }));
      observations.push({ geometry });
      assert(
        "full destination visible",
        geometry.scrollWidth <= geometry.width && geometry.text.trim().length > 0,
        true,
      );
      await act("open destination options", () => trigger.click());
      const checked = page.getByRole("option", { selected: true });
      await checked.waitFor({ state: "visible" });
      assert("one selected option", await checked.count(), 1);
      assert(
        "trigger and selection agree",
        (await checked.innerText()).trim(),
        geometry.text.trim(),
      );
    },
    "14/long-destination": async (assert) => {
      await settings("integrations");
      const trigger = page.getByRole("combobox", { name: "Open links in", exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await page.locator('[data-slot="select-popup"]').waitFor({ state: "visible" });
      const options = await page.getByRole("option").allTextContents();
      assert("destination options present", options.length > 1, true);
      const longest = options.toSorted((a, b) => b.length - a.length)[0];
      await act("select longest supported destination", () =>
        page.getByRole("option", { name: longest, exact: true }).click(),
      );
      await context.resize(840, 620);
      await trigger.scrollIntoViewIfNeeded();
      const geometry = await trigger.evaluate((e) => ({
        text: e.textContent,
        client: e.clientWidth,
        scroll: e.scrollWidth,
      }));
      observations.push({ longest, geometry });
      assert("long destination preserved", geometry.text.trim(), longest.trim());
      assert("long destination not clipped", geometry.scroll <= geometry.client, true);
      await context.resize(1920, 1080);
    },
    "14/selection-preserved": async (assert) => {
      await settings("integrations");
      const trigger = page.getByRole("combobox", { name: "Open links in", exact: true });
      await trigger.scrollIntoViewIfNeeded();
      const before = await trigger.innerText();
      await act("focus another option without activation", async () => {
        await trigger.focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
      });
      assert("focus-only leaves saved selection intact", await trigger.innerText(), before);
      await page.reload();
      await trigger.waitFor();
      assert("selection persists across reload", await trigger.innerText(), before);
    },
    "14/keyboard-disclosure": async (assert) => {
      await settings("integrations");
      const trigger = page.getByRole("combobox", { name: "Open links in", exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await act("keyboard opens destination", async () => {
        await trigger.focus();
        await page.keyboard.press("Enter");
      });
      assert("keyboard exposes options", (await page.getByRole("option").count()) > 1, true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Open links in",
      );
      assert(
        "keyboard focus returns",
        await trigger.evaluate((e) => e === document.activeElement),
        true,
      );
    },
    "15/installed-ready": async (assert) => sourceControlVariant(assert, "installed-ready"),
    "15/unauthenticated": async (assert) => sourceControlVariant(assert, "unauthenticated"),
    "15/authenticated": async (assert) => sourceControlVariant(assert, "authenticated"),
    "15/unavailable": async (assert) => sourceControlVariant(assert, "unavailable"),
    "15/no-authentication-side-effect": async (assert) => {
      const before = requests.length;
      await sourceControlVariant(assert, "unauthenticated");
      for (const button of await page.getByRole("button", { name: /^Toggle .* details$/ }).all()) {
        await button.scrollIntoViewIfNeeded();
        await button.click();
      }
      assert(
        "reading discovery/details never authenticates",
        requests
          .slice(before)
          .some((r) => /auth.*start|login|install|updateProvider/i.test(r.method)),
        false,
      );
      observations.push({ requests: requests.slice(before) });
    },
    "16/empty-connection-action": async (assert) => {
      await settings("connections");
      const add = page.getByRole("button", { name: "Add environment", exact: true });
      assert("one local connection draft action", await add.count(), 1);
      assert("local draft action available", await add.isEnabled(), true);
      await unchangedRequests(assert, () => add.click());
      assert("action opens connection draft", await page.getByRole("dialog").isVisible(), true);
    },
    "16/capability-copy-parity": async (assert) => {
      await settings("connections");
      const add = page.getByRole("button", { name: "Add environment", exact: true });
      const disabled = await add.isDisabled();
      const text = await page.locator("main").innerText();
      observations.push({ disabled, text });
      assert(
        "empty guidance does not instruct unavailable activation",
        !disabled || !/Click .Add environment.|환경 추가.*눌러/.test(text),
        true,
      );
      await unchangedRequests(assert, () => (disabled ? add.dispatchEvent("click") : add.click()));
      assert(
        "actual local capability agrees with action",
        await page.getByRole("dialog").isVisible(),
        !disabled,
      );
    },
    "16/unavailable-disabled": async (assert) => {
      await settings("connections");
      const controls = page.locator("main button:disabled, main [role=switch][aria-disabled=true]");
      const count = await controls.count();
      observations.push({
        applicability:
          "Actual unavailable controls only; local draft creation is not a privileged host mutation.",
        count,
      });
      if (count === 0) {
        const add = page.getByRole("button", { name: "Add environment", exact: true });
        assert(
          "local draft remains available in local-only environment",
          await add.isEnabled(),
          true,
        );
        await unchangedRequests(assert, () => add.click());
        assert(
          "local draft opens without host mutation",
          await page.getByRole("dialog").isVisible(),
          true,
        );
      } else {
        for (const control of await controls.all()) {
          const reason = await control.getAttribute("aria-describedby");
          assert("unavailable control has accessible reason", Boolean(reason), true);
          const before = requests.length;
          await control.dispatchEvent("click");
          await settle();
          assert("unavailable control invokes nothing", requests.length, before);
        }
      }
    },
    "16/direct-remote": async (assert) => {
      await settings("connections");
      await page.getByRole("button", { name: "Add environment", exact: true }).click();
      const dialog = page.getByRole("dialog");
      const text = await dialog.innerText();
      observations.push({ text });
      assert(
        "direct connection draft remains supported",
        /https?:|URL|주소|pairing|페어링/.test(text),
        true,
      );
      assert("retired hosted relay not presented", /T3 Connect|app\.t3\.codes/.test(text), false);
      await page.keyboard.press("Escape");
      assert(
        "no remote connection is opened by reading draft",
        requests.some((r) => /pair.*create|auth.*start/i.test(r.method)),
        false,
      );
    },
    "18/one-scroll-owner": async (assert) => {
      await modelForm();
      const owners = await sample("provider scroll owners", () => {
        const field = document.querySelector('input[id$="-custom-model"]');
        const result = [];
        for (let node = field.parentElement; node; node = node.parentElement)
          if (
            /(auto|scroll)/.test(getComputedStyle(node).overflowY) &&
            node.scrollHeight > node.clientHeight
          )
            result.push({
              slot: node.getAttribute("data-slot"),
              rect: node.getBoundingClientRect().toJSON(),
            });
        return result;
      });
      assert("one vertical provider scroll owner", owners.length, 1);
    },
    "18/form-actions-reachable": async (assert) => {
      await modelForm();
      for (const [width, height] of [
        [1280, 800],
        [1920, 1080],
        [840, 620],
      ]) {
        await context.resize(width, height);
        const field = await unique('input[id$="-custom-model"]');
        await field.focus();
        const geometry = await sample(`model-form-${width}`, () => {
          const field = document.querySelector('input[id$="-custom-model"]');
          const container = field.closest("form") ?? field.parentElement.parentElement;
          return [...container.querySelectorAll("label,input,button")].map((node) => ({
            text: node.textContent,
            tag: node.tagName,
            rect: node.getBoundingClientRect().toJSON(),
            visible: node.checkVisibility(),
          }));
        });
        assert(
          "form includes field and two actions",
          geometry.filter((r) => r.tag === "BUTTON").length >= 2,
          true,
        );
        assert(
          "field label and actions fit current viewport",
          geometry.every(
            (r) =>
              r.visible &&
              r.rect.top >= 0 &&
              r.rect.bottom <= height &&
              r.rect.left >= 0 &&
              r.rect.right <= width,
          ),
          true,
        );
        await frame(`model-form-${width}`);
      }
      await context.resize(1920, 1080);
    },
    "18/draft-preserved": async (assert) => {
      await modelForm();
      const field = await unique('input[id$="-custom-model"]');
      const draft = "hig-unsaved-model-".repeat(20);
      await field.fill(draft);
      await context.resize(840, 620);
      await field.focus();
      await page.keyboard.press("PageDown");
      await page.keyboard.press("Tab");
      assert("resize and keyboard preserve model draft", await field.inputValue(), draft);
      await context.resize(1920, 1080);
    },
    "18/status-summary-complete": async (assert) => {
      await settings("providers");
      const summaries = await sample("provider summary clipping", () =>
        [...document.querySelectorAll("main button, main [role=button]")]
          .filter(
            (e) =>
              e.checkVisibility() &&
              /Codex|Claude|Cursor|Grok|OpenCode|Antigravity/.test(e.textContent),
          )
          .map((e) => ({ text: e.textContent, clipped: e.scrollWidth > e.clientWidth })),
      );
      assert("provider statuses observed", summaries.length > 0, true);
      assert(
        "no clipped required provider summary",
        summaries.every((row) => !row.clipped),
        true,
      );
    },
    "18/raw-diagnostic": async (assert) => {
      await settingsDisclosure(assert, "providers", "provider-raw-diagnostic");
      await observedText(assert, "main", "raw-diagnostic-preserved", (text) =>
        /원문|진단|diagnostic|codex login/i.test(text),
      );
      assert(
        "reading raw diagnostic does not authenticate",
        requests.some((r) => /auth.*start|login/i.test(r.method)),
        false,
      );
    },
    "18/six-adapters": async (assert) => {
      await settings("providers");
      await page.getByRole("button", { name: "Add provider", exact: true }).click();
      const text = await page.getByRole("dialog").innerText();
      for (const name of ["Codex", "Claude", "Cursor", "Grok", "OpenCode", "Antigravity"])
        assert(`${name}: available or explicitly unavailable adapter`, text.includes(name), true);
      observations.push({ adapterInventory: text });
      await page.keyboard.press("Escape");
    },
    "19/selection-wash-check": async (assert) => {
      await settings("appearance");
      const light = page.getByRole("button", { name: "Use light mode", exact: true });
      await light.click();
      await light.blur();
      const selected = await sample("appearance selection", () => {
        const group = document.querySelector('[aria-label="Appearance mode"]');
        const button = group.querySelector('[aria-pressed="true"]');
        const style = getComputedStyle(button);
        return {
          count: group.querySelectorAll('[aria-pressed="true"]').length,
          shadow: style.boxShadow,
          background: style.backgroundColor,
          check: Boolean(button.querySelector("svg.lucide-check,[data-slot=selection-check]")),
          border: style.borderColor,
        };
      });
      assert("one selected appearance", selected.count, 1);
      assert("selection includes a check", selected.check, true);
      assert(
        "unfocused selection has no inset accent ring",
        selected.shadow.includes("inset"),
        false,
      );
      assert("selection has tonal wash", selected.background !== "rgba(0, 0, 0, 0)", true);
    },
    "19/focus-not-selection": async (assert) => {
      await settings("appearance");
      const light = page.getByRole("button", { name: "Use light mode", exact: true });
      const dark = page.getByRole("button", { name: "Use dark mode", exact: true });
      await light.click();
      await act("focus unselected appearance", async () => {
        await light.focus();
        await page.keyboard.press("Tab");
      });
      assert("focus moved without selecting", await light.getAttribute("aria-pressed"), "true");
      assert("dark remains unselected", await dark.getAttribute("aria-pressed"), "false");
      const state = await sample("appearance focus style", () => {
        const element = document.activeElement;
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          shadow: style.boxShadow,
          outline: style.outlineWidth,
        };
      });
      assert(
        "keyboard focus visibly treated",
        state.focusVisible && (state.shadow !== "none" || parseFloat(state.outline) >= 2),
        true,
      );
    },
    "19/system-live-theme": async (assert) => {
      await settings("appearance");
      const system = page.getByRole("button", {
        name: "Follow the system appearance",
        exact: true,
      });
      await system.click();
      for (const mode of ["light", "dark", "light"]) {
        await act(`system appearance ${mode}`, () =>
          context.application.evaluate(({ nativeTheme }, mode) => {
            nativeTheme.themeSource = mode;
          }, mode),
        );
        await page.waitForFunction(
          (dark) => document.documentElement.classList.contains("dark") === dark,
          mode === "dark",
        );
        assert(
          "System remains selected through OS change",
          await system.getAttribute("aria-pressed"),
          "true",
        );
        await frame(`system-${mode}`);
      }
    },
    "19/custom-theme-preview": async (assert) => {
      await settings("appearance");
      const before = await sample("palette before editor", () =>
        getComputedStyle(document.documentElement).getPropertyValue("--background"),
      );
      await act("create custom theme from current palette", () =>
        page.getByRole("button", { name: "Create theme", exact: true }).click(),
      );
      const editor = page.getByLabel("Create theme", { exact: true });
      await editor.waitFor();
      await owner(assert, "theme-editor", '[aria-label="Create theme"]');
      const previews = await sample("custom editor palette", () =>
        [...document.querySelectorAll("[data-theme-library-card]")].map((e) => ({
          id: e.getAttribute("data-theme-library-card"),
          background: getComputedStyle(e).backgroundColor,
        })),
      );
      assert("real theme previews remain mounted", previews.length > 0, true);
      assert(
        "opening custom editor preserves palette",
        await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--background"),
        ),
        before,
      );
      await page.getByRole("button", { name: "Close the theme editor", exact: true }).click();
    },
    "21/native-minimum": nativeBounds,
    "21/theme-content-parity": async (assert) =>
      codeCycle(assert, async (samples) => {
        for (const row of samples) {
          assert("same selected code thread", row.route.includes("baseline-code"), true);
          assert("theme preserves code and table order", row.text, samples[0].text);
          assert(
            "visible nonzero code",
            row.code.some((code) => code.rect.width > 0 && code.rect.height > 0),
            true,
          );
        }
      }),
    "21/renderer-electron-parity": async (assert) => {
      const records = packet.manifest.filter((r) => ["36", "41", "42", "43"].includes(r.stateId));
      assert("renderer/native paired corpus", records.length, 6);
      for (const record of records) {
        const renderer = await fs.readFile(path.join(output, record.file));
        const native = await fs.readFile(path.join(output, record.electronFile));
        assert("renderer hash", sha256(renderer), record.sha256);
        assert("Electron hash", sha256(native), record.electronSha256);
        assert("painted code content", record.paint.colors >= 16, true);
      }
      observations.push({
        pairs: records.map(({ file, electronFile, paint }) => ({ file, electronFile, paint })),
      });
    },
    "21/virtual-anchor": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const before = await sample("anchor before", () => {
        const node = document.querySelector("pre");
        return { text: node.textContent, y: node.getBoundingClientRect().y, route: location.hash };
      });
      await theme("dark");
      await context.ready(page, "greeting");
      const after = await sample("anchor after", () => {
        const node = document.querySelector("pre");
        return { text: node.textContent, y: node.getBoundingClientRect().y, route: location.hash };
      });
      assert("theme retains same message and scroll anchor", after, before);
    },
    "21/draft-preserved": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const editor = await unique('[data-testid="composer-editor"]');
      const draft = "HIG unsent Korean draft: 저장하지 않은 입력";
      await editor.fill(draft);
      await theme("dark");
      await context.resize(840, 620);
      assert("theme and resize retain draft", await editor.innerText(), draft);
      assert("no turn dispatched", packet.counters.model, 0);
      await context.resize(1920, 1080);
    },
    "11/empty-command": async (assert) => {
      await openAction();
      await act("submit empty command", async () => {
        await page.locator("#script-name").fill("HIG empty command");
        await page.locator("#script-command").fill("");
        await page.locator('[data-slot="dialog-popup"] button[type="submit"]').click();
      });
      const state = await sample("empty-command", () => {
        const field = document.querySelector("#script-command");
        return {
          invalid: field.getAttribute("aria-invalid"),
          value: field.value,
          description: field.getAttribute("aria-describedby"),
          focus: document.activeElement === field,
        };
      });
      assert("empty command is invalid", state.invalid, "true");
      assert("invalid field retains focus", state.focus, true);
      assert("description connected", Boolean(state.description), true);
    },
    "11/whitespace-command": async (assert) => {
      await openAction();
      await act("submit whitespace command", async () => {
        await page.locator("#script-name").fill("HIG whitespace command");
        await page.locator("#script-command").fill("   \n\t");
        await page.locator('[data-slot="dialog-popup"] button[type="submit"]').click();
      });
      assert(
        "whitespace remains invalid",
        await page.locator("#script-command").getAttribute("aria-invalid"),
        "true",
      );
      assert(
        "dialog not saved",
        await page.locator('[data-slot="dialog-popup"]').isVisible(),
        true,
      );
    },
    "11/no-save-on-invalid": async (assert) => {
      const { Database } = await import("bun:sqlite");
      const database = new Database(path.join(context.isolation.app, "userdata/state.sqlite"), {
        readonly: true,
      });
      try {
        const read = () =>
          database
            .query("SELECT scripts_json FROM projection_projects WHERE title = ?")
            .get("baseline-project");
        const before = read();
        await openAction();
        await act("submit invalid action", async () => {
          await page.locator("#script-name").fill("HIG invalid action");
          await page.locator("#script-command").fill(" ");
          await page.locator('[data-slot="dialog-popup"] button[type="submit"]').click();
        });
        await settle();
        assert("no persistence after invalid submit", read(), before);
        assert("no model dispatch", packet.counters.model, 0);
        observations.push({ projectBefore: before, projectAfter: read() });
      } finally {
        database.close();
      }
    },
    "11/inline-validation": async (assert) => {
      await openAction();
      await act("submit invalid command", async () => {
        await page.locator("#script-name").fill("HIG inline validation");
        await page.locator("#script-command").fill("");
        await page.locator('[data-slot="dialog-popup"] button[type="submit"]').click();
      });
      const state = await sample("validation geometry", () => {
        const field = document.querySelector("#script-command");
        const ids = field.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
        const descriptions = ids.map((id) => document.getElementById(id)).filter(Boolean);
        const fieldRect = field.getBoundingClientRect();
        return {
          field: fieldRect.toJSON(),
          errors: descriptions.map((node) => ({
            text: node.textContent,
            rect: node.getBoundingClientRect().toJSON(),
            visible: node.checkVisibility(),
          })),
        };
      });
      assert("field-specific inline error exists", state.errors.length > 0, true);
      assert(
        "error immediately below command",
        state.errors.some(
          (error) =>
            error.visible &&
            error.text.trim().length > 0 &&
            error.rect.top >= state.field.bottom &&
            error.rect.top - state.field.bottom <= 16,
        ),
        true,
      );
    },
    "11/valid-action": async (assert) => {
      await openAction();
      await act("save explicit inert command", async () => {
        await page.locator("#script-name").fill("HIG saved action");
        await page.locator("#script-command").fill("printf 'HIG not executed'");
        await page.locator('[data-slot="dialog-popup"] button[type="submit"]').click();
      });
      await page.locator('[data-slot="dialog-popup"]').waitFor({ state: "hidden" });
      assert(
        "saved action visible",
        await page.getByRole("button", { name: "HIG saved action", exact: true }).isVisible(),
        true,
      );
      assert("save does not dispatch model", packet.counters.model, 0);
    },
    "12/condition-ast-equivalence": async (assert) => {
      await settings("keybindings");
      assert("live binding inventory received", Array.isArray(liveConfig?.keybindings), true);
      const { parseKeybindingWhenExpression, mergeWithDefaultKeybindings } = await import(
        `${process.env.WEAVRA_CAPTURE_REPO}/app/t3code/packages/shared/src/keybindings.ts`
      );
      const bindings = mergeWithDefaultKeybindings(liveConfig.keybindings);
      const controls = page.getByRole("button", { name: /^Edit when clause for / });
      const expected = [
        ...new Set(
          bindings.map((binding) => JSON.stringify([binding.command, binding.whenAst ?? null])),
        ),
      ].sort();
      const actual = [];
      for (const control of await controls.all()) {
        const command = await control.evaluate((element) => {
          let row = element.closest('[data-slot="settings-row"]');
          while (row && !row.id.startsWith("keybinding-")) row = row.previousElementSibling;
          return row?.id.slice("keybinding-".length);
        });
        await control.scrollIntoViewIfNeeded();
        await control.click();
        const expression = page.getByRole("textbox", { name: "When expression", exact: true });
        await expression.waitFor();
        const raw = await expression.inputValue();
        actual.push(
          JSON.stringify([command, raw.trim() ? parseKeybindingWhenExpression(raw) : null]),
        );
        await page.keyboard.press("Escape");
      }
      assert(
        "every command and condition retains the original AST",
        [...new Set(actual)].sort(),
        expected,
      );
      observations.push({ bindings });
    },
    "12/alias-grouping": async (assert) => {
      await settings("keybindings");
      assert("binding inventory present", Array.isArray(liveConfig?.keybindings), true);
      const { mergeWithDefaultKeybindings } = await import(
        `${process.env.WEAVRA_CAPTURE_REPO}/app/t3code/packages/shared/src/keybindings.ts`
      );
      const bindings = mergeWithDefaultKeybindings(liveConfig.keybindings);
      const groups = new Map();
      for (const binding of bindings) {
        const key = JSON.stringify([binding.command, binding.whenAst ?? null]);
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      const rows = await sample("binding alias groups", () =>
        [...document.querySelectorAll('[data-slot="settings-row"]')]
          .map((node) => ({
            id: node.id,
            bindings:
              [...node.querySelectorAll("button")].filter((button) => button.querySelector("kbd"))
                .length + node.querySelectorAll("input[data-keybinding-capture]").length,
            text: node.textContent,
          }))
          .filter((row) => row.bindings > 0),
      );
      assert("semantic alias groups are represented", rows.length, groups.size);
      assert(
        "grouping loses no binding",
        rows.reduce((sum, row) => sum + row.bindings, 0),
        bindings.length,
      );
      observations.push({ groups: [...groups], bindings });
    },
    "12/keyboard-layout-parity": async (assert) => {
      await home();
      const route = await page.evaluate(() => location.hash);
      for (const key of ["b", "ㅠ"]) {
        const before = await page
          .locator('[data-slot="sidebar"][data-state]')
          .getAttribute("data-state");
        await act(`physical KeyB under ${key} layout`, () =>
          page
            .locator("body")
            .dispatchEvent("keydown", { key, code: "KeyB", metaKey: true, bubbles: true }),
        );
        await settle();
        const after = await page
          .locator('[data-slot="sidebar"][data-state]')
          .getAttribute("data-state");
        assert(`${key}: intended sidebar command executed`, after !== before, true);
        assert(
          `${key}: unrelated route preserved`,
          await page.evaluate(() => location.hash),
          route,
        );
      }
    },
    "12/no-rebind": async (assert) => {
      await settings("keybindings");
      const before = structuredClone(liveConfig.keybindings);
      const controls = page.getByRole("button", { name: /^Edit when clause for / });
      assert("advanced conditions reachable", (await controls.count()) > 0, true);
      await controls.first().click();
      await page.keyboard.press("Escape");
      await page.reload();
      await settings("keybindings");
      assert(
        "reading explanations never rewrites binding inventory",
        liveConfig.keybindings,
        before,
      );
      observations.push({ before, after: liveConfig.keybindings });
    },
    "17/archive-restore": async (assert) => {
      await home();
      await thread("03 Code blocks");
      await act("archive exact disposable thread", () => nativeMenu("대화 보관"));
      const confirmation = page.getByRole("alertdialog");
      if (await confirmation.isVisible()) await click("button", "Confirm", confirmation);
      await settings("archive");
      const row = page.locator('[data-slot="settings-row"]').filter({ hasText: "03 Code blocks" });
      await row.waitFor();
      assert("archive contains correct fixture", await row.count(), 1);
      await act("restore exact fixture thread", () =>
        row.getByRole("button", { name: "Unarchive", exact: true }).click(),
      );
      await row.waitFor({ state: "hidden" });
      await home();
      await thread("03 Code blocks");
      assert(
        "restored conversation retains content",
        (await page.locator("pre").allTextContents()).join("\n").includes("greeting"),
        true,
      );
      assert(
        "other fixture remains present",
        await page
          .locator('[data-sidebar="sidebar"]')
          .getByText("01 Conversation", { exact: true })
          .count(),
        1,
      );
    },
    "21/git-overflow": async (assert) => {
      await home();
      for (const [width, height] of [
        [840, 620],
        [1024, 768],
        [1280, 800],
        [1920, 1080],
        [2560, 1440],
      ]) {
        await context.resize(width, height);
        const geometry = await sample(`toolbar-${width}`, () => {
          const panel = document.querySelector('button[aria-label="오른쪽 패널 열기/닫기"]');
          const p = panel.getBoundingClientRect();
          return [...document.querySelectorAll("button")]
            .filter(
              (b) => b.checkVisibility() && /Git 초기화|Git init|Git 작업/.test(b.textContent),
            )
            .map((b) => {
              const r = b.getBoundingClientRect();
              return {
                text: b.textContent,
                rect: r.toJSON(),
                panel: p.toJSON(),
                intersection:
                  Math.max(0, Math.min(r.right, p.right) - Math.max(r.left, p.left)) *
                  Math.max(0, Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top)),
              };
            });
        });
        assert("Git action or labelled overflow is available", geometry.length > 0, true);
        assert(
          "Git and panel targets never overlap",
          geometry.every((row) => row.intersection <= 0.5),
          true,
        );
        await frame(`toolbar-${width}`);
      }
      await context.resize(1920, 1080);
    },
    "21/hit-test": async (assert) => {
      await home();
      for (const [width, height] of [
        [840, 620],
        [1280, 800],
        [1920, 1080],
        [2560, 1440],
      ]) {
        await context.resize(width, height);
        const geometry = await owner(
          assert,
          `panel-hit-${width}`,
          'button[aria-label="오른쪽 패널 열기/닫기"]',
        );
        assert(
          "panel icon has desktop minimum hit size",
          geometry.rect.width >= 36 && geometry.rect.height >= 36,
          true,
        );
        const before = packet.counters.model;
        await act("activate intended panel target", () =>
          page.getByRole("button", { name: "오른쪽 패널 열기/닫기", exact: true }).click(),
        );
        assert("panel navigation does not dispatch model", packet.counters.model, before);
        await page.keyboard.press("Escape");
      }
      await context.resize(1920, 1080);
    },
    "22/authored-locale": async (assert) => {
      for (const section of [
        "general",
        "appearance",
        "keybindings",
        "snapshots",
        "providers",
        "integrations",
        "source_control",
        "storage",
        "connections",
        "archive",
      ]) {
        await settings(section);
        await localeAudit(assert, "main", `locale-${section}`);
        await page.locator("main").evaluate((node) => {
          const scroll = [...node.querySelectorAll("*")].filter(
            (e) =>
              /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight,
          );
          for (const owner of scroll) owner.scrollTop = owner.scrollHeight;
        });
        await localeAudit(assert, "main", `locale-${section}-end`);
      }
    },
    "22/raw-diagnostics-allowlist": async (assert) => {
      await settingsDisclosure(assert, "providers", "locale-diagnostic-disclosure");
      const samples = await sample("diagnostic exceptions", () =>
        [...document.querySelectorAll("main pre,main code")].map((node) => ({
          text: node.textContent,
          tag: node.tagName,
          labelled: Boolean(node.closest("[aria-label],[aria-labelledby]")),
        })),
      );
      assert("raw command or diagnostic remains available", samples.length > 0, true);
      assert(
        "originals have separate labelled context",
        samples.every((row) => row.labelled),
        true,
      );
      observations.push({
        exceptions: samples.map((row) => ({
          ...row,
          classification: "labelled raw diagnostic/command",
        })),
      });
    },
    "22/both-sidebars": async (assert) =>
      bothSidebars(assert, async () => {
        await localeAudit(assert, '[data-sidebar="sidebar"]', "sidebar-locale");
      }),
    "22/six-adapters": async (assert) => {
      await executors["18/six-adapters"](assert);
      await localeAudit(assert, "main", "provider-locale");
    },
    "22/long-korean-copy": async (assert) => {
      await settings("general");
      await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document.querySelector("main"),
          NodeFilter.SHOW_TEXT,
        );
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          const text = node.textContent.trim();
          if (/[가-힣]/.test(text) && !node.parentElement.closest("pre,code,input,textarea"))
            node.textContent += " " + text.slice(0, Math.ceil(text.length * 0.4));
        }
        document.documentElement.style.fontSize = "150%";
      });
      for (const [width, height] of [
        [840, 620],
        [1280, 800],
        [1920, 1080],
      ]) {
        await context.resize(width, height);
        const overflow = await sample(`expanded-copy-${width}`, () => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          clipped: [...document.querySelectorAll("main button,main label")]
            .filter((node) => node.checkVisibility() && node.scrollWidth > node.clientWidth + 0.5)
            .map((node) => node.textContent),
        }));
        assert(
          "expanded copy preserves primary page bounds",
          overflow.scroll <= overflow.viewport,
          true,
        );
        assert("expanded essential labels are not clipped", overflow.clipped, []);
        await frame(`expanded-copy-${width}`);
      }
      await context.resize(1920, 1080);
    },
    "22/keyboard-ax": async (assert) => {
      await settings("general");
      const focusRows = [];
      for (let index = 0; index < 25; index++) {
        await page.keyboard.press("Tab");
        focusRows.push(
          await sample(`tab-${index}`, () => {
            const node = document.activeElement;
            const r = node.getBoundingClientRect();
            return {
              name: node.getAttribute("aria-label") ?? node.textContent,
              tag: node.tagName,
              visible: node.checkVisibility(),
              rect: r.toJSON(),
              disabled: node.matches(":disabled"),
            };
          }),
        );
      }
      assert(
        "keyboard visits actual enabled visible controls",
        focusRows.every(
          (row) =>
            row.visible &&
            !row.disabled &&
            row.rect.width > 0 &&
            row.rect.height > 0 &&
            row.tag !== "BODY",
        ),
        true,
      );
      assert(
        "keyboard controls have names",
        focusRows.every((row) => row.name?.trim().length > 0),
        true,
      );
      await localeAudit(assert, "main", "keyboard-accessible-locale");
    },
    "20/named-delete-consequence": async (assert) => {
      await home();
      await thread("03 Code blocks");
      await act("open exact thread delete", () => nativeMenu("삭제"));
      await settle();
      const alert = page.getByRole("alertdialog");
      assert("one confirmation owner", await alert.count(), 1);
      assert(
        "target identity in confirmation",
        (await alert.innerText()).includes("03 Code blocks"),
        true,
      );
      assert(
        "named destructive action",
        await alert.getByRole("button", { name: "스레드 삭제", exact: true }).count(),
        1,
      );
      const description = await sample("delete consequence", () => {
        const alert = document.querySelector('[role="alertdialog"]');
        return (alert.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
      });
      assert("permanent consequence is described", /영구|되돌릴 수 없/.test(description), true);
    },
    "20/target-identity": async (assert) => {
      await home();
      await thread("03 Code blocks");
      const before = await page.evaluate(() => location.hash);
      await act("open selected fixture deletion", () => nativeMenu("삭제"));
      const text = await page.getByRole("alertdialog").innerText();
      assert("correct named target", text.includes("03 Code blocks"), true);
      assert("other fixture not target", text.includes("01 Conversation"), false);
      await page.keyboard.press("Escape");
      assert("cancel preserves selected route", await page.evaluate(() => location.hash), before);
    },
    "20/enter-no-delete": async (assert) => {
      await home();
      await thread("03 Code blocks");
      await act("open deletion then unchosen Enter", async () => {
        await nativeMenu("삭제");
        await page.getByRole("alertdialog").waitFor();
        await settle();
        const focus = await sample("initial deletion focus", () => {
          const node = document.activeElement;
          return {
            role: node?.getAttribute("role"),
            tag: node?.tagName,
            button: node?.closest("button") !== null,
          };
        });
        assert("initial focus is neutral", focus.button, false);
        await page.keyboard.press("Enter");
      });
      await settle();
      assert(
        "unchosen Enter retains confirmation",
        await page.getByRole("alertdialog").isVisible(),
        true,
      );
      await page.keyboard.press("Escape");
      assert(
        "thread still exists",
        await page
          .locator('[data-sidebar="sidebar"]')
          .getByText("03 Code blocks", { exact: true })
          .count(),
        1,
      );
    },
    "20/escape-cancel": async (assert) => {
      await home();
      await thread("03 Code blocks");
      await nativeMenu("삭제");
      await page.getByRole("alertdialog").waitFor();
      await act("Escape cancels deletion", () => page.keyboard.press("Escape"));
      await page.getByRole("alertdialog").waitFor({ state: "hidden" });
      assert(
        "selected fixture retained",
        await page
          .locator('[data-sidebar="sidebar"]')
          .getByText("03 Code blocks", { exact: true })
          .count(),
        1,
      );
      assert(
        "other fixture retained",
        await page
          .locator('[data-sidebar="sidebar"]')
          .getByText("01 Conversation", { exact: true })
          .count(),
        1,
      );
    },
    "20/focus-return": async (assert) => {
      await home();
      await thread("03 Code blocks");
      await nativeMenu("삭제");
      await page.getByRole("alertdialog").waitFor();
      await act("cancel and restore focus", () => page.keyboard.press("Escape"));
      await page.getByRole("alertdialog").waitFor({ state: "hidden" });
      const focus = await sample("focus after cancellation", () => {
        const node = document.activeElement;
        return {
          visible: node?.checkVisibility(),
          text: node?.textContent,
          name: node?.getAttribute("aria-label"),
        };
      });
      assert(
        "focus returns to originating thread",
        focus.visible && `${focus.text} ${focus.name}`.includes("03 Code blocks"),
        true,
      );
    },
  };
  for (const caseId of selected) {
    for (const checkId of CASES[caseId].checks) {
      current = `${caseId}/${checkId}`;
      observations = [];
      actions = [];
      artifacts = [];
      const execute = executors[current];
      const row = await executeCheck(
        caseId,
        checkId,
        execute &&
          (async (assert) => {
            wire = null;
            responseTransform = null;
            providerFixture = null;
            liveConfig = null;
            replies.clear();
            requests = [];
            await context.resize(1920, 1080);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            const configReady = new Promise((resolve) => {
              onConfig = resolve;
            });
            await page.reload();
            await bounded(configReady, "Scenario server configuration");
            await home();
            await execute(assert);
          }),
        async () => {
          await frame("result");
          await save("observations.json", JSON.stringify({ actions, observations }, null, 2));
          return artifacts;
        },
      );
      rows.push(row);
      packet.checks = rows;
      await fs.writeFile(
        path.join(output, "scenario-progress.json"),
        JSON.stringify(rows, null, 2),
      );
      console.log(`SCENARIO ${current} ${row.status}${row.error ? ` ${row.error}` : ""}`);
    }
  }
  return rows;
}
