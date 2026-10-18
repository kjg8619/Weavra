import type { ComposerContextRecord } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "./AppText";
import { MaterialButton } from "./MaterialButton";

/** Inspect the saved record, including fields with no visible prompt reference. */
export function ComposerContextRecordDetails(props: { readonly record: ComposerContextRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-1">
      <AppText className="text-xs text-foreground-secondary">
        {props.record.kind}: {props.record.label}
      </AppText>
      <MaterialButton
        tone="text"
        label={`${expanded ? "Hide" : "Show"} ${props.record.label} details`}
        onPress={() => setExpanded((current) => !current)}
      />
      {expanded ? (
        <AppText selectable className="text-sm">
          {JSON.stringify(props.record, null, 2)}
        </AppText>
      ) : null}
    </View>
  );
}
