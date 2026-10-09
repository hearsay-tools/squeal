import { realpath } from "node:fs/promises";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import { filesUnderLinks, linksAmong } from "./candidates.js";
import { Exclusions } from "./exclusions.js";
import { buildWatchSpec } from "./watch-spec.js";

/**
 * The files the change feed's start pass walks under the observed symlinked
 * directories among `paths`, with the feed's root and exclusions. Git lists
 * such a link, never the files under it.
 *
 * Task 001-166: the stat cache's start seed hashes them without a revision,
 * as it does the files git lists, so the feed's first walk finds them known
 * rather than added.
 */
export async function linkedFiles(
  root: AbsolutePath,
  paths: readonly RelativePath[],
  extraFiles: readonly RelativePath[] = [],
): Promise<RelativePath[]> {
  const real = await realpath(root);
  const { linkedDirs } = await linksAmong(real, paths);
  if (linkedDirs.size === 0) return [];
  const spec = await buildWatchSpec(real, extraFiles);
  const ctx = {
    root: real,
    exclusions: new Exclusions(spec),
    extraFiles: new Set(extraFiles),
    trackedPaths: () => paths,
  };
  return filesUnderLinks(ctx, linkedDirs.keys());
}
