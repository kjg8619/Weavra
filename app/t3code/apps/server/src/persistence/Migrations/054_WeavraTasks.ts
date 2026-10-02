import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE projection_weavra_tasks (
      task_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      phase TEXT NOT NULL,
      ownership_state TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      generation INTEGER NOT NULL CHECK (generation > 0),
      task_json TEXT NOT NULL CHECK (json_valid(task_json)),
      CHECK (task_id = json_extract(task_json, '$.id')),
      CHECK (environment_id = json_extract(task_json, '$.environmentId')),
      CHECK (project_id = json_extract(task_json, '$.projectId')),
      CHECK (thread_id = json_extract(task_json, '$.threadId')),
      CHECK (canonical_cwd = json_extract(task_json, '$.checkout.canonicalCwd')),
      CHECK (phase = json_extract(task_json, '$.phase')),
      CHECK (ownership_state = json_extract(task_json, '$.ownership.state')),
      CHECK (revision = json_extract(task_json, '$.revision')),
      CHECK (generation = json_extract(task_json, '$.ownership.generation'))
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_weavra_tasks_active_thread
    ON projection_weavra_tasks(environment_id, thread_id)
    WHERE phase <> 'finished' OR ownership_state <> 'released'
  `;
  yield* sql`
    CREATE UNIQUE INDEX idx_weavra_tasks_owned_checkout
    ON projection_weavra_tasks(environment_id, canonical_cwd)
    WHERE ownership_state <> 'released'
  `;
  // Released rows retain their generation. Deleting a row would let stale operation tokens
  // become valid again when the next task acquires the same checkout (the ABA problem).
  yield* sql`
    CREATE TABLE workspace_execution_ownership (
      environment_id TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation > 0),
      task_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('analysis', 'draining', 'runtime', 'reconciling', 'released')),
      pending_execution_id TEXT,
      PRIMARY KEY (environment_id, canonical_cwd),
      CHECK ((state = 'released') = (task_id IS NULL)),
      CHECK (state <> 'released' OR pending_execution_id IS NULL)
    ) WITHOUT ROWID
  `;
  yield* sql`ALTER TABLE orchestration_command_receipts ADD COLUMN task_fingerprint TEXT`;
});
