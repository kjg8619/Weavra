import type { File } from "expo-file-system";

let tempFileSequence = 0;

/**
 * Replaces a file's contents through a sibling temp file and an overwriting
 * rename, so an interrupted write (app restart, process death) never leaves a
 * truncated document at the final path. Each write stages through its own
 * temp file so concurrent writers to the same destination cannot move or
 * clobber each other's staging file mid-flight.
 */
export async function prepareAtomicFileWriter(
  file: File,
): Promise<(contents: string, mayCommit?: () => boolean) => "written" | "cancelled"> {
  const { File: FileConstructor } = await import("expo-file-system");
  // After preparation, replacement and the caller's publication can share one
  // synchronous segment. Check caller state after staging, immediately before rename.
  return (contents, mayCommit) => {
    tempFileSequence += 1;
    const temp = new FileConstructor(file.parentDirectory, `${file.name}.${tempFileSequence}.tmp`);
    temp.create({ intermediates: true, overwrite: true });
    temp.write(contents);
    if (mayCommit && !mayCommit()) {
      temp.delete();
      return "cancelled";
    }
    temp.moveSync(file, { overwrite: true });
    return "written";
  };
}

export async function writeFileAtomically(file: File, contents: string): Promise<void> {
  const write = await prepareAtomicFileWriter(file);
  write(contents);
}
