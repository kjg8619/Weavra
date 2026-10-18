import { MessageId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  applyChatControlDraft,
  latestChatControlDraft,
  reuseControlDraft,
  useProjectControlDrafts,
  type ChatControlDraft,
} from "./projectControlDraft";
import { taskDraftFields } from "./weavraTaskLogic";

const candidate = {
  version: 1,
  goal: "Implement the inventory screen",
  symptom: "The project has no inventory screen",
  criteria: ["Inventory items are displayed", "Selection updates the details"],
  constraints: ["Keep existing navigation"],
} satisfies ChatControlDraft;
const response = (value: unknown) => ({
  id: MessageId.make("candidate-message"),
  role: "assistant" as const,
  text: "```weavra-control\n" + JSON.stringify(value) + "\n```",
  streaming: false,
});

beforeEach(async () => {
  await useProjectControlDrafts.persist.clearStorage();
  useProjectControlDrafts.setState({ byTask: {} });
});

describe("chat control candidates", () => {
  it("decodes a completed assistant packet without granting any execution authority", () => {
    const result = latestChatControlDraft([response(candidate)]);
    expect(result?.messageId).toBe("candidate-message");
    expect(result?.draft).toEqual(candidate);
    expect(applyChatControlDraft(taskDraftFields(null), candidate)).toMatchObject({
      goal: "Implement the inventory screen",
      criteria: "Inventory items are displayed\nSelection updates the details",
      observations: [],
      symptomCheck: "",
    });
  });

  it.each(["user", "reasoning"] as const)("ignores %s packets", (role) => {
    expect(latestChatControlDraft([{ ...response(candidate), role }])).toBeNull();
  });

  it("does not apply an unfinished response or malformed JSON", () => {
    expect(latestChatControlDraft([{ ...response(candidate), streaming: true }])).toBeNull();
    expect(
      latestChatControlDraft([{ ...response(candidate), text: "```weavra-control\n{\n```" }]),
    ).toBeNull();
  });

  it("rejects extra permission fields and oversized candidate packets", () => {
    expect(latestChatControlDraft([response({ ...candidate, approved: true })])).toBeNull();
    expect(latestChatControlDraft([response({ ...candidate, goal: "x".repeat(8193) })])).toBeNull();
  });

  it("uses the newest valid completed candidate instead of a later invalid one", () => {
    expect(
      latestChatControlDraft([
        response(candidate),
        { ...response({ ...candidate, criteria: [] }), id: MessageId.make("invalid") },
      ])?.draft.goal,
    ).toBe("Implement the inventory screen");
  });

  it("rejects criteria beyond the actual structured limit", () => {
    expect(
      latestChatControlDraft([
        response({
          ...candidate,
          criteria: Array.from({ length: 17 }, (_, index) => String(index)),
        }),
      ]),
    ).toBeNull();
  });
});

describe("saved control drafts", () => {
  it("reuses saved required fields only where input is blank", () => {
    const saved = {
      ...taskDraftFields(null),
      goal: "Saved goal",
      symptom: "Saved situation",
      criteria: "Saved criterion",
      constraints: "Saved constraint",
    };
    const input = {
      ...taskDraftFields(null),
      goal: "New goal",
      symptom: " ",
      hypothesis: "New hypothesis",
    };
    expect(reuseControlDraft(input, saved)).toMatchObject({
      goal: "New goal",
      symptom: "Saved situation",
      criteria: "Saved criterion",
      constraints: "Saved constraint",
      hypothesis: "New hypothesis",
    });
  });

  it("retains a scoped draft across rehydration without sharing another project", async () => {
    const key = JSON.stringify(["environment", "project-a", "thread", "task"]);
    const otherKey = JSON.stringify(["environment", "project-b", "thread", "task"]);
    const fields = {
      ...taskDraftFields(null),
      goal: "Keep local edits",
      criteria: "Pending criterion",
    };
    useProjectControlDrafts.getState().setDraft(key, fields);
    const options = useProjectControlDrafts.persist.getOptions();
    const storage = options.storage;
    const name = options.name;
    if (!storage || !name) throw new Error("Expected configured draft storage");
    const persisted = await storage.getItem(name);
    if (!persisted) throw new Error("Expected persisted draft");
    useProjectControlDrafts.setState({ byTask: {} });
    await storage.setItem(name, persisted);
    await useProjectControlDrafts.persist.rehydrate();
    expect(useProjectControlDrafts.getState().byTask[key]).toEqual(fields);
    expect(useProjectControlDrafts.getState().byTask[otherKey]).toBeUndefined();
  });
});
