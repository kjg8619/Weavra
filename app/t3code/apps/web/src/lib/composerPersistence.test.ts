import { describe, expect, it, vi } from "vite-plus/test";
import {
  ComposerPersistenceConflict,
  createComposerAuthority,
  createMemoryComposerBackend,
  type ComposerBackend,
  type ComposerJournalStorage,
} from "./composerPersistence";

function journal(): ComposerJournalStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
function client(backend: ComposerBackend, storage = journal()) {
  const onError = vi.fn();
  const authority = createComposerAuthority({
    backend,
    journal: storage,
    importLegacy: () => ({}),
    onError,
  });
  return { ...authority, onError };
}
const values = (key: string, value: unknown, environment = "environment") => ({
  [key]: { environment, value },
});
function stage(authority: ReturnType<typeof client>, key: string, environment = "environment") {
  authority.capture(key, environment);
}
function barrier() {
  const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>((complete) => {
      resolve = complete;
    });
    return { promise, resolve };
  };
  const entered = deferred();
  const release = deferred();
  return { entered, release };
}

describe("transactional composer authority", () => {
  it("keeps revisions for untouched hydrated records while another draft is edited", async () => {
    const backend = createMemoryComposerBackend();
    const seeded = client(backend);
    await seeded.hydrate();
    stage(seeded, "a");
    await seeded.flush(values("a", "stored a"));
    const gate = barrier();
    let hold = true;
    const fresh = client({
      async transact(update) {
        const result = await backend.transact(update);
        if (hold) {
          hold = false;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return result;
      },
    });
    const hydration = fresh.hydrate();
    await gate.entered.promise;
    stage(fresh, "b");
    gate.release.resolve();
    expect((await hydration).records.a?.value).toBe("stored a");
    await fresh.flush(values("b", "typed during hydration"));
    stage(fresh, "a");
    await fresh.flush(values("a", "edited after hydration"));
    const stored = await client(backend).hydrate();
    expect(stored.records.a?.value).toBe("edited after hydration");
    expect(stored.records.b?.value).toBe("typed during hydration");
  });

  it("does not rebase a pre-hydration edit across a global clear", async () => {
    const backend = createMemoryComposerBackend();
    const seeded = client(backend);
    await seeded.hydrate();
    await seeded.clear();
    const gate = barrier();
    let hold = true;
    const fresh = client({
      async transact(update) {
        const result = await backend.transact(update);
        if (hold) {
          hold = false;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return result;
      },
    });
    const hydration = fresh.hydrate();
    await gate.entered.promise;
    stage(fresh, "b");
    gate.release.resolve();
    await hydration;
    await expect(fresh.flush(values("b", "unobserved generation"))).rejects.toBeInstanceOf(
      ComposerPersistenceConflict,
    );
    expect((await client(backend).hydrate()).records.b).toBeUndefined();
  });

  it("works without secure-context randomUUID or Web Locks", async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    vi.stubGlobal("navigator", {});
    try {
      const a = client(createMemoryComposerBackend());
      await a.hydrate();
      stage(a, "draft");
      await a.flush(values("draft", "direct HTTP"));
      expect(a.snapshot().records.draft?.value).toBe("direct HTTP");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["a", "b"],
    ["b", "a"],
  ])("preserves concurrent disjoint records in %s then %s order", async (first, second) => {
    const backend = createMemoryComposerBackend();
    const a = client(backend);
    const b = client(backend);
    await Promise.all([a.hydrate(), b.hydrate()]);
    stage(a, first);
    stage(b, second);
    await Promise.all([a.flush(values(first, first)), b.flush(values(second, second))]);
    const restart = client(backend);
    const recovered = await restart.hydrate();
    expect(recovered.records[first]?.value).toBe(first);
    expect(recovered.records[second]?.value).toBe(second);
  });

  it("rejects same-slot contention and retains the losing journal", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    const a = client(backend);
    const b = client(backend, storage);
    await Promise.all([a.hydrate(), b.hydrate()]);
    stage(a, "draft");
    stage(b, "draft");
    await a.flush(values("draft", "winner"));
    await expect(b.flush(values("draft", "retained loser"))).rejects.toBeInstanceOf(
      ComposerPersistenceConflict,
    );
    expect(storage.length).toBe(1);
    expect(storage.getItem(storage.key(0) ?? "")).toContain("retained loser");
    expect(b.onError).toHaveBeenCalledOnce();
    expect((await client(backend).hydrate()).records.draft?.value).toBe("winner");
  });

  it.each(["discard", "accepted-send", "thread-removal"])(
    "fences a delayed writer after %s and an ABA recreation",
    async () => {
      const backend = createMemoryComposerBackend();
      const a = client(backend);
      await a.hydrate();
      stage(a, "draft");
      await a.flush(values("draft", "old"));
      const stale = client(backend);
      await stale.hydrate();
      stage(stale, "draft");
      stage(a, "draft");
      await a.flush(values("draft", null));
      stage(a, "draft");
      await a.flush(values("draft", "replacement"));
      await expect(stale.flush(values("draft", "late"))).rejects.toBeInstanceOf(
        ComposerPersistenceConflict,
      );
      expect((await client(backend).hydrate()).records.draft).toMatchObject({
        revision: 3,
        value: "replacement",
      });
    },
  );

  it("fences unseen slots and pending shutdown journals on environment removal", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    const stale = client(backend, storage);
    const remover = client(backend);
    await Promise.all([stale.hydrate(), remover.hydrate()]);
    stage(stale, "never-committed");
    stale.checkpoint(values("never-committed", "pending"));
    await remover.clearEnvironment("environment");
    const restart = client(backend, storage);
    const state = await restart.hydrate();
    expect(state.records["never-committed"]).toBeUndefined();
    expect(restart.onError).toHaveBeenCalledOnce();
    expect(storage.length).toBe(1);
    await expect(stale.flush({})).rejects.toBeInstanceOf(ComposerPersistenceConflict);
  });

  it("replays shutdown input once and never reimports legacy records after deletion", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    const importLegacy = vi.fn(() => values("legacy", "old"));
    const a = createComposerAuthority({
      backend,
      journal: storage,
      importLegacy,
      onError: vi.fn(),
    });
    await a.hydrate();
    a.capture("draft", "environment");
    a.checkpoint(values("draft", { prompt: "recovered", marker: "source" }));
    const b = client(backend, storage);
    expect((await b.hydrate()).records.draft?.value).toEqual({
      prompt: "recovered",
      marker: "source",
    });
    // The original writer can safely finish after another tab recovered its journal.
    await a.flush({});
    stage(b, "legacy");
    await b.flush(values("legacy", null));
    const c = createComposerAuthority({
      backend,
      journal: storage,
      importLegacy,
      onError: vi.fn(),
    });
    const restored = await c.hydrate();
    expect(restored.records.legacy?.value).toBeNull();
    expect(restored.records.draft?.revision).toBe(1);
    expect(importLegacy).toHaveBeenCalledTimes(1);
  });

  it("acknowledges only commit completion and keeps next edits on their own generation", async () => {
    const backend = createMemoryComposerBackend();
    const gate = barrier();
    let hold = false;
    const guarded: ComposerBackend = {
      async transact(update) {
        if (hold) {
          hold = false;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return backend.transact(update);
      },
    };
    const a = client(guarded);
    await a.hydrate();
    stage(a, "draft");
    hold = true;
    let acknowledged = false;
    const first = a.flush(values("draft", "first")).then(() => {
      acknowledged = true;
    });
    await gate.entered.promise;
    expect(acknowledged).toBe(false);
    stage(a, "draft");
    const next = a.flush(values("draft", "typed during commit"));
    gate.release.resolve();
    await Promise.all([first, next]);
    expect((await client(backend).hydrate()).records.draft).toMatchObject({
      revision: 2,
      value: "typed during commit",
    });
  });

  it.each(["AbortError", "QuotaExceededError"])(
    "retains all input on atomic %s without publishing partial records",
    async (name) => {
      const backend = createMemoryComposerBackend();
      let abort = false;
      const guarded: ComposerBackend = {
        transact: (update) =>
          backend.transact((current) => {
            const next = update(current);
            if (abort) throw new DOMException("forced failure", name);
            return next;
          }),
      };
      const storage = journal();
      const a = client(guarded, storage);
      await a.hydrate();
      stage(a, "content");
      stage(a, "marker");
      abort = true;
      await expect(
        a.flush({ ...values("content", "input"), ...values("marker", "source") }),
      ).rejects.toMatchObject({ name });
      expect((await client(backend).hydrate()).records).toEqual({});
      expect(storage.getItem(storage.key(0) ?? "")).toContain("input");
      expect(a.snapshot().records).toEqual({});
    },
  );

  it("does not promote a failed journal to newer authority on restart", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    const a = client(backend, storage);
    const b = client(backend);
    await Promise.all([a.hydrate(), b.hydrate()]);
    stage(a, "draft");
    a.checkpoint(values("draft", "stale"));
    stage(b, "draft");
    await b.flush(values("draft", "newer"));
    const restart = client(backend, storage);
    expect((await restart.hydrate()).records.draft?.value).toBe("newer");
    expect(restart.onError).toHaveBeenCalledOnce();
    expect(storage.length).toBe(1);
  });

  it("does not lend a newer writer revision to an already committed journal replay", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    const stale = client(backend, storage);
    await stale.hydrate();
    stage(stale, "draft");
    stale.checkpoint(values("draft", "first"));
    const newer = client(backend, storage);
    await newer.hydrate();
    stage(newer, "draft");
    await newer.flush(values("draft", "second"));
    await stale.flush({});
    stage(stale, "draft");
    await expect(stale.flush(values("draft", "stale third"))).rejects.toBeInstanceOf(
      ComposerPersistenceConflict,
    );
    expect((await client(backend).hydrate()).records.draft?.value).toBe("second");
  });

  it("does not give edits during a recovery or deletion commit its new generation", async () => {
    const backend = createMemoryComposerBackend();
    const gate = barrier();
    let hold = false;
    const guarded: ComposerBackend = {
      async transact(update) {
        if (hold) {
          hold = false;
          gate.entered.resolve();
          await gate.release.promise;
        }
        return backend.transact(update);
      },
    };
    const a = client(guarded);
    await a.hydrate();
    a.capture("draft", "environment", false);
    hold = true;
    const recovery = a.flush(values("draft", { content: "recovery", marker: "source" }));
    await gate.entered.promise;
    stage(a, "draft");
    const edited = a.flush(values("draft", "local input"));
    const rejected = expect(edited).rejects.toBeInstanceOf(ComposerPersistenceConflict);
    gate.release.resolve();
    await recovery;
    await rejected;
    expect((await client(backend).hydrate()).records.draft?.value).toEqual({
      content: "recovery",
      marker: "source",
    });
  });

  it("archives a near-quota legacy blob before reclaiming room for a small edit", async () => {
    const backend = createMemoryComposerBackend();
    const base = journal();
    const legacy = JSON.stringify({ version: 10, state: { prompt: "x".repeat(9_800) } });
    base.setItem("legacy", legacy);
    const storage: ComposerJournalStorage = {
      ...base,
      get length() {
        return base.length;
      },
      setItem(key, value) {
        const total = Array.from({ length: base.length }, (_, index) => base.key(index)).reduce(
          (size, current) =>
            size + (current === null || current === key ? 0 : (base.getItem(current)?.length ?? 0)),
          value.length,
        );
        if (total > 10_000) throw new DOMException("quota", "QuotaExceededError");
        base.setItem(key, value);
      },
    };
    const a = createComposerAuthority({
      backend,
      journal: storage,
      readLegacy: () => storage.getItem("legacy"),
      importLegacy: () => values("legacy-draft", "x".repeat(9_800)),
      releaseLegacy: (archived) => {
        if (storage.getItem("legacy") === archived) storage.removeItem("legacy");
      },
      onError: vi.fn(),
    });
    expect((await a.hydrate()).legacy).toBe(legacy);
    expect(storage.getItem("legacy")).toBeNull();
    a.capture("small-draft", "environment");
    await a.flush(values("small-draft", "ordinary edit"));
    expect((await client(backend).hydrate()).records["small-draft"]?.value).toBe("ordinary edit");
  });

  it("preserves a changed legacy value without importing it over a tombstone", async () => {
    const backend = createMemoryComposerBackend();
    const storage = journal();
    storage.setItem("legacy", "original");
    let changeAfterCommit = true;
    const wrapped: ComposerBackend = {
      async transact(update) {
        const result = await backend.transact(update);
        if (changeAfterCommit) {
          changeAfterCommit = false;
          storage.setItem("legacy", "later value");
        }
        return result;
      },
    };
    const importer = vi.fn(() => values("draft", "old"));
    const options = {
      backend: wrapped,
      journal: storage,
      importLegacy: importer,
      readLegacy: () => storage.getItem("legacy"),
      releaseLegacy: (archived: string) => {
        if (storage.getItem("legacy") === archived) storage.removeItem("legacy");
      },
      onError: vi.fn(),
    };
    const a = createComposerAuthority(options);
    await a.hydrate();
    expect(storage.getItem("legacy")).toBe("later value");
    a.capture("draft", "environment");
    await a.flush(values("draft", null));
    const restarted = createComposerAuthority(options);
    expect((await restarted.hydrate()).records.draft?.value).toBeNull();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(storage.getItem("legacy")).toBe("later value");
  });
});
