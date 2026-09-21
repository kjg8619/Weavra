// @effect-diagnostics nodeBuiltinImport:off - Exercises the actual unavailable installer without network tools.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { expect, it } from "vite-plus/test";

it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
  "refuses an inherited release configuration before changing the home or invoking a downloader",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavra-installer-"));
    try {
      const home = NodePath.join(root, "home");
      const bin = NodePath.join(root, "bin");
      const marker = NodePath.join(root, "external-command");
      NodeFS.mkdirSync(home);
      NodeFS.mkdirSync(bin);
      for (const name of ["curl", "wget", "git", "npm", "tar"]) {
        NodeFS.writeFileSync(
          NodePath.join(bin, name),
          '#!/bin/sh\nprintf attempted > "$WEAVRA_TEST_MARKER"\nexit 97\n',
          { mode: 0o755 },
        );
      }
      const result = NodeChildProcess.spawnSync(
        "/bin/sh",
        [NodePath.join(import.meta.dirname, "install.sh")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            PATH: bin,
            WEAVRA_TEST_MARKER: marker,
            T3CODE_HOME: home,
            T3CODE_VERSION: "1.2.3",
            T3CODE_RELEASE_BASE_URL: "https://upstream.invalid/releases",
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unavailable");
      expect(NodeFS.existsSync(marker)).toBe(false);
      expect(NodeFS.readdirSync(home)).toEqual([]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(HostProcessPlatform.defaultValue() !== "win32")(
  "refuses the PowerShell installer before creating a runtime home",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weavra-installer-"));
    try {
      const home = NodePath.join(root, "not-created");
      const result = NodeChildProcess.spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          NodePath.join(import.meta.dirname, "install.ps1"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            T3CODE_HOME: home,
            WEAVRA_APP_HOME: home,
            T3CODE_VERSION: "1.2.3",
            T3CODE_RELEASE_BASE_URL: "https://upstream.invalid/releases",
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unavailable");
      expect(NodeFS.existsSync(home)).toBe(false);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
