import { setManagedRelaySession } from "@t3tools/client-runtime/relay";
import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { type ReactNode, useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { clearAgentAwarenessRegistrationRecord } from "../../persistence/imperative";
import { getAgentLiveActivities } from "../agent-awareness/agentLiveActivity";
import { clearAndroidAgentNotifications } from "../agent-awareness/androidNotifications";

export async function deactivateCloudRelayAccount(): Promise<void> {
  setManagedRelaySession(appAtomRegistry, null);
  const activities = await settlePromise(async () => {
    clearAndroidAgentNotifications();
    for (const activity of getAgentLiveActivities()) {
      const ended = await settlePromise(() => activity.end("immediate"));
      if (ended._tag === "Failure") {
        reportAtomCommandResult(ended, { label: "local Live Activity cleanup" });
      }
    }
  });
  if (activities._tag === "Failure") {
    reportAtomCommandResult(activities, { label: "local notification cleanup" });
  }
  const registration = await settlePromise(clearAgentAwarenessRegistrationRecord);
  if (registration._tag === "Failure") {
    reportAtomCommandResult(registration, { label: "saved push registration cleanup" });
  }
}

export function CloudAuthProvider(props: { readonly children: ReactNode }) {
  useEffect(() => {
    void deactivateCloudRelayAccount();
  }, []);
  return props.children;
}
