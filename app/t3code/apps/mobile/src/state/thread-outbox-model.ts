import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import {
  clampFileAttachmentUploadBytes,
  fileAttachmentTooLargeMessage,
} from "@t3tools/client-runtime/state/attachments";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  OrchestrationMessage,
  OrchestrationMessageContext,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  WorkspaceTurnStartRefusalPayload,
  type ModelSelection as ModelSelectionType,
  type ProjectId as ProjectIdType,
  type ProviderInteractionMode as ProviderInteractionModeType,
  type RuntimeMode as RuntimeModeType,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { DraftComposerAttachmentSchema } from "../lib/composer-image-schema";
import type { DraftComposerAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";
import { resolveProviderInteractionMode } from "../features/threads/legacy-plan-mode";

// Older readers must reject, rather than discard, durable delivery fences.
const THREAD_OUTBOX_SCHEMA_VERSION = 5;
const THREAD_OUTBOX_MAX_RETRY_DELAY_MS = 16_000;

const QueuedThreadCreationSchema = Schema.Struct({
  projectId: ProjectId,
  // Snapshot of the project's display metadata so a pending task stays
  // presentable in the thread list even when the project shell is not loaded.
  projectTitle: Schema.optional(Schema.String),
  projectCwd: Schema.optional(Schema.String),
  workspaceMode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

export const QueuedThreadDeliverySchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("ready") }),
  Schema.Struct({ state: Schema.Literal("attempted") }),
  Schema.Struct({ state: Schema.Literal("unknown") }),
  Schema.Struct({
    state: Schema.Literal("refused"),
    sourceMessage: OrchestrationMessage,
    refusal: WorkspaceTurnStartRefusalPayload,
  }),
]);
export type QueuedThreadDelivery = typeof QueuedThreadDeliverySchema.Type;

export const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, 3, 4, THREAD_OUTBOX_SCHEMA_VERSION]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  context: Schema.optional(OrchestrationMessageContext),
  delivery: Schema.optionalKey(QueuedThreadDeliverySchema),
  storageIdentity: Schema.optionalKey(
    Schema.Struct({
      environmentId: EnvironmentId,
      threadId: ThreadId,
      messageId: MessageId,
    }),
  ),
  attachments: Schema.Array(DraftComposerAttachmentSchema),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  // Present when the queued item creates a brand-new thread (pending task)
  // instead of appending a turn to an existing one.
  creation: Schema.optional(QueuedThreadCreationSchema),
  createdAt: IsoDateTime,
}).check(
  Schema.makeFilter((message) => {
    const delivery = message.delivery;
    return (
      (message.storageIdentity === undefined ||
        message.storageIdentity.messageId === message.messageId) &&
      (delivery?.state !== "refused" ||
        (delivery.sourceMessage.role === "user" &&
          delivery.sourceMessage.id === message.messageId &&
          delivery.refusal.requestId === message.messageId))
    );
  }),
);

const decodeStoredQueuedThreadMessage = Schema.decodeUnknownSync(QueuedThreadMessageSchema);
const encodeStoredQueuedThreadMessage = Schema.encodeUnknownSync(QueuedThreadMessageSchema);

export interface QueuedThreadCreation {
  readonly projectId: ProjectIdType;
  readonly projectTitle?: string;
  readonly projectCwd?: string;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
}

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  /** Missing legacy metadata is unknown, never permission to invoke startTurn. */
  readonly delivery?: QueuedThreadDelivery;
  /** A pending task keeps its durable slot when the user retargets its scope. */
  readonly storageIdentity?: Pick<QueuedThreadMessage, "environmentId" | "threadId" | "messageId">;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly modelSelection?: ModelSelectionType;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
  readonly creation?: QueuedThreadCreation;
  readonly createdAt: string;
}

export interface ThreadSettingsSnapshot {
  readonly modelSelection: ModelSelectionType;
  readonly runtimeMode: RuntimeModeType;
  readonly interactionMode: ProviderInteractionModeType;
}

export function threadOutboxIdentity(
  message: Pick<QueuedThreadMessage, "environmentId" | "threadId" | "messageId">,
): string {
  return JSON.stringify([message.environmentId, message.threadId, message.messageId]);
}

export function threadOutboxStorageIdentity(message: QueuedThreadMessage): string {
  return threadOutboxIdentity(message.storageIdentity ?? message);
}

export function resolveQueuedThreadSettings(
  message: QueuedThreadMessage,
  thread: ThreadSettingsSnapshot,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "showInteractionModeToggle">> = [],
): ThreadSettingsSnapshot {
  const modelSelection = message.modelSelection ?? thread.modelSelection;
  const provider = providers.find(
    (candidate) => candidate.instanceId === modelSelection.instanceId,
  );
  return {
    modelSelection,
    runtimeMode: message.runtimeMode ?? thread.runtimeMode,
    interactionMode: resolveProviderInteractionMode(
      provider,
      message.interactionMode ?? thread.interactionMode,
    ),
  };
}

export function modelSelectionsEqual(left: ModelSelectionType, right: ModelSelectionType): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null)
  );
}

export function encodeQueuedThreadMessage(message: QueuedThreadMessage): unknown {
  return encodeStoredQueuedThreadMessage({
    schemaVersion: THREAD_OUTBOX_SCHEMA_VERSION,
    ...message,
  });
}

export function decodeQueuedThreadMessage(value: unknown): QueuedThreadMessage {
  const { schemaVersion, ...message } = decodeStoredQueuedThreadMessage(value);
  if (schemaVersion !== THREAD_OUTBOX_SCHEMA_VERSION) {
    const {
      delivery: _legacyDelivery,
      storageIdentity: _legacyStorageIdentity,
      ...legacyMessage
    } = message;
    return legacyMessage;
  }
  return message;
}

