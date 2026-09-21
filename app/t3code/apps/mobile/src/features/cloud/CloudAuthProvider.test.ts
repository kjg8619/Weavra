import { managedRelaySessionAtom, setManagedRelaySession } from "@t3tools/client-runtime/relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { appAtomRegistry } from "../../state/atom-registry";
import { deactivateCloudRelayAccount } from "./CloudAuthProvider";

const local = vi.hoisted(() => ({
  activities: new Map<string, { end: () => Promise<void> }>(),
  androidNotifications: new Set<string>(),
  storage: new Map<string, string>(),
}));

vi.mock("../agent-awareness/agentLiveActivity", () => ({
  getAgentLiveActivities: () => [...local.activities.values()],
}));
vi.mock("../agent-awareness/androidNotifications", () => ({
  clearAndroidAgentNotifications: () => local.androidNotifications.clear(),
}));
vi.mock("../../persistence/imperative", () => ({
  clearAgentAwarenessRegistrationRecord: async () => {
    local.storage.delete("registration");
  },
}));

beforeEach(() => {
  local.activities.clear();
  local.androidNotifications.clear();
  local.storage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request during local cleanup");
    }),
  );
});
afterEach(() => {
  setManagedRelaySession(appAtomRegistry, null);
  vi.unstubAllGlobals();
});

describe("unavailable mobile cloud", () => {
  it("revokes authority immediately and clears legacy push artifacts without changing local preferences or connections", async () => {
    const readClerkToken = vi.fn(async () => "old-token");
    setManagedRelaySession(appAtomRegistry, { accountId: "old-account", readClerkToken });
    local.storage.set("registration", "old-registration");
    local.storage.set("deviceId", "local-device");
    local.storage.set("preferences", "local-preferences");
    local.storage.set("directConnection", "local-connection");
    local.androidNotifications.add("old-agent-card");
    local.activities.set("old-activity", {
      end: async () => {
        local.activities.delete("old-activity");
      },
    });

    const cleanup = deactivateCloudRelayAccount();
    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
    await cleanup;

    expect(local.activities.size).toBe(0);
    expect(local.androidNotifications.size).toBe(0);
    expect(Object.fromEntries(local.storage)).toEqual({
      deviceId: "local-device",
      preferences: "local-preferences",
      directConnection: "local-connection",
    });
    expect(readClerkToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("continues local cleanup after an individual activity cannot be ended", async () => {
    local.storage.set("registration", "old-registration");
    local.activities.set("unavailable", {
      end: async () => {
        throw new Error("Native activity is unavailable");
      },
    });
    local.activities.set("remaining", {
      end: async () => {
        local.activities.delete("remaining");
      },
    });

    await deactivateCloudRelayAccount();

    expect([...local.activities.keys()]).toEqual(["unavailable"]);
    expect(local.storage.has("registration")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
