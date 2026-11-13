import type { WorktreeKeys } from "../scheduler/keying.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { NamedPart } from "./export-check.js";
import { hereOf } from "./inputs.js";
import { FileReuse } from "./reuse.js";

/*
 * Spec 018 D9 (2026-11-09, reviews of 0.1.421 B1): whether a keyed file's
 * result belongs to this checkout's content. Each input of its closure is
 * read here as its key holds it: a file by the job's stat cache, `.git` by
 * its kind; a listing by the names on disk, as the shard's evidence took it.
 * Only the evidence of the file's own shard counts. The certification is
 * `FileReuse.evidence`'s, the gate's too (020 D13.2, row 020-52), with no
 * records: an export carries none (D13.3).
 */

/** The inputs of `paths`, `ref`'s closure here, its shard's evidence does not certify; empty: all. */
export function certifier(
  root: AbsolutePath,
  keys: WorktreeKeys,
  parts: readonly NamedPart[],
): (ref: TestFileRef, paths: readonly RelativePath[]) => Promise<readonly RelativePath[]> {
  const reuse = new FileReuse(parts);
  const here = hereOf(root, (path) => keys.cache.hashOf(path));
  return async (ref, paths) => {
    const holder = reuse.owner(ref);
    if (holder === null || "reason" in holder) return [...paths];
    return (await reuse.evidence(holder, paths, here))?.uncertified ?? [];
  };
}
