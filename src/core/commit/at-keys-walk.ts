import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Checkout, createCheckout, removeCheckout } from "../checkout/checkout.js";
import { type InstallResult, installCheckout } from "../checkout/install.js";
import {
  cacheCheckoutsDir,
  cacheCheckoutsRoot,
  gitCheckoutsDir,
  locateCheckouts,
  packageStore,
} from "../checkout/location.js";
import { recordGroup } from "../checkout/marker.js";
import { sweepCheckouts } from "../checkout/sweep.js";
import { type Keyer, openKeyer } from "../code/gate/stored.js";
import { leaseProcess } from "../daemon/lease-process.js";
import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/reverse-index.js";
import { installCommand } from "../scheduler/install-command.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Policy } from "../types/policy.js";
import type { RunnerAdapter } from "../types/runner.js";
import type { Store } from "../types/store.js";
import { type CommitEntry, checkoutChange } from "./at-keys-verify.js";

/*
 * Spec 023 D2 as amended and D4 (row 023-16): the keys of the files the
 * fast path cannot settle come from the gate's keyer (`openKeyer`, row
 * 020-51), in-process, in a temporary checkout at the commit after a warm
 * frozen install. The keyer walks each named file's closure fresh over a
 * scratch store, so each key is the one a fresh walk at the commit gives.
 * No daemon starts there and nothing shared is written; the checkout is
 * removed when the keys are read.
 */

/** How the keys are made, here and in a checkout. */
export interface KeyingOptions {
  /**
   * Opens the adapters a daemon builds in `root` under `policy`, with
   * `tempDir` as their temporary folder (`daemonAdapters`); they key and
   * run nothing. The CLI gives them: nothing under `src/core` imports a runner.
   */
  readonly adapters: (
    root: AbsolutePath,
    policy: Policy,
    tempDir: AbsolutePath,
  ) => Promise<readonly RunnerAdapter[]>;
  readonly squealVersion: string;
  /** Allow-listed variables are read from here, as a daemon reads its own. */
  readonly env: NodeJS.ProcessEnv;
}

/** Where and how the checkout is made. */
export interface CheckoutOptions {
  /** The cache's checkouts root; `cacheCheckoutsRoot(env)` by default. */
  readonly cacheRoot?: AbsolutePath;
  /** The checkout's install; a frozen install with the project's manager by default. */
  readonly install?: (tree: AbsolutePath) => Promise<InstallResult>;
  /** The install's budget, 300 s by default. */
  readonly installTimeoutMs?: number;
  /** One line when the checkout lies in the git folder (D4.2). */
  readonly note?: (text: string) => void;
}

const INSTALL_TIMEOUT_MS = 300_000;

/**
 * Row 023-07: the whole-checkout check after the install: the first path
 * the commit tracks that the checkout does not hold as the commit does,
 * `null` when none; and the check's time.
 */
export interface CheckoutChange {
  readonly path: RelativePath | null;
  readonly ms: number;
}

/** A checkout that could not be made or installed: its files are not determined. */
export class CheckoutFailed extends Error {
  constructor(
    readonly reason: "checkout" | "install",
    detail: string,
  ) {
    super(detail);
  }
}

/** What a keyer gives `body`: the keyer, and the test files its adapters list. */
export interface OpenKeyer {
  readonly keyer: Keyer;
  readonly listed: ReadonlyMap<string, TestFileRef>;
  /** Row 023-07: the keyer's adapters, open until `body` ends, and the tree's policy. */
  readonly adapters: readonly RunnerAdapter[];
  readonly policy: Policy;
}

/**
 * Runs `body` with the gate's keyer of `root` over a scratch store, its
 * observed rows copied from `main`, and the adapters a daemon builds
 * there; closes both after.
 */
