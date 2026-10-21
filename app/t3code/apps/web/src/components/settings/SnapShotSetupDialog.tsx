import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import {
  isModifierPairShortcut,
  type DesktopSnapShotSetupAction,
  type DesktopSnapShotState,
} from "@t3tools/contracts";
import { useId, useState, type ReactNode } from "react";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  captureSetupAccessReady,
  captureSetupBackend,
  captureSetupCheckMessage,
  captureSetupDesktopName,
  captureSetupInitialStep,
  captureSetupShortcutReady,
  type CaptureSetupStep,
} from "./SnapShotSetupDialog.logic";
import { ko } from "~/i18n/ko";

const SETUP_STEPS = [
  { id: "access", label: ko.settings.snapshots.setup.stepAccess },
  { id: "shortcut", label: ko.settings.snapshots.setup.stepShortcut },
] as const;

const GNOME_ACCESS_COPY = {
  "not-installed": {
    title: ko.settings.snapshots.setup.gnome.notInstalledTitle,
    description: ko.settings.snapshots.setup.gnome.notInstalledDescription,
  },
  "restart-required": {
    title: ko.settings.snapshots.setup.gnome.restartRequiredTitle,
    description: ko.settings.snapshots.setup.gnome.restartRequiredDescription,
  },
  "update-required": {
    title: ko.settings.snapshots.setup.gnome.updateRequiredTitle,
    description: ko.settings.snapshots.setup.gnome.updateRequiredDescription,
  },
  "extensions-disabled": {
    title: ko.settings.snapshots.setup.gnome.extensionsDisabledTitle,
    description: ko.settings.snapshots.setup.gnome.extensionsDisabledDescription,
  },
  disabled: {
    title: ko.settings.snapshots.setup.gnome.disabledTitle,
    description: ko.settings.snapshots.setup.gnome.disabledDescription,
  },
  enabled: {
    title: ko.settings.snapshots.setup.readyTitle,
    description: ko.settings.snapshots.setup.readyDescription,
  },
  unsupported: {
    title: ko.settings.snapshots.setup.gnome.unsupportedTitle,
    description: ko.settings.snapshots.setup.gnome.unsupportedDescription,
  },
  error: {
    title: ko.settings.snapshots.setup.gnome.errorTitle,
    description: ko.settings.snapshots.setup.gnome.errorDescription,
  },
};

function ScreenRecordingIcon() {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-8 shrink-0 drop-shadow-[0_1px_1px_#0005]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x2="0" y2="1">
          <stop stopColor="#ff6972" />
          <stop offset="1" stopColor="#ff2938" />
        </linearGradient>
      </defs>
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        fill={`url(#${gradientId})`}
        stroke="#ffffff40"
      />
      <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.5" fill="#fff" />
    </svg>
  );
}

