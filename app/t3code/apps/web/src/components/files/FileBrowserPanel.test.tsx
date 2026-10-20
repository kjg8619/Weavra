import { describe, expect, it } from "vite-plus/test";

import { resolveFileBrowserBodyState } from "./FileBrowserPanel";

const base = {
  ready: true,
  error: null,
  query: "",
  searchPending: false,
  entryPaths: ["src", "src/index.ts"],
  searchMatchCount: 0,
} as const;

describe("Files body state", () => {
  it("shows loading until the root listing arrives", () => {
    expect(resolveFileBrowserBodyState({ ...base, ready: false, entryPaths: [] }).kind).toBe(
      "loading",
    );
  });

  it("keeps a read error distinct from an empty folder", () => {
    expect(
      resolveFileBrowserBodyState({ ...base, ready: false, entryPaths: [], error: "denied" }),
    ).toEqual({ kind: "error", message: "denied" });
    expect(resolveFileBrowserBodyState({ ...base, entryPaths: [], error: "denied" }).kind).toBe(
      "error",
    );
  });

  it("reports an empty folder only when the listing succeeded with nothing in it", () => {
    expect(resolveFileBrowserBodyState({ ...base, entryPaths: [] }).kind).toBe("empty");
  });

  it("separates a query that matches nothing from an empty folder", () => {
    expect(resolveFileBrowserBodyState({ ...base, query: "absent" })).toEqual({
      kind: "no-results",
      query: "absent",
      searching: false,
    });
  });

  it("says nothing loaded matches while the project-wide search is still running", () => {
    expect(resolveFileBrowserBodyState({ ...base, query: "abs", searchPending: true })).toEqual({
      kind: "no-results",
      query: "abs",
      searching: true,
    });
    expect(resolveFileBrowserBodyState({ ...base, query: "index", searchPending: true }).kind).toBe(
      "ready",
    );
  });

  it("shows the tree for a local or remote match and again once the query is cleared", () => {
    expect(resolveFileBrowserBodyState({ ...base, query: "INDEX" }).kind).toBe("ready");
    expect(resolveFileBrowserBodyState({ ...base, query: "deep", searchMatchCount: 2 }).kind).toBe(
      "ready",
    );
    expect(resolveFileBrowserBodyState({ ...base, query: "  " }).kind).toBe("ready");
  });
});
