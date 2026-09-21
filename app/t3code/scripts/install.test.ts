// @effect-diagnostics nodeBuiltinImport:off - Exercises the real shell entrypoint against an HTTP listener.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

it.skipIf(HostProcessPlatform.defaultValue() === "win32")(
  "refuses a release mirror before any download or installation",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "weavra-installer-"));
    const requests: string[] = [];
    const server = NodeHttp.createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(500).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const child = NodeChildProcess.spawn(
        "sh",
        [NodePath.join(import.meta.dirname, "install.sh")],
        {
          env: {
            ...process.env,
            T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
            T3CODE_VERSION: "1.2.3",
            T3CODE_HOME: NodePath.join(root, "home"),
            T3CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(code).toBe(1);
      expect(stderr).toContain("no Weavra release channel");
      expect(requests).toEqual([]);
      expect(await NodeFSP.readdir(root)).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
