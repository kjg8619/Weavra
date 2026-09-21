import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Notifications from "expo-notifications";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import {
  isAtomCommandInterrupted,
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  openAndroidLiveUpdateSettings,
  supportsAndroidLiveUpdateSettings,
} from "../agent-awareness/androidNotifications";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsScreen } from "./components/SettingsScreen";

type NotificationStatus = "checking" | "enabled" | "disabled" | "unsupported";

export function SettingsNotificationsRouteScreen() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const insets = useSafeAreaInsets();
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>("checking");
  const canClearLiveActivitiesPreference =
    AsyncResult.isSuccess(preferencesResult) &&
    preferencesResult.value.liveActivitiesEnabled !== false;

  const refreshNotifications = useCallback(async () => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      setNotificationStatus("unsupported");
      return;
    }
    const result = await settlePromise(() => Notifications.getPermissionsAsync());
    if (result._tag === "Failure") {
      reportAtomCommandResult(result, { label: "notification permission refresh" });
      setNotificationStatus("disabled");
      return;
    }
    setNotificationStatus(result.value.granted ? "enabled" : "disabled");
  }, []);

  useEffect(() => {
    void refreshNotifications();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshNotifications();
    });
    return () => subscription.remove();
  }, [refreshNotifications]);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      Alert.alert("Couldn't open Settings", "Open this device's notification settings manually.");
    });
  }, []);

  const requestNotifications = useCallback(async () => {
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        Alert.alert(
          "Notification permission unavailable",
          error instanceof Error ? error.message : "Could not request notification permission.",
        );
      }
      return;
    }
    if (result.value.type === "granted") {
      setNotificationStatus("enabled");
      Alert.alert(
        "System permission granted",
        "Remote delivery remains unavailable in this development build.",
      );
      return;
    }
    if (result.value.type === "unsupported") {
      setNotificationStatus("unsupported");
      Alert.alert(
        "Notifications unavailable",
        "Notification permission is unavailable on this platform.",
      );
      return;
    }
    setNotificationStatus("disabled");
    if (result.value.canAskAgain) {
      Alert.alert("Notifications disabled", "Notification permission was not granted.");
      return;
    }
    Alert.alert(
      "Notifications disabled",
      "Notifications were denied for this app. Open Settings to change the system permission.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: openSystemSettings },
      ],
    );
  }, [openSystemSettings]);

  const handleDeviceNotificationsChange = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        void requestNotifications();
        return;
      }
      Alert.alert("System notification permission", "Change this permission in device Settings.", [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: openSystemSettings },
      ]);
    },
    [openSystemSettings, requestNotifications],
  );

  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="text-base text-foreground-muted">
          Remote notifications and live activity delivery are unavailable because this development
          build has no hosted push service. Local permissions and preferences do not enable remote
          delivery.
        </Text>
        <SettingsSection title="Local device preferences">
          <SettingsSwitchRow
            icon="bell.badge"
            label="System notification permission"
            subtitle="Device permission only; hosted delivery is unavailable"
            disabled={notificationStatus === "checking" || notificationStatus === "unsupported"}
            value={notificationStatus === "enabled"}
            onValueChange={handleDeviceNotificationsChange}
          />
          {canClearLiveActivitiesPreference ? (
            <SettingsRow
              icon="bolt.circle"
              label="Turn off Live Activity preference"
              onPress={() => savePreferences({ liveActivitiesEnabled: false })}
            />
          ) : null}
          {Platform.OS === "ios" || Platform.OS === "android" ? (
            <SettingsRow
              icon="bell.badge"
              label="System notification settings"
              onPress={openSystemSettings}
            />
          ) : null}
          {supportsAndroidLiveUpdateSettings() ? (
            <SettingsRow
              icon="bolt.circle"
              label="Live Update Settings"
              onPress={() => {
                void openAndroidLiveUpdateSettings().catch(() => {
                  Alert.alert(
                    "Couldn't open Settings",
                    "Open Android Settings, select Weavra, then open Live Updates in Notifications.",
                  );
                });
              }}
            />
          ) : null}
        </SettingsSection>
      </ScrollView>
    </SettingsScreen>
  );
}