export function groupQueuedThreadMessages(
  messages: ReadonlyArray<QueuedThreadMessage>,
): Record<string, ReadonlyArray<QueuedThreadMessage>> {
  const deduplicated = new Map<string, QueuedThreadMessage>();
  for (const message of messages) {
    deduplicated.set(threadOutboxStorageIdentity(message), message);
  }

  const grouped: Record<string, Array<QueuedThreadMessage>> = {};
  for (const message of deduplicated.values()) {
    const threadKey = scopedThreadKey(message.environmentId, message.threadId);
    (grouped[threadKey] ??= []).push(message);
  }
  for (const queue of Object.values(grouped)) {
    queue.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return grouped;
}

export function flattenQueuedThreadMessages(
  queues: Record<string, ReadonlyArray<QueuedThreadMessage>>,
): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(queues).flat();
}

export function threadOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), THREAD_OUTBOX_MAX_RETRY_DELAY_MS);
}

export type ThreadOutboxDeliveryAction = "wait" | "send";

export function resolveThreadOutboxDeliveryAction(input: {
  readonly isCreation: boolean;
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadBusy: boolean;
}): ThreadOutboxDeliveryAction {
  if (input.isCreation) {
    // A shell is not a delivery receipt. Only a consumed claim's ACK or exact
    // persisted refusal evidence authorizes transport retirement.
    if (input.threadExists) {
      return "wait";
    }
    // Wait for the shell to be live before sending: until the thread list has
    // synchronized, a previously delivered creation whose cleanup failed would
    // look missing and get re-issued, duplicating the thread.
    return input.environmentConnected && input.shellStatus === "live" ? "send" : "wait";
  }
  if (!input.threadExists) {
    return "wait";
  }
  return input.environmentConnected ? "send" : "wait";
}

export type ThreadOutboxDispatchStep =
  | { readonly step: "wait" }
  | { readonly step: "retry" }
  | { readonly step: "restore"; readonly reason: string }
  | { readonly step: "send" };

/**
 * Wait for provider and file capabilities before sending. Shell existence
 * or absence never grants removal authority.
 */
export function resolveThreadOutboxDispatchStep(input: {
  readonly deliveryAction: ThreadOutboxDeliveryAction;
  readonly fileAttachments: ReadonlyArray<{ readonly name: string; readonly sizeBytes: number }>;
  /** Null while the environment's server config has not synced yet. */
  readonly serverConfig: { readonly maxFileUploadBytes: number | undefined } | null;
}): ThreadOutboxDispatchStep {
  if (input.deliveryAction !== "send") {
    return { step: input.deliveryAction };
  }
  if (input.serverConfig === null) {
    return { step: "retry" };
  }
  if (input.fileAttachments.length === 0) {
    return { step: "send" };
  }
  const maxBytes = input.serverConfig.maxFileUploadBytes;
  if (maxBytes === undefined) {
    return { step: "restore", reason: "This server does not support file attachments." };
  }
  const effectiveMaxBytes = clampFileAttachmentUploadBytes(maxBytes);
  const oversized = input.fileAttachments.find(
    (attachment) => attachment.sizeBytes > effectiveMaxBytes,
  );
  return oversized
    ? { step: "restore", reason: fileAttachmentTooLargeMessage(oversized.name, effectiveMaxBytes) }
    : { step: "send" };
}

/**
 * A queued creation can only be dispatched once its payload would pass server
 * validation; incomplete payloads stay pending until the user edits them.
 */
export function isQueuedThreadCreationSendable(message: QueuedThreadMessage): boolean {
  if (!message.creation) {
    return false;
  }
  if (message.text.trim().length === 0 || message.modelSelection === undefined) {
    return false;
  }
  return message.creation.workspaceMode !== "worktree" || Boolean(message.creation.branch);
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return typeof error === "string" ? error : null;
}

/**
 * Only a failure the server actually decided (`OrchestrationDispatchCommandError`,
 * or an authorization rejection) means the payload itself is bad. The other
 * typed failures a queued send can hit are transport-shaped: a socket that
 * dropped mid-request (`RpcClientError` wrapping a Socket read/write/close
 * reason), or an environment that is not connected or not registered. Those
 * are matched by tag, not by message text, because a `SocketReadError` message
 * is just "An error occurred during Read". A wrong answer here restores the
 * pending task into a draft and it disappears from the list.
 */
export function shouldRetryThreadOutboxDelivery(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    switch (error._tag) {
      case "OrchestrationDispatchCommandError":
      case "EnvironmentAuthorizationError":
        return false;
      case "ConnectionTransientError":
      case "RpcClientError":
      case "EnvironmentRpcUnavailableError":
      case "EnvironmentNotRegisteredError":
        return true;
      default:
        break;
    }
  }
  return isTransportConnectionErrorMessage(errorMessage(error));
}

export type ThreadOutboxCommandStage = "settings-sync" | "start-turn";
export type ThreadOutboxFailureAction = "retry" | "restore";

export function resolveThreadOutboxFailureAction(input: {
  readonly stage: ThreadOutboxCommandStage;
  readonly error: unknown;
  readonly interrupted: boolean;
}): ThreadOutboxFailureAction {
  if (
    input.stage === "settings-sync" ||
    input.interrupted ||
    shouldRetryThreadOutboxDelivery(input.error)
  ) {
    return "retry";
  }
  return "restore";
}
