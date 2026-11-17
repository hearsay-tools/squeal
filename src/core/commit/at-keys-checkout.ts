import type { Checkout } from "../checkout/checkout.js";
import { readStores } from "../code/gate/stored.js";
import { runGit } from "../fs/git.js";
import { resolveCommonDir } from "../fs/git-layout.js";
import { testFileId } from "../keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { CheckKey, TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { RunnerAdapter } from "../types/runner.js";
import type { Store } from "../types/store.js";
import type { ResultRecord } from "../types/store-records.js";
import { type ChangedLink, inputCheck } from "./at-keys-verify.js";
import {
  CheckoutFailed,
  type CheckoutOptions,
  type KeyingOptions,
  withCheckout,
  withKeyer,
} from "./at-keys-walk.js";

/*
 * Row 023-16: what `keysAtCommit` and `sideKeys` share: the answer's
 * shape, and the one step in the checkout. The human dropped the fast path
 * on 2026-11-17 after three reviews found current keys reused for commits
 * whose resolution differs (`reviews/wave-5*.md`): every asked file is
 * keyed by the gate's keyer in the checkout at the commit, exact by
 * construction.
 */

export type NotDeterminedReason =
  /** The test file is not in the commit's tree, or the side's test version. */
  | "absent"
  /** No adapter in the checkout lists the file, or its closure failed there. */
  | "unlisted"
  /** The checkout could not be made. */
  | "checkout"
  /** The checkout's install failed. */
  | "install"
  /**
   * Row 023-07 (re-review B5): a file its key reads differs in the
   * checkout from the commit's tree: bytes, mode or link target.
   */
  | "changed";

export interface NotDetermined {
  readonly reason: NotDeterminedReason;
  readonly detail: string;
}

export type KeyAt =
  | {
      /** The key the gate's keyer gives the file in the checkout at the commit. */
      readonly key: CheckKey;
      /** The shared store's results at the key for this file; empty when it holds none. */
      readonly stored: readonly ResultRecord[];
      /** Row 023-07: the sources its runner's closure loads in the checkout, when it was keyed there. */
      readonly loads?: readonly RelativePath[];
    }
  | { readonly notDetermined: NotDetermined };

/** Row 023-07: one file the checkout keyed, as `beforeRemove` sees it. */
export interface KeyedFile {
  readonly ref: TestFileRef;
  readonly at: KeyAt;
}

/**
 * Row 023-07 (D4): runs in the checkout after its files are keyed and the
 * keyer is closed, before the checkout is removed; given the keyed files.
 * What it throws rejects the whole call, the checkout removed first.
 */
export type BeforeRemove = (checkout: Checkout, files: readonly KeyedFile[]) => Promise<void>;

/**
 * Row 023-07 (review wave-7 B4): runs in the checkout after its files are
 * keyed, while the keyer's adapters are open, so a caller can ask them
 * which files a change affects (`RunnerAdapter.affected`).
 */
export type WhileOpen = (
  open: {
    readonly adapters: readonly RunnerAdapter[];
    readonly policy: Policy;
    /** The checkout's tree. */
    readonly tree: AbsolutePath;
  },
  files: readonly KeyedFile[],
) => Promise<void>;

/** Row 023-07: what a caller runs in the checkout before it is removed. */
export interface CheckoutHooks {
  readonly whileOpen?: WhileOpen;
  readonly beforeRemove?: BeforeRemove;
}

/** What the checkout step answered. */
export interface Checked {
  /** Each file's key, by `testFileId`. */
  readonly files: Map<string, KeyAt>;
  /** Why the checkout gave no keys: it could not be made or installed; `null` when it did. */
  readonly failure: NotDetermined | null;
  /** The checkout's whole time: make, install, open the keyer, key, remove. */
  readonly ms: number;
  /** Row 023-07: the time of the check of the keyed files' inputs against the commit; `null` when none ran. */
  readonly inputCheckMs: number | null;
}

/**
 * In a checkout of `input.commit`, each of `files` keyed fresh by the
 * gate's keyer; with `files` `null`, every file the adapters there list.
 * When the checkout or its install fails, every named file is not
 * determined, and `failure` says why.
 */
