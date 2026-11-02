import { join } from "node:path";
import { hashFile, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, RelativePath } from "../../types/index.js";
import type { LintSourceFile } from "./types.js";

/*
 * D5, D11 (`tasks/017-14/notes.md`, "Where `LintProvider` does not fit"
 * 6): a provider that reports no program, as oxlint, reads the files its
 * import plugin resolves from disk, unobserved. After a part with
 * whole-program files, the segment's listed files are read on disk again:
 * one at other bytes than the listing's means the run may have used bytes
 * no key holds, so nothing is stored for those files.
 */

/** The first of `files` whose bytes on disk are not its listed blob; `null` when none. */
export async function movedOnDisk(
  root: AbsolutePath,
  format: ObjectFormat,
  files: readonly LintSourceFile[],
): Promise<RelativePath | null> {
  for (const file of files) {
    let now: string | null;
    try {
      now = await hashFile(join(root, file.path), format);
    } catch {
      now = null;
    }
    if (now !== file.hash) return file.path;
  }
  return null;
}
