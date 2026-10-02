/** Internal Git argv only. Unknown commands are mutations, never a read-only escape hatch. */
export function isReadOnlyGitCommand(args: ReadonlyArray<string>): boolean {
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "-c" || arg === "-C" || arg === "--git-dir" || arg === "--work-tree") {
      index += 2;
    } else if (arg?.startsWith("-")) {
      index++;
    } else {
      break;
    }
  }
  const command = args[index];
  const rest = args.slice(index + 1);
  switch (command) {
    case "status":
    case "diff":
    case "log":
    case "show":
    case "rev-parse":
    case "show-ref":
    case "ls-files":
    case "ls-tree":
    case "check-ignore":
    case "check-attr":
    case "for-each-ref":
    case "merge-base":
    case "rev-list":
    case "cat-file":
      return true;
    case "config":
      return rest.some((arg) =>
        ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(arg),
      );
    case "remote":
      return rest.length === 0 || rest[0] === "-v" || rest[0] === "get-url";
    case "branch":
      return (
        rest.length === 0 ||
        rest.some(
          (arg) =>
            ["--show-current", "--list", "--contains", "--merged", "--no-merged"].includes(arg) ||
            arg.startsWith("--format="),
        )
      );
    case "worktree":
      return rest[0] === "list";
    case "symbolic-ref":
      return rest.filter((arg) => !arg.startsWith("-")).length === 1;
    default:
      return false;
  }
}
