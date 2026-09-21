import type { DesktopUpdateState } from "@t3tools/contracts";

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  return shouldShowArm64IntelBuildWarning(state)
    ? "This Mac has Apple Silicon, but Weavra is running the Intel build under Rosetta. Automatic updates are unavailable; use a locally built native Apple Silicon app to change architectures."
    : "This install is using the correct architecture.";
}
