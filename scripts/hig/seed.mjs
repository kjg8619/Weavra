// Frozen projection data, never a Runtime result or evidence of model quality.
import { Database } from "bun:sqlite";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const FIXTURE_VERSION = "hig-offline-projection-v1";
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
        "No model request was made. This is a seeded error-state fixture.",
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
