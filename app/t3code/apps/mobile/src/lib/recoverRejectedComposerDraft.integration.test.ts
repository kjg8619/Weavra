import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

const native = vi.hoisted(() => ({
  root: "",
  assets: new Map<string, Uint8Array>(),
  requested: [] as string[],
  failAfterRename: false,
  failRead: false,
  downloadGate: new (class {
    entered: (() => void) | null = null;
    released: Promise<void> | null = null;
  })(),
}));

// Real host files, copies and atomic rename; substitute only Expo and authenticated RPC.
// This exercises the composed native helpers, not native-device implementation semantics.
vi.mock("expo-file-system", () => {
  function pathOf(value: string | { uri: string }) {
    const uri = typeof value === "string" ? value : value.uri;
    return uri.startsWith("file:") ? NodeURL.fileURLToPath(uri) : uri;
  }
  class Directory {
    readonly path: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.path = name ? NodePath.join(pathOf(parent), name) : pathOf(parent);
    }
    get uri() {
      return NodeURL.pathToFileURL(this.path).href;
    }
    get name() {
      return NodePath.basename(this.path);
    }
    get exists() {
      return NodeFS.existsSync(this.path);
    }
    create(options?: { idempotent?: boolean; intermediates?: boolean }) {
      NodeFS.mkdirSync(this.path, { recursive: options?.idempotent || options?.intermediates });
    }
    list() {
      return NodeFS.readdirSync(this.path, { withFileTypes: true }).map((entry) =>
        entry.isDirectory() ? new Directory(this, entry.name) : new File(this, entry.name),
      );
    }
    delete() {
      NodeFS.rmSync(this.path, { recursive: true });
    }
  }
  class File {
    readonly path: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.path = name ? NodePath.join(pathOf(parent), name) : pathOf(parent);
    }
    get uri() {
      return NodeURL.pathToFileURL(this.path).href;
    }
    get name() {
      return NodePath.basename(this.path);
    }
    get parentDirectory() {
      return new Directory(NodePath.dirname(this.path));
    }
    get exists() {
      return NodeFS.existsSync(this.path);
    }
    get size() {
      return NodeFS.statSync(this.path).size;
    }
    create() {
      NodeFS.writeFileSync(this.path, "");
    }
    write(value: string) {
      NodeFS.writeFileSync(this.path, value);
    }
    async text() {
      if (native.failRead) throw new Error("read unavailable");
      return NodeFS.readFileSync(this.path, "utf8");
    }
    async copy(destination: File) {
      NodeFS.copyFileSync(this.path, destination.path);
    }
    delete() {
      NodeFS.unlinkSync(this.path);
    }
    moveSync(destination: File) {
      NodeFS.renameSync(this.path, destination.path);
      if (destination.name === "drafts.json" && native.failAfterRename) {
        native.failAfterRename = false;
        throw new Error("native completion unknown after rename");
      }
    }
    static async downloadFileAsync(
      url: string,
      destination: File,
      options: { signal: AbortSignal },
    ) {
      options.signal.throwIfAborted();
      if (native.downloadGate.released) {
        native.downloadGate.entered?.();
        await native.downloadGate.released;
      }
      const id = new URL(url).pathname.split("/").at(-1) ?? "";
      const bytes = native.assets.get(id);
      if (!bytes) throw new Error("asset unavailable");
      native.requested.push(id);
      NodeFS.writeFileSync(destination.path, bytes);
      return destination;
    }
  }
  return {
    Directory,
    File,
    FileMode: { ReadOnly: "r", WriteOnly: "w" },
    Paths: {
      get document() {
        return { uri: NodeURL.pathToFileURL(NodePath.join(native.root, "documents")).href };
      },
      get cache() {
        return { uri: NodeURL.pathToFileURL(NodePath.join(native.root, "cache")).href };
      },
    },
  };
});
vi.mock("./uuid", () => ({
  uuidv4: () => NodeCrypto.randomUUID(),
  randomHex: () => "0000",
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    NodeCrypto.createHash("sha256").update(value).digest("hex"),
}));
vi.mock("../state/assets", () => ({
  assetEnvironment: { createUrl: (query: unknown) => query },
}));
vi.mock("../state/attachments", () => ({ attachmentEnvironment: {} }));
vi.mock("../state/session", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const connection = Atom.make({ _tag: "Some", value: { httpBaseUrl: "https://source.example" } });
  return { environmentSession: { preparedConnectionValueAtom: () => connection } };
});
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentRpcCommand: () => Symbol("unused"),
  executeAtomQuery: async (
    _registry: unknown,
    query: { input: { resource: { attachmentId: string } } },
  ) => ({
    _tag: "Success",
    value: { relativeUrl: `/assets/${query.input.resource.attachmentId}` },
  }),
  squashAtomCommandFailure: () => new Error("authorization failed"),
  runAtomCommand: () => {
    throw new Error("Recovery must not dispatch");
  },
}));
vi.mock("../features/sharing/incoming-share-storage", () => ({
  loadIncomingShareDrafts: async () => [],
}));