export async function withKeyer<T>(
  root: AbsolutePath,
  commonDir: AbsolutePath,
  main: Store | undefined,
  options: KeyingOptions,
  body: (open: OpenKeyer) => Promise<T>,
): Promise<T> {
  const policy = readPolicy(root);
  const opened: RunnerAdapter[] = [];
  let keyer: Keyer | null = null;
  try {
    keyer = await openKeyer(
      {
        root,
        commonDir,
        policy,
        squealVersion: options.squealVersion,
        env: options.env,
        // The keyer owns and closes them; `opened` only lists their files.
        adapters: async (tempDir) => {
          const adapters = await options.adapters(root, policy, tempDir);
          opened.push(...adapters);
          return [...adapters];
        },
      },
      main,
    );
    const listed = new Map<string, TestFileRef>();
    for (const adapter of opened) {
      for (const ref of await adapter.testFiles()) listed.set(testFileId(ref), ref);
    }
    return await body({ keyer, listed, adapters: opened, policy });
  } finally {
    await keyer?.close();
  }
}

/**
 * D4 and D6: sweeps the checkouts of dead owners, makes a checkout of
 * `commit`, installs it, runs `body` in it and removes it, also when
 * `body` throws. `prepare` runs between the checkout and the install
 * (D5.2's copy-in). A checkout or install that fails throws `CheckoutFailed`.
 */
export async function withCheckout<T>(
  input: {
    readonly root: AbsolutePath;
    readonly commonDir: AbsolutePath;
    readonly commit: string;
    readonly prepare?: (checkout: Checkout) => Promise<void>;
    /**
     * The paths `prepare` writes in (D5.2's test versions): not the
     * commit's by design, so the input check against the commit skips them.
     */
    readonly copied?: readonly RelativePath[];
    /**
     * Row 023-08: paths `prepare` writes in that the check compares with
     * these entries instead of the commit's (a proof side's expected tree).
     */
    readonly expected?: ReadonlyMap<RelativePath, CommitEntry>;
  },
  options: CheckoutOptions,
  body: (checkout: Checkout, install: InstallResult, change: CheckoutChange) => Promise<T>,
): Promise<T> {
  const { root, commonDir, commit } = input;
  const cacheRoot = options.cacheRoot ?? cacheCheckoutsRoot();
  const dirs = [cacheCheckoutsDir(cacheRoot, commonDir), gitCheckoutsDir(commonDir)];
  await sweepCheckouts({ commonDir, dirs });
  const command = await installCommand(root, await manifestOf(root));
  const store = await packageStore(root, command);
  const location = locateCheckouts({ commonDir, cacheRoot, store, root });
  if (location.warning !== null) options.note?.(location.warning);
  let checkout: Checkout;
  try {
    checkout = await createCheckout({ root, commonDir, commit, dir: location.dir });
  } catch (error) {
    throw new CheckoutFailed("checkout", error instanceof Error ? error.message : String(error));
  }
  try {
    await input.prepare?.(checkout);
    const timeoutMs = options.installTimeoutMs ?? INSTALL_TIMEOUT_MS;
    // Review wave-5 B3: the install's group is recorded, so a sweep after this process's
    // SIGKILL stops an install that outlived it.
    const started = (group: number) => {
      try {
        recordGroup(checkout.folder, leaseProcess(group));
      } catch {
        // No marker to record in: the sweep removes such a folder without its group.
      }
    };
    const install = await (
      options.install ?? ((tree) => installCheckout(tree, { timeoutMs, started }))
    )(checkout.tree);
    if (!install.ok) throw new CheckoutFailed("install", `${install.command}: ${install.reason}`);
    // Row 023-07 (the human, 2026-11-17, "Whole-checkout check"): every path the commit tracks,
    // compared with the commit's tree after the install; a difference anywhere is told to `body`.
    const checkStarted = performance.now();
    const skip = new Set(input.copied ?? []);
    const path = await checkoutChange(root, checkout.tree, checkout.commit, skip, input.expected);
    const change = { path, ms: Math.round(performance.now() - checkStarted) };
    return await body(checkout, install, change);
  } finally {
    await removeCheckout(checkout);
  }
}

async function manifestOf(root: AbsolutePath): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
