import { vi } from "vite-plus/test";
import type { QueuedThreadMessage } from "../thread-outbox-model";
import type { ThreadOutboxRecord } from "../thread-outbox-record";
import type { createOutboxTestFixture } from "./outbox";

const state: {
  fixture: ReturnType<typeof createOutboxTestFixture> | undefined;
  setConfig: ((config: import("@t3tools/contracts").ServerConfig) => void) | undefined;
} = vi.hoisted(() => ({ fixture: undefined, setConfig: undefined }));
const harness = vi.hoisted(() => ({
  prepare: vi.fn<typeof import("../../lib/attachmentUpload").prepareTurnAttachments>(),
  removeFile: vi.fn(async () => {}),
  connectionError: vi.fn(),
  scopeConnected: true,
  randomHex: vi.fn(() => "abcd1234"),
  uuid: vi.fn(() => "00000000-0000-4000-8000-000000000000"),
  draftFile: new (class {
    document = JSON.stringify({ schemaVersion: 1, drafts: {} });
    error: Error | null = null;
    afterMove: (() => void) | null = null;
    onExists: (() => void) | null = null;
  })(),
}));
export { harness };
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("expo-file-system", () => ({
  Directory: class {
    create() {}
    list() {
      return [];
    }
  },
  File: class {
    get exists() {
      harness.draftFile.onExists?.();
      return true;
    }
    staged = "";
    parentDirectory = null;
    create() {}
    delete() {}
    async text() {
      return harness.draftFile.document;
    }
    write(value: string) {
      if (harness.draftFile.error) throw harness.draftFile.error;
      this.staged = value;
    }
    moveSync() {
      harness.draftFile.document = this.staged;
      harness.draftFile.afterMove?.();
    }
  },
  Paths: { document: "/documents" },
}));
vi.mock("../../lib/composerImages", () => ({
  removePersistedComposerAttachmentFile: harness.removeFile,
  toUploadChatImageAttachments: () => [],
}));
vi.mock("../../lib/uuid", () => ({
  uuidv4: harness.uuid,
  randomHex: harness.randomHex,
}));
vi.mock("../../lib/attachmentUpload", () => ({
  prepareTurnAttachments: harness.prepare,
  releasePendingAttachmentUploads: vi.fn(async () => {}),
}));
vi.mock("../entities", () => ({
  useProjects: () => [],
  useServerConfigs: () => new Map(),
  useThreadShells: () => [],
}));
vi.mock("../server", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const { appAtomRegistry } = await import("../atom-registry");
  const configValueAtom = Atom.family(() =>
    Atom.make<import("@t3tools/contracts").ServerConfig | null>(null).pipe(Atom.keepAlive),
  );
  state.setConfig = (config) =>
    appAtomRegistry.set(configValueAtom(config.environment.environmentId), config);
  return { serverEnvironment: { configValueAtom } };
});
vi.mock("../threads", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    threadEnvironment: {},
    environmentThreadShells: { threadShellsAtom: Atom.make([]) },
    environmentThreads: {},
  };
});
vi.mock("../presentation", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    environmentPresentations: {
      presentationAtom: () =>
        Atom.make({
          entry: { enabled: true },
          connection: { phase: harness.scopeConnected ? "connected" : "offline" },
        }),
    },
  };
});
vi.mock("../session", () => ({ environmentSession: {} }));
vi.mock("../shell", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { environmentShell: { stateValueAtom: Atom.family(() => Atom.make({ status: "live" })) } };
});
vi.mock("../use-atom-command", () => ({
  useAtomCommand: () => {
    throw new Error("Use the production delivery transport seam");
  },
}));
vi.mock("../use-remote-environment-registry", () => ({
  setPendingConnectionError: harness.connectionError,
  useRemoteConnectionStatus: () => ({ connectedEnvironments: [] }),
}));
vi.mock("../thread-outbox", async () => {
  const { createOutboxTestFixture } = await import("./outbox");
  const { appAtomRegistry } = await import("../atom-registry");
  const model = await import("../thread-outbox-model");
  state.fixture = createOutboxTestFixture(appAtomRegistry);
  return {
    ...model,
    get threadOutboxManager() {
      return fixture().manager;
    },
    flushThreadOutbox: () => fixture().manager.flush(),
    threadOutboxContent: content,
    confirmThreadOutboxMessageQueued: (message: QueuedThreadMessage) =>
      fixture().manager.confirmQueued(message),
    enqueueThreadOutboxMessage: (message: QueuedThreadMessage) =>
      fixture().manager.enqueueNew(content(message), null),
    updateThreadOutboxMessage: (message: QueuedThreadMessage, expected: ThreadOutboxRecord) =>
      fixture().edit(message, expected),
  };
});

export function fixture() {
  if (state.fixture === undefined) throw new Error("Fixture not initialized");
  return state.fixture;
}
export function setServerConfig(config: import("@t3tools/contracts").ServerConfig) {
  if (state.setConfig === undefined) throw new Error("Server fixture not initialized");
  state.setConfig(config);
}
export function content(message: QueuedThreadMessage) {
  const { storageIdentity: _slot, delivery: _delivery, ...value } = message;
  return value;
}
