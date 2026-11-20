import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { selects } from "../core/commit/at-keys-narrow.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";

/*
 * Spec 023 D3 (row 023-19, P4): the report's files, both sides. Moved out
 * of `status-at.ts` by row 023-29.
 */

export /**
 * Both sides' files, by `testFileId`. Row 023-19 (P4): a path that selects
 * no test file by path on a side selects there the files whose closure
 * holds it; one that selects nothing either way, and that the commit or
 * the working tree holds, is `unmatched`, as `squeal status <path>` says
 * it. A path that exists on neither side, or that a failed checkout could
 * not answer, is a file of its own in the default project, so it is
 * answered (absent, or not determined) and not dropped.
 */
function unionRefs(
  now: readonly TestFileRef[],
  at: readonly TestFileRef[],
  paths: readonly RelativePath[] | null,
  sides: {
    readonly now: ReadonlyMap<RelativePath, readonly TestFileRef[]>;
    readonly at: ReadonlyMap<RelativePath, readonly TestFileRef[]>;
    readonly failed: boolean;
  },
  root: AbsolutePath,
  commit: string,
): { refs: TestFileRef[]; unmatched: RelativePath[] } {
  const all = new Map([...now, ...at].map((ref) => [testFileId(ref), ref]));
  const unmatched: RelativePath[] = [];
  for (const path of paths ?? []) {
    if ([...all.values()].some((ref) => selects([path], ref.path))) continue;
    const readers = [...(sides.now.get(path) ?? []), ...(sides.at.get(path) ?? [])];
    if (readers.length > 0) continue;
    if (!sides.failed && (existsSync(join(root, path)) || inCommit(root, commit, path)))
      unmatched.push(path);
    else all.set(testFileId({ project: "", path }), { project: "", path });
  }
  return { refs: [...all.values()], unmatched };
}

/** Whether `commit` holds `path`, a file or a folder. */
function inCommit(root: AbsolutePath, commit: string, path: RelativePath): boolean {
  const found = spawnSync("git", ["cat-file", "-e", `${commit}:${path}`], { cwd: root });
  return found.status === 0;
}
