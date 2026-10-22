import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeURL from "node:url";
import { expectedFiles } from "./cases.mjs";
import { pngDimensions, sha256 } from "./assert.mjs";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
export async function diffCapture(before, after, out, visualCli) {
  // Refuse reuse: old successful pair receipts must never survive a failed run.
  await NodeFSP.mkdir(out);
  const result = { before, after, pairs: [], failures: [] };
  const [beforePacket, afterPacket] = await Promise.all(
    [before, after].map(async (directory) =>
      JSON.parse(await NodeFSP.readFile(NodePath.join(directory, "capture-manifest.json"), "utf8")),
    ),
  );
  const afterFiles = new Set(
    afterPacket.manifest.flatMap((r) => [r.file, r.electronFile].filter(Boolean)),
  );
  const files = new Set([
    ...expectedFiles(),
    ...beforePacket.manifest.flatMap((r) =>
      [r.file, r.electronFile].filter((file) => afterFiles.has(file)),
    ),
  ]);
  for (const file of files) {
    try {
      const b = NodePath.join(before, file);
      const a = NodePath.join(after, file);
      const [bb, ab] = await Promise.all([NodeFSP.readFile(b), NodeFSP.readFile(a)]);
      const { stdout } = await exec(
        process.execPath.endsWith("/bun") ? "node" : process.execPath,
        [visualCli, "image-diff", b, a],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      const comparison = JSON.parse(stdout);
      const pair = {
        file,
        beforeSha256: sha256(bb),
        afterSha256: sha256(ab),
        beforeDimensions: pngDimensions(bb),
        afterDimensions: pngDimensions(ab),
        result: comparison,
      };
      result.pairs.push(pair);
      const target = NodePath.join(out, file.replace(".png", ".json"));
      await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
      await NodeFSP.writeFile(target, JSON.stringify(pair, null, 2));
      NodeAssert.equal(comparison.dimensionsMatch, true, `Dimension mismatch: ${file}`);
      console.log(`DIFF ${file}`);
    } catch (error) {
      result.failures.push({ file, error: String(error) });
    }
  }
  await NodeFSP.writeFile(NodePath.join(out, "pairs.json"), JSON.stringify(result, null, 2));
  NodeAssert.equal(result.failures.length, 0, JSON.stringify(result.failures));
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const { values } = NodeUtil.parseArgs({
    options: {
      before: { type: "string" },
      after: { type: "string" },
      out: { type: "string" },
      visual: {
        type: "string",
        default:
          "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs",
      },
    },
  });
  NodeAssert.ok(values.before && values.after && values.out);
  await diffCapture(
    NodePath.resolve(values.before),
    NodePath.resolve(values.after),
    NodePath.resolve(values.out),
    values.visual,
  );
}
