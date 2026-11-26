import { basename, dirname, join } from "node:path";
import type { RelativePath } from "../../../core/types/common.js";

/**
 * Spec 028 D3.3: where Jest keeps `testFile`'s snapshots, worktree-relative, whether or not the
 * file exists: Jest's default `<dir>/__snapshots__/<basename>.snap`. `null` under a custom
 * `snapshotResolver`, whose paths only a run shows: the recorder observes the snapshot reads.
 */
export function snapshotPath(
  testFile: RelativePath,
  snapshotResolver: string | null | undefined,
): RelativePath | null {
  if (typeof snapshotResolver === "string" && snapshotResolver !== "") return null;
  return join(dirname(testFile), "__snapshots__", `${basename(testFile)}.snap`);
}
