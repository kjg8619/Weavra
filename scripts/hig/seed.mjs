// Frozen projection data, never a Runtime result or evidence of model quality.
import { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const FIXTURE_VERSION = "hig-offline-projection-v4";
export const CAPTURE_SETTINGS = {
  enableProviderUpdateChecks: false,
  usageLimitSources: {},
};

// Projection fixtures are readable, but lifecycle commands use the event-derived
// command model. Register only the disposable thread a lifecycle scenario owns.
export async function registerSeededThread(dispatch, isolation, threadId) {
  assertProfile(isolation.base, isolation.home, isolation.workspace, isolation.app);
  const db = new Database(NodePath.join(isolation.app, "userdata/state.sqlite"), {
    readonly: true,
  });
  let thread;
  try {
    thread = db.query("SELECT * FROM projection_threads WHERE thread_id = ?").get(threadId);
  } finally {
    db.close();
  }
  if (!thread) throw new Error(`Missing isolated fixture thread: ${threadId}`);
  const result = await dispatch({
    type: "thread.create",
    commandId: `hig-register-${threadId}`,
    threadId,
    projectId: thread.project_id,
    title: thread.title,
    modelSelection: JSON.parse(thread.model_selection_json),
    runtimeMode: thread.runtime_mode,
    interactionMode: thread.interaction_mode,
    branch: thread.branch,
    worktreePath: thread.worktree_path,
    createdAt: thread.created_at,
    historyImport: true,
  });
  if (!Number.isInteger(result.sequence))
    throw new Error(`Fixture registration failed: ${JSON.stringify(result)}`);
  return { threadId, ...result };
}

export function prepareCaptureProfile(isolation) {
  const { base, home, workspace, app } = isolation;
  assertProfile(base, home, workspace, app);
  const directory = NodePath.join(app, "userdata");
  NodeFS.mkdirSync(directory);
  NodeFS.writeFileSync(
    NodePath.join(directory, "settings.json"),
    JSON.stringify(CAPTURE_SETTINGS),
    { flag: "wx" },
  );
}

function freezeProviders(providers) {
  return providers.map((provider) => {
    const frozen = { ...provider };
    delete frozen.versionAdvisory;
    delete frozen.updateState;
    delete frozen.usageLimits;
    return frozen;
  });
}

function freezeConfig(config) {
  return {
    ...config,
    providers: freezeProviders(config.providers),
    settings: { ...config.settings, ...CAPTURE_SETTINGS },
    remoteOpenTargets: [],
    environmentThemes: [],
    usageLimitSources: [],
  };
}

// Only external observations are frozen. Scenario events injected downstream
// of this boundary remain explicit, labelled synthetic inputs.
export function freezeCaptureServerFrame(frame, method) {
  if (method === "server.getConfig" && frame.exit?._tag === "Success")
    return { ...frame, exit: { ...frame.exit, value: freezeConfig(frame.exit.value) } };
  if (method !== "subscribeServerConfig" || frame._tag !== "Chunk") return frame;
  return {
    ...frame,
    values: frame.values.map((value) => {
      switch (value.type) {
        case "snapshot":
          return { ...value, config: freezeConfig(value.config) };
        case "providerStatuses":
          return {
            ...value,
            payload: { ...value.payload, providers: freezeProviders(value.payload.providers) },
          };
        case "settingsUpdated":
          return {
            ...value,
            payload: {
              ...value.payload,
              settings: { ...value.payload.settings, ...CAPTURE_SETTINGS },
            },
          };
        case "environmentThemesUpdated":
          return { ...value, payload: { themes: [] } };
        case "usageLimitSourcesUpdated":
          return { ...value, payload: { sources: [] } };
        default:
          return value;
      }
    }),
  };
}

export async function installCaptureNetworkFixture(page) {
  const receipt = { settingsSnapshots: 0, unexpectedUpdateChecks: false, frozenFrames: 0 };
  await page.routeWebSocket("**/*", (socket) => {
    const server = socket.connectToServer();
    const methods = new Map();
    socket.onClose(() => server.close());
    server.onClose(() => socket.close());
    socket.onMessage((message) => {
      const decoded = JSON.parse(String(message));
      for (const frame of Array.isArray(decoded) ? decoded : [decoded])
        if (frame._tag === "Request") methods.set(frame.id, frame.tag);
      server.send(message);
    });
    server.onMessage((message) => {
      const decoded = JSON.parse(String(message));
      const frames = (Array.isArray(decoded) ? decoded : [decoded]).map((frame) => {
        const method = methods.get(frame.requestId);
        const settings =
          method === "server.getConfig" && frame.exit?._tag === "Success"
            ? [frame.exit.value.settings]
            : method === "subscribeServerConfig" && frame._tag === "Chunk"
              ? frame.values
                  .filter((value) => value.type === "snapshot" || value.type === "settingsUpdated")
                  .map((value) =>
                    value.type === "snapshot" ? value.config.settings : value.payload.settings,
                  )
              : [];
        for (const value of settings) {
          receipt.settingsSnapshots++;
          if (value.enableProviderUpdateChecks !== false) receipt.unexpectedUpdateChecks = true;
        }
        const frozen = freezeCaptureServerFrame(frame, method);
        if (JSON.stringify(frozen) !== JSON.stringify(frame)) receipt.frozenFrames++;
        return frozen;
      });
      socket.send(JSON.stringify(Array.isArray(decoded) ? frames : frames[0]));
    });
  });
  return receipt;
}

export function assertProfile(base, home, workspace, app) {
  const canonical = NodeFS.realpathSync(base);
  if (
    !NodePath.basename(canonical).startsWith("weavra-hig-") ||
    !["/tmp", "/private/tmp"].includes(NodePath.dirname(canonical))
  ) {
    throw new Error("Not a task-owned capture profile");
  }
  for (const [name, actual] of [
    ["home", home],
    ["workspace", workspace],
    ["app", app],
  ]) {
    if (NodeFS.realpathSync(actual) !== NodePath.join(canonical, name)) {
      throw new Error(`Profile isolation failed: ${name}`);
    }
  }
}
export function seed({ base, home, workspace, app }) {
  assertProfile(base, home, workspace, app);
  const db = new Database(NodePath.join(app, "userdata/state.sqlite"), {
    readwrite: true,
    create: false,
  });
  try {
    const project = db
      .query(
        "SELECT project_id, workspace_root FROM projection_projects WHERE title = 'baseline-project'",
      )
      .get();
    if (
      !project ||
      NodeFS.realpathSync(project.workspace_root) !==
        NodeFS.realpathSync(NodePath.join(workspace, "baseline-project"))
    ) {
      throw new Error("Create the isolated sibling baseline-project first");
    }
    const at = "2026-10-18T09:00:00.000Z";
    const selections = JSON.stringify({
      provider: "codex",
      model: "baseline-no-provider",
      instanceId: "codex",
    });
    const fixtures = [
      [
        "messages",
        "01 Conversation",
        "Please explain the capture baseline.",
        "This is a **local screenshot fixture**. No model was called.\n\nThe interface preserves conversation history and Markdown formatting.",
      ],
      [
        "long",
        "02 Long messages",
        "Review this long project brief.\n\n" +
          "Keep the existing workspace safe and make each result reproducible. ".repeat(45),
        "## Baseline review\n\n" +
          Array.from(
            { length: 18 },
            (_, i) =>
              `### Section ${i + 1}\n\nThis paragraph exercises wrapping, scrolling, and typography. It is seeded data, not a generated model response. The project remains isolated in a temporary directory.`,
          ).join("\n\n"),
      ],
      [
        "code",
        "03 Code blocks",
        "Show a TypeScript example and a shell command.",
        "## Example\n\n```typescript\nexport function greeting(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greeting('Weavra'));\n```\n\n```sh\nprintf 'local fixture only\\n'\n```\n\n| Check | Result |\n| --- | --- |\n| Profile | Isolated |\n| Paid requests | Zero |",
      ],
      [
        "working",
        "04 Working fixture",
        "Inspect the fixture project without changing it.",
        "Inspecting the local workspace and preparing the summary...",
      ],
      [
        "error",
        "05 Error fixture",
        "Demonstrate a recoverable provider failure.",
        "## Recovery context\n\nThe local provider is unavailable. Review the provider setup, then retry this isolated fixture when ready.\n\nNo model request was made. This is a seeded error-state fixture.",
      ],
      ["empty", "06 Empty thread", null, null],
    ];
    db.transaction(() => {
      for (const [id, title, user, assistant] of fixtures) {
        const thread = `baseline-${id}`;
        db.query(`INSERT OR REPLACE INTO projection_threads
          (thread_id,project_id,title,model_selection_json,runtime_mode,interaction_mode,latest_turn_id,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
          thread,
          project.project_id,
          title,
          selections,
          "approval-required",
          "default",
          user ? `turn-${id}` : null,
          at,
          at,
        );
        if (user) {
          for (const [role, text] of [
            ["user", user],
            ["assistant", assistant],
          ]) {
            const time = role === "assistant" ? "2026-10-18T09:00:01.000Z" : at;
            db.query(`INSERT OR REPLACE INTO projection_thread_messages
              (message_id,thread_id,turn_id,role,text,is_streaming,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?)`).run(
              `${id}-${role}`,
              thread,
              `turn-${id}`,
              role,
              text,
              id === "working" && role === "assistant" ? 1 : 0,
              time,
              time,
            );
          }
        }
        db.query(`INSERT OR REPLACE INTO projection_thread_sessions
          (thread_id,status,provider_name,provider_instance_id,runtime_mode,active_turn_id,last_error,updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          thread,
          id === "working" ? "running" : id === "error" ? "error" : "idle",
          "codex",
          "codex",
          "approval-required",
          id === "working" ? `turn-${id}` : null,
          id === "error"
            ? "Capture fixture: provider unavailable. No external request was sent."
            : null,
          at,
        );
        if (user) {
          db.query("DELETE FROM projection_turns WHERE thread_id = ?").run(thread);
          db.query(`INSERT INTO projection_turns
            (thread_id,turn_id,pending_message_id,assistant_message_id,state,requested_at,started_at,completed_at,checkpoint_files_json)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(
            thread,
            `turn-${id}`,
            `${id}-user`,
            `${id}-assistant`,
            id === "working" ? "running" : id === "error" ? "error" : "completed",
            at,
            at,
            id === "working" ? null : at,
            "[]",
          );
        }
      }
      db.query(`INSERT OR REPLACE INTO projection_thread_activities
        (activity_id,thread_id,turn_id,tone,kind,summary,payload_json,created_at,sequence)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        "hig-tool-error",
        "baseline-error",
        "turn-error",
        "error",
        "tool.completed",
        "HIG failed tool fixture",
        JSON.stringify({
          toolCallId: "hig-tool",
          itemType: "command_execution",
          status: "failed",
          command: "printf 'synthetic fixture; not executed'",
          exitCode: 1,
        }),
        "2026-10-18T09:00:00.500Z",
        999,
      );
    })();
    return {
      version: FIXTURE_VERSION,
      authority: "SYNTHETIC_PROJECTION_ONLY",
      projectId: project.project_id,
      threads: fixtures.map(([id]) => `baseline-${id}`),
    };
  } finally {
    db.close();
  }
}
