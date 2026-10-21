import { act, useEffect, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useTheme } from "../../hooks/useTheme";
import {
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_HALVES_STORAGE_KEY,
  THEME_FILE_VERSION,
  installCustomTheme,
  invalidateCustomThemes,
  parseThemeFile,
} from "../../themePalette";
import { ThemeLibrary } from "./ThemeSettings";

vi.mock("../../hooks/useEnvironmentTheme", () => ({
  useEnvironmentThemeDefinitions: () => [],
}));
// Import transport and its dialog are covered by ThemeImportDialog.test.ts.
vi.mock("./ThemeImportDialog", () => ({ ThemeImportDialog: () => null }));
// DOM positioning is exercised on packaged Electron, not the node renderer.
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));

const storage = new Map<string, string>();
const writes = vi.fn((key: string, value: string) => storage.set(key, value));
const appearanceListeners = new Set<() => void>();
let systemDark = false;
let renderer: ReactTestRenderer | undefined;
let snapshot: ReturnType<typeof useTheme>;
let customThemes: ReturnType<typeof installCustomTheme>[] = [];

function Library() {
  const theme = useTheme();
  useEffect(() => {
    snapshot = theme;
  }, [theme]);
  return (
    <ThemeLibrary
      {...theme}
      customThemes={customThemes}
      initialAppearance={theme.resolvedTheme}
      isImportOpen={false}
      onImportOpenChange={() => undefined}
    />
  );
}

const button = (name: string) => {
  if (!renderer) throw new Error("Theme library is not mounted");
  return renderer.root.find((node) => node.type === "button" && node.props["aria-label"] === name);
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.clear();
  storage.set("t3code:theme", "system");
  storage.set(THEME_APPEARANCE_MODE_STORAGE_KEY, "system");
  systemDark = false;
  customThemes = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: writes,
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({
      get matches() {
        return systemDark;
      },
      addEventListener: (_: string, listener: () => void) => appearanceListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) =>
        appearanceListeners.delete(listener),
    }),
  });
  invalidateCustomThemes();
  await act(() => {
    renderer = create(<Library />);
  });
  await act(() => snapshot.refreshTheme());
  writes.mockClear();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  appearanceListeners.clear();
  vi.unstubAllGlobals();
  invalidateCustomThemes();
});

describe("Appearance selection", () => {
  it("persists a mode once without replacing the chosen theme halves", async () => {
    // Given independently chosen light and dark palettes.
    await act(() => snapshot.setThemeHalf("light", "grove"));
    const halves = storage.get(THEME_HALVES_STORAGE_KEY);
    writes.mockClear();

    // When the mode control is activated (including native keyboard activation).
    await act(() => button("Use dark mode").props.onClick());

    // Then the saved mode and rendered selection change, but the mix survives.
    expect(writes).toHaveBeenCalledExactlyOnceWith(THEME_APPEARANCE_MODE_STORAGE_KEY, "dark");
    expect(storage.get(THEME_HALVES_STORAGE_KEY)).toBe(halves);
    expect(button("Use dark mode").props["aria-pressed"]).toBe(true);
    expect(button("Use light mode").props["aria-pressed"]).toBe(false);
  });

  it("assigns only the activated preview half", async () => {
    // Given the default light and dark mix.
    const darkOwner = snapshot.themeHalves?.dark;

    // When a palette's light preview is activated.
    await act(() =>
      button("Use Grove light mode").props.onClick({ stopPropagation: () => undefined }),
    );

    // Then only light changes, and the default dark preview stays selected.
    expect(snapshot.themeHalves?.light).toBe("grove");
    expect(snapshot.themeHalves?.dark).toBe(darkOwner);
    expect(button("Use Grove light mode").props["aria-pressed"]).toBe(true);
    expect(button("Use Weavra dark mode").props["aria-pressed"]).toBe(true);
  });

  it("keeps System saved through light dark light appearance events", async () => {
    // Given a saved System mode, with the real theme subscription mounted.
    expect(snapshot.appearanceMode).toBe("system");

    // When the operating system changes appearance.
    for (const dark of [false, true, false]) {
      await act(() => {
        systemDark = dark;
        for (const listener of appearanceListeners) listener();
      });

      // Then content resolves live without rewriting the user's choice.
      expect(snapshot.resolvedTheme).toBe(dark ? "dark" : "light");
      expect(button("Follow the system appearance").props["aria-pressed"]).toBe(true);
    }
    expect(writes).not.toHaveBeenCalled();
    expect(storage.get(THEME_APPEARANCE_MODE_STORAGE_KEY)).toBe("system");
  });

  it("opens and dismisses variant choices without changing selection", async () => {
    // Given an imported two-variant collection.
    customThemes = ["one", "two"].map((id) =>
      installCustomTheme(
        parseThemeFile({
          version: THEME_FILE_VERSION,
          id: `hig-${id}`,
          name: `HIG ${id}`,
          appearance: "light",
          collection: { id: "hig", label: "HIG" },
          colors: { accent: "#327a45" },
        }),
      ),
    );
    await act(() => renderer?.update(<Library />));
    const saved = [...storage];
    writes.mockClear();

    // When focus opens the choices and Escape dismisses them.
    await act(() => button("Choose light variant, 2 options, currently one").props.onFocus());
    if (!renderer) throw new Error("Theme library is not mounted");
    const group = renderer.root.find(
      (node) => node.type === "div" && node.props["aria-label"] === "Light and dark theme variants",
    );
    await act(() =>
      group.props.onKeyDown({
        key: "Escape",
        currentTarget: { querySelector: () => null },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }),
    );

    // Then focus and dismissal have no persistence effect.
    expect([...storage]).toEqual(saved);
    expect(writes).not.toHaveBeenCalled();
    expect(button("Use one for light mode").props.tabIndex).toBe(-1);
  });

  it.each(["light", "dark"] as const)(
    "returns focus to the %s opener without reopening its dismissed choices",
    async (mode) => {
      customThemes = ["one", "two"].map((id) =>
        installCustomTheme(
          parseThemeFile({
            version: THEME_FILE_VERSION,
            id: `hig-${id}`,
            name: `HIG ${id}`,
            appearance: mode,
            collection: { id: "hig", label: "HIG" },
            colors: { accent: "#327a45" },
          }),
        ),
      );
      await act(() => renderer?.update(<Library />));
      const opener = button(`Choose ${mode} variant, 2 options, currently one`);
      await act(() => opener.props.onFocus());
      await act(() => button(`Use two for ${mode} mode`).props.onFocus());
      writes.mockClear();
      // Native focus synchronously dispatches the opener's focus handler.
      const focus = vi.fn(() => opener.props.onFocus());
      const querySelector = vi.fn(() => ({ focus }));
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      if (!renderer) throw new Error("Theme library is not mounted");
      const group = renderer.root.find(
        (node) =>
          node.type === "div" && node.props["aria-label"] === "Light and dark theme variants",
      );

      await act(() =>
        group.props.onKeyDown({
          key: "Escape",
          currentTarget: { querySelector },
          preventDefault,
          stopPropagation,
        }),
      );

      expect(querySelector).toHaveBeenCalledExactlyOnceWith(
        `[data-theme-variant-trigger="${mode}"]`,
      );
      expect(focus).toHaveBeenCalledOnce();
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(button(`Use two for ${mode} mode`).props.disabled).toBe(true);
      expect(button(`Use two for ${mode} mode`).props.tabIndex).toBe(-1);
      expect(writes).not.toHaveBeenCalled();
    },
  );
});
