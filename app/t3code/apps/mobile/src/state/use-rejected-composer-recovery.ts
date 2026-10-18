import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useMemo } from "react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { stableStringify } from "@t3tools/shared/relaySigning";
import type { MessageId, ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import { composerCloudDraftsAtom, getComposerDraftSnapshot } from "./use-composer-drafts";
import { environmentSession, usePreparedConnection } from "./session";
import { serverEnvironment } from "./server";
import { environmentThreads } from "./threads";
import { selectRejectedComposerSource } from "../lib/rejectedComposerSource";
import { scopedThreadKey } from "../lib/scopedEntities";
import {
  canFocusRejectedComposerSend,
  createRejectedComposerGeneration,
  checkRejectedComposerOperation,
  discardRejectedComposer,
  recoverRejectedComposer,
  rejectedComposerOperationsAtom,
  type RejectedComposerOwner,
} from "./rejected-composer-operations";

export function useRejectedComposerRecovery(input: {
  readonly scope: ScopedThreadRef;
  readonly source: Parameters<typeof selectRejectedComposerSource>[0]["source"];
  readonly settings: readonly [
    QueuedThreadMessage["modelSelection"],
    QueuedThreadMessage["runtimeMode"],
    QueuedThreadMessage["interactionMode"],
    ServerConfig | null | undefined,
  ];
}) {
  const navigation = useNavigation();
  const account = useAtomValue(composerCloudDraftsAtom).accountId;
  const connection = usePreparedConnection(input.scope.environmentId);
  const states = useAtomValue(rejectedComposerOperationsAtom);
  const key = JSON.stringify([input.scope.environmentId, input.scope.threadId, account]);
  const signature = stableStringify([key, input.settings, input.source.synchronized]);
  const prepared = Option.getOrNull(connection);
  const lifetime = useMemo(
    () => ({
      key,
      signature,
      prepared,
      account,
      scope: input.scope,
      synchronized: input.source.synchronized,
      generation: createRejectedComposerGeneration(),
    }),
    [key, signature, prepared, account, input.scope, input.source.synchronized],
  );
  useFocusEffect(
    useCallback(() => {
      lifetime.generation.activate();
      return () => lifetime.generation.deactivate();
    }, [lifetime]),
  );
  useLayoutEffect(() => {
    const { generation, scope } = lifetime;
    generation.activate();
    const detailAtom = environmentThreads.stateAtom(scope.environmentId, scope.threadId);
    const readDetail = () => appAtomRegistry.get(detailAtom);
    const settingsOf = (result: ReturnType<typeof readDetail>) => {
      const state = Option.getOrNull(AsyncResult.value(result));
      const detail = state ? Option.getOrNull(state.data) : null;
      return stableStringify([
        state?.status,
        detail?.modelSelection,
        detail?.runtimeMode,
        detail?.interactionMode,
      ]);
    };
    let detailSettings = settingsOf(appAtomRegistry.get(detailAtom));
    // Subscribe to changes themselves, not just rendered values: batched A/B/A
    // account/connection/config transitions must still consume an old action.
    const releases = [
      appAtomRegistry.subscribe(composerCloudDraftsAtom, () => generation.invalidate()),
      appAtomRegistry.subscribe(
        environmentSession.preparedConnectionValueAtom(scope.environmentId),
        () => generation.invalidate(),
      ),
      appAtomRegistry.subscribe(serverEnvironment.configValueAtom(scope.environmentId), () =>
        generation.invalidate(),
      ),
      appAtomRegistry.subscribe(detailAtom, (result) => {
        const next = settingsOf(result);
        if (next !== detailSettings) generation.invalidate();
        detailSettings = next;
      }),
    ];
    return () => {
      generation.deactivate();
      releases.forEach((release) => release());
    };
  }, [lifetime]);
  const capture = useCallback((): RejectedComposerOwner => {
    const action = lifetime.generation.capture();
    const capturedAccount = appAtomRegistry.get(composerCloudDraftsAtom).accountId;
    const capturedConnection = Option.getOrNull(
      appAtomRegistry.get(
        environmentSession.preparedConnectionValueAtom(lifetime.scope.environmentId),
      ),
    );
    const isCurrentScope = () =>
      action.isCurrent() &&
      navigation.isFocused() &&
      lifetime.synchronized &&
      capturedConnection !== null &&
      capturedConnection === lifetime.prepared &&
      capturedAccount === lifetime.account &&
      capturedAccount === appAtomRegistry.get(composerCloudDraftsAtom).accountId &&
      capturedConnection ===
        Option.getOrNull(
          appAtomRegistry.get(
            environmentSession.preparedConnectionValueAtom(lifetime.scope.environmentId),
          ),
        );
    let renderedSettingsCurrent = false;
    if (isCurrentScope()) {
      const result = appAtomRegistry.get(
        environmentThreads.stateAtom(lifetime.scope.environmentId, lifetime.scope.threadId),
      );
      const state = Option.getOrNull(AsyncResult.value(result));
      const detail = state ? Option.getOrNull(state.data) : null;
      const draft = getComposerDraftSnapshot(
        scopedThreadKey(lifetime.scope.environmentId, lifetime.scope.threadId),
      );
      renderedSettingsCurrent =
        state?.status === "live" &&
        detail?.id === lifetime.scope.threadId &&
        stableStringify([
          lifetime.key,
          [
            draft.modelSelection ?? detail.modelSelection,
            draft.runtimeMode ?? detail.runtimeMode,
            draft.interactionMode ?? detail.interactionMode,
            appAtomRegistry.get(serverEnvironment.configValueAtom(lifetime.scope.environmentId)),
          ],
          true,
        ]) === lifetime.signature;
    }
    return {
      ...action,
      key: lifetime.key,
      scope: lifetime.scope,
      isCurrent: () => renderedSettingsCurrent && isCurrentScope(),
      readSource: () => {
        const result = appAtomRegistry.get(
          environmentThreads.stateAtom(lifetime.scope.environmentId, lifetime.scope.threadId),
        );
        const state = Option.getOrNull(AsyncResult.value(result));
        const detail = state ? Option.getOrNull(state.data) : null;
        return {
          scope: lifetime.scope,
          synchronized:
            lifetime.synchronized &&
            state?.status === "live" &&
            detail?.id === lifetime.scope.threadId,
          messages: detail?.messages ?? [],
          activities: detail?.activities ?? [],
        };
      },
    };
  }, [lifetime, navigation]);
  return {
    capture,
    state: states[key],
    canFocusSend: (id: MessageId) => canFocusRejectedComposerSend(key, id),
    recover: (id: MessageId) => recoverRejectedComposer(capture(), id),
    check: () => checkRejectedComposerOperation(capture()),
    discard: () => discardRejectedComposer(capture()),
  };
}
