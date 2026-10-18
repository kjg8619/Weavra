import { useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";
import { clearComposerDraftContent } from "../../state/use-composer-drafts";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { pendingTaskDraftKey } from "../../state/pending-task-identity";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { currentThreadOutboxPresentation } from "../../state/thread-outbox-presentation";

export function usePendingTaskListActions(): {
  readonly openPendingTask: (pendingTask: PendingNewTask) => void;
  readonly confirmDeletePendingTask: (pendingTask: PendingNewTask) => void;
  readonly retainedMessage: QueuedThreadMessage | null;
  readonly closeRetainedWork: () => void;
} {
  const navigation = useNavigation();
  const [retainedMessage, setRetainedMessage] = useState<QueuedThreadMessage | null>(null);

  const openPendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      if (
        pendingTask.kind === "pending" &&
        currentThreadOutboxPresentation(pendingTask.message).kind !== "ready"
      ) {
        setRetainedMessage(pendingTask.message);
        return;
      }
      navigation.navigate("NewTaskSheet", {
        screen: "NewTaskDraft",
        params: {
          environmentId: String(pendingTask.environmentId),
          projectId: String(pendingTask.projectId),
          ...(pendingTask.kind === "pending"
            ? { pendingTaskId: pendingTaskDraftKey(pendingTask.message) }
            : { draftId: pendingTask.draftKey }),
        },
      });
    },
    [navigation],
  );

  const confirmDeletePendingTask = useCallback((pendingTask: PendingNewTask) => {
    if (pendingTask.kind === "draft") {
      Alert.alert("Discard draft?", `“${pendingTask.title}” will be removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            // Same reset a submit performs: the next task in this project
            // re-resolves project defaults instead of inheriting the pick.
            clearComposerDraftContent(pendingTask.draftKey, {
              clearModelSelection: true,
              clearWorkspaceSelection: true,
            });
          },
        },
      ]);
      return;
    }
    Alert.alert(
      "Delete pending task?",
      `“${pendingTask.title}” will be discarded locally. This does not undo any recorded attempt or acknowledged transport.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void removeThreadOutboxMessage(pendingTask.message)
              .then((released) => {
                if (!released)
                  Alert.alert(
                    "Edited content retained",
                    "This task has newer work or an open editor. Its retained content was not deleted.",
                  );
              })
              .catch((error) => {
                Alert.alert(
                  "Could not delete pending task",
                  error instanceof Error ? error.message : "The pending task could not be removed.",
                );
              });
          },
        },
      ],
    );
  }, []);

  return {
    openPendingTask,
    confirmDeletePendingTask,
    retainedMessage,
    closeRetainedWork: () => setRetainedMessage(null),
  };
}
