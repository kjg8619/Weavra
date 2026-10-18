import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({
  connection: { httpBaseUrl: "https://source.example" },
  execute: vi.fn(),
  create: vi.fn((input: unknown) => input),
  download: vi.fn(),
  persist: vi.fn(),
  dispose: vi.fn(),
  release: vi.fn(),
  size: 3 as number | null,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    get size() {
      return mocks.size;
    }
  },
}));
vi.mock("../state/atom-registry", () => ({
  appAtomRegistry: { get: () => ({ _tag: "Some", value: mocks.connection }) },
}));
vi.mock("../state/session", () => ({
  environmentSession: { preparedConnectionValueAtom: (id: unknown) => id },
}));
vi.mock("../state/assets", () => ({ assetEnvironment: { createUrl: mocks.create } }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: mocks.execute,
  squashAtomCommandFailure: () => new Error("authorization failed"),
}));
vi.mock("../state/use-composer-drafts", () => ({
  releaseUnusedComposerAttachmentFiles: mocks.release,
}));
vi.mock("./attachmentDownload", () => ({ downloadAttachmentForPreview: mocks.download }));
vi.mock("./composerImages", () => ({ persistComposerAttachmentFile: mocks.persist }));

import { isComposerAttachmentFileRetained } from "./composerAttachmentFiles";
import { prepareRejectedComposerAttachments } from "./rejectedComposerAttachments";

const image = {
  id: "original-image",
  type: "image" as const,
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 3,
  source: {
    kind: "snap-shot" as const,
    capturedAt: "2026-10-04T00:00:00.000Z",
    appName: "Editor",
    windowTitle: "  exact  ",
  },
};
const file = {
  id: "original-file",
  type: "file" as const,
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
  source: { _tag: "pasted-text" as const },
};
const environmentId = EnvironmentId.make("environment");
const input = (signal = new AbortController().signal) => ({
  environmentId,
  attachments: [image, file],
  signal,
  isCurrent: () => true,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection = { httpBaseUrl: "https://source.example" };
  mocks.size = 3;
  mocks.execute.mockResolvedValue({ _tag: "Success", value: { relativeUrl: "/assets/original" } });
  mocks.download.mockResolvedValue({ uri: "file:///cache/original", dispose: mocks.dispose });
  let sequence = 0;
  mocks.persist.mockImplementation(async () => `file:///owned/${++sequence}`);
  mocks.release.mockResolvedValue(undefined);
});

