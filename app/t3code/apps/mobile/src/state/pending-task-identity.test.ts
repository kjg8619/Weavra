import { describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { findQueuedPendingTask, pendingTaskDraftKey } from "./pending-task-identity";

const message: QueuedThreadMessage = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
  commandId: CommandId.make("command"),
  text: "pending",
  attachments: [],
  createdAt: "2026-10-04T00:00:00.000Z",
  creation: {
    projectId: ProjectId.make("project"),
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
  },
};

describe("pending task identity", () => {
  it("selects only the exact scoped task among repeated message IDs", () => {
    const otherEnvironment = { ...message, environmentId: EnvironmentId.make("other") };
    const otherThread = { ...message, threadId: ThreadId.make("other") };
    const messages = [message, otherEnvironment, otherThread];
    for (const candidate of messages) {
      expect(findQueuedPendingTask(pendingTaskDraftKey(candidate), messages)).toBe(candidate);
    }
    expect(new Set(messages.map(pendingTaskDraftKey)).size).toBe(3);
  });

  it("keeps the editor key when a creation moves to another transport environment", () => {
    const moved = {
      ...message,
      environmentId: EnvironmentId.make("destination"),
      storageIdentity: {
        environmentId: message.environmentId,
        threadId: message.threadId,
        messageId: message.messageId,
      },
    };
    expect(pendingTaskDraftKey(moved)).toBe(pendingTaskDraftKey(message));
    expect(findQueuedPendingTask(pendingTaskDraftKey(message), [moved])).toBe(moved);
  });

  it("resolves an old raw ID only for an unambiguous creation", () => {
    expect(findQueuedPendingTask(message.messageId, [message])).toBe(message);
    expect(
      findQueuedPendingTask(message.messageId, [
        message,
        { ...message, environmentId: EnvironmentId.make("other") },
      ]),
    ).toBeNull();
    expect(
      findQueuedPendingTask(message.messageId, [
        message,
        { ...message, threadId: ThreadId.make("other") },
      ]),
    ).toBeNull();
    expect(findQueuedPendingTask(message.messageId, [message, { ...message }])).toBeNull();
  });

  it("rejects missing routes and existing-thread messages", () => {
    expect(findQueuedPendingTask("missing", [message])).toBeNull();
    expect(
      findQueuedPendingTask(message.messageId, [{ ...message, creation: undefined }]),
    ).toBeNull();
    expect(findQueuedPendingTask("pending-task:[malformed]", [message])).toBeNull();
  });
});
