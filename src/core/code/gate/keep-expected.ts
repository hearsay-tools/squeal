import type { Hasher } from "../../hash/hasher.js";
import type { StatCache } from "../../hash/stat-cache.js";
import { testFileId } from "../../keys/reverse-index.js";
import { copyInputs, type RuntimeIdentity } from "../../run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import type { RelativePath } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { GateRun } from "./collect.js";

/*
 * Spec 020 D17.3, review 0.1.433 B2: what the keeper expects of each
 * stored lookup until its run ends. Every runner's lookup comes before
 * any run (D14.4), and two node:test entries are one runner kind. So each
 * lookup holds its own files, their inputs and its run of `WorktreeKeys`;
 * each of its files finds it, and only a run of one of its files takes it.
 */

/** A file a lookup keyed and found nothing for: it runs, and may be kept. */
export interface Expected {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
  /** What its stability check compares: its closure, its environment files, its lockfile. */
  readonly paths: readonly RelativePath[];
  /** Its runtime identity as the lookup found it, when the lookup gave its source (row 011-320). */
  readonly runtimeIdentity?: string;
}

/** One lookup's files about to run, with their inputs as the lookup found them. */
export interface Pending {
  readonly runner: GateRun["runner"];
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `WorktreeKeys.beginRun`'s number, for the reads first hashed after it. */
  readonly run: number;
  readonly snapshot: StatCache;
  /** Where each file's runtime identity is read, before the run and at its end (row 011-320). */
  readonly runtime?: RuntimeIdentity;
  /** By `testFileId`. */
  readonly files: ReadonlyMap<string, Expected>;
}

export class Expectations {
  /** Each expected file's lookup, by `expectationOf`. */
  readonly #expected = new Map<string, Pending>();
  /** The lookups whose run of `WorktreeKeys` has not ended. */
  readonly #open = new Set<Pending>();

  /**
   * Before `runner`'s run: the files of `keyed` it will run, each at the
   * key the lookup gave it. Their inputs are copied from the stat cache
   * now, as the daemon copies a tier's when it selects it, and a run of
   * `keys` begins. With `runtime`, each file's runtime identity is read
   * now, as the daemon's `TierFile.runtimePolicy` is at selection.
   */
  add(
    runner: GateRun["runner"],
    keys: WorktreeKeys,
    hasher: Hasher,
    keyed: ReadonlyMap<TestFileRef, CheckKey>,
    runtime?: RuntimeIdentity,
  ): void {
    const files = new Map<string, Expected>();
    for (const [ref, key] of keyed) {
      const paths = keys.stabilityPaths(ref);
      const identity = runtime === undefined ? {} : { runtimeIdentity: runtime(ref) };
      files.set(testFileId(ref), { ref, key, paths, ...identity });
    }
    if (files.size === 0) return;
    const paths = new Set([...files.values()].flatMap((f) => f.paths));
    const snapshot = copyInputs(keys.cache, paths);
    const run = keys.beginRun();
    const source = runtime === undefined ? {} : { runtime };
    const pending = { runner, keys, hasher, run, snapshot, files, ...source };
    this.#open.add(pending);
    for (const id of files.keys()) this.#expected.set(expectationOf(runner, id), pending);
  }

  /**
   * The lookups that expected one of `run`'s files, each taken whole, so
   * no other run takes it. The caller ends each one's run of `keys`.
   */
  take(run: Pick<GateRun, "runner" | "files">): Pending[] {
    const taken = new Set<Pending>();
    for (const ref of run.files) {
      const pending = this.#expected.get(expectationOf(run.runner, testFileId(ref)));
      if (pending !== undefined) taken.add(pending);
    }
    for (const pending of taken) this.#drop(pending);
    return [...taken];
  }

  /** Ends the run of each lookup no run took, such as one the budget ended before. */
  close(): void {
    for (const pending of [...this.#open]) {
      this.#drop(pending);
      pending.keys.endRun();
    }
  }

  #drop(pending: Pending): void {
    this.#open.delete(pending);
    for (const id of pending.files.keys()) {
      const at = expectationOf(pending.runner, id);
      if (this.#expected.get(at) === pending) this.#expected.delete(at);
    }
  }
}

/**
 * A file's expectation: its runner kind and its `testFileId`. A node:test
 * ref's project is its entry's name, which the policy keeps unique, so two
 * entries' files never share one.
 */
function expectationOf(runner: GateRun["runner"], id: string): string {
  return `${runner}\0${id}`;
}