describe("rejected composer attachment preparation", () => {
  it("interrupts a waiting second authorization and releases the first copy on abort", async () => {
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<{ _tag: "Success"; value: { relativeUrl: string } }>();
    let querySignal: AbortSignal | undefined;
    mocks.execute.mockResolvedValueOnce({
      _tag: "Success",
      value: { relativeUrl: "/assets/original" },
    });
    mocks.execute.mockImplementationOnce((_registry, _query, options: { signal?: AbortSignal }) => {
      querySignal = options.signal;
      querySignal?.addEventListener(
        "abort",
        () => {
          completion.resolve({ _tag: "Success", value: { relativeUrl: "/assets/original" } });
        },
        { once: true },
      );
      entered.resolve();
      return completion.promise;
    });
    const pending = prepareRejectedComposerAttachments(input(controller.signal));
    const outcome = pending.then(
      (value) => ({ status: "success" as const, value }),
      (error: unknown) => ({ status: "failure" as const, error }),
    );
    await entered.promise;
    try {
      expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(true);
      expect(querySignal).toBe(controller.signal);
      controller.abort();
      const result = await outcome;
      expect(result).toMatchObject({ status: "failure", error: { reason: "changed" } });
      expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(false);
      expect(mocks.release).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
      completion.resolve({ _tag: "Success", value: { relativeUrl: "/assets/original" } });
      const settled = await outcome;
      if (settled.status === "success") await settled.value.release();
    }
  });

  it("keeps the selected environment when the caller mutates its input during preparation", async () => {
    const request = input();
    const pending = prepareRejectedComposerAttachments(request);
    request.environmentId = EnvironmentId.make("foreign");
    const prepared = await pending;
    onTestFinished(prepared.release);

    expect(mocks.create.mock.calls.map(([value]) => value)).toEqual(
      [image, file].map((attachment) => ({
        environmentId,
        input: {
          resource: { _tag: "attachment", attachmentId: attachment.id, fileName: attachment.name },
        },
      })),
    );
  });

  it("reauthorizes original assets and retains exact IDs and metadata until release", async () => {
    const prepared = await prepareRejectedComposerAttachments(input());
    onTestFinished(prepared.release);
    expect(prepared.attachments).toEqual([
      { ...image, fileUri: "file:///owned/1", previewUri: "file:///owned/1" },
      { ...file, fileUri: "file:///owned/2" },
    ]);
    expect(mocks.create.mock.calls.map(([request]) => request)).toEqual(
      [image, file].map((attachment) => ({
        environmentId,
        input: {
          resource: { _tag: "attachment", attachmentId: attachment.id, fileName: attachment.name },
        },
      })),
    );
    expect(mocks.execute.mock.calls.every((call) => call[2].refresh === true)).toBe(true);
    expect(mocks.persist.mock.calls.map((call) => call.slice(1))).toEqual([
      ["shot.png", 3],
      ["notes.txt", 3],
    ]);
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
    expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(true);
    expect(mocks.release).not.toHaveBeenCalled();

    await prepared.release();
    await prepared.release();

    expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(false);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(prepared.attachments);
  });

  it.each([null, 2, 4])("rejects persisted size %s and releases copies and cache", async (size) => {
    mocks.size = size;
    await expect(prepareRejectedComposerAttachments(input())).rejects.toMatchObject({
      reason: "size",
    });
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(false);
  });

  it.each(["authorization", "download", "copy"] as const)(
    "cancels at %s without retaining partial recovery",
    async (stage) => {
      const controller = new AbortController();
      if (stage === "authorization") {
        mocks.execute.mockImplementationOnce(async () => {
          controller.abort();
          return { _tag: "Success", value: { relativeUrl: "/assets/original" } };
        });
      } else if (stage === "download") {
        mocks.download.mockImplementationOnce(async () => {
          controller.abort();
          return { uri: "file:///cache/original", dispose: mocks.dispose };
        });
      } else {
        mocks.persist.mockImplementationOnce(async () => {
          controller.abort();
          return "file:///owned/1";
        });
      }
      await expect(
        prepareRejectedComposerAttachments(input(controller.signal)),
      ).rejects.toMatchObject({ reason: "changed" });
      expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(false);
      expect(mocks.dispose).toHaveBeenCalledTimes(stage === "authorization" ? 0 : 1);
      expect(mocks.release).toHaveBeenCalledTimes(stage === "copy" ? 1 : 0);
    },
  );

  it("rejects a replaced connection before using its returned asset URL", async () => {
    mocks.execute.mockImplementationOnce(async () => {
      mocks.connection = { httpBaseUrl: "https://source.example" };
      return { _tag: "Success", value: { relativeUrl: "/assets/original" } };
    });
    await expect(prepareRejectedComposerAttachments(input())).rejects.toMatchObject({
      reason: "changed",
    });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("rejects a foreign-origin asset URL before download", async () => {
    mocks.execute.mockResolvedValue({
      _tag: "Success",
      value: { relativeUrl: "https://foreign.example/asset" },
    });
    await expect(prepareRejectedComposerAttachments(input())).rejects.toMatchObject({
      reason: "url",
    });
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("does not authorize another attachment after the connection changes between copies", async () => {
    mocks.dispose.mockImplementationOnce(() => {
      mocks.connection = { httpBaseUrl: "https://source.example" };
    });

    await expect(prepareRejectedComposerAttachments(input())).rejects.toMatchObject({
      reason: "changed",
    });

    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(isComposerAttachmentFileRetained("file:///owned/1")).toBe(false);
  });

  it("rejects duplicate or unsupported source attachments before authorization", async () => {
    await expect(
      prepareRejectedComposerAttachments({ ...input(), attachments: [image, image] }),
    ).rejects.toMatchObject({ reason: "duplicate" });
    await expect(
      prepareRejectedComposerAttachments({
        ...input(),
        attachments: [
          {
            id: "unknown",
            type: "future",
            name: "unknown",
            mimeType: "application/octet-stream",
            sizeBytes: 3,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
