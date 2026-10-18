import { afterEach, describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { vi } from "vite-plus/test";

const faults = vi.hoisted(() => ({
  beforeMove: null as (() => void) | null,
  writeFailure: false,
}));

// Exercise real sibling files and rename while substituting only Expo's native API.
// Device-panel QA must still verify the supported platform implementation.
vi.mock("expo-file-system", () => {
  return {
    File: class {
      constructor(
        readonly parentDirectory: string,
        readonly name: string,
      ) {}
      get uri() {
        return NodePath.join(this.parentDirectory, this.name);
      }
      create() {
        NodeFS.writeFileSync(this.uri, "");
      }
      write(contents: string) {
        if (faults.writeFailure) throw new Error("staging write failed");
        NodeFS.writeFileSync(this.uri, contents);
      }
      moveSync(destination: { readonly uri: string }) {
        faults.beforeMove?.();
        NodeFS.renameSync(this.uri, destination.uri);
      }
      delete() {
        NodeFS.unlinkSync(this.uri);
      }
    },
  };
});

import { File } from "expo-file-system";
import { prepareAtomicFileWriter, writeFileAtomically } from "./atomic-file";

const directories: string[] = [];
function fixture() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavra-atomic-file-"));
  directories.push(directory);
  const path = NodePath.join(directory, "drafts.json");
  NodeFS.writeFileSync(path, "original");
  return { directory, path, file: new File(directory, "drafts.json") };
}

afterEach(() => {
  faults.beforeMove = null;
  faults.writeFailure = false;
  for (const directory of directories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("atomic file replacement", () => {
  it("checks commit permission after staging and removes a cancelled staging file", async () => {
    const { directory, path, file } = fixture();
    const write = await prepareAtomicFileWriter(file);
    const mayCommit = vi.fn(() => {
      expect(NodeFS.readFileSync(path, "utf8")).toBe("original");
      const staged = NodeFS.readdirSync(directory).filter((name) => name.endsWith(".tmp"));
      expect(staged).toHaveLength(1);
      expect(
        staged.map((name) => NodeFS.readFileSync(NodePath.join(directory, name), "utf8")),
      ).toEqual(["replacement"]);
      return false;
    });

    const result = write("replacement", mayCommit);

    expect(result).toBe("cancelled");
    expect(mayCommit).toHaveBeenCalledOnce();
    expect(NodeFS.readFileSync(path, "utf8")).toBe("original");
    expect(NodeFS.readdirSync(directory)).toEqual(["drafts.json"]);
  });

  it("lets publication follow rename before a queued mutation runs", async () => {
    const { path, file } = fixture();
    const write = await prepareAtomicFileWriter(file);
    const observations: string[] = [];
    let published = "original";
    const mutation = new Promise<void>((resolve) => {
      faults.beforeMove = () => {
        queueMicrotask(() => {
          observations.push(published);
          published = "cleared";
          resolve();
        });
      };
    });

    const result = write("replacement", () => true);
    if (result === "written") published = "replacement";
    await mutation;

    expect(observations).toEqual(["replacement"]);
    expect(published).toBe("cleared");
    expect(NodeFS.readFileSync(path, "utf8")).toBe("replacement");
  });

  it("keeps the original visible until the complete staging file is renamed", async () => {
    const { directory, path, file } = fixture();
    faults.beforeMove = () => {
      expect(NodeFS.readFileSync(path, "utf8")).toBe("original");
      const staged = NodeFS.readdirSync(directory).filter((name) => name.endsWith(".tmp"));
      expect(staged).toHaveLength(1);
      expect(
        staged.map((name) => NodeFS.readFileSync(NodePath.join(directory, name), "utf8")),
      ).toEqual(["replacement"]);
    };

    await writeFileAtomically(file, "replacement");

    expect(NodeFS.readFileSync(path, "utf8")).toBe("replacement");
    expect(NodeFS.readdirSync(directory)).toEqual(["drafts.json"]);
  });

  it.each(["write", "rename"] as const)("preserves the original when %s fails", async (stage) => {
    const { path, file } = fixture();
    faults.writeFailure = stage === "write";
    if (stage === "rename") {
      faults.beforeMove = () => {
        throw new Error("rename failed");
      };
    }

    await expect(writeFileAtomically(file, "replacement")).rejects.toThrow();

    expect(NodeFS.readFileSync(path, "utf8")).toBe("original");
  });

  it("uses distinct staging files for overlapping writes", async () => {
    const { directory, path, file } = fixture();
    const stagingNames: string[] = [];
    let secondWrite: Promise<void> | undefined;
    faults.beforeMove = () => {
      stagingNames.push(...NodeFS.readdirSync(directory).filter((name) => name.endsWith(".tmp")));
      // Start the second call at the first write's exact pre-rename boundary,
      // not while the test runner is resolving two mocked dynamic imports.
      secondWrite ??= writeFileAtomically(file, "second");
    };

    await writeFileAtomically(file, "first");
    expect(secondWrite).toBeDefined();
    await secondWrite;

    expect(stagingNames).toHaveLength(2);
    expect(new Set(stagingNames).size).toBe(2);
    expect(NodeFS.readFileSync(path, "utf8")).toBe("second");
    expect(NodeFS.readdirSync(directory)).toEqual(["drafts.json"]);
  });
});
