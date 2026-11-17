import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import {
  absent,
  type BeforeRemove,
  type CheckoutHooks,
  commonDirOf,
  inCheckout,
  type KeyAt,
  type NotDetermined,
  resolveCommit,
  withStores,
} from "./at-keys-checkout.js";
import { type CiCall, ciSettled } from "./at-keys-ci.js";
import type { CheckoutOptions, KeyingOptions } from "./at-keys-walk.js";
import { committedBlobs } from "./tree.js";

/*
 * Spec 023 D2 as amended 2026-11-17 (row 023-16): each test file's key at a
 * commit, exactly as a fresh walk at that commit gives it, or not
 * determined with a reason, and the results the shared store holds at that
 * key, read-only. Every file is keyed by the gate's keyer in a temporary
 * checkout at the commit (`at-keys-walk.ts`), after a warm frozen install:
 * the human dropped the fast path on 2026-11-17, after three reviews found
 * it reused current keys where the commit resolves imports otherwise.
 *
 * Row 023-17: before the checkout, CI's export of the commit
 * (`at-keys-ci.ts`) settles the files it holds and proves here, with CI's
 * passes; only the rest go to the checkout, and none is made when CI
 * settles every named file. With no named files the checkout still lists
 * them, and a file CI settles takes CI's answer.
 */

export interface KeysAt {
  /** The commit, resolved. */
  readonly commit: string;
  /** Each asked file's key at the commit, by `testFileId`. */
  readonly files: ReadonlyMap<string, KeyAt>;
  /** Why the checkout gave no keys, when it could not be made or installed; else `null`. */
  readonly failure: NotDetermined | null;
  /**
   * The checkout's whole time in ms (make, install, load the configs, key
   * the files, remove); `null` when none was made: every named file is
   * absent at the commit.
   */
  readonly checkoutMs: number | null;
  /** Whether the shared store could be read; without it every `stored` is empty. */
  readonly store: boolean;
  /**
   * Row 023-17: the export CI's results came from (`sourceLabel`) and the
   * files it settled, or why none was used (`missed`); absent when the CI
   * step was off.
   */
  readonly ci?: {
    readonly source: string | null;
    readonly settled: number;
    readonly missed: string | null;
  };
}

export interface KeysAtOptions extends KeyingOptions, CheckoutOptions, CheckoutHooks {
  /** The user's worktree: git resolves the commit there, and its repository holds the store. */
  readonly root: AbsolutePath;
  /** Any commit-ish git resolves there. */
  readonly commit: string;
  /** The test files to key; every file the adapters at the commit list by default. */
  readonly files?: readonly TestFileRef[];
  /** Row 023-17: CI's export of the commit settles files first; on by default, `false` turns it off. */
  readonly ci?: CiCall | false;
}

/** D2 as amended: each test file's key at `options.commit`, by the keyer in a checkout there. */
export async function keysAtCommit(options: KeysAtOptions): Promise<KeysAt> {
  const { root } = options;
  const commonDir = commonDirOf(root);
  const commit = await resolveCommit(root, options.commit);
  return withStores(commonDir, async (main) => {
    const files = new Map<string, KeyAt>();
    const blobs = await committedBlobs(root, commit);
    let asked: readonly TestFileRef[] | null = null;
    if (options.files !== undefined) {
      // A named file the commit lacks needs no checkout.
      for (const ref of options.files) {
        if (!blobs.has(ref.path)) files.set(testFileId(ref), absent(ref.path, commit));
      }
      asked = options.files.filter((ref) => blobs.has(ref.path));
    }
    const store = main !== null;
    let ci: KeysAt["ci"];
    if (options.ci !== false) {
      const input = { root, commit, main, policy: readPolicy(root), blobs, env: options.env };
      const settled = await ciSettled(input, asked, options.ci);
      for (const [id, key] of settled.files) files.set(id, key);
      ci = { source: settled.source, settled: settled.files.size, missed: settled.missed };
      if (asked !== null) asked = asked.filter((ref) => !settled.files.has(testFileId(ref)));
    }
    const ciPart = ci === undefined ? {} : { ci };
    if (asked !== null && asked.length === 0)
      return { commit, files, failure: null, checkoutMs: null, store, ...ciPart };
    // Row 023-07: a file CI settled takes CI's answer, so the hooks do not see it.
    const own = <F extends { readonly ref: TestFileRef }>(keyed: readonly F[]) =>
      keyed.filter((f) => !files.has(testFileId(f.ref)));
    const { beforeRemove, whileOpen } = options;
    const hooks = {
      ...(beforeRemove === undefined
        ? {}
        : {
            beforeRemove: ((checkout, keyed) => beforeRemove(checkout, own(keyed))) as BeforeRemove,
          }),
      ...(whileOpen === undefined
        ? {}
        : { whileOpen: ((open, keyed) => whileOpen(open, own(keyed))) as typeof whileOpen }),
    };
    const at = await inCheckout(main, { root, commonDir, commit }, asked, { ...options, ...hooks });
    for (const [id, key] of at.files) if (!files.has(id)) files.set(id, key);
    return { commit, files, failure: at.failure, checkoutMs: at.ms, store, ...ciPart };
  });
}
