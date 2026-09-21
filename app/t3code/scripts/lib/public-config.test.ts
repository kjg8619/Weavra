// @effect-diagnostics nodeBuiltinImport:off - Exercises real env-file precedence and inherited tenant removal.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { loadRepoEnv, resolvePublicConfig } from "./public-config.ts";

it("does not enable hosted services through ambient or copied legacy build configuration", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavra-public-config-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(root, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_RELAY_URL=https://relay.example.test\nLOCAL_VALUE=root\nROOT_ONLY=retained\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(root, ".env.local"),
      "VITE_CLERK_JWT_TEMPLATE=legacy\nEXPO_PUBLIC_OTLP_TRACES_TOKEN=token\nLOCAL_VALUE=local\n",
    );
    const ambient = {
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ambient",
      T3CODE_RELAY_URL: "https://ambient.example.test",
      ANTHROPIC_API_KEY: "provider-key",
      LOCAL_VALUE: "process",
    };
    const env = Object.assign({ ...ambient }, loadRepoEnv({ baseEnv: ambient, repoRoot: root }));
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBe("");
    expect(env.T3CODE_RELAY_URL).toBe("");
    expect(env.T3CODE_CLERK_PUBLISHABLE_KEY).toBe("");
    expect(env.EXPO_PUBLIC_OTLP_TRACES_TOKEN).toBe("");
    expect(env.ANTHROPIC_API_KEY).toBe("provider-key");
    expect(env.LOCAL_VALUE).toBe("process");
    expect(env.ROOT_ONLY).toBe("retained");
    expect(
      Object.values(resolvePublicConfig(ambient, env)).every((value) => value === undefined),
    ).toBe(true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
