import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";

const T3CODE_CODEX_LAUNCH_ARGS_ENV = "T3CODE_CODEX_LAUNCH_ARGS";

export const resolveCodexLaunchArgs = (
  launchArgs?: string,
  environment: NodeJS.ProcessEnv = process.env,
) => environment[T3CODE_CODEX_LAUNCH_ARGS_ENV]?.trim() || launchArgs?.trim() || "";

const codexLaunchArgv = (launchArgs?: string): ReadonlyArray<string> => tokenizeCliArgs(launchArgs);

export const codexAppServerArgs = (launchArgs?: string) => [
  "app-server",
  ...codexLaunchArgv(launchArgs),
];

export const codexExecLaunchArgs = (launchArgs?: string) => {
  const args = codexLaunchArgv(launchArgs);
  const execArgs: Array<string> = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === "--strict-config" || arg.startsWith("--config=") || arg.startsWith("-c=")) {
      execArgs.push(arg);
    } else if (arg === "--config" || arg === "-c" || arg === "--enable" || arg === "--disable") {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        execArgs.push(arg, value);
        index++;
      }
    } else if (arg.startsWith("--enable=") || arg.startsWith("--disable=")) {
      execArgs.push(arg);
    }
  }

  return execArgs;
};

export const codexSessionAppServerArgs = (
  appServerArgs: ReadonlyArray<string> | undefined,
  launchArgs: string | undefined,
  controlledAnalysis = false,
) => {
  const launchAppServerArgs = codexAppServerArgs(launchArgs);
  const args = appServerArgs ? [...launchAppServerArgs, ...appServerArgs] : launchAppServerArgs;
  if (!controlledAnalysis) return args;
  const controlled = ["app-server"];
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--strict-config") continue;
    let flag: string;
    let value: string | undefined;
    if (arg === "-c" || arg === "--config" || arg === "--enable" || arg === "--disable") {
      flag = arg;
      value = args[++index];
    } else if (arg?.startsWith("--config=")) {
      flag = "--config";
      value = arg.slice("--config=".length);
    } else if (arg?.startsWith("-c") && arg.length > 2) {
      flag = "-c";
      value = arg.slice(2);
    } else if (arg?.startsWith("--enable=") || arg?.startsWith("--disable=")) {
      const equals = arg.indexOf("=");
      flag = arg.slice(0, equals);
      value = arg.slice(equals + 1);
    } else {
      throw new Error("Controlled analysis does not support this Codex launch option.");
    }
    if (!value || value.startsWith("-"))
      throw new Error("Controlled analysis requires explicit Codex option values.");
    if (flag === "-c" || flag === "--config") {
      const equals = value.indexOf("=");
      if (
        equals < 1 ||
        value.slice(0, equals).trim().replaceAll('"', "").replaceAll("'", "") === "profile"
      )
        throw new Error("Controlled analysis does not support a selected Codex profile.");
    }
    controlled.push(flag, value);
  }
  controlled.push("--strict-config");
  for (const feature of CONTROLLED_ANALYSIS_DISABLED_FEATURES) {
    // Codex emits --disable overrides after --enable overrides, independently of argv order.
    controlled.push("--disable", feature, "-c", `features.${feature}=false`);
  }
  return controlled;
};

export const CONTROLLED_ANALYSIS_DISABLED_FEATURES = [
  "apps",
  "plugins",
  "hooks",
  "codex_hooks",
  "plugin_hooks",
  "skill_mcp_dependency_install",
] as const;

function isConfigRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function controlledAnalysisConfigIssue(
  config: Readonly<Record<string, unknown>>,
): string | null {
  if (config["profile"] !== undefined && config["profile"] !== null)
    return "Controlled analysis does not support a selected Codex profile.";
  const features = config["features"];
  if (
    !isConfigRecord(features) ||
    CONTROLLED_ANALYSIS_DISABLED_FEATURES.some((key) => features[key] !== false)
  )
    return "Controlled analysis could not verify disabled external-tool features.";
  const servers = config["mcp_servers"];
  if (
    servers !== undefined &&
    (!isConfigRecord(servers) ||
      Object.values(servers).some(
        (server) => !isConfigRecord(server) || server["enabled"] !== false,
      ))
  )
    return "Controlled analysis requires every configured MCP server to be explicitly disabled.";
  return null;
}
