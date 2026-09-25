// Pins git behaviour for every repository the suite creates, ahead of the
// host's ~/.gitconfig. Git for Windows installs with core.autocrlf=true,
// which checks committed LF files out as CRLF and breaks every byte-exact
// content assertion; a signing key or a non-default init branch on the
// developer's machine breaks fixtures the same way. Set as environment so
// each git child the driver spawns sees it without touching the fixtures.
//
// maintenance.auto=false: commit, fetch and merge start a detached
// `git maintenance run --auto --detach` that outlives the command the driver
// waited for. Since git 2.54 it repacks once objects/17, the only directory it
// samples, holds two loose objects, writing .git/objects/pack and .git/info
// while the scoped temp directory is removed (ENOTEMPTY).
const entries: ReadonlyArray<readonly [key: string, value: string]> = [
  ["core.autocrlf", "false"],
  ["core.filemode", "false"],
  ["core.longpaths", "true"],
  ["commit.gpgsign", "false"],
  ["tag.gpgsign", "false"],
  ["init.defaultBranch", "main"],
  ["maintenance.auto", "false"],
];

const existing = Number(process.env.GIT_CONFIG_COUNT ?? "0");
process.env.GIT_CONFIG_COUNT = String(existing + entries.length);
entries.forEach(([key, value], index) => {
  process.env[`GIT_CONFIG_KEY_${existing + index}`] = key;
  process.env[`GIT_CONFIG_VALUE_${existing + index}`] = value;
});
