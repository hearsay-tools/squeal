import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, EnvironmentHash, TestFileRef } from "../types/keys.js";
import {
  absent,
  commonDirOf,
  inCheckout,
  type Kept,
  type KeyAt,
  resolveCommit,
  withStores,
} from "./at-keys-checkout.js";
import { commitSide, differenceAt, hereNames } from "./at-keys-diff.js";
import { changedInput } from "./at-keys-fast.js";
import { untrackedInputs } from "./at-keys-untracked.js";
import { type CheckoutOptions, type KeyingOptions, withKeyer } from "./at-keys-walk.js";

/*
 * Spec 023 D2 as amended 2026-11-17 (row 023-16): each test file's key at a
 * commit, exactly as a fresh walk at that commit gives it, or not
 * determined with a reason, and the results the shared store holds at that
 * key, read-only. The fast path's git checks (`at-keys-fast.ts`) are a
 * first filter: a file that passes them keeps its current key only when the
 * checkout at the commit reads its project's environment with an equal hash
 * (review wave-5 B2), since a config can read files no key input lists.
 * So every call with a file present at the commit makes a checkout, installs
 * it and loads the configs; the files that fail either check are walked by
 * the gate's keyer in that checkout (`at-keys-walk.ts`).
 */

export interface KeysAt {
  /** The commit, resolved. */
  readonly commit: string;
  /** Each asked file's key at the commit, by `testFileId`. */
  readonly files: ReadonlyMap<string, KeyAt>;
  /** Each asked file's key in this worktree now, by `testFileId`; absent when it has none. */
  readonly current: ReadonlyMap<string, CheckKey>;
  /** Why each file did not keep its current key, by `testFileId`. */
  readonly changed: ReadonlyMap<string, string>;
  /**
   * The checkout's whole time in ms (make, install, load the configs, key
   * the walked files, remove); `null` when none was made: every asked file
   * is absent at the commit.
   */
  readonly checkoutMs: number | null;
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
    const kept = new Map<string, Kept>();
    const environments = new Map<ProjectName, EnvironmentHash | undefined>();
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
        const there = await commitSide(root, commit);
        const [names, diff] = await Promise.all([
          hereNames(root),
          differenceAt(root, commit, readPolicy(root), there.blobs.keys()),
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
              : changedInput(
                  { path: ref.path, paths, closure: keyer.keys.index.closure(ref)?.paths ?? [] },
                  there,
                  here,
                  diff,
                );
          environments.set(ref.project, keyer.keys.index.environment(ref.project));
          if (why === null && key !== undefined) kept.set(id, { ref, key });
          else changed.set(id, why ?? "");
        }
        return refs;
      },
    );
    const walk = asked.filter((ref) => changed.has(testFileId(ref)));
    let checkoutMs: number | null = null;
    if (walk.length > 0 || kept.size > 0) {
      const input = { root, commonDir, commit };
      const at = await inCheckout(main, input, { kept, environments, walk }, options);
      for (const [id, key] of at.files) files.set(id, key);
      for (const [id, why] of at.changed) changed.set(id, why);
      checkoutMs = at.ms;
    }
    return { commit, files, current, changed, checkoutMs, store: main !== null };
  });
}
