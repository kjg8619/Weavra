import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildAmbiguousProjectDetails, findActiveProjectGroup } from "./DraftHeroHeadline";

const work = EnvironmentId.make("env-work");
const home = EnvironmentId.make("env-home");
const group = (projectKey: string, ...refs: ReturnType<typeof scopeProjectRef>[]) => ({
  projectKey,
  displayName: "baseline-project",
  memberProjectRefs: refs,
});

describe("draft hero current project", () => {
  it("tells same-named projects on two machines apart by their scoped identity", () => {
    const onWork = group("work", scopeProjectRef(work, ProjectId.make("p1")));
    const onHome = group("home", scopeProjectRef(home, ProjectId.make("p1")));

    expect(
      findActiveProjectGroup([onWork, onHome], scopeProjectRef(home, ProjectId.make("p1"))),
    ).toBe(onHome);
    expect(
      findActiveProjectGroup([onWork, onHome], scopeProjectRef(work, ProjectId.make("p1"))),
    ).toBe(onWork);
  });

  it("matches any member of a grouped logical project", () => {
    const grouped = group(
      "logical",
      scopeProjectRef(work, ProjectId.make("p1")),
      scopeProjectRef(home, ProjectId.make("p2")),
    );
    expect(findActiveProjectGroup([grouped], scopeProjectRef(home, ProjectId.make("p2")))).toBe(
      grouped,
    );
  });

  it("follows the selected project id when two projects in one environment share a name", () => {
    const first = group("a", scopeProjectRef(work, ProjectId.make("p1")));
    const second = group("b", scopeProjectRef(work, ProjectId.make("p2")));

    expect(
      findActiveProjectGroup([first, second], scopeProjectRef(work, ProjectId.make("p2"))),
    ).toBe(second);
  });

  it("adds a folder detail only to same-named projects", () => {
    const details = buildAmbiguousProjectDetails([
      { projectKey: "a", displayName: "app", workspaceRoot: "/work/one/app" },
      { projectKey: "b", displayName: "app", workspaceRoot: "/work/two/app" },
      { projectKey: "c", displayName: "docs", workspaceRoot: "/work/docs" },
    ]);

    expect(details.get("a")).toBe("one/app");
    expect(details.get("b")).toBe("two/app");
    expect(details.has("c")).toBe(false);
  });

  it("falls back to the full path when the last two segments still collide", () => {
    const details = buildAmbiguousProjectDetails([
      { projectKey: "a", displayName: "app", workspaceRoot: "/x/one/app" },
      { projectKey: "b", displayName: "app", workspaceRoot: "/y/one/app" },
    ]);

    expect(details.get("a")).toBe("/x/one/app");
    expect(details.get("b")).toBe("/y/one/app");
  });

  it("marks nothing when the draft targets no known project", () => {
    const onWork = group("work", scopeProjectRef(work, ProjectId.make("p1")));
    expect(findActiveProjectGroup([onWork], null)).toBeNull();
    expect(
      findActiveProjectGroup([onWork], scopeProjectRef(home, ProjectId.make("p9"))),
    ).toBeNull();
  });
});
