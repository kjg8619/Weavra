import { describe, expect, it } from "vite-plus/test";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";

import { resolveShortcutCommand } from "../../keybindings";
import {
  buildKeybindingRows,
  buildKeybindingCommandOptions,
  buildWhenVariableOptions,
  commandLabel,
  groupKeybindingRows,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  parseWhenExpressionDraft,
  shortcutToKeybindingInput,
  unknownWhenVariables,
  whenAstToExpression,
  whenNodeRemoveLabel,
} from "./KeybindingsSettings.logic";

describe("KeybindingsSettings.logic", () => {
  it("groups default aliases without dropping any editable binding or changing its AST", () => {
    const rows = buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS, "");

    const groups = groupKeybindingRows(rows);

    expect(groups.flat()).toHaveLength(DEFAULT_RESOLVED_KEYBINDINGS.length);
    expect(new Set(groups.flat().map((row) => row.id))).toEqual(new Set(rows.map((row) => row.id)));
    for (const group of groups) {
      expect(new Set(group.map((row) => row.command)).size).toBe(1);
      expect(new Set(group.map((row) => JSON.stringify(row.binding.whenAst))).size).toBe(1);
      for (const row of group) {
        expect(row.binding).toBe(DEFAULT_RESOLVED_KEYBINDINGS.find((b) => b === row.binding));
        expect(parseWhenExpressionDraft(row.when)).toEqual({
          ok: true,
          value: row.binding.whenAst,
        });
      }
    }
    const chatAliases = groups.find((group) => group[0]?.command === "chat.new");
    expect(chatAliases?.map((row) => row.key).toSorted()).toEqual(["mod+n", "mod+shift+o"]);
    expect(groups.find((group) => group[0]?.command === "chat.newLocal")).not.toBe(chatAliases);
  });

  it("keeps distinct applicability and custom variables in independently editable groups", () => {
    const binding = DEFAULT_RESOLVED_KEYBINDINGS.find((b) => b.command === "chat.new");
    expect(binding).toBeDefined();
    if (!binding) throw new Error("Missing chat.new default binding");
    const customAst = parseKeybindingWhenExpression("customModeActive || !terminalFocus");
    if (!customAst) throw new Error("Custom expression did not parse");
    const rows = buildKeybindingRows([binding, { ...binding, whenAst: customAst }], "");

    const groups = groupKeybindingRows(rows);

    expect(groups).toHaveLength(2);
    expect(groups.flat().map((row) => row.binding.whenAst)).toContain(customAst);
    expect(unknownWhenVariables(customAst)).toEqual(["customModeActive"]);
    expect(parseWhenExpressionDraft(whenAstToExpression(customAst))).toEqual({
      ok: true,
      value: customAst,
    });
  });

  it.each([
    "!(terminalFocus || (terminalOpen && modelPickerOpen))",
    "(terminalFocus || terminalOpen) && !modelPickerOpen",
    "terminalFocus || (terminalOpen && !modelPickerOpen)",
    "customModeActive && (isDesktop || !isWeb)",
    "true && !false",
  ])("preserves resolver outcomes after serializing the displayed AST for %s", (expression) => {
    const ast = parseKeybindingWhenExpression(expression);
    if (!ast) throw new Error("Fixture expression did not parse");
    const parsed = parseWhenExpressionDraft(whenAstToExpression(ast));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Serialized expression did not parse");
    const shortcut = DEFAULT_RESOLVED_KEYBINDINGS[0]?.shortcut;
    expect(shortcut).toBeDefined();
    if (!shortcut) throw new Error("Missing default shortcut");
    const names = [
      "terminalFocus",
      "terminalOpen",
      "modelPickerOpen",
      "customModeActive",
      "isDesktop",
      "isWeb",
    ];
    const event = {
      key: shortcut.key,
      code: "",
      metaKey: shortcut.modKey || shortcut.metaKey,
      ctrlKey: shortcut.ctrlKey,
      altKey: shortcut.altKey,
      shiftKey: shortcut.shiftKey,
    };

    for (let bits = 0; bits < 2 ** names.length; bits++) {
      const context = Object.fromEntries(names.map((name, i) => [name, Boolean(bits & (1 << i))]));
      const options = { platform: "MacIntel", context };
      expect(
        resolveShortcutCommand(
          event,
          [{ command: "chat.new", shortcut, whenAst: parsed.value }],
          options,
        ),
      ).toBe(
        resolveShortcutCommand(event, [{ command: "chat.new", shortcut, whenAst: ast }], options),
      );
    }
    expect(parsed.value).toEqual(ast);
  });

  it("lists composer, provider, and pull request commands with editable defaults", () => {
    const rows = buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS, "");
    for (const command of [
      "composer.host",
      "composer.effort",
      "composer.mode",
      "composer.workspace",
      "composer.branch",
      "composer.previousWorktree",
      "modelPicker.previousProvider",
      "modelPicker.nextProvider",
      "thread.copyReference",
      "pullRequest.copyNumber",
    ]) {
      expect(rows.find((row) => row.command === command)).toMatchObject({
        source: "Default",
        conflicts: [],
      });
    }
  });
  it.each(["pu", "pull request", "copy link", "thread id"])(
    "finds the copy link shortcut with %s",
    (query) => {
      const rows = buildKeybindingRows(DEFAULT_RESOLVED_KEYBINDINGS, query);
      expect(rows).toContainEqual(
        expect.objectContaining({ command: "thread.copyReference", key: "mod+shift+c" }),
      );
    },
  );
  it("builds searchable rows with readable key and when values", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "terminal.toggle",
          shortcut: {
            key: "j",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "terminal",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        command: "terminal.toggle",
        key: "mod+j",
        when: "!terminalFocus",
        defaultKey: "mod+j",
        defaultWhen: "",
        source: "Custom",
      }),
    ]);
  });

  it("captures platform-specific mod shortcuts", () => {
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        "MacIntel",
      ),
    ).toBe("mod+shift+k");
    expect(
      keybindingFromKeyboardEvent(
        { key: "K", code: "KeyK", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        "Win32",
      ),
    ).toBe("mod+shift+k");
  });

  it.each([
    ["@", "Digit2", "mod+shift+2"],
    ['"', "Digit2", "mod+shift+2"],
    ["@", "Quote", "mod+shift+'"],
  ])("captures %s at %s by physical key", (key, code, expected) => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key,
          code,
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toBe(expected);
  });

  it("captures Latin layout keys instead of their punctuation position", () => {
    expect(
      keybindingFromKeyboardEvent(
        {
          key: "m",
          code: "Semicolon",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe("mod+m");
  });

  it("serializes shortcuts and when expressions for upserts", () => {
    expect(
      shortcutToKeybindingInput({
        key: " ",
        modKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toBe("mod+alt+space");

    expect(
      whenAstToExpression({
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      }),
    ).toBe("editorFocus && !terminalFocus");

    expect(parseWhenExpressionDraft("editorFocus && (!terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "and",
        left: { type: "identifier", name: "editorFocus" },
        right: {
          type: "or",
          left: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
    expect(parseWhenExpressionDraft("editorFocus &&")).toEqual({
      ok: false,
      message: "Use variables with !, &&, ||, and parentheses.",
    });

    expect(parseWhenExpressionDraft("!(terminalFocus || modelPickerOpen)")).toEqual({
      ok: true,
      value: {
        type: "not",
        node: {
          type: "or",
          left: { type: "identifier", name: "terminalFocus" },
          right: { type: "identifier", name: "modelPickerOpen" },
        },
      },
    });
  });

  it("describes the scope of each visual expression removal", () => {
    const condition = { type: "identifier", name: "terminalFocus" } as const;
    const negatedCondition = { type: "not", node: condition } as const;
    const group = { type: "and", left: condition, right: negatedCondition } as const;
    const negatedGroup = { type: "not", node: group } as const;

    expect(whenNodeRemoveLabel(group, 0)).toBe("Clear all conditions");
    expect(whenNodeRemoveLabel(condition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(negatedCondition, 1)).toBe("Remove condition");
    expect(whenNodeRemoveLabel(group, 1)).toBe("Remove group and its conditions");
    expect(whenNodeRemoveLabel(negatedGroup, 1)).toBe("Remove group and its conditions");
  });

  it("formats static and project script command labels", () => {
    expect(commandLabel("commandPalette.toggle")).toBe("Command Palette: Toggle");
    expect(commandLabel("themeEditor.toggle")).toBe("Theme Editor: Toggle");
    expect(commandLabel("script.setup-db.run")).toBe("Run Script: Setup Db");
  });

  it("builds known when variable options from defaults without frontend labels", () => {
    const options = buildWhenVariableOptions();

    expect(options).toEqual(
      expect.arrayContaining([
        "terminalFocus",
        "terminalOpen",
        "isWeb",
        "isDesktop",
        "modelPickerOpen",
        "true",
        "false",
      ]),
    );
    expect(options).not.toContain("customModeActive");
  });

  it("builds command options from all static commands and resolved project bindings", () => {
    const options = buildKeybindingCommandOptions([
      {
        command: "script.setup-db.run",
        shortcut: {
          key: "r",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
        },
      },
    ] satisfies ResolvedKeybindingsConfig);

    expect(options).toEqual(
      expect.arrayContaining([
        "chat.new",
        "rightPanel.toggleMaximized",
        "thread.stop",
        "script.setup-db.run",
      ]),
    );
    expect(DEFAULT_RESOLVED_KEYBINDINGS.some((binding) => binding.command === "thread.stop")).toBe(
      false,
    );
  });

  it("reports unknown when variables without rejecting parseable expressions", () => {
    const parsed = parseWhenExpressionDraft("!terminalFocus && terminalFoc");

    expect(parsed.ok).toBe(true);
    expect(unknownWhenVariables(parsed.ok ? parsed.value : undefined)).toEqual(["terminalFoc"]);
  });

  it("marks each default shortcut for multi-binding commands as default", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "chat.new",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
        {
          command: "chat.new",
          shortcut: {
            key: "o",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: true,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );

    expect(rows.map((row) => row.source)).toEqual(["Default", "Default"]);
  });

  it("reports conflicting shortcuts that share an active when context", () => {
    const rows = buildKeybindingRows(
      [
        {
          command: "chat.new",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
        {
          command: "chat.newLocal",
          shortcut: {
            key: "n",
            modKey: true,
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
          },
          whenAst: {
            type: "not",
            node: { type: "identifier", name: "terminalFocus" },
          },
        },
      ] satisfies ResolvedKeybindingsConfig,
      "",
    );

    expect(rows[0]?.conflicts).toEqual(["Chat: New Local"]);
    expect(
      keybindingConflictLabels(rows, {
        rowId: rows[0]?.id ?? "",
        key: "mod+n",
        when: "",
      }),
    ).toEqual(["Chat: New Local"]);
  });
});
