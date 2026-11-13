import type { Hasher } from "../hash/hasher.js";
import { OBSERVED_META_KEYS } from "../keys/observed-rows.js";
import { testFileId } from "../keys/reverse-index.js";
import type { TestFileRef } from "../types/keys.js";
import type {
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunReport,
} from "../types/runner.js";
import type { Store } from "../types/store.js";
import { openDaemonKeys } from "./daemon-keys.js";
import type { WorktreeKeys } from "./keying.js";
import { observedGrowth } from "./observed.js";

/*
 * Spec 020 D11.7 and 018 D9 (row 020-51): the one path that keys test files
 * as a daemon in this checkout keys them, for `squeal code --base`'s stores
 * lookup and for `squeal ci export`. The daemon's `WorktreeKeys` over a
 * store of the caller's (`openDaemonKeys`), the environments of the
 * adapters a daemon builds here, each listed file's closure from its
 * adapter, and, for the export, what its shard observed beyond it, as a
 * daemon's record grows a key. Where the readers differ on purpose, the
 * difference is an option: `observedFrom` (the gate starts from the
 * observed rows its daemons stored), `leftOut` (the export's
 * `node:inspector` rule) and `grow` (the export's shard reports).
 */

export type DaemonKeyingInput = Parameters<typeof openDaemonKeys>[0] & {
  /** The adapters a daemon builds here, open; the caller closes them. */
  readonly adapters: readonly RunnerAdapter[];
  /**
   * The store whose observed rows seed `store` for the adapters' projects
   * before the keys bootstrap, as a daemon here starts with them (the gate:
   * the repository's store). Absent, `store` holds its own (the export:
   * none, which `grow` adds from its shards' reports).
   */
  readonly observedFrom?: Store;
};

export interface KeyFilesOptions<F extends TestFileRef> {
  /**
   * A file whose closure here says it goes no further: counted in
   * `leftOut`, its closure not set (the export's `node:inspector` rule,
   * spec 020 D19.6). Absent, none.
   */
  readonly leftOut?: (file: F, closure: RunnerClosure) => boolean;
}

/** What `keyFiles` keyed. */
export interface KeyedFiles {
  /** The adapter's closure of each file keyed, by `testFileId`, in the order given. */
  readonly closures: ReadonlyMap<string, RunnerClosure>;
  /** The files `leftOut` named. */
  readonly leftOut: number;
}

/** The daemon's keys of this checkout with the adapters' environments set. */
export class DaemonKeying {
  readonly #root: DaemonKeyingInput["root"];
  readonly #adapters: readonly RunnerAdapter[];
  #listed: Promise<ReadonlyMap<string, RunnerAdapter>> | null = null;

  constructor(
    input: Pick<DaemonKeyingInput, "root" | "adapters">,
    readonly keys: WorktreeKeys,
    readonly hasher: Hasher,
    /** Every adapter's environments, as `keys` has them. */
    readonly environments: readonly RunnerEnvironment[],
  ) {
    this.#root = input.root;
    this.#adapters = input.adapters;
  }

  /**
   * Keys each of `files` an adapter lists by that adapter's closure, as a
   * daemon's start does (`setClosure`, then `trackUntracked`). A file no
   * adapter lists, whose closure fails, or that `options.leftOut` names, is
   * not keyed. The adapter is asked of the file's project and path alone.
   * Read each key from `keys.index` after the last step.
   */
  async keyFiles<F extends TestFileRef>(
    files: readonly F[],
    options: KeyFilesOptions<F> = {},
  ): Promise<KeyedFiles> {
    const listed = await this.#listedOnce();
    const closures = new Map<string, RunnerClosure>();
    let leftOut = 0;
    for (const file of files) {
      const ref: TestFileRef = { project: file.project, path: file.path };
      const id = testFileId(ref);
      const closure = await listed
        .get(id)
        ?.closure(ref)
        .catch(() => null);
      if (closure === undefined || closure === null) continue;
      if (options.leftOut?.(file, closure) === true) {
        leftOut++;
        continue;
      }
      closures.set(id, closure);
      this.keys.setClosure(closure);
    }
    await this.keys.trackUntracked();
    return { closures, leftOut };
  }

  /**
   * Grows the keys of `report`'s files by what they observed beyond their
   * closure, as a daemon's record does (`observedGrowth`, `addObserved`),
   * and stores it in the keys' store (`writeSeen`).
   */
  async grow(report: RunReport): Promise<void> {
    const { keys } = this;
    const run = keys.beginRun();
    try {
      const growth = await observedGrowth({ root: this.#root, keys }, report, run);
      for (const { testFile } of report.observed ?? []) {
        const grown = growth.get(testFileId(testFile));
        if (grown !== undefined) keys.addObserved(testFile, grown.add);
      }
    } finally {
      keys.endRun();
    }
    await keys.trackUntracked();
    keys.writeSeen();
  }

  /** Which adapter lists each test file, by `testFileId`, read once; a later adapter wins. */
  #listedOnce(): Promise<ReadonlyMap<string, RunnerAdapter>> {
    this.#listed ??= (async () => {
      const listed = new Map<string, RunnerAdapter>();
      for (const adapter of this.#adapters) {
        for (const ref of await adapter.testFiles()) listed.set(testFileId(ref), adapter);
      }
      return listed;
    })();
    return this.#listed;
  }
}

/**
 * The daemon's keys over `input.store`, bootstrapped as at a daemon's
 * start, with every adapter's environments set; first, with
 * `observedFrom`, the observed rows of the environments' projects copied
 * into `input.store`.
 */
export async function openDaemonKeying(input: DaemonKeyingInput): Promise<DaemonKeying> {
  const { adapters, observedFrom, store } = input;
  const environments = (await Promise.all(adapters.map((a) => a.environment()))).flat();
  if (observedFrom !== undefined) {
    for (const project of new Set(environments.map((e) => e.project))) {
      for (const key of OBSERVED_META_KEYS) copyMeta(observedFrom, store, key(project));
    }
  }
  const { root, worktreeId, policy, squealVersion, env } = input;
  const opened = { root, worktreeId, store, policy, squealVersion, env };
  const { keys, hasher } = await openDaemonKeys(opened);
  await keys.setEnvironments(environments);
  return new DaemonKeying(input, keys, hasher, environments);
}

/** Copies the meta row `key` of `from` into `to`, when `from` has one. */
function copyMeta(from: Store, to: Store, key: string): void {
  const value = from.meta.get(key);
  if (value !== null) to.meta.set(key, value);
}
