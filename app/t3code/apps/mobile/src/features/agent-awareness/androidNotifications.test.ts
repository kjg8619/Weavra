import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  os: "android",
  version: 36,
  openSettings: vi.fn(),
  native: null as {
    clear?: ReturnType<typeof vi.fn>;
    openLiveUpdateSettings?: ReturnType<typeof vi.fn>;
  } | null,
  requireModule: vi.fn(),
}));

vi.mock("expo", () => ({ requireOptionalNativeModule: mocks.requireModule }));
vi.mock("react-native", () => ({
  Linking: { openSettings: mocks.openSettings },
  Platform: {
    get Version() {
      return mocks.version;
    },
    get OS() {
      return mocks.os;
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.os = "android";
  mocks.version = 36;
  mocks.openSettings.mockReset().mockResolvedValue(undefined);
  mocks.native = { clear: vi.fn() };
  mocks.requireModule.mockReset().mockImplementation(() => mocks.native);
});

describe("Android native notification capability", () => {
  it("opens the Live Update controls on supported Android builds", async () => {
    mocks.native!.openLiveUpdateSettings = vi.fn(() => true);
    const { openAndroidLiveUpdateSettings, supportsAndroidLiveUpdateSettings } =
      await import("./androidNotifications");
    expect(supportsAndroidLiveUpdateSettings()).toBe(true);
    await openAndroidLiveUpdateSettings();
    expect(mocks.native!.openLiveUpdateSettings).toHaveBeenCalledOnce();
    expect(mocks.openSettings).not.toHaveBeenCalled();
    mocks.version = 35;
    expect(supportsAndroidLiveUpdateSettings()).toBe(false);
    mocks.os = "ios";
    mocks.version = 36;
    expect(supportsAndroidLiveUpdateSettings()).toBe(false);
  });

  it.each([undefined, vi.fn(() => false)])(
    "falls back to app settings for older binaries or missing system activities (%j)",
    async (openLiveUpdateSettings) => {
      if (openLiveUpdateSettings) mocks.native!.openLiveUpdateSettings = openLiveUpdateSettings;
      const { openAndroidLiveUpdateSettings } = await import("./androidNotifications");
      await openAndroidLiveUpdateSettings();
      expect(mocks.openSettings).toHaveBeenCalledOnce();
    },
  );
});
