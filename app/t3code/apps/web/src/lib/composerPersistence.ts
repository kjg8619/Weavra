import * as Schema from "effect/Schema";
import * as Encoding from "effect/Encoding";
import { NonNegativeInt, PositiveInt } from "@t3tools/contracts";

const RecordSchema = Schema.Struct({
  revision: PositiveInt,
  operation: Schema.String,
  environment: Schema.NullOr(Schema.String),
  value: Schema.Unknown,
});
const DatabaseSchema = Schema.Struct({
  imported: Schema.Boolean,
  legacy: Schema.NullOr(Schema.String),
  generation: NonNegativeInt,
  environments: Schema.Record(Schema.String, NonNegativeInt),
  writers: Schema.Record(Schema.String, NonNegativeInt),
  records: Schema.Record(Schema.String, RecordSchema),
});
type Database = typeof DatabaseSchema.Type;
export type ComposerRecord = { readonly environment: string | null; readonly value: unknown };
const ChangeSchema = Schema.Struct({
  key: Schema.String,
  revision: NonNegativeInt,
  epochs: Schema.Record(Schema.String, NonNegativeInt),
  environment: Schema.NullOr(Schema.String),
  chain: Schema.Boolean,
  value: Schema.Unknown,
});
type Change = typeof ChangeSchema.Type;
const IntentSchema = Schema.Struct({
  operation: Schema.String,
  writer: Schema.String,
  sequence: PositiveInt,
  generation: NonNegativeInt,
  changes: Schema.Array(ChangeSchema),
});
type Intent = typeof IntentSchema.Type;
const decodeDatabase = Schema.decodeUnknownSync(DatabaseSchema);
const decodeIntent = Schema.decodeUnknownSync(IntentSchema);
const emptyDatabase = (): Database => ({
  imported: false,
  legacy: null,
  generation: 0,
  environments: {},
  writers: {},
  records: {},
});

export class ComposerPersistenceConflict extends Error {
  constructor(readonly key: string) {
    super(
      "This draft changed in another tab. Your local input is retained; copy it before reloading.",
    );
    this.name = "ComposerPersistenceConflict";
  }
}

/** The callback runs synchronously inside one readwrite transaction. */
export interface ComposerBackend {
  transact: (update: (current: Database) => Database) => Promise<Database>;
}

function createIndexedDbComposerBackend(): ComposerBackend {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () => {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("t3code-composer", 1);
      request.addEventListener("upgradeneeded", () =>
        request.result.createObjectStore("authority"),
      );
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () =>
        reject(new Error("Close older tabs to open composer storage.")),
      );
      request.addEventListener("success", () => {
        const db = request.result;
        db.addEventListener("versionchange", () => {
          db.close();
          connection = undefined;
        });
        resolve(db);
      });
    });
    return connection;
  };
  return {
    async transact(update) {
      const db = await open();
      return new Promise<Database>((resolve, reject) => {
        const transaction = db.transaction("authority", "readwrite", { durability: "strict" });
        const store = transaction.objectStore("authority");
        const request = store.get("state");
        let result: Database | undefined;
        let failure: unknown;
        transaction.addEventListener("abort", () => reject(failure ?? transaction.error));
        transaction.addEventListener("error", () => {
          failure ??= transaction.error;
        });
        transaction.addEventListener("complete", () => {
          if (result) resolve(result);
          else reject(new Error("Composer transaction completed without a result."));
        });
        request.addEventListener("success", () => {
          try {
            const current =
              request.result === undefined ? emptyDatabase() : decodeDatabase(request.result);
            result = update(current);
            if (result !== current) store.put(result, "state");
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        });
      });
    },
  };
}

/** Node-only store tests use the same atomic update callback, never localStorage authority. */
export function createMemoryComposerBackend(): ComposerBackend {
  let database = emptyDatabase();
  return {
    async transact(update) {
      const next = update(database);
      database = structuredClone(next);
      return structuredClone(database);
    },
  };
}

export function createComposerBackend(): ComposerBackend {
  return typeof window === "undefined" && typeof indexedDB === "undefined"
    ? createMemoryComposerBackend()
    : createIndexedDbComposerBackend();
}

function applyIntent(current: Database, intent: Intent): Database {
  if (intent.generation !== current.generation) {
    throw new ComposerPersistenceConflict("generation");
  }
  const highWater = current.writers[intent.writer] ?? 0;
  if (intent.sequence <= highWater) return current;
  if (intent.sequence !== highWater + 1) {
    throw new ComposerPersistenceConflict("writer-sequence");
  }
  const records = { ...current.records };
  for (const change of intent.changes) {
    const existing = records[change.key];
    // Crash after commit but before journal removal: acknowledge, never rewrite.
    if (existing?.operation === intent.operation) continue;
    if (
      (existing?.revision ?? 0) !== change.revision ||
      Object.entries(change.epochs).some(
        ([environment, epoch]) => (current.environments[environment] ?? 0) !== epoch,
      )
    ) {
      throw new ComposerPersistenceConflict(change.key);
    }
    records[change.key] = {
      revision: change.revision + 1,
      operation: intent.operation,
      environment: change.environment,
      value: change.value,
    };
  }
  return {
    ...current,
    records,
    writers: { ...current.writers, [intent.writer]: intent.sequence },
  };
}

