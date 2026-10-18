import { canInvokeQueuedMessage, queuedMessageScopeCurrent } from "./thread-outbox-scope";
import { useThreadOutboxRefusals } from "./use-thread-outbox-refusals";
export { canInvokeQueuedMessage } from "./thread-outbox-scope";
import { useAtomValue } from "@effect/atom-react";
import { absurd as assertNever } from "effect/Function";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import { completeQueuedMessageDelivery } from "./thread-outbox-acknowledgment";
import { useProjects, useServerConfigs, useThreadShells } from "./entities";
import { environmentSession } from "./session";
import {
  clearPendingThreadCreationOutcome,
  pendingThreadCreationOutcomesAtom,
  recordPendingThreadCreationOutcome,
} from "./pending-thread-creation";
import { threadOutboxManager } from "./thread-outbox";
import { createThreadOutboxDelivery, type OutboxAcknowledgment } from "./thread-outbox-delivery";
import { canPrepareQueuedMessage, firstEligibleOutboxMessage } from "./thread-outbox-preparation";
import { pendingTaskDraftKey } from "./pending-task-identity";
import { createThreadOutboxDrainWake } from "./thread-outbox-drain-wake";
import { createThreadOutboxRunner } from "./thread-outbox-drain-run";
import { restoreRejectedQueuedMessage } from "./thread-outbox-restoration";
import {
  isQueuedThreadCreationSendable,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxDispatchStep,
  threadOutboxStorageIdentity,
} from "./thread-outbox-model";
import { threadEnvironment } from "./threads";
import { composerDraftsAtom, waitForComposerDraftsLoaded } from "./use-composer-drafts";
import { useAtomCommand } from "./use-atom-command";
import {
  dispatchingQueuedMessageIdAtom,
  editingQueuedMessageIdsAtom,
  useThreadOutboxMessages,
  useThreadOutboxShellStatuses,
} from "./use-thread-outbox";
import { useRemoteConnectionStatus } from "./use-remote-environment-registry";

export { prepareQueuedMessageAttachments } from "./thread-outbox-preparation";
export { restoreRejectedQueuedMessage } from "./thread-outbox-restoration";
export { completeQueuedMessageDelivery } from "./thread-outbox-acknowledgment";