function AccessibilityPermissionIcon() {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className="size-8 shrink-0 drop-shadow-[0_1px_1px_#0005]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x2="0" y2="1">
          <stop stopColor="#48b6ff" />
          <stop offset="1" stopColor="#0085ff" />
        </linearGradient>
      </defs>
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7"
        fill={`url(#${gradientId})`}
        stroke="#ffffff40"
      />
      <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="1.75" />
      <circle cx="16" cy="10" r="1.6" fill="#fff" />
      <path
        d="m10 13 6 1 6-1M16 14v4m0 0-2.5 6m2.5-6 2.5 6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy: actionBusy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const busy = actionBusy || checking || configBusy;
  const backend = captureSetupBackend(state);
  const configShortcut = backend === "niri" || backend === "hyprland";
  const desktop = captureSetupDesktopName(state);
  const extension = state.gnomeExtension;
  const helper = backend === "hyprland" ? state.hyprlandHelper : state.kdeHelper;
  const helperBackend = backend === "kde" || backend === "hyprland";
  const installHelper = backend === "hyprland" ? "install-hyprland-helper" : "install-kde-helper";
  const removeHelper = backend === "hyprland" ? "remove-hyprland-helper" : "remove-kde-helper";
  const accessReady = captureSetupAccessReady(state);
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions)
        throw new Error(ko.settings.snapshots.setup.permissionStatusUnavailable);
      return refreshed.macPermissions;
    },
    state.macPermissions ?? { screenRecording: false, accessibility: false },
    Boolean(state.macPermissions) && step === "access" && !busy,
  );
  const macPermissions = state.macPermissions ? permissionStatus.status : undefined;
  const macPermissionsReady =
    !macPermissions ||
    permissionStatus.isReady(
      includeAccessibility ? ["screenRecording", "accessibility"] : ["screenRecording"],
    );
  const shortcutReady = captureSetupShortcutReady(state, shortcutChanged);
  const install = extension?.status === "not-installed" || extension?.status === "update-required";
  const enable = extension?.status === "disabled";
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setChecked(false);
    setStep(next);
  };
  const checkAgain = async () => {
    if (busy) return;
    setChecking(true);
    setChecked(false);
    try {
      setChecked((await onRefresh()) !== undefined);
    } finally {
      setChecking(false);
    }
  };
  const accessCopy =
    state.message && !macPermissions
      ? {
          title: ko.settings.snapshots.setup.retryTitle,
          description: ko.settings.snapshots.setup.retryDescription,
        }
      : backend === "gnome" && extension
        ? extension.status === "enabled" && !accessReady
          ? {
              title: ko.settings.snapshots.setup.checkAccessTitle,
              description: ko.settings.snapshots.setup.checkAccessDescription,
            }
          : GNOME_ACCESS_COPY[extension.status]
        : helperBackend
          ? helper?.status === "ready"
            ? {
                title: ko.settings.snapshots.setup.readyTitle,
                description: ko.settings.snapshots.setup.readyDescription,
              }
            : helper?.status === "error"
              ? {
                  title: ko.settings.snapshots.setup.fixAccessTitle,
                  description: ko.settings.snapshots.setup.fixAccessDescription,
                }
              : {
                  title:
                    helper?.status === "update-required"
                      ? ko.settings.snapshots.setup.updateHelperTitle
                      : ko.settings.snapshots.setup.allowTitle,
                  description: ko.settings.snapshots.setup.helperDescription,
                }
          : backend === "niri"
            ? {
                title: ko.settings.snapshots.setup.readyTitle,
                description: ko.settings.snapshots.setup.readyDescription,
              }
            : backend === "picker"
              ? {
                  title: ko.settings.snapshots.setup.pickerTitle,
                  description: ko.settings.snapshots.setup.pickerDescription,
                }
              : {
                  title: ko.settings.snapshots.setup.allowTitle,
                  description:
                    backend === "portal"
                      ? ko.settings.snapshots.setup.portalDescription
                      : macPermissions
                        ? macPermissionsReady
                          ? ko.settings.snapshots.setup.macTestDescription
                          : ko.settings.snapshots.setup.macAllowDescription
                        : ko.settings.snapshots.setup.directDescription,
                };
  const title =
    step === "access" ? accessCopy.title : ko.settings.snapshots.setup.chooseShortcutTitle;
  const description =
    step === "access"
      ? accessCopy.description
      : configShortcut
        ? ko.settings.snapshots.setup.configShortcutDescription
        : state.mode === "portal"
          ? ko.settings.snapshots.setup.portalShortcutDescription
          : ko.settings.snapshots.setup.directShortcutDescription;
  const stepIndex = SETUP_STEPS.findIndex(({ id }) => id === step);
  const details = [
    ...new Set(
      [
        error,
        ...(step === "access"
          ? [
              state.message,
              backend === "gnome" &&
              (extension?.status === "error" || extension?.status === "unsupported")
                ? extension.message
                : null,
              helperBackend && helper?.status === "error" ? helper.message : null,
            ]
          : []),
      ].filter((detail) => detail !== null),
    ),
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={!busy}>
        <WizardHeader
          title={
            desktop
              ? ko.settings.snapshots.setup.titleForDesktop(desktop)
              : ko.settings.snapshots.setup.title
          }
        >
          <WizardSteps
            steps={SETUP_STEPS.map((item) => item.label)}
            currentStep={stepIndex}
            isStepDisabled={(index) => busy || index > stepIndex}
            onStepChange={(index) => {
              const next = SETUP_STEPS[index];
              if (next && next.id !== step) changeStep(next.id);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{title}</h3>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {step === "access" ? (
              <>
                <p
                  role="status"
                  aria-atomic="true"
                  className={
                    checked && !busy && !error ? "text-xs text-muted-foreground" : "sr-only"
                  }
                >
                  {checked && !busy && !error ? captureSetupCheckMessage(state) : null}
                </p>
                {macPermissions ? (
                  <PermissionChecklist
                    busy={busy}
                    permissions={[
                      {
                        id: "screenRecording",
                        icon: <ScreenRecordingIcon />,
                        title: ko.settings.snapshots.setup.screenRecording,
                        description: ko.settings.snapshots.setup.screenRecordingDescription,
                        granted: macPermissions.screenRecording,
                        onAllow: () => void onAction("allow-screen-recording"),
                      },
                      {
                        id: "accessibility",
                        icon: <AccessibilityPermissionIcon />,
                        title: ko.settings.snapshots.setup.accessibility,
                        description: includeAccessibility
                          ? ko.settings.snapshots.setup.accessibilityDescription
                          : ko.settings.snapshots.setup.accessibilityOptionalDescription,
                        granted: macPermissions.accessibility,
                        onAllow: () => void onAction("allow-accessibility"),
                      },
                    ]}
                  />
                ) : null}
                {permissionStatus.error && macPermissions ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {permissionStatus.error}
                  </p>
                ) : null}
                {helperBackend && helper?.status === "error" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onAction(installHelper)}
                  >
                    {ko.settings.snapshots.setup.reinstallHelper}
                  </Button>
                ) : null}
              </>
            ) : configShortcut ? (
              <CaptureShortcutConfig
                state={state}
                disabled={actionBusy || checking || !accessReady}
                onBusyChange={setConfigBusy}
                onSaved={onRefresh}
                onComplete={() => onClose(true)}
              />
            ) : (
              <div className="space-y-3">
                {shortcutInput}
                {shortcutStatus ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcutStatus}
                  </p>
                ) : null}
                {!shortcutChanged &&
                !state.shortcutRegistered &&
                !state.shortcutPending &&
                state.shortcutCanRetry !== false &&
                !isModifierPairShortcut(state.shortcut) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onAction("retry-shortcut")}
                  >
                    {state.mode === "portal"
                      ? ko.settings.snapshots.setup.shortcutPermissions
                      : ko.common.retry}
                  </Button>
                ) : null}
              </div>
            )}
            {step === "shortcut" && !accessReady ? (
              <p role="alert" className="text-destructive">
                {ko.settings.snapshots.setup.needsAttention}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {ko.settings.snapshots.setup.stepFailed}
              </p>
            ) : null}
            {details.length > 0 || (step === "access" && (backend === "gnome" || helperBackend)) ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{ko.settings.snapshots.setup.advanced}</summary>
                <div className="mt-3 space-y-3">
                  {details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail}
                    </p>
                  ))}
                  {step === "access" && (backend === "gnome" || helperBackend) ? (
                    <p>{ko.settings.snapshots.setup.includedWithWeavra}</p>
                  ) : null}
                  {step === "access" && backend === "gnome" && extension?.status === "enabled" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction("disable-extension")}
                    >
                      {ko.settings.snapshots.setup.disableExtension}
                    </Button>
                  ) : null}
                  {step === "access" && helperBackend && helper?.status !== "not-installed" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void onAction(removeHelper)}
                    >
                      {ko.settings.snapshots.setup.removeHelper}
                    </Button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {step !== "access" ? (
            <Button variant="ghost" disabled={busy} onClick={() => changeStep("access")}>
              {ko.common.back}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void onClose(false)}>
            {wasEnabled ? ko.common.close : ko.settings.snapshots.setup.finishLater}
          </Button>
          {step === "access" ? (
            helperBackend && !accessReady && helper?.status !== "ready" ? (
              <Button
                disabled={busy}
                aria-busy={busy}
                onClick={() =>
                  void (helper?.status === "error" ? checkAgain() : onAction(installHelper))
                }
              >
                {checking
                  ? ko.settings.snapshots.setup.checking
                  : busy
                    ? ko.settings.snapshots.setup.installing
                    : helper?.status === "error"
                      ? ko.settings.snapshots.setup.checkAgain
                      : helper?.status === "update-required"
                        ? ko.settings.snapshots.setup.updateHelper
                        : ko.settings.snapshots.setup.installHelper}
              </Button>
            ) : backend === "gnome" && !accessReady && extension?.status !== "enabled" ? (
              <Button
                disabled={busy}
                aria-busy={checking}
                onClick={() =>
                  void (install
                    ? onAction("install-extension")
                    : enable
                      ? onAction("enable-extension")
                      : checkAgain())
                }
              >
                {checking
                  ? ko.settings.snapshots.setup.checking
                  : busy
                    ? install
                      ? ko.settings.snapshots.setup.installing
                      : enable
                        ? ko.settings.snapshots.setup.enabling
                        : ko.settings.snapshots.setup.working
                    : install
                      ? extension?.status === "update-required"
                        ? ko.settings.snapshots.setup.updateExtension
                        : ko.settings.snapshots.setup.installExtension
                      : enable
                        ? ko.settings.snapshots.setup.enableExtension
                        : ko.settings.snapshots.setup.checkAgain}
              </Button>
            ) : (
              <PermissionContinueButton
                ready={macPermissionsReady}
                busy={busy}
                onClick={async () => {
                  if (await onEnable()) changeStep("shortcut");
                }}
              >
                {busy
                  ? ko.settings.snapshots.setup.working
                  : macPermissions
                    ? ko.settings.snapshots.setup.testAndContinue
                    : backend === "direct"
                      ? ko.settings.snapshots.setup.allowCapture
                      : !accessReady && !macPermissions
                        ? ko.common.retry
                        : ko.settings.snapshots.setup.continue}
              </PermissionContinueButton>
            )
          ) : !configShortcut ? (
            <Button
              disabled={
                busy || !accessReady || (shortcutChanged ? !canSaveShortcut : !shortcutReady)
              }
              onClick={async () => {
                if (!shortcutChanged || (await onSaveShortcut())) await onClose(true);
              }}
            >
              {busy
                ? ko.common.saving
                : shortcutChanged
                  ? ko.settings.snapshots.setup.saveAndFinish
                  : ko.common.done}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
