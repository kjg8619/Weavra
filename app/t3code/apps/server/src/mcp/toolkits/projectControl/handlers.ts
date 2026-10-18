import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { parseDocument } from "yaml";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { setupProject } from "../../../weavra/ProjectSetup.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import {
  ProjectControlError,
  ProjectControlToolkit,
  type SaveProjectControlInput,
} from "./tools.ts";

const scope = Effect.gen(function* () {
  const invocation = yield* requireMcpCapability("project-control");
  const snapshots = yield* ProjectionSnapshotQuery;
  const thread = yield* snapshots
    .getThreadShellById(invocation.threadId)
    .pipe(Effect.mapError(() => new ProjectControlError({ code: "TARGET_UNAVAILABLE" })));
  if (Option.isNone(thread)) return yield* new ProjectControlError({ code: "TARGET_UNAVAILABLE" });
  return {
    environmentId: invocation.environmentId,
    projectId: thread.value.projectId,
    threadId: invocation.threadId,
  };
});

const read = Effect.fn("ProjectControl.read")(function* () {
  const selected = yield* scope;
  const current = yield* setupProject({ scope: selected, action: "read" });
  return current.result.kind === "error" && current.result.code === "CONFIG_MISSING"
    ? yield* setupProject({ scope: selected, action: "draft" })
    : current;
});

// Conversational configuration may choose project files/checks, not weaken the
// account, workflow, sandbox, trust, mutation, review or budget controls.
const protectedSettings = [
  ["models"],
  ["runtime"],
  ["agents"],
  ["review"],
  ["budget"],
  ["risk"],
  ["state"],
  ["mutation"],
  ["workspace"],
  ["project"],
  ["code_intelligence"],
  ["verification", "sandbox"],
  ["verification", "trust"],
  ["verification", "repair"],
  ["verification", "advisory"],
] as const;

// Mirrors parseRuntimeConfig (runtime/pi/packages/company-runtime/src/config.ts):
// the same schema, tag, merge, duplicate-key and alias policy, so the guard and
// Runtime cannot read one document as different values.
const runtimeYaml = (source: string): { value: unknown } | undefined => {
  try {
    const document = parseDocument(source, {
      version: "1.2",
      schema: "core",
      merge: false,
      uniqueKeys: true,
      resolveKnownTags: false,
      prettyErrors: false,
      logLevel: "silent",
    });
    if (document.errors.length || document.warnings.length) return undefined;
    return { value: document.toJS({ maxAliasCount: 0 }) as unknown };
  } catch {
    return undefined;
  }
};

const valueAt = (resolved: unknown, path: ReadonlyArray<string>): unknown => {
  let node = (resolved as { value: unknown }).value;
  for (const key of path) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

// Key order is not semantic; everything else must match exactly.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).toSorted(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  ) ?? "undefined";

const save = Effect.fn("ProjectControl.save")(function* (
  input: typeof SaveProjectControlInput.Type,
) {
  const selected = yield* scope;
  const current = yield* setupProject({ scope: selected, action: "read" });
  if (!input.yaml.trim()) return current;
  if (current.targetDigest !== input.targetDigest)
    return yield* new ProjectControlError({ code: "TARGET_UNAVAILABLE" });
  if (current.result.kind === "error") {
    if (current.result.code !== "CONFIG_MISSING") return current;
    if (input.expectedConfigDigest !== undefined)
      return yield* new ProjectControlError({ code: "STALE_CONFIG" });
  } else if (
    current.result.kind !== "read" ||
    current.result.configDigest !== input.expectedConfigDigest
  ) {
    return yield* new ProjectControlError({ code: "STALE_CONFIG" });
  }
  const baseline =
    current.result.kind === "read"
      ? current
      : yield* setupProject({ scope: selected, action: "draft" });
  if (baseline.result.kind !== "read" && baseline.result.kind !== "draft") return baseline;
  // Compare the values Runtime will actually load, not YAML text: an edited anchor
  // or a version directive must not change a protected value unnoticed.
  const resolvedPrevious = runtimeYaml(baseline.result.yaml);
  const resolvedProposed = runtimeYaml(input.yaml);
  if (resolvedPrevious === undefined || resolvedProposed === undefined)
    return yield* new ProjectControlError({ code: "INVALID_CONFIG" });
  for (const path of protectedSettings) {
    if (canonical(valueAt(resolvedPrevious, path)) !== canonical(valueAt(resolvedProposed, path)))
      return yield* new ProjectControlError({ code: "PROTECTED_SETTING" });
  }
  if (baseline.result.yaml === input.yaml) return baseline;
  return yield* setupProject(
    current.result.kind === "read"
      ? {
          scope: selected,
          action: "update",
          targetDigest: input.targetDigest,
          expectedConfigDigest: current.result.configDigest,
          yaml: input.yaml,
        }
      : { scope: selected, action: "save", targetDigest: input.targetDigest, yaml: input.yaml },
  );
});

export const ProjectControlToolkitHandlersLive = ProjectControlToolkit.toLayer(
  Effect.succeed(
    ProjectControlToolkit.of({
      read_project_control: () => read(),
      save_project_control: save,
    }),
  ),
);
