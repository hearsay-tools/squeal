import { execFileSync } from "node:child_process";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import { observedGrowth } from "../../src/core/scheduler/observed.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/index.js";
import {
  type AbsolutePath,
  DEFAULT_POLICY,
  type RelativePath,
  type RunnerAdapter,
  type RunReport,
  type Store,
  type TestFileRef,
  type WorktreeId,
} from "../../src/core/types/index.js";

/*
 * Spec 016 D1, K10: the worktrees of one play share one scratch store, as
 * the daemons of two worktrees share `<common-dir>/squeal/store.sqlite`,
 * and no daemon runs. An opened worktree has its own connection, its own
 * `WorktreeKeys` and its own adapter, as a daemon has; a restart closes the
 * three and opens new ones. What a run observed takes the core's step, as
 * `record-tier.ts` records a completed file, and a file's closure is the
 * one `WorktreeKeys.setClosure` assembles. A pack whose adapter writes the
 * store itself gets the connection when it opens.
 */

/** Makes `root` a repository of its own: the keys' bootstrap lists its files with git. */
export function initRepository(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
}

/**
 * What `observedGrowth` reads of its context. Its parameter is the whole
 * `SchedulerContext`, which `src/core` declares, so a read of another
 * member cannot fail to compile here: the proxy throws on it instead, and
 * every play that runs fails with the member's name.
 */
type Growing = Pick<SchedulerContext, "root" | "keys">;

function growing(context: Growing): SchedulerContext {
  return new Proxy(context, {
    get(target, member) {
      if (typeof member === "symbol" || member in target) return Reflect.get(target, member);
      throw new Error(`observedGrowth read context.${member}, which the kit does not model`);
    },
  }) as SchedulerContext;
}

/** One worktree's adapter, keys and store connection, open over the play's store. */
export class OpenWorktree {
  private constructor(
    readonly adapter: RunnerAdapter,
    private readonly keys: WorktreeKeys,
    private readonly store: Store,
    private readonly root: AbsolutePath,
  ) {}

  /**
   * Opens worktree `name` at `root` over the store of directory `common`:
   * a connection, the adapter `open` makes with it, and keys bootstrapped
   * from the store, with the adapter's environments and the closure of
   * each file it lists, as a daemon keys its worktree at start.
   */
  static async open(
    name: string,
    root: AbsolutePath,
    common: AbsolutePath,
    open: (store: Store) => Promise<RunnerAdapter>,
  ): Promise<OpenWorktree> {
    const store = openStore(common, { busyTimeoutMs: 10_000 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    let adapter: RunnerAdapter | null = null;
    try {
      adapter = await open(store);
      const keys = new WorktreeKeys({
        root,
        worktreeId: name as WorktreeId,
        store,
        hasher: createFsHasher(root, "sha1"),
        objectFormat: "sha1",
        policy: DEFAULT_POLICY,
        squealVersion: "0.0.0-kit",
        env: {},
        onExtraFiles: () => {},
      });
      await keys.bootstrap(() => readHead(root));
      await keys.setEnvironments(await adapter.environment());
      for (const ref of await adapter.testFiles()) keys.setClosure(await adapter.closure(ref));
      await keys.trackUntracked();
      return new OpenWorktree(adapter, keys, store, root);
    } catch (error) {
      // The open's own error is the one to report; what the close of a half-open worktree throws is not.
      await adapter?.close().catch(() => {});
      store.close();
      throw error;
    }
  }

  /**
   * The closure the core keys `ref` with: the adapter's `closure()`, with
   * this worktree's declared inputs and the observed set the store shares.
   * The key index's reverse map, which re-keys a file at an edit, is built
   * from it.
   */
  async keyed(ref: TestFileRef): Promise<readonly RelativePath[]> {
    this.keys.setClosure(await this.adapter.closure(ref));
    return this.keys.index.closure(ref)?.paths ?? [];
  }

  /**
   * Runs `files` by `run`, keyed first as the scheduler keys a tier, then
   * adds what each completed file observed beyond its closure to the
   * shared set, as `recordCompleted` does with `observedGrowth`.
   */
  async record(files: readonly TestFileRef[], run: () => Promise<RunReport>): Promise<RunReport> {
    for (const ref of files) await this.keyed(ref);
    const number = this.keys.beginRun();
    try {
      const report = await run();
      const growth = await observedGrowth(
        growing({ root: this.root, keys: this.keys }),
        report,
        number,
      );
      for (const { testFile } of report.observed ?? []) {
        const grown = growth.get(testFileId(testFile));
        if (grown !== undefined) this.keys.addObserved(testFile, grown.add);
      }
      return report;
    } finally {
      this.keys.endRun();
    }
  }

  /** Closes the adapter, then the connection, whatever the adapter's close throws. */
  async close(): Promise<void> {
    try {
      await this.adapter.close();
    } finally {
      this.store.close();
    }
  }
}