export function useThreadOutboxDrain(): void {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, { reportFailure: false });
  const setInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const deliver = useMemo(
    () =>
      createThreadOutboxDelivery({ startTurn, updateMetadata, setRuntimeMode, setInteractionMode }),
    [startTurn, updateMetadata, setRuntimeMode, setInteractionMode],
  );
  const dispatching = useAtomValue(dispatchingQueuedMessageIdAtom);
  const editors = useAtomValue(editingQueuedMessageIdsAtom);
  const drafts = useAtomValue(composerDraftsAtom);
  const queues = useThreadOutboxMessages();
  const inventoryReady = useAtomValue(threadOutboxManager.inventoryReadyAtom);
  const shells = useThreadOutboxShellStatuses();
  const threads = useThreadShells();
  const projects = useProjects();
  const configs = useServerConfigs();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const creationOutcomes = useAtomValue(pendingThreadCreationOutcomesAtom);
  const [retryTick, setRetryTick] = useState(0);
  const [retries] = useState(() =>
    createThreadOutboxDrainWake(() => setRetryTick((tick) => tick + 1)),
  );
  const [acknowledgments] = useState(() => new Map<string, OutboxAcknowledgment>());
  const [draftsReady, setDraftsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      await waitForComposerDraftsLoaded();
      const loaded = await threadOutboxManager.load();
      if (!mounted) return;
      setDraftsReady(true);
      if (!loaded)
        Alert.alert(
          "Some queued messages could not be loaded",
          "Records and attachments are retained. Sending waits for a complete inventory.",
          [
            { text: "Dismiss", style: "cancel" },
            { text: "Retry", onPress: () => void load() },
          ],
        );
    };
    void load().catch((error: unknown) =>
      console.warn("[thread-outbox] draft hydration failed", error),
    );
    return () => {
      mounted = false;
      retries.cancelTimers();
    };
  }, [retries]);

  useThreadOutboxRefusals(queues);

  useEffect(() => {
    for (const [key, outcome] of Object.entries(creationOutcomes)) {
      if (
        outcome.kind === "delivered" &&
        threads.some(
          (thread) =>
            scopedThreadKey(thread.environmentId, thread.id) === key && thread.latestTurn !== null,
        )
      ) {
        clearPendingThreadCreationOutcome(key);
      }
    }
  }, [creationOutcomes, threads]);

  useEffect(() => {
    if (!draftsReady || dispatching !== null) return;
    if (!inventoryReady) {
      const retained = Object.values(queues).flat()[0];
      if (retained !== undefined) retries.reconcile(retained);
      return;
    }
    const finish = createThreadOutboxRunner(retries);
    for (const [key, ack] of acknowledgments) {
      if (retries.isBlocked(ack.submitted)) continue;
      finish(ack.submitted, () =>
        completeQueuedMessageDelivery(ack).then((complete) => {
          if (complete) acknowledgments.delete(key);
          return complete;
        }),
      );
      return;
    }
    for (const queue of Object.values(queues)) {
      // Quarantine is not a FIFO barrier for independently eligible work.
      const message = firstEligibleOutboxMessage(queue);
      if (message === undefined || retries.isBlocked(message) || !canInvokeQueuedMessage(message))
        continue;
      const environment = connectedEnvironments.find(
        (candidate) => candidate.environmentId === message.environmentId,
      );
      if (
        environment?.connectionState !== "connected" ||
        !environment.isEnabled ||
        editors[threadOutboxStorageIdentity(message)] ||
        drafts[pendingTaskDraftKey(message)] ||
        drafts[`pending-task:${message.messageId}`]
      )
        continue;
      const thread = threads.find(
        (candidate) =>
          candidate.environmentId === message.environmentId && candidate.id === message.threadId,
      );
      if (
        resolveThreadOutboxDeliveryAction({
          isCreation: message.creation !== undefined,
          threadExists: thread !== undefined,
          shellStatus: shells.get(message.environmentId) ?? "empty",
          environmentConnected: true,
          threadBusy: thread?.session?.status === "running",
        }) !== "send"
      )
        continue;
      const config = configs.get(message.environmentId);
      const step = resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: message.attachments.filter((attachment) => attachment.type === "file"),
        serverConfig: config
          ? { maxFileUploadBytes: config.environment.capabilities.fileAttachments?.maxUploadBytes }
          : null,
      });
      if (step.step === "restore") {
        finish(message, () =>
          restoreRejectedQueuedMessage(message, step.reason, () =>
            queuedMessageScopeCurrent(message),
          ).then((result) => result === "restored" || result === "deferred"),
        );
        return;
      }
      if (step.step !== "send") continue;
      if (message.creation && !isQueuedThreadCreationSendable(message)) continue;
      const cwd = message.creation
        ? (projects.find(
            (project) =>
              project.environmentId === message.environmentId &&
              project.id === message.creation?.projectId,
          )?.workspaceRoot ??
          message.creation.projectCwd ??
          null)
        : null;
      if (message.creation && cwd === null) continue;
      const connection = appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(message.environmentId),
      );
      finish(message, () =>
        deliver({
          message,
          thread,
          projectCwd: cwd,
          canInvoke: () =>
            canInvokeQueuedMessage(message) &&
            appAtomRegistry.get(
              environmentSession.preparedConnectionValueAtom(message.environmentId),
            ) === connection,
        }).then(async (result) => {
          switch (result.status) {
            case "retry":
              return false;
            case "retained": {
              const current = threadOutboxManager.recordAt(message.storageIdentity ?? message);
              return current === null || !canPrepareQueuedMessage(current);
            }
            case "acknowledged": {
              const ack = result.acknowledgment;
              const key = threadOutboxStorageIdentity(ack.submitted);
              acknowledgments.set(key, ack);
              if (ack.submitted.creation)
                recordPendingThreadCreationOutcome({ kind: "delivered", message: ack.submitted });
              const complete = await completeQueuedMessageDelivery(ack);
              if (complete) acknowledgments.delete(key);
              return complete;
            }
            default:
              return assertNever(result);
          }
        }),
      );
      return;
    }
  }, [
    draftsReady,
    inventoryReady,
    dispatching,
    queues,
    threads,
    projects,
    configs,
    connectedEnvironments,
    shells,
    editors,
    drafts,
    retryTick,
    retries,
    acknowledgments,
    deliver,
  ]);
}
