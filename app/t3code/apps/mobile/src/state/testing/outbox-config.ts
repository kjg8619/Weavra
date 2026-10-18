import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  type ServerConfig,
} from "@t3tools/contracts";

export const environmentId = EnvironmentId.make("environment");
export const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "model" };
export const config: ServerConfig = {
  environment: {
    environmentId,
    label: "Test",
    platform: { os: "darwin", arch: "arm64" },
    serverVersion: "test",
    capabilities: { repositoryIdentity: true, connectionProbe: true, attachmentUploads: true },
  },
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-access-token"],
    sessionCookieName: "test",
  },
  cwd: "/repo",
  keybindingsConfigPath: "/tmp/keys",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};
