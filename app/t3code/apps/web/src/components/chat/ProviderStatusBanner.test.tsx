import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./ProviderStatusBanner";
import { getThreadErrorBannerKey, shouldShowThreadErrorBanner } from "./ThreadErrorBanner";

function warningProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "warning",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-23T12:00:00.000Z",
    message: "Provider is temporarily degraded.",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("ProviderStatusBanner", () => {
  it("waits for an Antigravity auth result before showing a sign-in warning", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      instanceId: ProviderInstanceId.make("google_work"),
      driver: ProviderDriverKind.make("antigravity"),
      auth: { status: "unknown" },
      message: "Antigravity is installed. Google account access is not checked yet.",
    };

    expect(shouldShowProviderStatusBanner(status, null)).toBe(false);
    expect(
      shouldShowProviderStatusBanner(
        {
          ...status,
          auth: { status: "unauthenticated" },
          message: "Sign in with Google to use Antigravity.",
        },
        null,
      ),
    ).toBe(true);
  });

  it("shows Antigravity installation and startup failures before auth is checked", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      driver: ProviderDriverKind.make("antigravity"),
      auth: { status: "unknown" },
    };

    expect(shouldShowProviderStatusBanner({ ...status, installed: false }, null)).toBe(true);
    expect(shouldShowProviderStatusBanner({ ...status, status: "error" }, null)).toBe(true);
    expect(
      shouldShowProviderStatusBanner({ ...status, driver: ProviderDriverKind.make("codex") }, null),
    ).toBe(true);
  });

  it("shows an auth-only failure with its own recovery key", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex requires login",
    };

    expect(shouldShowProviderStatusBanner(status, null)).toBe(true);
    expect(shouldShowThreadErrorBanner("env:thread-a", null, false)).toBe(false);
  });

  it("keeps an auth failure and a turn failure independent", () => {
    const status: ServerProvider = {
      ...warningProvider(),
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Provider unavailable",
    };
    const turnKey = getThreadErrorBannerKey("env:thread-a", "Provider unavailable");

    expect(getProviderStatusBannerKey(status)).not.toBe(turnKey);
    // Dismissing the turn failure must not hide the provider cause, and vice versa.
    expect(shouldShowProviderStatusBanner(status, turnKey)).toBe(true);
    expect(shouldShowThreadErrorBanner("env:thread-a", "Provider unavailable", false)).toBe(true);
  });

  it("treats the same provider event repeated as one cause", () => {
    const first = warningProvider();
    const repeated = { ...warningProvider(), checkedAt: "2026-07-23T12:05:00.000Z" };

    expect(getProviderStatusBannerKey(repeated)).toBe(getProviderStatusBannerKey(first));
    expect(shouldShowProviderStatusBanner(repeated, getProviderStatusBannerKey(first))).toBe(false);
  });

  it("keeps equal messages from distinct provider instances separate", () => {
    const work = warningProvider();
    const personal = {
      ...warningProvider(),
      instanceId: ProviderInstanceId.make("codex_personal"),
    };

    expect(getProviderStatusBannerKey(personal)).not.toBe(getProviderStatusBannerKey(work));
    expect(shouldShowProviderStatusBanner(personal, getProviderStatusBannerKey(work))).toBe(true);
  });

  it("stays hidden after its current warning is dismissed", () => {
    const status = warningProvider();

    expect(shouldShowProviderStatusBanner(status, null)).toBe(true);
    expect(shouldShowProviderStatusBanner(status, getProviderStatusBannerKey(status))).toBe(false);
  });

  it("renders an accessible dismiss control for provider warnings", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner status={warningProvider()} onDismiss={() => {}} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Codex 공급자 경고 닫기"');
  });

  it("labels error dismiss controls with the correct severity", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={{ ...warningProvider(), status: "error" }}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Codex 공급자 오류 닫기"');
  });
});

describe("getProviderStatusMessage", () => {
  it("preserves the environment's authentication error", () => {
    const message = "SUBSCRIPTION_REQUIRED: This Google account cannot use Antigravity.";
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        status: "error",
        auth: { status: "unauthenticated" },
        message,
      }),
    ).toBe(message);
  });

  it("points a signed-out Antigravity account to Google sign-in without a CLI command", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("공급자 설정을 열어 Google로 로그인해 주세요.");
  });

  it("requires installation on the environment before sign-in", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        driver: ProviderDriverKind.make("antigravity"),
        displayName: "Google work account",
        installed: false,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("Open provider setup to install Antigravity on this environment.");
  });

  it("keeps CLI sign-in advice for a provider without integrated setup", () => {
    expect(
      getProviderStatusMessage({
        ...warningProvider(),
        status: "error",
        auth: { status: "unauthenticated" },
        message: "",
      }),
    ).toBe("CLI로 다시 로그인해 주세요.");
  });
});
