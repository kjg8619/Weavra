import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WEAVRA_PRODUCT_VERSION } from "@t3tools/shared/product";

import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { AppText as Text } from "../../components/AppText";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

export function SettingsAboutRouteScreen() {
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="About Weavra">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="App">
          <SettingsRow icon="internaldrive" label="Client Storage" target="SettingsClientStorage" />
          <SettingsRow icon="stethoscope" label="Diagnostics" target="SettingsDiagnostics" />
          <SettingsRow
            icon="doc.on.doc"
            label="Open source licenses"
            target="SettingsOpenSourceLicenses"
          />
          <SettingsRow icon="doc.text" label="Legal" fullScreenTarget="SettingsLegal" />
          <View className="flex-row items-center justify-between gap-4 p-4">
            <Text className="text-lg text-foreground">Version</Text>
            <Text className="text-lg text-foreground-muted">{WEAVRA_PRODUCT_VERSION}</Text>
          </View>
        </SettingsSection>
        <Text className="text-sm leading-normal text-foreground-muted">
          App updates, hosted accounts, cloud relay and push delivery are unavailable in this
          development build. Connect directly to your own environment on your local network or
          tailnet. Install a new local build to update the app.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
