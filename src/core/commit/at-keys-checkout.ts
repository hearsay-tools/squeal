import { readStores } from "../code/gate/stored.js";
import { runGit } from "../fs/git.js";
import { resolveCommonDir } from "../fs/git-layout.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, ProjectName, RelativePath } from "../types/common.js";
import type { CheckKey, EnvironmentHash, TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import {
  CheckoutFailed,
  type CheckoutOptions,
  type KeyingOptions,
  withCheckout,
  withKeyer,
} from "./at-keys-walk.js";

/*
 * Row 023-16: what `keysAtCommit` and `sideKeys` share: the answer's
 * shape, and the one step in the checkout. There the keyer reads each
 * project's environment at the commit, keeps a current key the fast path
 * passed only when its project's environment hash is equal (review wave-5
 * B2), and walks the rest.
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
      /**
       * `unchanged`: the current key, its inputs and its environment equal at
       * the commit; `walk`: the keyer in a checkout at the commit gave it.
       */
      readonly via: "unchanged" | "walk";
      /** The shared store's results at the key for this file; empty when it holds none. */
      readonly stored: readonly ResultRecord[];
    }
  | { readonly notDetermined: { readonly reason: NotDeterminedReason; readonly detail: string } };

/** A file the fast path passed: its current key, kept when its environment is equal there. */
export interface Kept {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
}

export interface InCheckout {
  /** Files the fast path passed, by `testFileId`. */
  readonly kept: ReadonlyMap<string, Kept>;
  /** Each project's environment hash here. */
  readonly environments: ReadonlyMap<ProjectName, EnvironmentHash | undefined>;
  /** Files to walk. */
  readonly walk: readonly TestFileRef[];
}

/** What the checkout step answered. */
export interface Checked {
  readonly files: Map<string, KeyAt>;
  /** Why each kept file was walked after all: its environment differs. */
  readonly changed: Map<string, string>;
  /** The checkout's whole time: make, install, open the keyer, key, remove. */
  readonly ms: number;
}

/**
 * In a checkout of `input.commit`: each kept file with its current key when
 * its project's environment hash there equals the one here, else walked;
 * and each file of `walk` keyed fresh. When the checkout or its install
 * fails, every file is not determined.
 */
export async function inCheckout(
  main: Store | null,
  input: Parameters<typeof withCheckout>[0],
  asked: InCheckout,
  options: KeyingOptions & CheckoutOptions,
): Promise<Checked> {
  const files = new Map<string, KeyAt>();
  const changed = new Map<string, string>();
  const started = performance.now();
  try {
    await withCheckout(input, options, async (checkout) =>
      withKeyer(checkout.tree, input.commonDir, main ?? undefined, options, async ({ keyer }) => {
        const walk = [...asked.walk];
        for (const [id, { ref, key }] of asked.kept) {
          const there = keyer.keys.index.environment(ref.project);
          if (there !== undefined && there === asked.environments.get(ref.project)) {
            files.set(id, found(main, ref, key, "unchanged"));
          } else {
            changed.set(id, `the environment of project "${ref.project}" differs at the commit`);
            walk.push(ref);
          }
        }
        const keyed = await keyer.keyed(walk);
        for (const ref of walk) {
          const at = keyed.get(ref);
          const id = testFileId(ref);
          if (at === undefined) {
            const detail = `no runner in the checkout keyed ${ref.path}`;
            files.set(id, { notDetermined: { reason: "unlisted", detail } });
          } else files.set(id, found(main, ref, at.key, "walk"));
        }
      }),
    );
  } catch (error) {
    if (!(error instanceof CheckoutFailed)) throw error;
    const refs = [...asked.walk, ...[...asked.kept.values()].map((k) => k.ref)];
    for (const ref of refs) {
      files.set(testFileId(ref), {
        notDetermined: { reason: error.reason, detail: error.message },
      });
    }
  }
  return { files, changed, ms: Math.round(performance.now() - started) };
}

export function absent(path: RelativePath, where: string | null): KeyAt {
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
export async function withStores<T>(
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

export function commonDirOf(root: AbsolutePath): AbsolutePath {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) throw new Error(`squeal: ${root} is not a git worktree`);
  return commonDir;
}

export async function resolveCommit(root: AbsolutePath, commit: string): Promise<string> {
  const args = ["rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`];
  return (await runGit(root, args)).trim();
}
