import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WeavraProjectSetupError,
  type WeavraProjectSetupInput,
  type WeavraProjectSetupResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { beforeEach, expect, vi } from "vite-plus/test";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { WorkspaceExecutionOwnership } from "../../../workspace/WorkspaceExecutionOwnership.ts";
import { ProjectControlToolkitRegistrationLive } from "../../McpHttpServer.ts";
import { McpInvocationContext, type McpInvocationScope } from "../../McpInvocationContext.ts";

const setup = vi.hoisted(() =>
  vi.fn<
    (
      input: WeavraProjectSetupInput,
    ) => Effect.Effect<WeavraProjectSetupResult, WeavraProjectSetupError>
  >(),
);
vi.mock("../../../weavra/ProjectSetup.ts", () => ({ setupProject: setup }));

const environmentId = EnvironmentId.make("rules-environment");
const threadId = ThreadId.make("rules-thread");
const projectId = ProjectId.make("rules-project");
const thread = Schema.decodeSync(OrchestrationThreadShell)({
  id: threadId,
  projectId,
  title: "Rules fixture",
  modelSelection: { instanceId: "codex", model: "fixture-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  session: null,
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const targetDigest = `sha256:${"a".repeat(64)}`;
const configDigest = `sha256:${"b".repeat(64)}`;
const yaml = `schemaVersion: 1
models:
  profiles:
    coding: {provider: test, model: coding}
    reasoning: {provider: test, model: reasoning}
runtime: {workflow: STANDARD}
files:
  allowed_paths:
    - docs
verification:
  sandbox: {mode: required}
  checks: []
`;
const current: WeavraProjectSetupResult = {
  targetDigest,
  result: { schemaVersion: 1, kind: "read", yaml, configDigest },
};
const missing: WeavraProjectSetupResult = {
  targetDigest,
  result: { schemaVersion: 1, kind: "error", code: "CONFIG_MISSING", message: "Missing" },
};
const candidate: WeavraProjectSetupResult = {
  targetDigest,
  result: {
    schemaVersion: 1,
    kind: "draft",
    yaml,
    projectTypes: ["fixture"],
    workspaceProfile: {
      schemaVersion: 1,
      kind: "supported",
      profile: { mode: "default", candidate: false },
      fileCount: 1,
      totalBytes: 1,
    },
  },
};
const invocation: McpInvocationScope = {
  environmentId,
  threadId,
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: "rules-session",
  issuedAt: 1,
  capabilities: new Set(["project-control"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "rules-test", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rules-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const system = ProjectControlToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: (requested) =>
          Effect.succeed(requested === threadId ? Option.some(thread) : Option.none()),
      }),
      Layer.mock(WorkspaceExecutionOwnership)({ environmentId }),
      Layer.mock(ProviderRegistry)({}),
      NodeServices.layer,
    ),
  ),
);
const call = (name: string, args: Record<string, unknown>, scope = invocation) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name, arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext, scope),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  }).pipe(Effect.scoped, Effect.provide(system));

beforeEach(() => {
  setup.mockReset().mockReturnValue(Effect.succeed(current));
});

it.effect("derives configuration selectors from the authenticated conversation", () =>
  Effect.gen(function* () {
    const result = yield* call("read_project_control", {});
    expect(result.isError).toBe(false);
    expect(setup).toHaveBeenCalledExactlyOnceWith({
      scope: { environmentId, projectId, threadId },
      action: "read",
    });
  }),
);

it.effect("refuses a credential without the configuration capability", () =>
  Effect.gen(function* () {
    const result = yield* call(
      "read_project_control",
      {},
      {
        ...invocation,
        capabilities: new Set(["preview"]),
      },
    );
    expect(result.isError).toBe(true);
    expect(setup).not.toHaveBeenCalled();
  }),
);

it.effect("treats blank YAML as reuse and performs no save", () =>
  Effect.gen(function* () {
    const result = yield* call("save_project_control", { targetDigest, yaml: " \n" });
    expect(result.isError).toBe(false);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
  }),
);

it.effect("rejects a stale configuration digest before mutation", () =>
  Effect.gen(function* () {
    const result = yield* call("save_project_control", {
      targetDigest,
      yaml: yaml.replace("- docs", "- src"),
      expectedConfigDigest: `sha256:${"c".repeat(64)}`,
    });
    expect(result.isError).toBe(true);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
  }),
);

