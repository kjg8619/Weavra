import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  codexAppServerArgs,
  codexExecLaunchArgs,
  codexSessionAppServerArgs,
  controlledAnalysisConfigIssue,
  CONTROLLED_ANALYSIS_DISABLED_FEATURES,
  resolveCodexLaunchArgs,
} from "./codexLaunchArgs.ts";

describe("resolveCodexLaunchArgs", () => {
  it("uses T3CODE_CODEX_LAUNCH_ARGS before configured settings", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { T3CODE_CODEX_LAUNCH_ARGS: "--enable foo" }),
      "--enable foo",
    );
  });

  it("uses configured settings when T3CODE_CODEX_LAUNCH_ARGS is empty", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { T3CODE_CODEX_LAUNCH_ARGS: "   " }),
      "--strict-config",
    );
  });

  it("ignores whitespace-only environment values", () => {
    NodeAssert.equal(resolveCodexLaunchArgs("", { T3CODE_CODEX_LAUNCH_ARGS: "   " }), "");
  });
});

describe("codexAppServerArgs", () => {
  it("returns the app-server command for empty launch args", () => {
    NodeAssert.deepStrictEqual(codexAppServerArgs(""), ["app-server"]);
  });

  it("appends parsed launch args after app-server", () => {
    NodeAssert.deepStrictEqual(codexAppServerArgs("--strict-config --enable foo"), [
      "app-server",
      "--strict-config",
      "--enable",
      "foo",
    ]);
  });
});

describe("codexExecLaunchArgs", () => {
  it("keeps shared codex flags and omits app-server-only flags", () => {
    NodeAssert.deepStrictEqual(
      codexExecLaunchArgs('--strict-config --enable foo --listen off --config model="gpt 5"'),
      ["--strict-config", "--enable", "foo", "--config", "model=gpt 5"],
    );
  });

  it("does not pair value-taking flags with adjacent flags", () => {
    NodeAssert.deepStrictEqual(codexExecLaunchArgs("--config --strict-config --enable --disable"), [
      "--strict-config",
    ]);
  });
});

describe("controlled Codex launch", () => {
  it("forces strict configuration and feature disables despite inherited enables", () => {
    const args = codexSessionAppServerArgs(
      [],
      '--enable plugins --config features.apps=true --config model_provider="fixture"',
      true,
    );
    NodeAssert.equal(args.filter((arg) => arg === "--strict-config").length, 1);
    for (const feature of [
      "apps",
      "plugins",
      "hooks",
      "codex_hooks",
      "plugin_hooks",
      "skill_mcp_dependency_install",
    ]) {
      NodeAssert.ok(args.some((arg, index) => arg === "--disable" && args[index + 1] === feature));
    }
    NodeAssert.ok(args.includes("model_provider=fixture"));
  });

  it("rejects selected profiles and ambiguous controlled launch options", () => {
    for (const input of [
      "--profile work",
      "-pwork",
      "-c profile='work'",
      "--",
      "--listen ws://localhost:1234",
    ]) {
      NodeAssert.throws(() => codexSessionAppServerArgs([], input, true));
    }
  });

  it("requires explicit feature denial and disabled MCP servers in effective configuration", () => {
    const features = Object.fromEntries(
      CONTROLLED_ANALYSIS_DISABLED_FEATURES.map((key) => [key, false]),
    );
    const clean = { features, model_provider: "fixture", model: "custom", profile: null };
    NodeAssert.equal(controlledAnalysisConfigIssue(clean), null);
    NodeAssert.equal(controlledAnalysisConfigIssue({ ...clean, mcp_servers: {} }), null);
    NodeAssert.equal(
      controlledAnalysisConfigIssue({
        ...clean,
        mcp_servers: { mutator: { enabled: false, command: "fixture-writer" } },
        plugins: { configuredButGloballyDisabled: { enabled: true } },
      }),
      null,
    );
    for (const mcp_servers of [
      null,
      [],
      { mutator: {} },
      { mutator: { enabled: true } },
      { mutator: null },
    ]) {
      NodeAssert.notEqual(controlledAnalysisConfigIssue({ ...clean, mcp_servers }), null);
    }
    for (const key of CONTROLLED_ANALYSIS_DISABLED_FEATURES) {
      NodeAssert.notEqual(
        controlledAnalysisConfigIssue({ ...clean, features: { ...features, [key]: true } }),
        null,
      );
    }
    NodeAssert.notEqual(controlledAnalysisConfigIssue({ ...clean, features: {} }), null);
    NodeAssert.notEqual(controlledAnalysisConfigIssue({ ...clean, profile: "unresolved" }), null);
  });
});
