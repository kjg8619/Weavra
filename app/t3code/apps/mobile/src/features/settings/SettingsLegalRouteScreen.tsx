import { View } from "react-native";
import { AppText as Text } from "../../components/AppText";

export function SettingsLegalRouteScreen() {
  return (
    <View className="flex-1 justify-center gap-4 bg-sheet px-6">
      <Text className="text-xl font-t3-bold text-foreground">Development build</Text>
      <Text className="text-base leading-normal text-foreground-muted">
        Weavra does not provide hosted services in this build. No hosted-service terms, privacy
        policy or security contact have been configured. Review the repository license and the Open
        source licenses screen for applicable software notices.
      </Text>
    </View>
  );
}
