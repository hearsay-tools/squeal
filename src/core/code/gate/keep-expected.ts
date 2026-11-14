import type { Hasher } from "../../hash/hasher.js";
import type { StatCache } from "../../hash/stat-cache.js";
import { testFileId } from "../../keys/reverse-index.js";
import {
  copyInputs,
  copyListed,
  type Revisions,
  type RevisionsSince,
  type RuntimeSource,
  revisionsSince,
} from "../../run-evidence/run-evidence.js";
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
 * Row 020-55: a file that runs once more under load (D3.4) is taken by its
 * rerun, not its first run, over the same lookup.
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
  /** The files below the files' listings, as the lookup's keys hold them (row 011-320). */
  readonly listed: ReadonlySet<RelativePath>;
  /** Where each file's runtime identity is read, before the run and at its end (row 011-320). */
  readonly runtime?: RuntimeSource;
  /** The revisions a serving daemon records from the lookup on (review 0.1.458 B1). */
  readonly revisions?: RevisionsSince;
  /** By `testFileId`. */
  readonly files: ReadonlyMap<string, Expected>;
}

/** A lookup a run took; `endsRun` false while its retried files wait for their rerun (row 020-55). */
export interface Taken {
  readonly pending: Pending;
  readonly endsRun: boolean;
}

/**
 * What a lookup reads beyond its keys (row 011-320), each optional: the
 * runtime identity, and the worktree's revisions in the repository's store.
 */
export interface LookupSources {
  readonly runtime?: RuntimeSource;
  readonly revisions?: Revisions;
}

export class Expectations {
  /** Each expected file's lookup, by `expectationOf`. */
  readonly #expected = new Map<string, Pending>();
  /** The lookups whose run of `WorktreeKeys` has not ended. */
  readonly #open = new Set<Pending>();

  /**
   * Before `runner`'s run: the files of `keyed` it will run, each at the
   * key the lookup gave it. Their inputs are copied from the stat cache
   * now, as the daemon copies a tier's when it selects it, with the files
   * below their listings, and a run of `keys` begins. With `sources`'
   * runtime, each file's runtime identity is read now, as the daemon's
   * `TierFile.runtimePolicy` is at selection; with its revisions, the
   * latest one now is where the revisions during the run begin.
   */
  add(
    runner: GateRun["runner"],
    keys: WorktreeKeys,
    hasher: Hasher,
    keyed: ReadonlyMap<TestFileRef, CheckKey>,
    sources: LookupSources = {},
  ): void {
    const { runtime } = sources;
    const files = new Map<string, Expected>();
    for (const [ref, key] of keyed) {
      const paths = keys.stabilityPaths(ref);
      const identity = runtime === undefined ? {} : { runtimeIdentity: runtime.identity(ref) };
      files.set(testFileId(ref), { ref, key, paths, ...identity });
    }
    if (files.size === 0) return;
    const paths = new Set([...files.values()].flatMap((f) => f.paths));
    const snapshot = copyInputs(keys.cache, paths);
    const listed = copyListed(keys, paths);
    const run = keys.beginRun();
    const pending = {
      runner,
      keys,
      hasher,
      run,
      snapshot,
      listed,
      files,
      ...(runtime === undefined ? {} : { runtime }),
      ...(sources.revisions === undefined ? {} : { revisions: revisionsSince(sources.revisions) }),
    };
    this.#hold(pending);
  }

  /**
   * The lookups that expected one of `run`'s files, each taken whole, so
   * no other run takes it. The caller ends each one's run of `keys` when
   * `endsRun`. Row 020-55: the files of `run.retrying` are not decided by
   * this run, so its first failure is never kept. Their lookup stays
   * expected for them alone, with its inputs and its run of `keys` as the
   * lookup began them: their rerun takes it, and the window their keep is
   * judged over runs from the lookup to the rerun's end.
   */
  take(run: Pick<GateRun, "runner" | "files" | "retrying">): Taken[] {
    const taken = new Set<Pending>();
    for (const ref of run.files) {
      const pending = this.#expected.get(expectationOf(run.runner, testFileId(ref)));
      if (pending !== undefined) taken.add(pending);
    }
    const retrying = new Set((run.retrying ?? []).map(testFileId));
    return [...taken].map((pending) => {
      this.#drop(pending);
      const files = [...pending.files];
      const rest = new Map(files.filter(([id]) => retrying.has(id)));
      if (rest.size === 0) return { pending, endsRun: true };
      this.#hold({ ...pending, files: rest });
      const now = new Map(files.filter(([id]) => !retrying.has(id)));
      return { pending: { ...pending, files: now }, endsRun: false };
    });
  }

  /**
   * Ends the run of each lookup no run took, such as one the budget ended
   * before, or one whose retried files' rerun never started (row 020-55).
   */
  close(): void {
    for (const pending of [...this.#open]) {
      this.#drop(pending);
      pending.keys.endRun();
    }
  }

  #hold(pending: Pending): void {
    this.#open.add(pending);
    for (const id of pending.files.keys())
      this.#expected.set(expectationOf(pending.runner, id), pending);
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
