import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  getArm64IntelBuildWarningDescription,
  shouldShowArm64IntelBuildWarning,
} from "./desktopUpdate.logic";

describe("desktop architecture warning", () => {
  it("warns for a translated Intel build without recommending an updater", () => {
    const state = { hostArch: "arm64", appArch: "x64" } as DesktopUpdateState;
    expect(shouldShowArm64IntelBuildWarning(state)).toBe(true);
    expect(getArm64IntelBuildWarningDescription(state)).toContain("Rosetta");
    expect(getArm64IntelBuildWarningDescription(state)).not.toContain("next app update");
    expect(shouldShowArm64IntelBuildWarning({ ...state, appArch: "arm64" })).toBe(false);
    expect(shouldShowArm64IntelBuildWarning(null)).toBe(false);
  });
});
