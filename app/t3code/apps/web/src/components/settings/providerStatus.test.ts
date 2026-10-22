import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getProviderRecoveryGuidance, getProviderSummary } from "./providerStatus";
import { ko } from "~/i18n/ko";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("getProviderSummary", () => {
  it("keeps account metadata and long diagnostics out of the structured headline", () => {
    const message = "Synthetic CLI diagnostic\n".repeat(80);
    const summary = getProviderSummary(
      {
        ...provider,
        auth: { status: "authenticated", label: "account-".repeat(80) },
        message,
      },
      { concise: true },
    );
    expect(summary.headline).toBe(
      getProviderSummary({ ...provider, auth: { status: "authenticated" } }, { concise: true })
        .headline,
    );
    expect(summary.detail).toBe(message);
  });

  it("preserves the account metadata for consumers that do not request a concise status", () => {
    const label = "synthetic-account-type";
    const summary = getProviderSummary({
      ...provider,
      auth: { status: "authenticated", label },
    });
    expect(summary.headline.endsWith(label)).toBe(true);
  });

  it("reports ready providers with unknown authentication as available", () => {
    expect(getProviderSummary({ ...provider, auth: { status: "unknown" } })).toEqual({
      headline: ko.providers.status.available,
      detail: null,
    });
  });

  it("does not hide a provider error behind a previous authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        message: "The provider process failed to start.",
      }),
    ).toEqual({
      headline: ko.common.unavailable,
      detail: "The provider process failed to start.",
    });
  });

  it("does not hide a provider warning behind an authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "warning",
        message: "The provider version is unsupported.",
      }),
    ).toEqual({
      headline: ko.providers.status.needsAttention,
      detail: "The provider version is unsupported.",
    });
  });

  it("keeps authentication failures actionable when their provider status is error", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Run codex login.",
      }),
    ).toEqual({
      headline: ko.providers.status.notAuthenticated,
      detail: "Run codex login.",
    });
  });

  it("treats a disabled provider status as disabled even before its enabled flag updates", () => {
    expect(getProviderSummary({ ...provider, status: "disabled" }).headline).toBe(
      ko.common.disabled,
    );
  });
});

describe("getProviderRecoveryGuidance", () => {
  const raw = "HIG fixture requires codex login";

  it("gives each structured failure its own catalog cause and action, leaving the raw diagnostic intact", () => {
    const cases = [
      { ...provider, installed: false, message: raw },
      { ...provider, auth: { status: "unauthenticated" as const }, message: raw },
      { ...provider, status: "error" as const, message: raw },
      { ...provider, status: "warning" as const, message: raw },
    ];
    const guidance = cases.map((entry) => getProviderRecoveryGuidance(entry));
    const causes = guidance.map((entry) => entry?.cause);
    expect(new Set(causes).size).toBe(cases.length);
    for (const [index, entry] of guidance.entries()) {
      expect(entry).not.toBeNull();
      expect(entry!.cause).not.toContain(raw);
      expect(entry!.action).not.toContain(raw);
      expect(getProviderSummary(cases[index]!).detail).toBe(raw);
    }
  });

  it("has no guidance for a ready or disabled provider", () => {
    expect(getProviderRecoveryGuidance(provider)).toBeNull();
    expect(
      getProviderRecoveryGuidance({ ...provider, enabled: false, installed: false }),
    ).toBeNull();
  });
});
