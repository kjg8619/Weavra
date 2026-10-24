import type { DesktopPreviewAnnotationTheme } from "@t3tools/contracts";

const readVariable = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback;

export function readPreviewAnnotationTheme(): DesktopPreviewAnnotationTheme {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  return {
    colorScheme: root.classList.contains("dark") ? "dark" : "light",
    radius: readVariable(styles, "--radius", "0.625rem"),
    background: readVariable(styles, "--annotation-background", "oklch(99.2% 0 0)"),
    foreground: readVariable(styles, "--annotation-foreground", "oklch(27.4% 0.006 286.033)"),
    popover: readVariable(styles, "--popover", "white"),
    popoverForeground: readVariable(
      styles,
      "--contrast-popover-foreground",
      "oklch(27.4% 0.006 286.033)",
    ),
    primary: readVariable(styles, "--primary", "oklch(0.488 0.217 264)"),
    primaryForeground: readVariable(styles, "--primary-foreground", "white"),
    muted: readVariable(styles, "--muted", "oklch(98.5% 0 0)"),
    mutedForeground: readVariable(
      styles,
      "--contrast-muted-foreground",
      "oklch(55.2% 0.016 285.938)",
    ),
    accent: readVariable(styles, "--accent", "oklch(96.7% 0.001 286.375)"),
    accentForeground: readVariable(
      styles,
      "--contrast-accent-foreground",
      "oklch(21% 0.006 285.885)",
    ),
    border: readVariable(styles, "--contrast-border", "oklch(92% 0.004 286.32)"),
    input: readVariable(styles, "--contrast-input", "oklch(87.1% 0.006 286.286)"),
    ring: readVariable(styles, "--ring", "oklch(0.488 0.217 264)"),
    fontSans: readVariable(styles, "--font-sans", styles.fontFamily || "system-ui, sans-serif"),
    fontMono: readVariable(styles, "--font-mono", "ui-monospace, monospace"),
  };
}
