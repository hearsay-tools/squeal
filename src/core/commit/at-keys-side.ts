import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { copyIntoCheckout } from "../checkout/checkout.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import {
  absent,
  type CheckoutHooks,
  commonDirOf,
  inCheckout,
  type KeyAt,
  resolveCommit,
  withStores,
} from "./at-keys-checkout.js";
import { narrowed } from "./at-keys-narrow.js";
import { type CommitEntry, commitEntries } from "./at-keys-verify.js";
import {
  CheckoutFailed,
  type CheckoutOptions,
  changedText,
  type KeyingOptions,
} from "./at-keys-walk.js";
import { LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D5.1 (row 023-16): a side's keys. A side is a mixed tree, so no
 * fast path applies: the keyer walks the named test files in a checkout at
 * the side's code version, with the side's test files copied in.
 */

export interface SideKeysOptions extends KeyingOptions, CheckoutOptions, CheckoutHooks {
  readonly root: AbsolutePath;
  /** The side's code version: the checkout's commit. */
  readonly code: string;
  /** The side's test version: a commit, or `null` for this worktree's files now. */
  readonly tests: string | null;
  /** The named test files: only they take part, copied from `tests` into the checkout. */
  readonly files: readonly TestFileRef[];
  /**
   * Row 023-08 (D5.2): further paths copied from `tests` into the checkout
   * with the named files, the test-side files the test version holds
   * otherwise than the code version; those `tests` lacks are left out.
   */
  readonly also?: readonly RelativePath[];
  /**
   * Row 023-08 (review wave-8 re-review): the named files' projects are
   * the checkout's: each adapter there lists the named paths, and every
   * project that lists one is keyed. `files`' projects are then not read.
   */
  readonly listed?: boolean;
  /**
   * Row 023-11 (D5.3, `--without`): paths in the repository removed from
   * the checkout after the copies, before the install; out of the side's
   * expected tree, which holds only while they are absent.
   */
  readonly hidden?: readonly RelativePath[];
}

/** D5.1: the key of each named test file on a side, test version over code version. */
export async function sideKeys(options: SideKeysOptions): Promise<ReadonlyMap<string, KeyAt>> {
  const { root, files } = options;
  const commonDir = commonDirOf(root);
  const commit = await resolveCommit(root, options.code);
  const named = files.map((ref) => ref.path);
  const hidden = options.hidden ?? [];
  const source = await testSource(root, options.tests, [...named, ...(options.also ?? [])]);
  try {
    return await withStores(commonDir, async (main) => {
      const out = new Map<string, KeyAt>();
      const copied = files.filter((ref) => !source.absent.has(ref.path));
      for (const ref of files) {
        if (source.absent.has(ref.path)) out.set(testFileId(ref), absent(ref.path, options.tests));
      }
      if (copied.length === 0) return out;
      const paths = [...source.written];
      const prepare = async (checkout: { tree: AbsolutePath }) => {
        copyIntoCheckout(checkout, source.from, paths);
        // Review wave-8 B3: a committed link is copied as a link with its own target. The
        // copy above made a plain file at its path through folders the checkout owns.
        for (const [path, target] of source.links) {
          unlinkSync(join(checkout.tree, path));
          symlinkSync(target, join(checkout.tree, path));
        }
        for (const path of hidden) removeHidden(checkout.tree, path);
      };
      // Row 023-08: the side's expected tree, its copies at the test version's kind, mode and
      // blob; every copied path is checked (review wave-8 B3), none skipped.
      const skip = paths.filter((path) => !source.expected.has(path));
      const { expected } = source;
      const input = { root, commonDir, commit, prepare, copied: skip, expected, hidden };
      const listing = options.listed === true;
      const keying = listing
        ? { ...options, adapters: narrowed(options.adapters, named) }
        : options;
      const at = await inCheckout(main, input, listing ? null : copied, keying);
      // Row 023-07: a checkout the install changed gives no key that is the commit's.
      const changed: KeyAt | null =
        at.changed === null
          ? null
          : {
              notDetermined: {
                reason: "changed",
                detail: changedText(at.changed),
              },
            };
      for (const [id, key] of at.files)
        out.set(id, changed !== null && "key" in key ? changed : key);
      // Listed by the checkout: a checkout that gave no listing leaves each named file its failure.
      if (listing && at.failure !== null)
        for (const ref of copied) out.set(testFileId(ref), { notDetermined: at.failure });
      return out;
    });
  } finally {
    source.remove();
  }
}

/**
 * Row 023-11 (D5.3, review wave-9 B2): removes the hidden `path` from the
 * checkout's `tree` without following a link. Each parent folder is
 * checked with `lstat` first: a link or a file among them refuses the
 * side (`CheckoutFailed`), since a removal through it would delete outside
 * the checkout. The path itself, a link included, is removed as it is:
 * `rmSync` removes a link, never its target.
 */
export function removeHidden(tree: AbsolutePath, path: RelativePath): void {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  if (name === "" || name === "." || name === ".." || parts.includes(".."))
    throw new CheckoutFailed("checkout", `--without ${path} is not a path inside the checkout`);
  let folder: string = tree;
  for (const part of parts) {
    folder = join(folder, part);
    const stats = lstatSync(folder, { throwIfNoEntry: false });
    if (stats === undefined) return;
    if (stats.isSymbolicLink() || !stats.isDirectory())
      throw new CheckoutFailed(
        "checkout",
        `--without ${path} lies under ${stats.isSymbolicLink() ? "a link" : "a file"} in the checkout: ${relative(tree, folder)}`,
      );
  }
  rmSync(join(folder, name), { recursive: true, force: true });
}

/** The test files of `tests` to copy in; their folder, those the version lacks, and those written. */
interface TestSource {
  readonly from: AbsolutePath;
  readonly absent: ReadonlySet<RelativePath>;
  /** The paths to copy, in order. */
  readonly written: readonly RelativePath[];
  /** Row 023-08: each written path's entry at `tests`; empty for the worktree's files. */
  readonly expected: ReadonlyMap<RelativePath, CommitEntry>;
  /** Review wave-8 B3: the written paths that are links at `tests`, with their targets. */
  readonly links: ReadonlyMap<RelativePath, Buffer>;
  remove(): void;
}

/** The largest blob copied in. */
const MAX_BLOB_BYTES = 256 * 1024 * 1024;

/** The files of `tests` in a folder to copy from; `absent` names those the version lacks. */
async function testSource(
  root: AbsolutePath,
  tests: string | null,
  paths: readonly RelativePath[],
): Promise<TestSource> {
  const unique = [...new Set(paths)];
  if (tests === null) {
    const missing = new Set(unique.filter((path) => !existsSync(join(root, path))));
    const written = unique.filter((path) => !missing.has(path));
    const none = { expected: new Map(), links: new Map() };
    return { from: root, absent: missing, written, ...none, remove: () => {} };
  }
  const commit = await resolveCommit(root, tests);
  const entries = await commitEntries(root, commit);
  const from = mkdtempSync(join(tmpdir(), "squeal-side-tests-")) as AbsolutePath;
  const absentAt = new Set<RelativePath>();
  const written: RelativePath[] = [];
  const expected = new Map<RelativePath, CommitEntry>();
  const links = new Map<RelativePath, Buffer>();
  for (const path of unique) {
    const entry = entries.get(path);
    if (entry === undefined) {
      absentAt.add(path);
      continue;
    }
    // Bytes, not text: a fixture's blob must keep its bytes to match its entry.
    const bytes = execFileSync("git", ["cat-file", "blob", entry.blob], {
      cwd: root,
      maxBuffer: MAX_BLOB_BYTES,
      timeout: LS_TREE_TIMEOUT_MS,
    });
    mkdirSync(dirname(join(from, path)), { recursive: true });
    writeFileSync(join(from, path), bytes);
    written.push(path);
    if (entry.mode === "100755") chmodSync(join(from, path), 0o755);
    // A link's blob is its target: `prepare` makes the link in the checkout.
    if (entry.mode === "120000") links.set(path, bytes);
    expected.set(path, entry);
  }
  const remove = () => rmSync(from, { recursive: true, force: true });
  return { from, absent: absentAt, written, expected, links, remove };
}
