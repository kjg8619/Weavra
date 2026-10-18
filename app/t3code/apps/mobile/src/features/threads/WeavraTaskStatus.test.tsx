import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WeavraTask,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { WeavraTaskViewState } from "@t3tools/client-runtime/state/weavraTask";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  View: "div",
  ScrollView: "div",
  Pressable: "button",
}));
vi.mock("../../components/AppText", () => ({ AppText: "span" }));
// Command/observer factories are lazy. These tests exercise the production
// publication bridge and freshness projection without starting native services.
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));

import {
  beginWeavraTaskStatusList,
  projectWeavraTaskStatus,
  type WeavraTaskStatusList,
} from "./WeavraTaskStatus";

const scope: WeavraTaskScopeInput = {
  environmentId: EnvironmentId.make("environment-1"),
  projectId: ProjectId.make("project-1"),
  threadId: ThreadId.make("thread-1"),
};
const decodeTask = Schema.decodeUnknownSync(WeavraTask);

function task(
  revision = 1,
  selected: WeavraTaskScopeInput = scope,
  id = "11111111-1111-4111-8111-111111111111",
) {
  return decodeTask({
    ...selected,
    id,
    target: { workspaceRoot: "/tmp/project", worktreePath: null },
    checkout: {
      canonicalCwd: "/tmp/project",
      repositoryRoot: "/tmp/project",
      headCommit: "a".repeat(40),
      workspaceDigest: `sha256:${"a".repeat(64)}`,
    },
    phase: "analysis",
    revision,
    context: null,
    execution: null,
    ownership: { generation: 1, state: "analysis" },
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  });
}

function observation(overrides: Partial<WeavraTaskViewState> = {}): WeavraTaskViewState {
  return {
    support: "supported",
    connection: "CONNECTED",
    task: task(),
    stale: false,
    errorCode: null,
    ...overrides,
  };
}

function deferredList() {
  return Promise.withResolvers<AtomCommandResult<ReadonlyArray<WeavraTask>, unknown>>();
}

describe("native controlled-task discovery", () => {
  it.each([
    { connected: false, supported: true, status: "disconnected" },
    { connected: true, supported: false, status: "unsupported" },
    { connected: true, supported: null, status: "loading" },
  ] as const)("does not read when status is $status", async (availability) => {
    const load = vi.fn(async () => AsyncResult.success([task()]));
    const states: WeavraTaskStatusList[] = [];
    const request = beginWeavraTaskStatusList({
      scope,
      ...availability,
      load,
      publish: (state) => states.push(state),
    });
    await request.settled;
    expect(load).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: availability.status, tasks: [] }]);
  });

  it("reads only the exact selected scope and publishes its task identities", async () => {
    const listed = task();
    const load = vi.fn(async () => AsyncResult.success([listed]));
    const states: WeavraTaskStatusList[] = [];
    const request = beginWeavraTaskStatusList({
      scope,
      connected: true,
      supported: true,
      load,
      publish: (state) => states.push(state),
    });
    expect(states).toEqual([{ status: "loading", tasks: [] }]);
    await request.settled;
    expect(load).toHaveBeenCalledExactlyOnceWith({
      environmentId: scope.environmentId,
      input: scope,
    });
    expect(states.at(-1)).toEqual({ status: "ready", tasks: [listed] });
  });

  const foreignScopes = [
    { ...scope, environmentId: EnvironmentId.make("environment-2") },
    { ...scope, projectId: ProjectId.make("project-2") },
    { ...scope, threadId: ThreadId.make("thread-2") },
  ];

  it.each(foreignScopes)("rejects a list containing a foreign scope: %j", async (foreign) => {
    const states: WeavraTaskStatusList[] = [];
    const request = beginWeavraTaskStatusList({
      scope,
      connected: true,
      supported: true,
      load: async () => AsyncResult.success([task(), task(1, foreign)]),
      publish: (state) => states.push(state),
    });
    await request.settled;
    expect(states.at(-1)).toEqual({ status: "unavailable", tasks: [] });
  });

  it.each(["scope-switch", "reconnect", "refresh"] as const)(
    "ignores an older response after %s",
    async (change) => {
      const first = deferredList();
      const second = deferredList();
      const states: WeavraTaskStatusList[] = [];
      const oldRequest = beginWeavraTaskStatusList({
        scope,
        connected: true,
        supported: true,
        load: () => first.promise,
        publish: (state) => states.push(state),
      });
      oldRequest.cancel();
      const nextScope =
        change === "scope-switch" ? { ...scope, threadId: ThreadId.make("thread-2") } : scope;
      const newTask = task(2, nextScope);
      const newRequest = beginWeavraTaskStatusList({
        scope: nextScope,
        connected: true,
        supported: true,
        load: () => second.promise,
        publish: (state) => states.push(state),
      });
      second.resolve(AsyncResult.success([newTask]));
      await newRequest.settled;
      const published = [...states];
      first.resolve(AsyncResult.success([task()]));
      await oldRequest.settled;
      expect(states).toEqual(published);
      expect(states.at(-1)).toEqual({ status: "ready", tasks: [newTask] });
    },
  );

  it("clears a pending result on disconnection", async () => {
    const pending = deferredList();
    const states: WeavraTaskStatusList[] = [];
    const oldRequest = beginWeavraTaskStatusList({
      scope,
      connected: true,
      supported: true,
      load: () => pending.promise,
      publish: (state) => states.push(state),
    });
    oldRequest.cancel();
    const load = vi.fn(async () => AsyncResult.success([task()]));
    const disconnected = beginWeavraTaskStatusList({
      scope,
      connected: false,
      supported: true,
      load,
      publish: (state) => states.push(state),
    });
    await disconnected.settled;
    pending.resolve(AsyncResult.success([task()]));
    await oldRequest.settled;
    expect(load).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: "disconnected", tasks: [] });
  });

  it("leaves an empty read empty without another operation", async () => {
    const load = vi.fn(async () => AsyncResult.success([]));
    const states: WeavraTaskStatusList[] = [];
    const request = beginWeavraTaskStatusList({
      scope,
      connected: true,
      supported: true,
      load,
      publish: (state) => states.push(state),
    });
    await request.settled;
    expect(load).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ status: "ready", tasks: [] });
  });

  it("does not retain task data or retry a failed read", async () => {
    const failure: AtomCommandResult<ReadonlyArray<WeavraTask>, unknown> = AsyncResult.failure(
      Cause.fail(new Error("unavailable")),
    );
    const load = vi.fn(async () => failure);
    const states: WeavraTaskStatusList[] = [];
    const request = beginWeavraTaskStatusList({
      scope,
      connected: true,
      supported: true,
      load,
      publish: (state) => states.push(state),
    });
    await request.settled;
    expect(load).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ status: "unavailable", tasks: [] });
  });
});