import { recoverRejectedComposerDraft } from "./recoverRejectedComposerDraft";
import {
  composerDraftsAtom,
  composerCloudDraftsAtom,
  stickyComposerModelSelectionAtom,
  resetComposerDraftsLoadState,
  waitForComposerDraftsLoaded,
  getComposerDraftSnapshot,
  setComposerDraftText,
  flushComposerDrafts,
  clearComposerDraftContent,
} from "../state/use-composer-drafts";
import { appAtomRegistry } from "../state/atom-registry";
import { isComposerAttachmentFileRetained } from "./composerAttachmentFiles";
import {
  checkRejectedComposerOperation,
  createRejectedComposerGeneration,
  recoverRejectedComposer,
  rejectedComposerOperationsAtom,
  sendRejectedComposer,
} from "../state/rejected-composer-operations";
import { threadOutboxManager } from "../state/thread-outbox";

const scope = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const messageId = MessageId.make("source-message");
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOG0AAAAASUVORK5CYII=",
    "base64",
  ),
);
const text = new TextEncoder().encode("original text\n");
const image = {
  id: "image",
  type: "image" as const,
  name: "capture.png",
  mimeType: "image/png",
  sizeBytes: png.length,
};
const file = {
  id: "file",
  type: "file" as const,
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: text.length,
};
const message: OrchestrationMessage = {
  id: messageId,
  role: "user",
  text: "  /original\n",
  attachments: [image, file],
  turnId: null,
  streaming: false,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
const activity: OrchestrationThreadActivity = {
  id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, messageId).activityId,
  kind: "provider.turn.start.failed",
  tone: "error",
  summary: "denied",
  turnId: null,
  sequence: 2,
  createdAt: message.createdAt,
  payload: {
    version: 1,
    source: "workspace-ownership",
    requestId: messageId,
    reason: "target-changed",
    originCommandId: CommandId.make("origin"),
    originSequence: 1,
  },
};
const input = () => ({
  scope,
  messageId,
  readSource: () => ({ scope, synchronized: true, messages: [message], activities: [activity] }),
  signal: new AbortController().signal,
  isCurrent: () => true,
});
const draftPath = () => NodePath.join(native.root, "documents/composer-drafts/drafts.json");

