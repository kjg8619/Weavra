import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const gh = join(root, "tools/portable/gh_2.102.0_macOS_arm64/bin/gh");
const index = JSON.parse(await fs.readFile(join(root, "publication-index.json"), "utf8"));
const mapFile = join(root, "attachment-map.json");
let attachments = {};
try {
  attachments = JSON.parse(await fs.readFile(mapFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const repo = "kjg8619/Weavra";
const remote = JSON.parse((await exec(gh, ["pr", "view", "74", "--repo", repo, "--json", "headRefOid"])).stdout);
if (remote.headRefOid !== index.provenance.after.revision)
  throw new Error("Push the exact captured foundations revision before publishing images");
const failed = JSON.parse(await fs.readFile(join(root, "publication-verification.json"), "utf8"));
const failedUrls = new Set(failed.failures.map((entry) => entry.url));
const originalAttachments = structuredClone(attachments);
const originalBody = await fs.readFile(join(root, "publication-body.md"), "utf8");
const pending = index.images.filter((image) => failedUrls.has(attachments[`${image.side}/${image.file}`]?.url));
for (let start = 0; start < pending.length; start += 50) {
  const batch = pending.slice(start, start + 50);
  let status = originalBody;
  for (const [key, original] of Object.entries(originalAttachments)) {
    const current = attachments[key];
    if (current.url !== original.url) status = status.replaceAll(original.url, current.url);
  }

  let failure;
  try {
    await exec(gh, ["pr", "edit", "74", "--repo", repo, "--body", status,
      ...batch.flatMap((image) => ["--attach", `${image.path}#${image.side}/${image.file}`])],
    { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    failure = error;
  }
  const body = JSON.parse((await exec(gh, ["pr", "view", "74", "--repo", repo, "--json", "body"])).stdout).body;
  for (const match of body.matchAll(/!\[([^\]]+)\]\((https:\/\/github\.com\/user-attachments\/assets\/[^)]+)\)/g)) {
    const image = batch.find((image) => `${image.side}/${image.file}` === match[1]);
    if (image) attachments[match[1]] = { url: match[2], sha256: image.sha256 };
  }
  await fs.writeFile(mapFile, JSON.stringify(attachments, null, 2));
  const verified = index.images.filter((image) =>
    attachments[`${image.side}/${image.file}`]?.sha256 === image.sha256).length;
  console.log(`REUPLOADED ${start + batch.length}/${pending.length}; mapped=${verified}/${index.images.length}`);
  if (failure) throw failure;
  for (const image of batch)
    if (attachments[`${image.side}/${image.file}`]?.sha256 !== image.sha256)
      throw new Error(`Current upload URL missing: ${image.name}`);
}
console.log("ATTACHMENTS_COMPLETE");
