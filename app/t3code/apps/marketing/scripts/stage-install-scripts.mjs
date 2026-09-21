// Serve the canonical unavailable-installer responses from scripts/.
// Weavra has no hosted installer source. Build/dev must copy both files so a
// stale inherited downloader can never survive in the marketing output.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const marketingDir = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const repoRoot = NodePath.dirname(NodePath.dirname(marketingDir));
const publicDir = NodePath.join(marketingDir, "public");
NodeFS.mkdirSync(publicDir, { recursive: true });
for (const name of ["install.sh", "install.ps1"]) {
  NodeFS.copyFileSync(NodePath.join(repoRoot, "scripts", name), NodePath.join(publicDir, name));
}
