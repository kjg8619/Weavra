import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import * as persistence from "./lib/composerPersistence";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("./lib/composerPersistence");
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it.each([
  ["a", "b"],
  ["b", "a"],
])(
  "keeps disjoint sessions, mappings and sticky records in %s then %s order",
  async (first, second) => {
    const backend = persistence.createMemoryComposerBackend();
    vi.doMock("./lib/composerPersistence", () => ({
      ...persistence,
      createComposerBackend: () => backend,
    }));
    vi.resetModules();
    const a = await import("./composerDraftStore");
    await a.useComposerDraftStore.persist.rehydrate();
    vi.resetModules();
    const b = await import("./composerDraftStore");
    await b.useComposerDraftStore.persist.rehydrate();
    const environment = EnvironmentId.make("metadata");
    for (const [module, name] of [
      [a, first],
      [b, second],
    ] as const) {
      const id = module.DraftId.make(`draft-${name}`);
      const provider = ProviderInstanceId.make(name);
      module.useComposerDraftStore
        .getState()
        .setLogicalProjectDraftThreadId(
          `logical-${name}`,
          scopeProjectRef(environment, ProjectId.make(`project-${name}`)),
          id,
        );
      module.useComposerDraftStore.getState().setPrompt(id, `input-${name}`);
      module.useComposerDraftStore.setState({
        stickyModelSelectionByProvider: {
          [provider]: { instanceId: provider, model: `model-${name}` },
        },
      });
    }
    await Promise.all([a.flushComposerDrafts(), b.flushComposerDrafts()]);
    vi.resetModules();
    const restart = await import("./composerDraftStore");
    await restart.useComposerDraftStore.persist.rehydrate();
    const state = restart.useComposerDraftStore.getState();
    for (const name of ["a", "b"]) {
      expect(state.draftsByThreadKey[`draft-${name}`]?.prompt).toBe(`input-${name}`);
      expect(state.draftThreadsByThreadKey[`draft-${name}`]?.projectId).toBe(`project-${name}`);
      expect(state.logicalProjectDraftThreadKeyByLogicalProjectKey[`logical-${name}`]).toBe(
        `draft-${name}`,
      );
      expect(state.stickyModelSelectionByProvider[ProviderInstanceId.make(name)]?.model).toBe(
        `model-${name}`,
      );
    }
  },
);

it("retains recovered content when an independent stale tab edits a disjoint draft", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
  const backend = persistence.createMemoryComposerBackend();
  vi.doMock("./lib/composerPersistence", () => ({
    ...persistence,
    createComposerBackend: () => backend,
  }));
  vi.resetModules();
  const a = await import("./composerDraftStore");
  await a.useComposerDraftStore.persist.rehydrate();
  vi.resetModules();
  const b = await import("./composerDraftStore");
  await b.useComposerDraftStore.persist.rehydrate();
  vi.useFakeTimers();
  const environmentId = EnvironmentId.make("cross-tab");
  const recoveredScope = scopeThreadRef(environmentId, ThreadId.make("recovered"));
  const siblingScope = scopeThreadRef(environmentId, ThreadId.make("sibling"));
  const messageId = MessageId.make("refused");
  await a.commitRejectedTurnDraft(recoveredScope, null, {
    ...recoveredScope,
    messageId,
    key: a.rejectedTurnRecoveryKey(recoveredScope, messageId),
    text: "Preserve this recovered request exactly.",
    attachments: [],
  });
  b.useComposerDraftStore.getState().setPrompt(siblingScope, "Unrelated edit in stale tab.");
  await vi.advanceTimersByTimeAsync(300);
  const stored = await b.useComposerDraftStore.persist
    .getOptions()
    .storage?.getItem(b.COMPOSER_DRAFT_STORAGE_KEY);
  expect(stored).toMatchObject({
    state: {
      draftsByThreadKey: {
        [scopedThreadKey(recoveredScope)]: {
          prompt: "Preserve this recovered request exactly.",
          rejectedTurn: { messageId },
        },
        [scopedThreadKey(siblingScope)]: { prompt: "Unrelated edit in stale tab." },
      },
    },
  });
});

