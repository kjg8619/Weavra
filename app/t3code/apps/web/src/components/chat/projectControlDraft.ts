import { type MessageId, WeavraTaskFinding } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "../../lib/storage";
import type { ChatMessage } from "../../types";
import type { TaskDraftFields } from "./weavraTaskLogic";

const nonempty = (max: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max), Schema.isPattern(/\S/));
const candidate = Schema.Struct({
  version: Schema.Literal(1),
  goal: nonempty(2048),
  symptom: nonempty(1000),
  criteria: Schema.Array(nonempty(500)).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  constraints: Schema.optionalKey(Schema.Array(nonempty(250)).check(Schema.isMaxLength(8))),
});
const decodeCandidate = Schema.decodeUnknownOption(Schema.fromJsonString(candidate), {
  onExcessProperty: "error",
});
export type ChatControlDraft = typeof candidate.Type;
export function decodeChatControlDraft(json: string): ChatControlDraft | null {
  if (new TextEncoder().encode(json).length > 8192) return null;
  const decoded = decodeCandidate(json);
  return Option.isSome(decoded) ? decoded.value : null;
}
const draftFields = Schema.Struct({
  goal: Schema.String,
  symptom: Schema.String,
  hypothesis: Schema.String,
  uncertainties: Schema.String,
  constraints: Schema.String,
  criteria: Schema.String,
  sources: Schema.String,
  symptomCriterion: Schema.String,
  symptomCheck: Schema.String,
  observations: Schema.Array(WeavraTaskFinding).check(Schema.isMaxLength(8)),
});
const decodeStored = Schema.decodeUnknownOption(Schema.Record(Schema.String, draftFields), {
  onExcessProperty: "error",
});

interface ControlDrafts {
  readonly byTask: Readonly<Record<string, TaskDraftFields>>;
  readonly setDraft: (key: string, fields: TaskDraftFields) => void;
}

export const useProjectControlDrafts = create<ControlDrafts>()(
  persist(
    (set) => ({
      byTask: {},
      setDraft: (key, fields) =>
        set((state) => ({
          byTask: { ...state.byTask, [key]: fields },
        })),
    }),
    {
      name: "weavra:control-drafts:v1",
      storage: createJSONStorage(() => resolveStorage(globalThis.localStorage)),
      partialize: (state) => ({ byTask: state.byTask }),
      merge: (persisted, current) => {
        const raw =
          typeof persisted === "object" && persisted !== null && "byTask" in persisted
            ? persisted.byTask
            : {};
        return { ...current, byTask: Option.getOrElse(decodeStored(raw), () => ({})) };
      },
    },
  ),
);

export function reuseControlDraft(
  fields: TaskDraftFields,
  saved: TaskDraftFields,
): TaskDraftFields {
  return {
    ...fields,
    goal: fields.goal.trim() ? fields.goal : saved.goal,
    symptom: fields.symptom.trim() ? fields.symptom : saved.symptom,
    criteria: fields.criteria.trim() ? fields.criteria : saved.criteria,
    constraints: fields.constraints.trim() ? fields.constraints : saved.constraints,
  };
}

export function applyChatControlDraft(
  fields: TaskDraftFields,
  draft: ChatControlDraft,
): TaskDraftFields {
  return {
    ...fields,
    goal: draft.goal,
    symptom: draft.symptom,
    criteria: draft.criteria.join("\n"),
    constraints: draft.constraints?.join("\n") ?? fields.constraints,
  };
}

export function latestChatControlDraft(
  messages: readonly Pick<ChatMessage, "id" | "role" | "text" | "streaming">[],
): { readonly messageId: MessageId; readonly draft: typeof candidate.Type } | null {
  for (let index = messages.length - 1; index >= Math.max(0, messages.length - 50); index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || message.streaming) continue;
    const blocks = message.text.matchAll(/```weavra-control[ \t]*\r?\n([\s\S]*?)\r?\n```/g);
    let found: typeof candidate.Type | null = null;
    for (const block of blocks) {
      const json = block[1];
      if (json === undefined) continue;
      const decoded = decodeChatControlDraft(json);
      if (decoded) found = decoded;
    }
    if (found) return { messageId: message.id, draft: found };
  }
  return null;
}
