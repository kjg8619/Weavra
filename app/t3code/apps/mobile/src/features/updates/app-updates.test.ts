import { expect, it, vi } from "vite-plus/test";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import {
  createAppUpdateForegroundRecheck,
  createAppUpdateLaunchCheck,
  isAppUpdateCheckAvailable,
  runAppUpdateCheck,
} from "./app-updates";

vi.mock("expo-updates", () => ({ isEnabled: true }));

it("never checks, downloads or reloads inherited OTA updates, even with a cached pending install", async () => {
  const client = {
    isEnabled: true,
    checkForUpdateAsync: vi.fn(),
    fetchUpdateAsync: vi.fn(),
    reloadAsync: vi.fn(),
  };
  const onFailure = vi.fn();
  const onStateChange = vi.fn();
  expect(isAppUpdateCheckAvailable(client)).toBe(false);
  await createAppUpdateLaunchCheck(client)();
  createAppUpdateForegroundRecheck(client)();
  await runAppUpdateCheck({
    client,
    applyMode: "immediate",
    deferral: { pendingInstall: true, installInProgress: false },
    onFailure,
    onStateChange,
  });
  expect(onFailure).toHaveBeenCalledWith(APP_UPDATE_UNAVAILABLE_REASON);
  expect(onStateChange).toHaveBeenCalledWith("idle");
  expect(client.checkForUpdateAsync).not.toHaveBeenCalled();
  expect(client.fetchUpdateAsync).not.toHaveBeenCalled();
  expect(client.reloadAsync).not.toHaveBeenCalled();
});