it.effect("updates project rules through the original target and configuration CAS", () =>
  Effect.gen(function* () {
    const next = yaml.replace("- docs", "- src");
    const result = yield* call("save_project_control", {
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml: next,
    });
    expect(result.isError).toBe(false);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read", "update"]);
    expect(setup.mock.calls[1]?.[0]).toEqual({
      scope: { environmentId, projectId, threadId },
      action: "update",
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml: next,
    });
  }),
);

it.effect("refuses sandbox weakening without running setup mutation", () =>
  Effect.gen(function* () {
    const result = yield* call("save_project_control", {
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml: yaml.replace("mode: required", "mode: disabled"),
    });
    expect(result.isError).toBe(true);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
  }),
);

it.effect("refuses sandbox weakening through an unchanged alias", () =>
  Effect.gen(function* () {
    const aliased = yaml
      .replace("schemaVersion: 1\n", "schemaVersion: 1\ntemplate: &sandbox\n  mode: required\n")
      .replace("sandbox: {mode: required}", "sandbox: *sandbox");
    setup.mockReturnValue(
      Effect.succeed({ targetDigest, result: { ...current.result, yaml: aliased } }),
    );
    const result = yield* call("save_project_control", {
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml: aliased.replace("mode: required", "mode: disabled"),
    });
    expect(result.isError).toBe(true);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
  }),
);

it.effect("refuses a budget change hidden by a YAML version directive", () =>
  Effect.gen(function* () {
    const budgeted = yaml.replace("files:", "budget: {max_worker_invocations: 10}\nfiles:");
    setup.mockReturnValue(
      Effect.succeed({ targetDigest, result: { ...current.result, yaml: budgeted } }),
    );
    for (const spelling of ["012", "!!int 012"]) {
      setup.mockClear();
      const result = yield* call("save_project_control", {
        targetDigest,
        expectedConfigDigest: configDigest,
        yaml: `%YAML 1.1\n---\n${budgeted.replace("invocations: 10", `invocations: ${spelling}`)}`,
      });
      expect(result.isError).toBe(true);
      expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
    }
  }),
);

it.effect("drafts only when the authenticated project's saved configuration is missing", () =>
  Effect.gen(function* () {
    setup
      .mockReturnValueOnce(Effect.succeed(missing))
      .mockReturnValueOnce(Effect.succeed(candidate));
    const result = yield* call("read_project_control", {});
    expect(result.isError).toBe(false);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read", "draft"]);
    expect(result.structuredContent).toMatchObject({ result: { kind: "draft" } });
  }),
);

it.effect("publishes first rules without initialization, checks or execution commands", () =>
  Effect.gen(function* () {
    const next = yaml.replace("- docs", "- src");
    setup
      .mockReturnValueOnce(Effect.succeed(missing))
      .mockReturnValueOnce(Effect.succeed(candidate))
      .mockReturnValueOnce(
        Effect.succeed({
          targetDigest,
          result: {
            schemaVersion: 1,
            kind: "saved",
            yaml: next,
            configDigest,
            readiness: {
              schemaVersion: 1,
              ready: false,
              diagnostics: [],
              configuration: null,
              workspaceAssessment: null,
            },
          },
        }),
      );
    const result = yield* call("save_project_control", { targetDigest, yaml: next });
    expect(result.isError).toBe(false);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read", "draft", "save"]);
    expect(setup.mock.calls[2]?.[0]).toEqual({
      scope: { environmentId, projectId, threadId },
      action: "save",
      targetDigest,
      yaml: next,
    });
  }),
);

it.effect("preserves an owned-task refusal instead of bypassing setup admission", () =>
  Effect.gen(function* () {
    setup.mockReturnValue(Effect.fail(new WeavraProjectSetupError({ code: "WORKSPACE_BUSY" })));
    const result = yield* call("save_project_control", {
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml: yaml.replace("- docs", "- src"),
    });
    expect(result.isError).toBe(true);
    expect(setup.mock.calls.map(([input]) => input.action)).toEqual(["read"]);
  }),
);

it.effect("refuses a missing authenticated conversation before reading any project", () =>
  Effect.gen(function* () {
    const result = yield* call(
      "read_project_control",
      {},
      {
        ...invocation,
        threadId: ThreadId.make("missing-thread"),
      },
    );
    expect(result.isError).toBe(true);
    expect(setup).not.toHaveBeenCalled();
  }),
);
