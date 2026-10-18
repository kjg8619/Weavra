import {
  McpCapabilityUnavailableError,
  WeavraProjectSetupError,
  WeavraProjectSetupResult,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../../provider/Services/ProviderRegistry.ts";
import { WorkspaceExecutionOwnership } from "../../../workspace/WorkspaceExecutionOwnership.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

export class ProjectControlError extends Schema.TaggedError<ProjectControlError>()(
  "ProjectControlError",
  {
    code: Schema.Literals([
      "TARGET_UNAVAILABLE",
      "STALE_CONFIG",
      "INVALID_CONFIG",
      "PROTECTED_SETTING",
    ]),
  },
) {
  override get message(): string {
    switch (this.code) {
      case "TARGET_UNAVAILABLE":
        return "The conversation's project changed or is unavailable. Read its current rules again.";
      case "STALE_CONFIG":
        return "The saved rules changed. Read and reconcile them; do not overwrite or blindly retry.";
      case "INVALID_CONFIG":
        return "The proposed project rules are not valid YAML. Existing rules were preserved.";
      case "PROTECTED_SETTING":
        return "Chat rule updates cannot change models, execution workflow, sandbox, trust, approvals or budgets. Use project settings for an explicit reviewed change.";
    }
  }
}

const dependencies = [
  McpInvocationContext,
  ProjectionSnapshotQuery,
  WorkspaceExecutionOwnership,
  HostProcessEnvironment,
  Path.Path,
  FileSystem.FileSystem,
  ChildProcessSpawner.ChildProcessSpawner,
  ProviderRegistry,
];
const failure = Schema.Union([
  McpCapabilityUnavailableError,
  WeavraProjectSetupError,
  ProjectControlError,
]);
const digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));

const read = Tool.make("read_project_control", {
  description:
    "Read this conversation's saved project control rules, or obtain a candidate when none exist. Reuse existing YAML and its digests before updating rules. Does not initialize Git, run a workflow, call a model, or execute checks.",
  success: WeavraProjectSetupResult,
  failure,
  dependencies,
})
  .annotate(Tool.Title, "Read project control rules")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const SaveProjectControlInput = Schema.Struct({
  yaml: Schema.String.check(
    Schema.makeFilter((value) => new TextEncoder().encode(value).length <= 65_536),
  ),
  targetDigest: digest,
  expectedConfigDigest: Schema.optionalKey(digest),
});

const save = Tool.make("save_project_control", {
  description:
    "Save useful project control rules developed during this conversation. Pass the YAML and original target/config digests from read_project_control. Preserve unrelated keys and existing protections. Blank YAML reuses the saved configuration. This saves settings only; it never grants execution consent, initializes a workflow, or runs checks. Conflicts must be read and reconciled, never blindly retried.",
  parameters: SaveProjectControlInput,
  success: WeavraProjectSetupResult,
  failure,
  dependencies,
})
  .annotate(Tool.Title, "Save project control rules")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ProjectControlToolkit = Toolkit.make(read, save);
