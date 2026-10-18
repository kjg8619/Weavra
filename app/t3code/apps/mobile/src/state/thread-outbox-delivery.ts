import type { AtomCommand, AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type DispatchResult,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { buildProjectThreadStartTurnInput } from "../lib/projectThreadStartTurn";
import { serializeComposerMessageForServer, uploadedComposerContext } from "../lib/composerContext";
import { isModelSelectionUnavailable } from "../lib/modelOptions";
import { randomHex } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { serverEnvironment } from "./server";
import { threadOutboxManager } from "./thread-outbox";
import type { ThreadOutboxClaim } from "./thread-outbox-authority";
import {
  modelSelectionsEqual,
  resolveQueuedThreadSettings,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import {
  canPrepareQueuedMessage,
  prepareQueuedMessageAttachments,
} from "./thread-outbox-preparation";
import type { threadEnvironment } from "./threads";

type Runner<C> =
  C extends AtomCommand<infer W, infer A, infer E>
    ? (input: W) => Promise<AtomCommandResult<A, E>>
    : never;
export type OutboxAcknowledgment = {
  readonly token: ThreadOutboxClaim;
  readonly receipt: DispatchResult;
  readonly submitted: QueuedThreadMessage;
};
type DeliveryResult =
  | { readonly status: "acknowledged"; readonly acknowledgment: OutboxAcknowledgment }
  | { readonly status: "retained" }
  | { readonly status: "retry" };

/** Both production branches pass through this exact write-ahead transport seam. */
export function createThreadOutboxDelivery(transport: {
  readonly startTurn: Runner<typeof threadEnvironment.startTurn>;
  readonly updateMetadata: Runner<typeof threadEnvironment.updateMetadata>;
  readonly setRuntimeMode: Runner<typeof threadEnvironment.setRuntimeMode>;
  readonly setInteractionMode: Runner<typeof threadEnvironment.setInteractionMode>;
}) {
  return async (input: {
    readonly message: QueuedThreadMessage;
    readonly thread:
      | Pick<EnvironmentThreadShell, "modelSelection" | "runtimeMode" | "interactionMode">
      | undefined;
    readonly projectCwd: string | null;
    readonly canInvoke: () => boolean;
  }): Promise<DeliveryResult> => {
    const { message, thread, canInvoke } = input;
    const initial = threadOutboxManager.recordFor(message);
    if (initial === null) return { status: "retained" };
    const current = () => canPrepareQueuedMessage(initial) && canInvoke();
    if (!current()) return { status: "retained" };
    const config = appAtomRegistry.get(serverEnvironment.configValueAtom(message.environmentId));
    const defaults =
      thread ??
      (message.modelSelection === undefined
        ? null
        : {
            modelSelection: message.modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          });
    if (config === null || defaults === null) return { status: "retry" };
    const settings = resolveQueuedThreadSettings(message, defaults, config.providers);
    if (isModelSelectionUnavailable(config, settings.modelSelection)) return { status: "retained" };
    const settingId = (name: string) => CommandId.make(`${message.commandId}:${name}`);
    if (thread !== undefined) {
      if (!modelSelectionsEqual(settings.modelSelection, thread.modelSelection)) {
        if (!current()) return { status: "retained" };
        const result = await transport.updateMetadata({
          environmentId: message.environmentId,
          input: {
            commandId: settingId("model-selection"),
            threadId: message.threadId,
            modelSelection: settings.modelSelection,
          },
        });
        if (result._tag !== "Success") return { status: "retry" };
      }
      if (settings.runtimeMode !== thread.runtimeMode) {
        if (!current()) return { status: "retained" };
        const result = await transport.setRuntimeMode({
          environmentId: message.environmentId,
          input: {
            commandId: settingId("runtime-mode"),
            threadId: message.threadId,
            runtimeMode: settings.runtimeMode,
            createdAt: message.createdAt,
          },
        });
        if (result._tag !== "Success") return { status: "retry" };
      }
      if (settings.interactionMode !== thread.interactionMode) {
        if (!current()) return { status: "retained" };
        const result = await transport.setInteractionMode({
          environmentId: message.environmentId,
          input: {
            commandId: settingId("interaction-mode"),
            threadId: message.threadId,
            interactionMode: settings.interactionMode,
            createdAt: message.createdAt,
          },
        });
        if (result._tag !== "Success") return { status: "retry" };
      }
    }
    if (!current()) return { status: "retained" };
    const prepared = await prepareQueuedMessageAttachments(
      message,
      config.environment.capabilities.attachmentUploads === true,
      canInvoke,
    );
    if (prepared.status === "abandoned") return { status: "retained" };
    if (!canPrepareQueuedMessage(prepared.record) || !canInvoke()) return { status: "retained" };
    const latestConfig = appAtomRegistry.get(
      serverEnvironment.configValueAtom(message.environmentId),
    );
    if (latestConfig === null) return { status: "retry" };
    if (isModelSelectionUnavailable(latestConfig, settings.modelSelection))
      return { status: "retained" };
    const sendSettings = resolveQueuedThreadSettings(
      prepared.persistedMessage,
      settings,
      latestConfig.providers,
    );
    const serialized = serializeComposerMessageForServer(
      prepared.persistedMessage.text,
      uploadedComposerContext(
        prepared.persistedMessage.context,
        prepared.persistedMessage.attachments,
        prepared.prepared.attachments,
      ),
      latestConfig.environment.capabilities.inlineMessageContext === true,
    );
    const creation = prepared.persistedMessage.creation;
    if (creation !== undefined && input.projectCwd === null) return { status: "retained" };
    const command = {
      type: "thread.turn.start" as const,
      ...(creation !== undefined && input.projectCwd !== null
        ? buildProjectThreadStartTurnInput({
            projectId: creation.projectId,
            projectCwd: input.projectCwd,
            threadId: message.threadId,
            commandId: message.commandId,
            messageId: message.messageId,
            createdAt: message.createdAt,
            ...serialized,
            uploadedAttachments: prepared.prepared.attachments,
            ...sendSettings,
            workspaceMode: creation.workspaceMode,
            branch: creation.branch,
            worktreePath: creation.worktreePath,
            startFromOrigin: creation.startFromOrigin ?? false,
            worktreeBranchName: buildTemporaryWorktreeBranchName(randomHex),
          })
        : {
            commandId: message.commandId,
            threadId: message.threadId,
            message: {
              messageId: message.messageId,
              role: "user" as const,
              ...serialized,
              attachments: prepared.prepared.attachments,
            },
            ...sendSettings,
            createdAt: message.createdAt,
          }),
    };
    const token = await threadOutboxManager.authority.claimForDelivery(
      prepared.record,
      { environmentId: message.environmentId, command },
      canInvoke,
    );
    if (token === null) return { status: "retained" };
    const invocation = threadOutboxManager.authority.consumeClaim(token);
    if (invocation === null) return { status: "retained" };
    const { type: _type, ...wireInput } = invocation.command;
    // No await, regeneration or secondary permission check between consumption
    // and the existing transport call.
    const result = await transport.startTurn({
      environmentId: invocation.environmentId,
      input: wireInput,
    });
    if (result._tag !== "Success") return { status: "retained" };
    return {
      status: "acknowledged",
      acknowledgment: {
        token,
        receipt: result.value,
        submitted: prepared.persistedMessage,
      },
    };
  };
}
