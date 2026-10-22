import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";
import { MAX_CUSTOM_MODEL_LENGTH } from "../../modelSelection";
import { ko } from "~/i18n/ko";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
    useEffect: () => undefined,
  };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import {
  ProviderModelsSection,
  groupModelsForDisplay,
  nextHiddenModelsForBulkToggle,
} from "./ProviderModelsSection";

function model(slug: string, isCustom = false): ServerProviderModel {
  return { slug, name: slug, isCustom, capabilities: null };
}

describe("groupModelsForDisplay", () => {
  it("lists favorites first, then visible models in user order, then hidden ones", () => {
    const models = [model("a"), model("b"), model("c"), model("d"), model("custom", true)];

    const display = groupModelsForDisplay(models, {
      favoriteModels: new Set(["c"]),
      hiddenModels: new Set(["a", "custom"]),
      modelOrder: ["d", "b"],
    });

    // A custom model is never hidden, even if its slug is in the hidden set.
    expect(display.map((entry) => entry.slug)).toEqual(["c", "d", "b", "custom", "a"]);
  });
});

describe("nextHiddenModelsForBulkToggle", () => {
  it("hides every built-in model without hiding custom models", () => {
    const models = [model("a"), model("b"), model("custom", true)];

    expect(nextHiddenModelsForBulkToggle(models, ["a"])).toEqual(["a", "b"]);
  });

  it("shows every built-in model while preserving unrelated hidden entries", () => {
    const models = [model("a"), model("b"), model("custom", true)];

    expect(nextHiddenModelsForBulkToggle(models, ["a", "b", "legacy", "custom"])).toEqual([
      "legacy",
      "custom",
    ]);
  });
});

describe("custom model decisions", () => {
  beforeEach(() => hooks.reset());

  function setup() {
    const save = vi.fn();
    const render = () => {
      hooks.beginRender();
      return ProviderModelsSection({
        instanceId: ProviderInstanceId.make("codex"),
        driverKind: ProviderDriverKind.make("codex"),
        models: [model("built-in")],
        customModels: [],
        hiddenModels: [],
        favoriteModels: [],
        modelOrder: [],
        onChange: save,
        onHiddenModelsChange: vi.fn(),
        onFavoriteModelsChange: vi.fn(),
        onModelOrderChange: vi.fn(),
      });
    };
    const click = (tree: unknown, text: string) => {
      const button = visitElements(tree, (e) => e.props.children === text);
      if (!button || typeof button.props.onClick !== "function") throw new Error("Missing action");
      button.props.onClick();
    };
    const fill = (value: string) => {
      const input = visitElements(
        render(),
        (e) => e.props.id === "provider-instance-codex-custom-model",
      );
      if (!input || typeof input.props.onChange !== "function")
        throw new Error("Missing model field");
      input.props.onChange({ target: { value } });
    };
    const open = visitElements(
      render(),
      (e) =>
        Array.isArray(e.props.children) &&
        e.props.children.includes(ko.providers.models.addCustomModel),
    );
    if (!open || typeof open.props.onClick !== "function") throw new Error("Missing add action");
    open.props.onClick();
    return { render, click, fill, save };
  }

  it.each(["", "   ", "built-in", "x".repeat(MAX_CUSTOM_MODEL_LENGTH + 1)])(
    "rejects invalid model %s without saving",
    (value) => {
      const form = setup();
      form.fill(value);
      form.click(form.render(), ko.common.add);
      expect(form.save).not.toHaveBeenCalled();
      expect(visitElements(form.render(), (e) => e.props["aria-invalid"] === true)).not.toBeNull();
    },
  );

  it("saves a corrected long ID once with its exact normalized value", () => {
    const form = setup();
    form.fill("x".repeat(MAX_CUSTOM_MODEL_LENGTH + 1));
    form.click(form.render(), ko.common.add);
    const slug = "x".repeat(MAX_CUSTOM_MODEL_LENGTH);
    form.fill(slug);
    form.click(form.render(), ko.common.add);
    expect(form.save).toHaveBeenCalledExactlyOnceWith([{ slug, name: slug, capabilities: null }]);
  });

  it("cancels an unsaved long ID without changing saved models", () => {
    const form = setup();
    form.fill("unsaved-".repeat(30));
    form.click(form.render(), ko.common.cancel);
    expect(form.save).not.toHaveBeenCalled();
    expect(
      visitElements(form.render(), (e) => e.props.id === "provider-instance-codex-custom-model"),
    ).toBeNull();
  });
});
