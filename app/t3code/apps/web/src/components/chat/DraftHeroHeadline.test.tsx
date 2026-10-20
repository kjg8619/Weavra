import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findActiveProjectGroup } from "./DraftHeroHeadline";

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

  it("marks nothing when the draft targets no known project", () => {
    const onWork = group("work", scopeProjectRef(work, ProjectId.make("p1")));
    expect(findActiveProjectGroup([onWork], null)).toBeNull();
    expect(
      findActiveProjectGroup([onWork], scopeProjectRef(home, ProjectId.make("p9"))),
    ).toBeNull();
  });
});