export interface ComposerJournalStorage {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}
const JOURNAL_PREFIX = "t3code:composer-intent:v1:";
const MAX_JOURNAL_CHARACTERS = 4 * 1024 * 1024;

export function createComposerAuthority(options: {
  backend: ComposerBackend;
  journal?: ComposerJournalStorage;
  importLegacy: (raw: string | null) => Record<string, ComposerRecord>;
  readLegacy?: () => string | null;
  releaseLegacy?: (archived: string) => void;
  onError: (error: unknown) => void;
  onCommitted?: () => void;
  onRetained?: (changes: ReadonlyArray<{ readonly key: string; readonly value: unknown }>) => void;
}) {
  let view = emptyDatabase();
  let pending = new Map<string, Omit<Change, "value">>();
  let pendingGeneration: number | undefined;
  let outstanding: Intent[] = [];
  let tail: Promise<void> = Promise.resolve();
  let failure: unknown;
  // getRandomValues is available on supported direct HTTP clients; randomUUID
  // is secure-context-only. Keep this module independent of the composer store.
  const writer = Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  let sequence = 0;
  const persistedKeys = new Set<string>();
  const keyFor = (intent: Intent) => `${JOURNAL_PREFIX}${intent.writer}/${intent.sequence}`;

  function persistJournal() {
    const serialized = outstanding.map((intent) => ({
      key: keyFor(intent),
      value: JSON.stringify(intent),
    }));
    if (serialized.reduce((size, entry) => size + entry.value.length, 0) > MAX_JOURNAL_CHARACTERS) {
      throw new Error(
        "The pending composer draft exceeds the shutdown journal limit. Keep this tab open.",
      );
    }
    for (const entry of serialized) {
      if (persistedKeys.has(entry.key)) continue;
      options.journal?.setItem(entry.key, entry.value);
      persistedKeys.add(entry.key);
    }
    for (const key of persistedKeys) {
      if (serialized.some((entry) => entry.key === key)) continue;
      options.journal?.removeItem(key);
      persistedKeys.delete(key);
    }
  }

  function report(error: unknown) {
    // Retry storage failures with the original immutable intent. Conflicts
    // remain fenced and cannot be rebased onto newer committed work.
    failure = error instanceof ComposerPersistenceConflict ? error : undefined;
    options.onError(error);
  }

  function adoptCommitted(intent: Intent) {
    const records = { ...view.records };
    for (const change of intent.changes) {
      // An idempotent replay may observe a newer writer's value. Acknowledging
      // our old operation must not lend that newer revision to stale local UI.
      records[change.key] = {
        revision: change.revision + 1,
        operation: intent.operation,
        environment: change.environment,
        value: change.value,
      };
    }
    view = { ...view, records };
  }

  return {
    async hydrate() {
      // Hydration never consumes current local mutations or grants them new revisions.
      await tail;
      const committed = await options.backend.transact((current) => {
        if (current.imported) return current;
        const legacy = options.readLegacy?.() ?? null;
        const records = { ...current.records };
        for (const [key, record] of Object.entries(options.importLegacy(legacy))) {
          records[key] = { ...record, revision: 1, operation: "legacy-import" };
        }
        return { ...current, imported: true, legacy, records };
      });
      if (committed.legacy !== null) options.releaseLegacy?.(committed.legacy);
      const journalKeys = options.journal
        ? Array.from({ length: options.journal.length }, (_, index) => options.journal?.key(index))
        : [];
      let recovered = committed;
      const journals: Array<{ key: string; intent: Intent }> = [];
      for (const key of journalKeys) {
        if (!key?.startsWith(JOURNAL_PREFIX) || persistedKeys.has(key)) continue;
        const raw = options.journal?.getItem(key);
        if (!raw) continue;
        try {
          const intent = decodeIntent(JSON.parse(raw));
          if (key !== keyFor(intent)) throw new Error("Invalid composer journal identity.");
          journals.push({ key, intent });
        } catch (error) {
          options.onError(error);
        }
      }
      journals.sort(
        (a, b) =>
          a.intent.writer.localeCompare(b.intent.writer) || a.intent.sequence - b.intent.sequence,
      );
      for (const { key, intent } of journals) {
        try {
          recovered = await options.backend.transact((current) => applyIntent(current, intent));
          // Intent keys are immutable. An active writer's next edit has a new
          // sequence/key, so completing this journal cannot delete newer input.
          options.journal?.removeItem(key);
        } catch (error) {
          // Conflicted input stays in its original journal for explicit inspection.
          options.onError(error);
          options.onRetained?.(intent.changes);
        }
      }
      const protectedKeys = new Set([
        ...pending.keys(),
        ...outstanding.flatMap((intent) => intent.changes.map((change) => change.key)),
      ]);
      const records = { ...recovered.records };
      for (const key of protectedKeys) {
        const previous = view.records[key];
        if (previous) records[key] = previous;
        else delete records[key];
      }
      view = { ...recovered, records };
      return recovered;
    },
    capture(key: string, environment: string | null, chain = true) {
      if (pending.size === 0) pendingGeneration = view.generation;
      const previous = pending.get(key);
      if (previous) {
        pending.set(key, {
          ...previous,
          environment,
          chain: previous.chain && chain,
          epochs:
            environment === null
              ? previous.epochs
              : {
                  ...previous.epochs,
                  [environment]:
                    previous.epochs[environment] ?? view.environments[environment] ?? 0,
                },
        });
        return;
      }
      const inFlight = outstanding
        .flatMap((intent) => intent.changes)
        .filter((entry) => entry.key === key);
      const last = inFlight.at(-1);
      pending.set(key, {
        key,
        environment,
        chain,
        revision: last ? last.revision + (last.chain ? 1 : 0) : (view.records[key]?.revision ?? 0),
        epochs: environment === null ? {} : { [environment]: view.environments[environment] ?? 0 },
      });
    },
    pendingKeys: () =>
      new Set([
        ...pending.keys(),
        ...outstanding.flatMap((intent) => intent.changes.map((change) => change.key)),
      ]),
    snapshot: () => view,
    checkpoint(values: Record<string, ComposerRecord>) {
      if (pending.size > 0) {
        const intent: Intent = {
          operation: `${writer}/${sequence + 1}`,
          writer,
          sequence: ++sequence,
          generation: pendingGeneration ?? view.generation,
          changes: [...pending.values()].map((change) => ({
            ...change,
            value: values[change.key]?.value ?? null,
          })),
        };
        outstanding.push(intent);
        pending = new Map();
        pendingGeneration = undefined;
      }
      persistJournal();
    },
    async flush(values: Record<string, ComposerRecord>) {
      try {
        this.checkpoint(values);
      } catch (error) {
        // A full synchronous journal must not prevent an ordinary IDB commit.
        // The intent is still held in memory, and beforeunload will synchronously
        // retry the journal and cancel navigation if it cannot preserve it.
        options.onError(error);
      }
      const intents = [...outstanding];
      const run = tail.then(async () => {
        if (failure) throw failure;
        for (const intent of intents) {
          if (!outstanding.includes(intent)) continue;
          await options.backend.transact((current) => applyIntent(current, intent));
          adoptCommitted(intent);
          outstanding = outstanding.filter((entry) => entry !== intent);
          try {
            persistJournal();
          } catch (error) {
            // A committed immutable intent can be replayed safely if removal
            // fails. This is not a failed database transaction.
            options.onError(error);
          }
        }
        if (outstanding.length === 0 && pending.size === 0) options.onCommitted?.();
      });
      tail = run.catch(report);
      return run;
    },
    async clearEnvironment(environment: string) {
      await tail;
      const epoch = view.environments[environment] ?? 0;
      const committed = await options.backend.transact((current) => {
        if ((current.environments[environment] ?? 0) !== epoch) {
          throw new ComposerPersistenceConflict(environment);
        }
        const records = { ...current.records };
        for (const [key, record] of Object.entries(records)) {
          if (record.environment === environment) {
            records[key] = {
              ...record,
              revision: record.revision + 1,
              operation: `${writer}/clear/${epoch + 1}`,
              value: null,
            };
          }
        }
        return {
          ...current,
          records,
          environments: { ...current.environments, [environment]: epoch + 1 },
        };
      });
      const records = { ...view.records };
      for (const [key, record] of Object.entries(committed.records)) {
        if (record.environment === environment) records[key] = record;
      }
      view = {
        ...view,
        records,
        environments: { ...view.environments, [environment]: epoch + 1 },
      };
      pending = new Map([...pending].filter(([, change]) => change.environment !== environment));
      if (pending.size === 0) pendingGeneration = undefined;
      // Existing immutable journal entries keep their original epoch and fail
      // rather than gaining authority over the deleted environment.
    },
    async clear() {
      await tail;
      const committed = await options.backend.transact((current) => ({
        ...emptyDatabase(),
        imported: true,
        legacy: current.legacy,
        generation: current.generation + 1,
      }));
      view = committed;
      pending.clear();
      pendingGeneration = undefined;
      outstanding = [];
      sequence = 0;
      failure = undefined;
      persistJournal();
    },
  };
}
