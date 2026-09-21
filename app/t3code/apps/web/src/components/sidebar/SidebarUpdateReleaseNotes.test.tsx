import type { DesktopUpdateState } from "@t3tools/contracts";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { SidebarUpdateReleaseNotes } from "./SidebarUpdateReleaseNotes";
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

it("does not expose inherited release links even when old notes are present", () => {
  const openExternal = vi.fn();
  const markup = renderToStaticMarkup(
    <SidebarUpdateReleaseNotes
      shell={{ openExternal }}
      tooltip="Update available"
      state={{
        ...baseState,
        status: "available",
        channel: "nightly",
        omittedReleaseCount: 1,
        releaseNotes: [{ version: "1.1.0-nightly.1", items: ["Inherited release"], totalItems: 1 }],
      }}
    />,
  );
  expect(markup).toContain(APP_UPDATE_UNAVAILABLE_REASON);
  expect(markup).not.toContain("href=");
  expect(openExternal).not.toHaveBeenCalled();
});