export async function inCheckout(
  main: Store | null,
  input: Parameters<typeof withCheckout>[0],
  files: readonly TestFileRef[] | null,
  options: KeyingOptions & CheckoutOptions & CheckoutHooks,
): Promise<Checked> {
  const out = new Map<string, KeyAt>();
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  let inputCheckMs: number | null = null;
  try {
    await withCheckout(input, options, async (checkout) => {
      const refs = await withKeyer(
        checkout.tree,
        input.commonDir,
        main ?? undefined,
        options,
        async (open) => {
          const refs = files ?? [...open.listed.values()];
          const keyed = await open.keyer.keyed(refs);
          for (const ref of refs) {
            const at = keyed.get(ref);
            const id = testFileId(ref);
            if (at === undefined) {
              const detail = `no runner in the checkout keyed ${ref.path}`;
              out.set(id, { notDetermined: { reason: "unlisted", detail } });
            } else out.set(id, { ...found(main, ref, at.key), loads: at.loads });
          }
          const { adapters, policy } = open;
          const checkStarted = performance.now();
          await refuseChanged(input, checkout, adapters, refs, out);
          inputCheckMs = Math.round(performance.now() - checkStarted);
          await options.whileOpen?.({ adapters, policy, tree: checkout.tree }, keyedOf(refs, out));
          return refs;
        },
      );
      // Row 023-07: the keyer's adapters are closed; the files run in this same checkout.
      await options.beforeRemove?.(checkout, keyedOf(refs, out));
    });
  } catch (error) {
    if (!(error instanceof CheckoutFailed)) throw error;
    const failure = { reason: error.reason, detail: error.message };
    for (const ref of files ?? []) out.set(testFileId(ref), { notDetermined: failure });
    return { files: out, failure, ms: ms(), inputCheckMs };
  }
  return { files: out, failure: null, ms: ms(), inputCheckMs };
}

/**
 * Re-review B5 (`at-keys-verify.ts`): each keyed file whose closure, or
 * its project's runner files, differs in the checkout from the commit's
 * tree is not the commit's: its key is dropped, so nothing reads, runs or
 * stores it as the commit's.
 */
async function refuseChanged(
  input: { readonly root: AbsolutePath; readonly copied?: readonly RelativePath[] },
  checkout: Checkout,
  adapters: readonly RunnerAdapter[],
  refs: readonly TestFileRef[],
  out: Map<string, KeyAt>,
): Promise<void> {
  const runnerFiles = new Map<string, RelativePath[]>();
  for (const adapter of adapters) {
    for (const environment of await adapter.environment()) {
      const project = runnerFiles.get(environment.project) ?? [];
      project.push(...environment.files);
      runnerFiles.set(environment.project, project);
    }
  }
  const every = [...runnerFiles.values()].flat();
  const check = await inputCheck(input.root, checkout.tree, checkout.commit);
  const copied = new Set(input.copied ?? []);
  for (const ref of refs) {
    const id = testFileId(ref);
    const at = out.get(id);
    if (at === undefined || !("key" in at)) continue;
    const own = runnerFiles.get(ref.project) ?? every;
    const inputs = [ref.path, ...own, ...(at.loads ?? [])].filter((p) => !copied.has(p));
    const path = (await check.changed(inputs)) ?? throughLink(check.links, inputs);
    if (path !== null) {
      const detail = `install changed ${path}`;
      out.set(id, { notDetermined: { reason: "changed", detail } });
    }
  }
}

/** A changed tracked link that `inputs` read: the link itself, or what it leads to now. */
function throughLink(
  links: readonly ChangedLink[],
  inputs: readonly RelativePath[],
): RelativePath | null {
  for (const { link, resolved } of links) {
    const reads = (path: RelativePath) =>
      path === link ||
      (resolved !== null && (path === resolved || path.startsWith(`${resolved}/`)));
    if (inputs.some(reads)) return link;
  }
  return null;
}

function keyedOf(refs: readonly TestFileRef[], out: ReadonlyMap<string, KeyAt>): KeyedFile[] {
  return refs.map((ref) => ({ ref, at: out.get(testFileId(ref)) as KeyAt }));
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
): { key: CheckKey; stored: readonly ResultRecord[] } {
  const stored =
    main === null
      ? []
      : main.results
          .byKey(key, 0)
          .filter((r) => r.check.project === ref.project && r.check.testPath === ref.path);
  return { key, stored };
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