it("retains local edits made during the recovery transaction without overwriting publication", async () => {
  const backend = persistence.createMemoryComposerBackend();
  const entered = deferred();
  const release = deferred();
  let hold = false;
  vi.doMock("./lib/composerPersistence", () => ({
    ...persistence,
    createComposerBackend: () => ({
      async transact(update: Parameters<typeof backend.transact>[0]) {
        if (hold) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
        return backend.transact(update);
      },
    }),
  }));
  vi.resetModules();
  const store = await import("./composerDraftStore");
  await store.useComposerDraftStore.persist.rehydrate();
  const scope = scopeThreadRef(EnvironmentId.make("transaction"), ThreadId.make("draft"));
  const messageId = MessageId.make("refused");
  hold = true;
  const recovered = store.commitRejectedTurnDraft(scope, null, {
    ...scope,
    messageId,
    key: store.rejectedTurnRecoveryKey(scope, messageId),
    text: "Original source",
    attachments: [],
  });
  await entered.promise;
  store.useComposerDraftStore.getState().setPrompt(scope, "Local edit during recovery");
  release.resolve();
  expect(await recovered).toBe("changed");
  await expect(store.flushComposerDrafts()).rejects.toBeInstanceOf(
    persistence.ComposerPersistenceConflict,
  );
  expect(store.useComposerDraftStore.getState().getComposerDraft(scope)?.prompt).toBe(
    "Local edit during recovery",
  );
  expect(
    store.useComposerDraftStore.getState().getComposerDraft(scope)?.rejectedTurn,
  ).toBeUndefined();
  expect(store.useComposerPersistenceStatus.getState().error).not.toBeNull();
});

it("imports a valid near-quota v10 snapshot once and saves an ordinary edit", async () => {
  const backend = persistence.createMemoryComposerBackend();
  const key = "t3code:composer-drafts:v1";
  const environmentId = EnvironmentId.make("legacy-quota");
  const scope = scopeThreadRef(environmentId, ThreadId.make("large"));
  const original = JSON.stringify({
    version: 10,
    state: {
      draftsByThreadKey: {
        [scopedThreadKey(scope)]: { prompt: "x".repeat(9_000), attachments: [] },
      },
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    },
  });
  const values = new Map([[key, original]]);
  const quota = original.length + 64;
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null,
    removeItem: (name: string) => {
      values.delete(name);
    },
    setItem: (name: string, value: string) => {
      const size = [...values].reduce(
        (sum, [entry, content]) => sum + (entry === name ? 0 : content.length),
        value.length,
      );
      if (size > quota) throw new DOMException("quota", "QuotaExceededError");
      values.set(name, value);
    },
  });
  vi.doMock("./lib/composerPersistence", () => ({
    ...persistence,
    createComposerBackend: () => backend,
  }));
  vi.resetModules();
  const store = await import("./composerDraftStore");
  await store.useComposerDraftStore.persist.rehydrate();
  expect(values.has(key)).toBe(false);
  expect((await backend.transact((state) => state)).legacy).toBe(original);
  store.useComposerDraftStore.getState().setPrompt(scope, `${"x".repeat(9_000)} small edit`);
  await store.flushComposerDrafts();
  vi.resetModules();
  const restart = await import("./composerDraftStore");
  await restart.useComposerDraftStore.persist.rehydrate();
  expect(restart.useComposerDraftStore.getState().getComposerDraft(scope)?.prompt).toBe(
    `${"x".repeat(9_000)} small edit`,
  );
});

it("commits an unrelated edit made while recovery flushes an earlier ordinary draft", async () => {
  const backend = persistence.createMemoryComposerBackend();
  const entered = deferred();
  const release = deferred();
  let hold = false;
  vi.doMock("./lib/composerPersistence", () => ({
    ...persistence,
    createComposerBackend: () => ({
      async transact(update: Parameters<typeof backend.transact>[0]) {
        if (hold) {
          hold = false;
          entered.resolve();
          await release.promise;
        }
        return backend.transact(update);
      },
    }),
  }));
  vi.resetModules();
  const store = await import("./composerDraftStore");
  await store.useComposerDraftStore.persist.rehydrate();
  const environment = EnvironmentId.make("preflush");
  const sibling = scopeThreadRef(environment, ThreadId.make("sibling"));
  const scope = scopeThreadRef(environment, ThreadId.make("recovered"));
  store.useComposerDraftStore.getState().setPrompt(sibling, "Before");
  const messageId = MessageId.make("refused");
  hold = true;
  const recovered = store.commitRejectedTurnDraft(scope, null, {
    ...scope,
    messageId,
    key: store.rejectedTurnRecoveryKey(scope, messageId),
    text: "Original source",
    attachments: [],
  });
  await entered.promise;
  store.useComposerDraftStore.getState().setPrompt(sibling, "Edited during preflush");
  release.resolve();
  expect(await recovered).toBe("recovered");
  const committed = await backend.transact((current) => current);
  expect(committed.records[`draftsByThreadKey/${scopedThreadKey(sibling)}`]?.value).toMatchObject({
    prompt: "Edited during preflush",
  });
});
