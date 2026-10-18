import { type WeavraTaskCreateInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceExecutionOwnership } from "../workspace/WorkspaceExecutionOwnership.ts";
import { withWorkspaceLease } from "../workspace/workspaceLease.ts";
import { prepareProjectGit } from "./ProjectGitPreparation.ts";
import { projectSetupTargetDigest, setupProject } from "./ProjectSetup.ts";
import { TaskCoordinatorError } from "./TaskCoordinator.ts";

/** Explicit create only: repository preparation never runs from discovery or setup reads. */
export const prepareTaskProject = Effect.fn("weavra.prepareTaskProject")(function* (
  input: WeavraTaskCreateInput,
) {
  const ownership = yield* WorkspaceExecutionOwnership;
  const query = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  if (input.environmentId !== ownership.environmentId)
    return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
  const select = Effect.fn("weavra.prepareTaskProject.select")(function* () {
    const thread = yield* query.getThreadShellById(input.threadId);
    if (Option.isNone(thread) || thread.value.projectId !== input.projectId)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const project = yield* query.getProjectShellById(input.projectId);
    if (Option.isNone(project)) return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const cwd = yield* fs
      .realPath(thread.value.worktreePath ?? project.value.workspaceRoot)
      .pipe(Effect.mapError(() => new TaskCoordinatorError({ code: "TARGET_CHANGED" })));
    return {
      cwd,
      workspaceRoot: project.value.workspaceRoot,
      worktreePath: thread.value.worktreePath,
    };
  });
  const selected = yield* select();
  // Missing worktrees are not new projects and must never be initialized in place.
  if (selected.worktreePath !== null) return selected.cwd;
  const operation = Effect.gen(function* () {
    const current = yield* select();
    if (
      current.cwd !== selected.cwd ||
      current.workspaceRoot !== selected.workspaceRoot ||
      current.worktreePath !== selected.worktreePath
    )
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const snapshot = yield* query.getCommandReadModel();
    const duplicate = snapshot.weavraTasks?.find(
      (task) => task.createCommandId === input.commandId,
    );
    if (duplicate) {
      if (
        duplicate.environmentId !== input.environmentId ||
        duplicate.projectId !== input.projectId ||
        duplicate.threadId !== input.threadId
      )
        return yield* new TaskCoordinatorError({ code: "COMMAND_CONFLICT" });
      return;
    }
    const receipts = yield* sql<{ readonly commandId: string }>`SELECT command_id AS "commandId"
      FROM orchestration_command_receipts WHERE command_id = ${input.commandId} LIMIT 1`;
    if (receipts.length) {
      const recorded = (yield* query.getCommandReadModel()).weavraTasks?.find(
        (task) => task.createCommandId === input.commandId,
      );
      if (
        recorded &&
        recorded.environmentId === input.environmentId &&
        recorded.projectId === input.projectId &&
        recorded.threadId === input.threadId
      )
        return;
      return yield* new TaskCoordinatorError({ code: "COMMAND_CONFLICT" });
    }
    const resolved = yield* ownership.resolveTarget(input.threadId).pipe(Effect.result);
    if (resolved._tag === "Failure") {
      if (resolved.failure.reason !== "target-changed")
        return yield* new TaskCoordinatorError({ code: "PROJECT_PREPARATION_BUSY" });
      yield* ownership
        .withFreshOperation(
          { cwd: selected.cwd, kind: "git", threadId: input.threadId, exclusive: true },
          Effect.gen(function* () {
            const fresh = yield* select();
            if (
              fresh.cwd !== selected.cwd ||
              fresh.workspaceRoot !== selected.workspaceRoot ||
              fresh.worktreePath !== null
            )
              return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
            yield* prepareProjectGit(selected.cwd).pipe(
              Effect.mapError(
                (error) =>
                  new TaskCoordinatorError({
                    code:
                      error.code === "CAPACITY"
                        ? "WORKSPACE_EVIDENCE_CAPACITY"
                        : "PROJECT_PREPARATION_FAILED",
                  }),
              ),
            );
          }),
        )
        .pipe(
          Effect.catchTag("WorkspaceOwnershipError", () =>
            Effect.fail(new TaskCoordinatorError({ code: "PROJECT_PREPARATION_BUSY" })),
          ),
        );
    }
    const bound = yield* ownership
      .resolveTarget(input.threadId)
      .pipe(Effect.mapError(() => new TaskCoordinatorError({ code: "TARGET_CHANGED" })));
    if (
      bound.projectId !== input.projectId ||
      bound.canonicalCwd !== selected.cwd ||
      bound.target.workspaceRoot !== selected.workspaceRoot ||
      bound.target.worktreePath !== selected.worktreePath
    )
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const expectedDigest = projectSetupTargetDigest(bound);
    // Existing configuration is authoritative; don't rewrite it or reinitialize its Runtime home.
    if (yield* fs.exists(path.join(selected.cwd, ".ai", "config.yaml"))) return;
    const scope = {
      environmentId: input.environmentId,
      projectId: input.projectId,
      threadId: input.threadId,
    };
    const inspected = yield* setupProject({ scope, action: "read" });
    if (inspected.targetDigest !== expectedDigest)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    if (inspected.result.kind === "read") return;
    if (inspected.result.kind !== "error" || inspected.result.code !== "CONFIG_MISSING")
      return yield* new TaskCoordinatorError({ code: "PROJECT_NOT_CONFIGURED" });
    const draft = yield* setupProject({ scope, action: "draft" });
    if (draft.targetDigest !== expectedDigest)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    if (
      draft.result.kind !== "draft" ||
      !draft.recommendation?.selected ||
      draft.result.workspaceProfile.kind !== "supported"
    )
      return yield* new TaskCoordinatorError({ code: "PROJECT_NOT_CONFIGURED" });
    const saved = yield* setupProject({
      scope,
      action: "save",
      targetDigest: draft.targetDigest,
      yaml: draft.result.yaml,
    });
    if (saved.result.kind !== "saved")
      return yield* new TaskCoordinatorError({ code: "PROJECT_NOT_CONFIGURED" });
    const initialized = yield* setupProject({ scope, action: "initialize" });
    if (initialized.result.kind !== "initialized")
      return yield* new TaskCoordinatorError({ code: "PROJECT_PREPARATION_FAILED" });
  }).pipe(
    Effect.catchTag("WeavraProjectSetupError", () =>
      Effect.fail(new TaskCoordinatorError({ code: "PROJECT_PREPARATION_FAILED" })),
    ),
  );
  yield* withWorkspaceLease(selected.cwd, operation);
  return selected.cwd;
});
