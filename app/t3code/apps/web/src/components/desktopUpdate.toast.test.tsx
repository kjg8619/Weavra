import { expect, it, vi } from "vite-plus/test";
import type { DesktopUpdateState } from "@t3tools/contracts";
const addToast = vi.hoisted(() => vi.fn());
vi.mock("./ui/toast", () => ({ toastManager: { add: addToast } }));
import { showDesktopUpdateDownloadedToast } from "./desktopUpdate.toast";
const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

it("does not recommend installing an inherited downloaded update", () => {
  const openExternal = vi.fn();
  showDesktopUpdateDownloadedToast(
    { openExternal },
    { ...baseState, status: "downloaded", downloadedVersion: "1.1.0" },
  );
  expect(addToast).not.toHaveBeenCalled();
  expect(openExternal).not.toHaveBeenCalled();
});
