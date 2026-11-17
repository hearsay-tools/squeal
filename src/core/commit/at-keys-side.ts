import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyIntoCheckout } from "../checkout/checkout.js";
import { runGit } from "../fs/git.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import {
  absent,
  commonDirOf,
  inCheckout,
  type KeyAt,
  resolveCommit,
  withStores,
} from "./at-keys-checkout.js";
import type { CheckoutOptions, KeyingOptions } from "./at-keys-walk.js";
import { committedBlobs, LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D5.1 (row 023-16): a side's keys. A side is a mixed tree, so no
 * fast path applies: the keyer walks the named test files in a checkout at
 * the side's code version, with the side's test files copied in.
 */

export interface SideKeysOptions extends KeyingOptions, CheckoutOptions {
  readonly root: AbsolutePath;
  /** The side's code version: the checkout's commit. */
  readonly code: string;
  /** The side's test version: a commit, or `null` for this worktree's files now. */
  readonly tests: string | null;
  /** The named test files: only they take part, copied from `tests` into the checkout. */
  readonly files: readonly TestFileRef[];
}

/** D5.1: the key of each named test file on a side, test version over code version. */
export async function sideKeys(options: SideKeysOptions): Promise<ReadonlyMap<string, KeyAt>> {
  const { root, files } = options;
  const commonDir = commonDirOf(root);
  const commit = await resolveCommit(root, options.code);
  const source = await testSource(root, options.tests, files);
  try {
    return await withStores(commonDir, async (main) => {
      const out = new Map<string, KeyAt>();
      const copied = files.filter((ref) => !source.absent.has(ref.path));
      for (const ref of files) {
        if (source.absent.has(ref.path)) out.set(testFileId(ref), absent(ref.path, options.tests));
      }
      if (copied.length === 0) return out;
      const prepare = async (checkout: { tree: AbsolutePath }) =>
        copyIntoCheckout(
          checkout,
          source.from,
          copied.map((ref) => ref.path),
        );
      const paths = copied.map((ref) => ref.path);
      const input = { root, commonDir, commit, prepare, copied: paths };
      const at = await inCheckout(main, input, copied, options);
      for (const [id, key] of at.files) out.set(id, key);
      return out;
    });
  } finally {
    source.remove();
  }
}

/** The test files of `tests` in a folder to copy from; `absent` names those the version lacks. */
async function testSource(
  root: AbsolutePath,
  tests: string | null,
  files: readonly TestFileRef[],
): Promise<{ from: AbsolutePath; absent: Set<RelativePath>; remove: () => void }> {
  if (tests === null) {
    const missing = files.map((ref) => ref.path).filter((path) => !existsSync(join(root, path)));
    return { from: root, absent: new Set(missing), remove: () => {} };
  }
  const commit = await resolveCommit(root, tests);
  const blobs = await committedBlobs(root, commit);
  const from = mkdtempSync(join(tmpdir(), "squeal-side-tests-")) as AbsolutePath;
  const absentAt = new Set<RelativePath>();
  for (const { path } of files) {
    if (!blobs.has(path)) {
      absentAt.add(path);
      continue;
    }
    const text = await runGit(root, ["cat-file", "blob", blobs.get(path) as string], {
      timeoutMs: LS_TREE_TIMEOUT_MS,
    });
    mkdirSync(dirname(join(from, path)), { recursive: true });
    writeFileSync(join(from, path), text);
  }
  return { from, absent: absentAt, remove: () => rmSync(from, { recursive: true, force: true }) };
}
