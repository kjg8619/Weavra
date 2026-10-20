import { useMemo } from "react";

import { useEnvironments } from "~/state/environments";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { ProviderUpdateEnvironmentRows } from "./ProviderUpdateEnvironmentRows";

/**
 * True when a desktop-local secondary backend (the parallel WSL backend) is
 * present alongside the primary. Local secondaries connect over loopback with a
 * `local:<backendInstanceId>` bearer connection id; everything else (SSH, relay,
 * remote) is ignored.
 */
function useHasLocalSecondaryEnvironment(): boolean {
  const { environments } = useEnvironments();
  return useMemo(
    () =>
      environments.some((environment) => isDesktopLocalConnectionTarget(environment.entry.target)),
    [environments],
  );
}

/**
 * Provider update availability is routine information. It no longer opens a
 * launch popup over active work, so a modal or picker is never covered and
 * nothing is replayed when it closes. Availability stays discoverable in the
 * sidebar update pill and Providers settings, where the user starts an update
 * and reads its result in place. The app shell keeps this mount point.
 */
export function ProviderUpdateLaunchNotification() {
  return null;
}

export function ProviderUpdateEnvironmentsStatus() {
  const hasLocalSecondary = useHasLocalSecondaryEnvironment();
  return hasLocalSecondary ? <ProviderUpdateEnvironmentRows /> : null;
}
