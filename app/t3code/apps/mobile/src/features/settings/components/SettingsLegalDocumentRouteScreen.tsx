import { useNavigation } from "@react-navigation/native";
import { Pressable } from "react-native";
import { SymbolView } from "../../../components/AppSymbol";

export function SettingsLegalDocumentCloseHeaderButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityLabel="Close legal document"
      accessibilityRole="button"
      hitSlop={12}
      onPress={() => navigation.goBack()}
      className="p-2 active:opacity-60"
    >
      <SymbolView
        name="xmark"
        size={18}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="semibold"
      />
    </Pressable>
  );
}
