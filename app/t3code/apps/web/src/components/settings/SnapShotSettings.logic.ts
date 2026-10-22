import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";
import { ko } from "~/i18n/ko";

export function snapShotStatus(state: DesktopSnapShotState | null, enabled: boolean): string {
  if (!state) return ko.settings.snapshots.checking;
  if (state.mode === "unavailable") return state.message ?? ko.settings.snapshots.notSupported;
  if (!enabled) return ko.settings.snapshots.turnOnToSetUp;
  return snapShotSetupSummary(state, enabled);
}

export function snapShotSetupSummary(state: DesktopSnapShotState, enabled: boolean): string {
  if (state.message) return ko.settings.snapshots.needsAttention;
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error"
      ? ko.settings.snapshots.checkAccessInSetup
      : ko.settings.snapshots.installHelperToContinue;
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return ko.settings.snapshots.setUpActiveWindow;
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error"
      ? ko.settings.snapshots.checkAccessInSetup
      : ko.settings.snapshots.installHelperToContinue;
  if (captureSetupBackend(state) === "picker") return ko.settings.snapshots.manualOnly;
  if (!enabled) return ko.settings.snapshots.enableToContinue;
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? ko.settings.snapshots.connectingShortcut
      : ko.settings.snapshots.waitingShortcutPermission;
  if (state.shortcutVerified) return ko.settings.snapshots.readyToCapture;
  if (state.linuxBackend === "niri" && state.shortcutBinding)
    return ko.settings.snapshots.shortcutFromAnotherApp;
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return ko.settings.snapshots.shortcutFromAnotherApp;
  if (state.shortcutRegistered)
    return state.shortcutLabel
      ? ko.settings.snapshots.readyToCapture
      : ko.settings.snapshots.shortcutSavedStatus;
  return ko.settings.snapshots.finishShortcutSetup;
}

export function snapShotShortcutStatus(state: DesktopSnapShotState | null): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return ko.settings.snapshots.approveShortcutPrompt;
  if (state.shortcutRegistered)
    return state.mode === "portal" ? null : ko.settings.snapshots.shortcutSaved;
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(state: DesktopSnapShotState | null): string {
  if (!state) return ko.settings.snapshots.continueSetup;
  if (captureSetupAccessReady(state)) return ko.settings.snapshots.manageCapture;
  const desktop = captureSetupDesktopName(state);
  return desktop
    ? ko.settings.snapshots.setUpDesktopCapture(desktop)
    : ko.settings.snapshots.continueSetup;
}

// Windows needs no permissions or setup: turning capture on is enough. macOS setup
// has nothing left to manage once permissions and the shortcut are in place; the
// shortcut row stays editable inline. Revoking a permission brings the button back
// as "Continue setup" through the state message.
export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? ko.settings.snapshots.effectsUnavailable
      : ko.settings.snapshots.installOrUpdateHelper;
  if (state.linuxBackend === "niri") return ko.settings.snapshots.effectsUnavailableNiri;
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? ko.settings.snapshots.effectsUnavailable
      : ko.settings.snapshots.installOrUpdateHelper;
  return state.linuxBackend === "gnome-extension"
    ? ko.settings.snapshots.updateGnomeExtension
    : captureSetupBackend(state) === "gnome"
      ? ko.settings.snapshots.finishExtensionSetup
      : ko.settings.snapshots.effectsUnavailable;
}

export function snapShotDescription(state: DesktopSnapShotState | null): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? ko.settings.snapshots.descriptionPicker
    : ko.settings.snapshots.descriptionDefault;
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return ko.settings.snapshots.screenshotOnly;
  return undefined;
}

export function snapShotUnavailableMessage(hasBridge: boolean): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? ko.settings.snapshots.updateDesktopApp
    : ko.settings.snapshots.desktopAppOnly;
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