beforeEach(async () => {
  native.root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavra-recovery-"));
  native.assets = new Map([
    ["image", png],
    ["file", text],
  ]);
  native.requested = [];
  native.failAfterRename = false;
  native.failRead = false;
  native.downloadGate.entered = null;
  native.downloadGate.released = null;
  resetComposerDraftsLoadState();
  appAtomRegistry.set(composerDraftsAtom, {});
  appAtomRegistry.set(composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  appAtomRegistry.set(stickyComposerModelSelectionAtom, null);
  await waitForComposerDraftsLoaded();
});
afterEach(() => {
  resetComposerDraftsLoadState();
  NodeFS.rmSync(native.root, { recursive: true, force: true });
});

describe("mixed-attachment recovery on host filesystem", () => {
  it("guards duplicate recovery across unmount while an original download is outstanding", async () => {
    const generation = createRejectedComposerGeneration();
    const owner = () => ({ ...input(), ...generation.capture(), key: native.root });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    native.downloadGate.entered = () => entered.resolve();
    native.downloadGate.released = release.promise;
    const recovering = recoverRejectedComposer(owner(), messageId);
    await entered.promise;
    generation.invalidate();
    expect(await recoverRejectedComposer(owner(), messageId)).toBe(false);
    expect(native.requested).toEqual([]);
    release.resolve();
    expect(await recovering).toBe(false);
    expect(getComposerDraftSnapshot("environment:thread").rejectedTurn).toBeUndefined();
    const requests = [...native.requested];
    expect(requests).toEqual(["image"]);
    native.downloadGate.released = null;
    expect(await recoverRejectedComposer(owner(), messageId)).toBe(true);
    expect(native.requested).toEqual(["image", "image", "file"]);
  });

  it("leaves a marked edit-clear intact when explicit missing-byte reacquisition fails", async () => {
    await recoverRejectedComposerDraft(input());
    clearComposerDraftContent("environment:thread", { deferAttachmentCleanup: true });
    setComposerDraftText("environment:thread", "  changed exact text\n");
    await flushComposerDrafts();
    const expected = getComposerDraftSnapshot("environment:thread");
    const records = threadOutboxManager.authority.knownRecords().length;
    native.assets.delete("file");
    expect(
      await sendRejectedComposer({ owner: { ...input(), key: native.root }, settings: {} }),
    ).toBeNull();
    expect(getComposerDraftSnapshot("environment:thread")).toEqual(expected);
    expect(threadOutboxManager.authority.knownRecords()).toHaveLength(records);
  });

  it("keeps uncertain recovery leases across route ABA until an explicit verified release", async () => {
    const generation = createRejectedComposerGeneration();
    const ownerKey = native.root;
    const owner = () => ({ ...input(), ...generation.capture(), key: ownerKey });
    native.failAfterRename = true;
    expect(await recoverRejectedComposer(owner(), messageId)).toBe(false);
    const saved = JSON.parse(NodeFS.readFileSync(draftPath(), "utf8")).drafts["environment:thread"];
    const uris: string[] = saved.attachments.map(
      (attachment: { fileUri: string }) => attachment.fileUri,
    );
    generation.invalidate();
    generation.invalidate();
    native.failRead = true;
    await checkRejectedComposerOperation(owner());
    expect(appAtomRegistry.get(rejectedComposerOperationsAtom)[ownerKey]?.needsCheck).toBe(true);
    for (const uri of uris) expect(isComposerAttachmentFileRetained(uri)).toBe(true);
    native.failRead = false;
    await checkRejectedComposerOperation(owner());
    expect(appAtomRegistry.get(rejectedComposerOperationsAtom)[ownerKey]?.status).toBe(
      "recovery-referenced",
    );
    for (const uri of uris) expect(isComposerAttachmentFileRetained(uri)).toBe(true);
    setComposerDraftText("environment:thread", "new work");
    await flushComposerDrafts();
    await checkRejectedComposerOperation(owner());
    await checkRejectedComposerOperation(owner());
    expect(appAtomRegistry.get(rejectedComposerOperationsAtom)[ownerKey]?.needsCheck).toBe(false);
    for (const uri of uris) expect(isComposerAttachmentFileRetained(uri)).toBe(false);
    expect(native.requested).toEqual(["image", "file"]);
    expect(getComposerDraftSnapshot("environment:thread").text).toBe("new work");
  });

  it("reacquires missing mixed source files only on explicit Send and commits canonical bindings", async () => {
    await recoverRejectedComposerDraft(input());
    clearComposerDraftContent("environment:thread", { deferAttachmentCleanup: true });
    setComposerDraftText("environment:thread", "  /usage-limits\n");
    await flushComposerDrafts();
    expect(native.requested).toEqual(["image", "file"]);
    const marker = getComposerDraftSnapshot("environment:thread").rejectedTurn;
    const id = await sendRejectedComposer({
      owner: { ...input(), key: native.root },
      settings: {},
    });
    expect(id).not.toBeNull();
    expect(native.requested).toEqual(["image", "file", "image", "file"]);
    const record = threadOutboxManager.authority
      .knownRecords()
      .find((entry) => entry.transport.messageId === id);
    if (record?.kind !== "message") throw new Error("Expected admitted source files");
    expect(record.message.text).toBe("  /usage-limits\n");
    expect(record.message.attachments.map((attachment) => attachment.id)).toEqual([
      "image",
      "file",
    ]);
    expect(
      record.message.attachments.every(
        (attachment) => attachment.uploadedAttachmentId === undefined,
      ),
    ).toBe(true);
    for (const [index, bytes] of [png, text].entries()) {
      const uri = record.message.attachments[index]?.fileUri;
      if (uri === undefined) throw new Error("Expected original bytes");
      expect(new Uint8Array(NodeFS.readFileSync(NodeURL.fileURLToPath(uri)))).toEqual(bytes);
    }
    expect(marker?.message).toEqual(message);
    expect(getComposerDraftSnapshot("environment:thread").rejectedTurn).toBeUndefined();
  });

  it("preserves original bytes and IDs through real preparation, commit and reload", async () => {
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "recovered" });
    expect(native.requested).toEqual(["image", "file"]);
    const draft = getComposerDraftSnapshot("environment:thread");
    expect(draft.attachments.map((attachment) => attachment.id)).toEqual(["image", "file"]);
    for (const [index, bytes] of [png, text].entries()) {
      const uri = draft.attachments[index]?.fileUri;
      if (!uri) throw new Error("Expected persisted original");
      expect(new Uint8Array(NodeFS.readFileSync(NodeURL.fileURLToPath(uri)))).toEqual(bytes);
      expect(isComposerAttachmentFileRetained(uri)).toBe(false);
    }
    appAtomRegistry.set(composerDraftsAtom, {});
    resetComposerDraftsLoadState();
    await waitForComposerDraftsLoaded();
    expect(getComposerDraftSnapshot("environment:thread")).toEqual(draft);
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "existing" });
    expect(native.requested).toEqual(["image", "file"]);
    expect(NodeFS.readdirSync(NodePath.join(native.root, "cache/t3-attachment-downloads"))).toEqual(
      [],
    );
  });

  it("keeps files after uncertain rename until later disk ownership is provably absent", async () => {
    native.failAfterRename = true;
    const result = await recoverRejectedComposerDraft(input());
    if (result.status !== "uncertain") throw new Error("Expected uncertain result");
    const saved = JSON.parse(NodeFS.readFileSync(draftPath(), "utf8")).drafts["environment:thread"];
    const uris: string[] = saved.attachments.map(
      (attachment: { fileUri: string }) => attachment.fileUri,
    );
    expect(getComposerDraftSnapshot("environment:thread").text).toBe("");
    expect(await result.reconcile()).toBe("referenced");
    for (const uri of uris) {
      expect(NodeFS.existsSync(NodeURL.fileURLToPath(uri))).toBe(true);
      expect(isComposerAttachmentFileRetained(uri)).toBe(true);
    }
    setComposerDraftText("environment:thread", "newer user work");
    await flushComposerDrafts();
    expect(await result.reconcile()).toBe("released");
    for (const uri of uris) {
      expect(isComposerAttachmentFileRetained(uri)).toBe(false);
      expect(NodeFS.existsSync(NodeURL.fileURLToPath(uri))).toBe(false);
    }
    expect(getComposerDraftSnapshot("environment:thread").text).toBe("newer user work");
    expect(native.requested).toEqual(["image", "file"]);
  });
});
