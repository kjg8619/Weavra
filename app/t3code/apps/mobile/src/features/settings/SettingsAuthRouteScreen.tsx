import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";

export function SettingsAuthRouteScreen() {
  return (
    <View className="flex-1 justify-center gap-3 bg-sheet px-6">
      <Text className="text-lg font-t3-bold text-foreground">Cloud accounts unavailable</Text>
      <Text className="text-base leading-normal text-foreground-muted">
        This Weavra development build does not provide a hosted account or relay service. Add a
        direct environment in Settings instead.
      </Text>
    </View>
  );
}
