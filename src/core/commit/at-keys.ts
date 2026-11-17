import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyIntoCheckout } from "../checkout/checkout.js";
import { readStores } from "../code/gate/stored.js";
import { readPolicy } from "../daemon/policy.js";
import { runGit } from "../fs/git.js";
import { resolveCommonDir } from "../fs/git-layout.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import { commitSide, differenceAt, hereNames } from "./at-keys-diff.js";
import { changedInput } from "./at-keys-fast.js";
import { untrackedInputs } from "./at-keys-untracked.js";
import {
  CheckoutFailed,
  type CheckoutOptions,
  type KeyingOptions,
  withCheckout,
  withKeyer,
} from "./at-keys-walk.js";
import { committedBlobs, LS_TREE_TIMEOUT_MS } from "./tree.js";

/*
 * Spec 023 D2 as amended 2026-11-17 and D5.1 (row 023-16): each test
 * file's key at a commit, exactly as a fresh walk at that commit gives it,
 * or not determined with a reason, and the results the shared store holds
 * at that key, read-only. A file whose every key input is unchanged keeps
 * its current key with no checkout (the fast path, `at-keys-fast.ts`); the
 * rest are keyed by the gate's keyer in a temporary checkout at the commit
 * (`at-keys-walk.ts`). `sideKeys` gives D5's side keys: the keyer in a
 * checkout at the side's code version, its test files copied in.
 */

export type NotDeterminedReason =
  /** The test file is not in the commit's tree, or the side's test version. */
  | "absent"
  /** No adapter in the checkout lists the file, or its closure failed there. */
  | "unlisted"
  /** The checkout could not be made. */
  | "checkout"
  /** The checkout's install failed. */
  | "install";

export type KeyAt =
  | {
      readonly key: CheckKey;
      /** `unchanged`: the fast path kept the current key; `walk`: the keyer in a checkout gave it. */
      readonly via: "unchanged" | "walk";
      /** The shared store's results at the key for this file; empty when it holds none. */
      readonly stored: readonly ResultRecord[];
    }
  | { readonly notDetermined: { readonly reason: NotDeterminedReason; readonly detail: string } };

export interface KeysAt {
  /** The commit, resolved. */
  readonly commit: string;
  /** Each asked file's key at the commit, by `testFileId`. */
  readonly files: ReadonlyMap<string, KeyAt>;
  /** Each asked file's key in this worktree now, by `testFileId`; absent when it has none. */
  readonly current: ReadonlyMap<string, CheckKey>;
  /** Why each file left the fast path, by `testFileId`. */
  readonly changed: ReadonlyMap<string, string>;
  /** Whether a checkout was made. */
  readonly checkout: boolean;
  /** Whether the shared store could be read; without it every `stored` is empty. */
  readonly store: boolean;
}

export interface KeysAtOptions extends KeyingOptions, CheckoutOptions {
  /** The user's worktree. */
  readonly root: AbsolutePath;
  /** Any commit-ish git resolves there. */
  readonly commit: string;
  /** The test files to key; every file this worktree's adapters list by default. */
  readonly files?: readonly TestFileRef[];
}

