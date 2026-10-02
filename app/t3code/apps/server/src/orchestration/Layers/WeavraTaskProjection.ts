import { type OrchestrationEvent, WeavraCheckoutOwnership, WeavraTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../../persistence/Errors.ts";

const encodeTask = Schema.encodeSync(Schema.fromJsonString(WeavraTask));
const decodeTasks = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ task: Schema.fromJsonString(WeavraTask) })),
);
const decodeOwnership = Schema.decodeUnknownEffect(Schema.Array(WeavraCheckoutOwnership));

/** Called inside the event/receipt transaction; failed CAS rolls back the event as well. */
export const projectWeavraTask = Effect.fn("projectWeavraTask")(
  function* (event: OrchestrationEvent) {
    if (event.type !== "thread.weavra-task-set") return;
    const sql = yield* SqlClient.SqlClient;
    const { task, expectedRevision, expectedOwnershipGeneration } = event.payload;
    const rows =
      expectedRevision === null
        ? yield* sql`
          INSERT INTO projection_weavra_tasks
            (task_id, environment_id, project_id, thread_id, canonical_cwd, phase,
             ownership_state, revision, generation, task_json)
          VALUES (${task.id}, ${task.environmentId}, ${task.projectId}, ${task.threadId},
            ${task.checkout.canonicalCwd}, ${task.phase}, ${task.ownership.state},
            ${task.revision}, ${task.ownership.generation}, ${encodeTask(task)})
          RETURNING task_id
        `
        : yield* sql`
          UPDATE projection_weavra_tasks
          SET phase = ${task.phase}, ownership_state = ${task.ownership.state},
              revision = ${task.revision}, generation = ${task.ownership.generation},
              task_json = ${encodeTask(task)}
          WHERE task_id = ${task.id} AND revision = ${expectedRevision}
            AND environment_id = ${task.environmentId} AND project_id = ${task.projectId}
            AND thread_id = ${task.threadId} AND canonical_cwd = ${task.checkout.canonicalCwd}
          RETURNING task_id
        `;
    if (rows.length !== 1) {
      return yield* new PersistenceSqlError({
        operation: "projectWeavraTask",
        detail: "Stale task revision.",
      });
    }
    const ownerTaskId = task.ownership.state === "released" ? null : task.id;
    const pendingExecutionId =
      ownerTaskId === null ? null : (task.execution?.binding.executionId ?? null);
    const owners =
      expectedOwnershipGeneration === 0
        ? yield* sql`
          INSERT INTO workspace_execution_ownership
            (environment_id, canonical_cwd, generation, task_id, state, pending_execution_id)
          VALUES (${task.environmentId}, ${task.checkout.canonicalCwd},
            ${task.ownership.generation}, ${ownerTaskId}, ${task.ownership.state},
            ${pendingExecutionId})
          RETURNING generation
        `
        : yield* sql`
          UPDATE workspace_execution_ownership
          SET generation = ${task.ownership.generation}, task_id = ${ownerTaskId},
              state = ${task.ownership.state}, pending_execution_id = ${pendingExecutionId}
          WHERE environment_id = ${task.environmentId}
            AND canonical_cwd = ${task.checkout.canonicalCwd}
            AND generation = ${expectedOwnershipGeneration}
            AND (task_id = ${task.id} OR task_id IS NULL)
          RETURNING generation
        `;
    if (owners.length !== 1) {
      return yield* new PersistenceSqlError({
        operation: "projectWeavraTask",
        detail: "Stale checkout ownership generation.",
      });
    }
  },
  Effect.catchTag("SqlError", (error) =>
    Effect.fail(toPersistenceSqlError("projectWeavraTask")(error)),
  ),
);

export const listWeavraTasks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT task_json AS task FROM projection_weavra_tasks ORDER BY task_id
  `.pipe(Effect.mapError(toPersistenceSqlError("listWeavraTasks")));
  return (yield* decodeTasks(rows).pipe(
    Effect.mapError(toPersistenceDecodeError("listWeavraTasks")),
  )).map((row) => row.task);
});

export const listWeavraOwnership = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT environment_id AS "environmentId", canonical_cwd AS "canonicalCwd",
      generation, task_id AS "taskId", state, pending_execution_id AS "pendingExecutionId"
    FROM workspace_execution_ownership ORDER BY environment_id, canonical_cwd
  `.pipe(Effect.mapError(toPersistenceSqlError("listWeavraOwnership")));
  return yield* decodeOwnership(rows).pipe(
    Effect.mapError(toPersistenceDecodeError("listWeavraOwnership")),
  );
});
