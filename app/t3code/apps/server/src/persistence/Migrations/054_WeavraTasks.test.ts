import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))("054_WeavraTasks", (it) => {
  it.effect("adds task storage without rewriting legacy messages or receipts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      yield* sql`
          INSERT INTO orchestration_command_receipts
            (command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, error)
          VALUES ('legacy', 'thread', 'thread', 'before', 1, 'accepted', NULL)
        `;
      const before = yield* sql`SELECT * FROM orchestration_command_receipts`;
      yield* sql`
          INSERT INTO projection_thread_messages
            (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at, context_json)
          VALUES ('legacy-message', 'thread', NULL, 'user', 'Unrelated dirty text', 0, 'before', 'before',
            '{"unrecognizedLegacyField":"preserve byte for byte"}')
        `;
      const messages = yield* sql`SELECT * FROM projection_thread_messages`;
      const migrated = yield* runMigrations();
      assert.deepStrictEqual(migrated, [[54, "WeavraTasks"]]);
      const after = yield* sql`
          SELECT command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, error
          FROM orchestration_command_receipts
        `;
      assert.deepStrictEqual(after, before);
      assert.deepStrictEqual(yield* sql`SELECT * FROM projection_thread_messages`, messages);
      const tasks = yield* sql`SELECT * FROM projection_weavra_tasks`;
      const owners = yield* sql`SELECT * FROM workspace_execution_ownership`;
      assert.deepStrictEqual(tasks, []);
      assert.deepStrictEqual(owners, []);
      const fingerprints = yield* sql<{ readonly taskFingerprint: string | null }>`
          SELECT task_fingerprint AS "taskFingerprint" FROM orchestration_command_receipts
        `;
      assert.equal(fingerprints[0]?.taskFingerprint, null);
    }),
  );
});