/** D2 as amended: each test file's key at `options.commit`, by the fast path or a walk. */
export async function keysAtCommit(options: KeysAtOptions): Promise<KeysAt> {
  const { root } = options;
  const commonDir = commonDirOf(root);
  const commit = await resolveCommit(root, options.commit);
  return withStores(commonDir, async (main) => {
    const current = new Map<string, CheckKey>();
    const files = new Map<string, KeyAt>();
    const changed = new Map<string, string>();
    const asked = await withKeyer<readonly TestFileRef[]>(
      root,
      commonDir,
      main ?? undefined,
      options,
      async ({ keyer, listed }) => {
        const refs = options.files ?? [...listed.values()];
        const keyed = await keyer.keyed(refs);
        const inputs = new Map<string, readonly RelativePath[]>();
        for (const [ref, { key }] of keyed) {
          current.set(testFileId(ref), key);
          inputs.set(testFileId(ref), keyer.keys.stabilityPaths(ref));
        }
        const [there, names, diff] = await Promise.all([
          commitSide(root, commit),
          hereNames(root),
          differenceAt(root, commit, readPolicy(root)),
        ]);
        const untracked = await untrackedInputs(root, [...inputs.values()].flat());
        const here = { hashOf: (p: RelativePath) => keyer.keys.cache.hashOf(p), names, untracked };
        for (const ref of refs) {
          const id = testFileId(ref);
          const paths = inputs.get(id);
          const key = current.get(id);
          if (!there.blobs.has(ref.path)) {
            files.set(id, absent(ref.path, commit));
            continue;
          }
          const why =
            paths === undefined || key === undefined
              ? `${ref.path} has no key here`
              : changedInput({ path: ref.path, paths }, there, here, diff);
          if (why === null && key !== undefined) files.set(id, found(main, ref, key, "unchanged"));
          else changed.set(id, why ?? "");
        }
        return refs;
      },
    );
    const walk = asked.filter((ref) => changed.has(testFileId(ref)));
    if (walk.length > 0) {
      for (const [id, at] of await walked(main, { root, commonDir, commit }, walk, options))
        files.set(id, at);
    }
    return { commit, files, current, changed, checkout: walk.length > 0, store: main !== null };
  });
}

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
      const at = await walked(main, { root, commonDir, commit, prepare }, copied, options);
      for (const [id, key] of at) out.set(id, key);
      return out;
    });
  } finally {
    source.remove();
  }
}

/** The keys of `files` from the keyer in a checkout of `input.commit`; each not determined when it fails. */
async function walked(
  main: Store | null,
  input: Parameters<typeof withCheckout>[0],
  files: readonly TestFileRef[],
  options: KeyingOptions & CheckoutOptions,
): Promise<Map<string, KeyAt>> {
  const out = new Map<string, KeyAt>();
  try {
    await withCheckout(input, options, async (checkout) =>
      withKeyer(checkout.tree, input.commonDir, main ?? undefined, options, async ({ keyer }) => {
        const keyed = await keyer.keyed(files);
        for (const ref of files) {
          const at = keyed.get(ref);
          const id = testFileId(ref);
          if (at === undefined) {
            const detail = `no runner in the checkout keyed ${ref.path}`;
            out.set(id, { notDetermined: { reason: "unlisted", detail } });
          } else out.set(id, found(main, ref, at.key, "walk"));
        }
      }),
    );
  } catch (error) {
    if (!(error instanceof CheckoutFailed)) throw error;
    for (const ref of files) {
      out.set(testFileId(ref), { notDetermined: { reason: error.reason, detail: error.message } });
    }
  }
  return out;
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

function absent(path: RelativePath, where: string | null): KeyAt {
  const at = where === null ? "in this worktree" : `at ${where}`;
  return { notDetermined: { reason: "absent", detail: `${path} does not exist ${at}` } };
}

/** The key and the results `main` holds at it for `ref`. */
function found(
  main: Store | null,
  ref: TestFileRef,
  key: CheckKey,
  via: "unchanged" | "walk",
): KeyAt {
  const stored =
    main === null
      ? []
      : main.results
          .byKey(key, 0)
          .filter((r) => r.check.project === ref.project && r.check.testPath === ref.path);
  return { key, via, stored };
}

/** Runs `body` with the repository's main store open read-only, `null` when it cannot be read. */
async function withStores<T>(
  commonDir: AbsolutePath,
  body: (main: Store | null) => Promise<T>,
): Promise<T> {
  const stores = readStores(commonDir);
  try {
    return await body(stores?.main ?? null);
  } finally {
    stores?.close();
  }
}

function commonDirOf(root: AbsolutePath): AbsolutePath {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) throw new Error(`squeal: ${root} is not a git worktree`);
  return commonDir;
}

async function resolveCommit(root: AbsolutePath, commit: string): Promise<string> {
  const args = ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`];
  return (await runGit(root, args)).trim();
}
