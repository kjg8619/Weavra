import type { StorageCleanupSettings, WorktreeCleanupRules } from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { useState } from "react";
import { ko } from "~/i18n/ko";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useClearScopedSettings,
  useScopedSettings,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function RetentionControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  if (savedValue !== value) {
    setSavedValue(value);
    setDraft(value);
  }

  return (
    <div className="flex items-center gap-3">
      {value !== null ? (
        <NumberField
          value={draft}
          min={1}
          max={3650}
          step={1}
          size="sm"
          className="w-auto"
          onValueChange={setDraft}
          onValueCommitted={(next) => {
            if (next === null) setDraft(value);
            else {
              const days = Math.min(3650, Math.max(1, Math.round(next)));
              setDraft(days);
              onChange(days);
            }
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement aria-label={ko.settings.storage.decrease(label)} />
            <NumberFieldInput
              aria-label={ko.settings.storage.inDays(label)}
              size={new Intl.NumberFormat().format(draft ?? value).length}
              className="field-sizing-content w-auto min-w-[1ch] grow-0 text-right in-data-[size=sm]:px-1"
            />
            <span aria-hidden="true" className="self-center pr-2 text-xs">
              {ko.settings.storage.daysUnit}
            </span>
            <NumberFieldIncrement aria-label={ko.settings.storage.increase(label)} />
          </NumberFieldGroup>
        </NumberField>
      ) : (
        <span className="text-xs text-muted-foreground">{ko.common.off}</span>
      )}
      <Switch
        aria-label={label}
        checked={value !== null}
        onCheckedChange={(enabled) => onChange(enabled ? 8 : null)}
      />
    </div>
  );
}

export function StorageSettingsPanel() {
  const { scope, connectedEnvironments, targets, target } = useSettingsScope();
  const scopedSettings = useScopedSettings();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const settings = {
    ...scopedSettings.storageCleanup,
    ...resolveWorktreeCleanup(scopedSettings, null),
  };
  const projectMode = (entry: ScopedSettingsTarget | null) =>
    entry?.sources.worktreeCleanup === "project"
      ? (entry.settings.worktreeCleanup?.mode ?? "inherit")
      : "inherit";
  const mode = projectMode(target);
  const mixedModes = targets.some((entry) => projectMode(entry) !== mode);
  const updateSettings = useUpdateScopedSettings();
  const clearSettings = useClearScopedSettings();
  const ruleStatus = (key: keyof StorageCleanupSettings) =>
    targets.some(
      (target) =>
        ({ ...target.settings.storageCleanup, ...resolveWorktreeCleanup(target.settings, null) })[
          key
        ] !== settings[key],
    )
      ? ko.settings.storage.mixedAcrossMachines
      : undefined;
  const update = (patch: Partial<StorageCleanupSettings>) =>
    updateSettings({ storageCleanup: patch });
  const updateWorktree = (patch: Partial<WorktreeCleanupRules>) =>
    isProjectScope
      ? updateSettings({ worktreeCleanup: { mode: "custom", rules: patch } })
      : update(patch);

  if (
    isProjectScope &&
    connectedEnvironments.some(
      (environment) =>
        environment.serverConfig?.environment.capabilities.projectWorktreeCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice target="all">
        {ko.settings.storage.updateMachinesForProjectCleanup}
      </SettingsScopeNotice>
    );
  }

  if (
    connectedEnvironments.some(
      (environment) => environment.serverConfig?.environment.capabilities.storageCleanup !== true,
    )
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        eligibleEnvironmentIds={connectedEnvironments
          .filter(
            (environment) =>
              environment.serverConfig?.environment.capabilities.storageCleanup === true,
          )
          .map((environment) => environment.environmentId)}
      >
        {ko.settings.storage.updateEnvironmentsForCleanup}
      </SettingsScopeNotice>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection id="storage-worktrees" title={ko.settings.storage.worktreesSection}>
        {isProjectScope && (
          <SettingsRow
            title={ko.settings.storage.automaticCleanup}
            description={
              mode === "off"
                ? ko.settings.storage.automaticCleanupOff
                : mode === "custom"
                  ? ko.settings.storage.automaticCleanupCustom
                  : ko.settings.storage.automaticCleanupInherit
            }
            serverScoped
            settingKeys={["worktreeCleanup"]}
            mixed={mixedModes}
            control={
              <Select
                value={mixedModes ? null : mode}
                onValueChange={(next) => {
                  if (next === "inherit") clearSettings(["worktreeCleanup"]);
                  else if (next === "off") updateSettings({ worktreeCleanup: { mode: "off" } });
                  else if (next === "custom")
                    updateSettings({ worktreeCleanup: { mode: "custom", rules: {} } });
                }}
              >
                <SelectTrigger size="sm" aria-label={ko.settings.storage.automaticCleanup}>
                  <SelectValue>
                    {mixedModes
                      ? ko.settings.storage.modeMixed
                      : mode === "inherit"
                        ? ko.settings.storage.modeInherit
                        : mode === "off"
                          ? ko.common.off
                          : ko.settings.storage.modeCustom}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="inherit">{ko.settings.storage.modeInherit}</SelectItem>
                  <SelectItem value="off">{ko.common.off}</SelectItem>
                  <SelectItem value="custom">{ko.settings.storage.modeCustom}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        )}
        {(!isProjectScope || (!mixedModes && mode === "custom")) && (
          <>
            <SettingsRow
              title={ko.settings.storage.deleteWithThreads}
              status={ruleStatus("worktreeOnDelete")}
              description={ko.settings.storage.deleteWithThreadsDescription}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={ko.settings.storage.deleteWithThreads}
                  checked={settings.worktreeOnDelete}
                  onCheckedChange={(worktreeOnDelete) => updateWorktree({ worktreeOnDelete })}
                />
              }
            />
            <SettingsRow
              title={ko.settings.storage.deleteInactive}
              status={ruleStatus("worktreeAfterDays")}
              description={ko.settings.storage.deleteInactiveDescription}
              serverScoped={!isProjectScope}
              control={
                <RetentionControl
                  label={ko.settings.storage.deleteInactive}
                  value={settings.worktreeAfterDays}
                  onChange={(worktreeAfterDays) => updateWorktree({ worktreeAfterDays })}
                />
              }
            />
            <SettingsRow
              title={ko.settings.storage.deleteMerged}
              status={ruleStatus("worktreeOnMerge")}
              description={ko.settings.storage.deleteMergedDescription}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={ko.settings.storage.deleteMerged}
                  checked={settings.worktreeOnMerge}
                  onCheckedChange={(worktreeOnMerge) => updateWorktree({ worktreeOnMerge })}
                />
              }
            />
            <SettingsRow
              title={ko.settings.storage.deleteUnchanged}
              status={ruleStatus("worktreeUnchanged")}
              description={ko.settings.storage.deleteUnchangedDescription}
              serverScoped={!isProjectScope}
              control={
                <Switch
                  aria-label={ko.settings.storage.deleteUnchanged}
                  checked={settings.worktreeUnchanged}
                  onCheckedChange={(worktreeUnchanged) => updateWorktree({ worktreeUnchanged })}
                />
              }
            />
          </>
        )}
      </SettingsSection>

      {!isProjectScope && (
        <SettingsSection id="storage-artifacts" title={ko.settings.storage.artifactsSection}>
          <SettingsRow
            title={ko.settings.storage.deleteBrowserArtifacts}
            status={ruleStatus("browserArtifactsAfterDays")}
            description={ko.settings.storage.deleteBrowserArtifactsDescription}
            serverScoped
            control={
              <RetentionControl
                label={ko.settings.storage.deleteBrowserArtifacts}
                value={settings.browserArtifactsAfterDays}
                onChange={(browserArtifactsAfterDays) => update({ browserArtifactsAfterDays })}
              />
            }
          />
          <SettingsRow
            title={ko.settings.storage.deleteRotatedLogs}
            status={ruleStatus("logsAfterDays")}
            description={ko.settings.storage.deleteRotatedLogsDescription}
            serverScoped
            control={
              <RetentionControl
                label={ko.settings.storage.deleteRotatedLogs}
                value={settings.logsAfterDays}
                onChange={(logsAfterDays) => update({ logsAfterDays })}
              />
            }
          />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}
