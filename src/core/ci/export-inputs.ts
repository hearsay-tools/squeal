import type { WorktreeKeys } from "../scheduler/keying.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { NamedPart } from "./export-check.js";
import { atCommit, hereOf } from "./inputs.js";
import { FileReuse } from "./reuse.js";
import type { AtCommit } from "./reuse-endpoints.js";

/*
 * Spec 018 D9 (2026-11-09, reviews of 0.1.421 B1): whether a keyed file's
 * result belongs to this checkout's content. Each input of its closure is
 * read here as its key holds it: a file by the job's stat cache, `.git` by
 * its kind; a listing by the names on disk, as the shard's evidence took it.
 * Only the evidence of the file's own shard counts. The certification is
 * `FileReuse.evidence`'s, the gate's too (020 D13.2, row 020-52), with no
 * records: an export carries none (D13.3). An input of a part of format 6
 * that its read-time evidence lacks is certified by the part's endpoint
 * hashes at the parts' commit (D33, `endpointHash`).
 */

/** What `certifier` gives of one file: the inputs not certified, and those the endpoint rule certified. */
export interface Certification {
  /** The inputs of its closure here its shard's evidence does not certify; empty: all. */
  readonly uncertified: readonly RelativePath[];
  /** With none uncertified: the inputs certified by the endpoint rule alone (D33). */
  readonly endpoints: readonly RelativePath[];
}

/** The certification of `paths`, `ref`'s closure here, by its shard's part. */
export function certifier(
  root: AbsolutePath,
  keys: WorktreeKeys,
  parts: readonly NamedPart[],
): (ref: TestFileRef, paths: readonly RelativePath[]) => Promise<Certification> {
  const reuse = new FileReuse(parts, { atCommit: (commit) => treeAt(root, commit) });
  const here = hereOf(root, (path) => keys.cache.hashOf(path));
  return async (ref, paths) => {
    const holder = reuse.owner(ref);
    if (holder === null || "reason" in holder) return { uncertified: [...paths], endpoints: [] };
    const { refused, endpoints } = await reuse.certify(holder, paths, here);
    return { uncertified: refused?.uncertified ?? [], endpoints };
  };
}

/** `atCommit`; `null` when git cannot read the commit's tree, so no input is certified by D33. */
async function treeAt(root: AbsolutePath, commit: string): Promise<AtCommit | null> {
  try {
    return await atCommit(root, commit);
  } catch {
    return null;
  }
}
