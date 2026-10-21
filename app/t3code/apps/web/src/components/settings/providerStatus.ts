import type { ServerProvider, ServerProviderVersionAdvisory } from "@t3tools/contracts";
import { ko } from "~/i18n/ko";

const copy = ko.providers.status;

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship. A ready provider without account metadata
 * remains available and does not imply an authentication failure.
 */
export function getProviderSummary(
  provider: ServerProvider | undefined,
  options?: { readonly concise?: boolean },
) {
  if (!provider) {
    return {
      headline: copy.checking,
      detail: copy.checkingDetail,
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return {
      headline: ko.common.disabled,
      detail: provider.message ?? copy.disabledDetail,
    };
  }
  if (!provider.installed) {
    return {
      headline: copy.notFound,
      detail: provider.message ?? copy.notFoundDetail,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: copy.notAuthenticated,
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: copy.needsAttention,
      detail: provider.message ?? copy.warningDetail,
    };
  }
  if (provider.status === "error") {
    return {
      headline: ko.common.unavailable,
      detail: provider.message ?? copy.errorDetail,
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline:
        !options?.concise && authLabel ? copy.authenticatedWith(authLabel) : copy.authenticated,
      detail: provider.message ?? null,
    };
  }
  return {
    headline: copy.available,
    detail: provider.message ?? null,
  };
}

/**
 * Korean cause and recovery for a structured provider failure, derived only
 * from status fields the server already reports. Shown before the original
 * diagnostics, which stay untranslated. Null when nothing needs recovery.
 */
export function getProviderRecoveryGuidance(
  provider: ServerProvider | undefined,
): { readonly cause: string; readonly action: string } | null {
  if (!provider || !provider.enabled || provider.status === "disabled") return null;
  const hasSetup = provider.driver === "antigravity" || provider.setup !== undefined;
  if (!provider.installed) {
    return {
      cause: copy.notInstalledCause,
      action:
        hasSetup && provider.setup?.canInstall !== false
          ? copy.notInstalledSetupAction
          : copy.notInstalledAction,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      cause: copy.unauthenticatedCause,
      action:
        hasSetup && provider.setup?.canAuthenticate !== false
          ? copy.unauthenticatedSetupAction
          : copy.unauthenticatedAction,
    };
  }
  if (provider.status === "error") {
    return { cause: copy.errorCause, action: copy.diagnosticsAction };
  }
  if (provider.status === "warning") {
    return { cause: copy.warningCause, action: copy.diagnosticsAction };
  }
  if (provider.versionAdvisory?.status === "behind_latest") {
    return { cause: copy.versionBehindCause, action: copy.versionBehindAction };
  }
  return null;
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  // Antigravity reports a release tag such as `agy_acp_server_20260818_01_RC01`.
  // Show the date and candidate so the row title keeps room for the name.
  const antigravity = /^agy_acp_server_(\d{4})(\d{2})(\d{2})_\d+(?:_(\w+))?$/.exec(version);
  if (antigravity) {
    const [, year, month, day, candidate] = antigravity;
    return `${year}-${month}-${day}${candidate ? ` ${candidate}` : ""}`;
  }
  // Only bare semver-like versions get a `v` prefix. Other tags are shown as-is.
  return /^\d/.test(version) ? `v${version}` : version;
}

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
): {
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    detail:
      advisory.message ??
      (versionLabel ? copy.updateInstallVersion(versionLabel) : copy.updateInstallLatest),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
  };
}
