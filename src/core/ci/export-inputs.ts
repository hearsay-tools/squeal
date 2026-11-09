import { GIT_ENTRY, listedDirectory } from "../keys/observed.js";
import { testFileId } from "../keys/reverse-index.js";
import type { WorktreeKeys } from "../scheduler/keying.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash, TestFileRef } from "../types/keys.js";
import type { NamedPart } from "./export-check.js";
import { gitEntryHash, type InputEvidence, listingHash, uncertified } from "./inputs.js";

/*
 * Spec 018 D9 (2026-11-09, reviews of 0.1.421 B1): whether a keyed file's
 * result belongs to this checkout's content. Each input of its closure is
 * read here as its key holds it: a file by the job's stat cache, `.git` by
 * its kind; a listing by the names on disk, as the shard's evidence took it.
 * Only the evidence of the file's own shard counts.
 */

/** The inputs of `paths`, `ref`'s closure here, its shard's evidence does not certify; empty: all. */
export function certifier(
  root: AbsolutePath,
  keys: WorktreeKeys,
  parts: readonly NamedPart[],
): (ref: TestFileRef, paths: readonly RelativePath[]) => RelativePath[] {
  const owners = new Map<string, InputEvidence>();
  for (const { part } of parts) {
    for (const file of part.testFiles) owners.set(testFileId(file), part.evidence);
  }
  const here = (path: RelativePath): FileHash | null | undefined => {
    const directory = listedDirectory(path);
    if (directory !== null) return listingHash(root, directory);
    if (path === GIT_ENTRY) return gitEntryHash(root);
    return keys.cache.hashOf(path);
  };
  return (ref, paths) => {
    const evidence = owners.get(testFileId(ref));
    return evidence === undefined ? [...paths] : uncertified(paths, evidence, here);
  };
}