describe("native controlled-task freshness", () => {
  it("requires a synchronized supported observation for fresh status", () => {
    expect(projectWeavraTaskStatus(task(), observation()).freshness).toBe("fresh");
    for (const state of [
      observation({ stale: true }),
      observation({ connection: "RECONNECTING" }),
      observation({ support: "unknown" }),
      observation({ task: null }),
    ]) {
      expect(projectWeavraTaskStatus(task(), state).freshness).toBe("stale");
    }
  });

  it.each([
    { connection: "DISCONNECTED", freshness: "disconnected" },
    { connection: "ERROR", freshness: "unavailable" },
  ] as const)("keeps $connection observations non-current", ({ connection, freshness }) => {
    const result = projectWeavraTaskStatus(task(), observation({ connection }));
    expect(result.freshness).toBe(freshness);
    expect(result.task?.id).toBe(task().id);
  });

  it("withholds task detail when support is unavailable", () => {
    expect(projectWeavraTaskStatus(task(), observation({ support: "unsupported" }))).toEqual({
      task: null,
      freshness: "unsupported",
    });
  });

  it.each([
    { ...scope, environmentId: EnvironmentId.make("environment-2") },
    { ...scope, projectId: ProjectId.make("project-2") },
    { ...scope, threadId: ThreadId.make("thread-2") },
  ])("withholds foreign observer details: %j", (foreign) => {
    expect(projectWeavraTaskStatus(task(), observation({ task: task(2, foreign) }))).toEqual({
      task: null,
      freshness: "unavailable",
    });
  });

  it("withholds an observer for another task in the same thread", () => {
    expect(
      projectWeavraTaskStatus(
        task(),
        observation({
          task: task(2, scope, "22222222-2222-4222-8222-222222222222"),
        }),
      ),
    ).toEqual({ task: null, freshness: "unavailable" });
  });

  it("does not call an observation older than discovery fresh", () => {
    const listed = task(3);
    expect(projectWeavraTaskStatus(listed, observation({ task: task(2) }))).toEqual({
      task: listed,
      freshness: "stale",
    });
    const latest = task(4);
    expect(projectWeavraTaskStatus(listed, observation({ task: latest }))).toEqual({
      task: latest,
      freshness: "fresh",
    });
  });

  it("does not promote revision errors or changed targets to fresh status", () => {
    expect(
      projectWeavraTaskStatus(task(), observation({ errorCode: "REVISION_REGRESSION" })).freshness,
    ).toBe("unavailable");
    expect(projectWeavraTaskStatus(task(), observation({ errorCode: "TARGET_CHANGED" }))).toEqual({
      task: null,
      freshness: "unavailable",
    });
  });
});
