import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { acquireDaemonLock } from "../../daemon/lock.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import type { Hasher } from "../../hash/hasher.js";
import { testFileId } from "../../keys/reverse-index.js";
import { checkId } from "../../scheduler/files.js";
import { healsUnheld } from "../../scheduler/hold.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { observedGrowth } from "../../scheduler/observed.js";
import { recordsForFile } from "../../scheduler/records.js";
import { changedSince } from "../../scheduler/stability.js";
import { storeResults } from "../../scheduler/store-results.js";
import { describeFailure } from "../../state/fingerprint.js";
import { BUSY_SLICE_MS, busyBackoffMs } from "../../store/busy.js";
import { isBusy, withBusySliceSync } from "../../store/connection.js";
import { isStoreOpenFailure, openStore } from "../../store/open.js";
import { lockFileFor } from "../../store/paths.js";
import type { AbsolutePath, CommitSha, EpochMs, RelativePath } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import type { Provenance } from "../../types/store-records.js";
import { shareRecord } from "../coverage/parts.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import type { CoverageRecord } from "../coverage/types.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../store/open.js";
import type { CodeStore } from "../store/types.js";
import type { GateRun } from "./collect.js";
import { Expectations, type Expected, type Pending } from "./keep-expected.js";

/*
 * Spec 020 D17.3 (row 020-17c): the gate keeps each test file it ran to
 * completion, with its results and its coverage record, at the key a
 * daemon in the worktree gives it (D11.7), so the next run on the same
 * bytes, and a daemon, read it. It keeps a file as the daemon's tier
 * record stores one (`scheduler/store-decision.ts`, "store" at the key it
 * ran under): it completed, its inputs held still for the whole run, and
 * the run read nothing its key lacks. The rows are the daemon's own
 * (`recordsForFile`, `storeResults`, `putParts`), written under the
 * daemon's worktree lock; while a daemon holds it, nothing is written.
 */

/**
 * How long the gate retries a store whose write lock another connection
 * holds before the files of a run it has not written are not kept, as
 * `squeal import` bounds its write (`BUSY_BOUND_MS`, row 011-212).
 */
export const KEEP_BUSY_BOUND_MS = 10_000;

export interface KeepOptions {
  readonly root: AbsolutePath;
  /** The repository's git common directory, which holds the stores. */
  readonly commonDir: AbsolutePath;
  /** The policy the keys take; the code store opens only with `complexity.enabled`. */
  readonly policy: Policy;
  /** The commit the runs ran at and whether the tree was dirty: the results' provenance. */
  readonly head: () => Promise<{ readonly head: CommitSha; readonly dirty: boolean }>;
  /** Why a run's files were not kept, told once each; dropped when absent. */
  readonly note?: (text: string) => void;
  readonly now?: () => EpochMs;
  /** Default `KEEP_BUSY_BOUND_MS`. */
  readonly busyBoundMs?: number;
}

/** A completed file that may be written. */
interface Kept extends Expected {
  readonly record: CoverageRecord;
}

export class Keeper {
  readonly #options: KeepOptions;
  readonly #expected = new Expectations();
  readonly #told = new Set<string>();

  constructor(options: KeepOptions) {
    this.#options = options;
  }

  /** Before `runner`'s run: the files of `keyed` it will run, each at the key the lookup gave it. */
  expect(
    runner: GateRun["runner"],
    keys: WorktreeKeys,
    hasher: Hasher,
    keyed: ReadonlyMap<TestFileRef, CheckKey>,
  ): void {
    this.#expected.add(runner, keys, hasher, keyed);
  }

  /**
   * After `run`: writes each file it may keep of the lookups that expected
   * one of its files (review 0.1.433 B2); a failure only costs the write.
   */
  async ran(run: GateRun): Promise<void> {
    for (const pending of this.#expected.take(run)) await this.#keep(pending, run);
  }

  /** Ends what no run took, such as a runner the budget ended before; keeps nothing. */
  close(): void {
    this.#expected.close();
  }

  async #keep(pending: Pending, run: GateRun): Promise<void> {
    try {
      let kept: readonly Kept[];
      try {
        kept = await this.#keepable(pending, run);
      } finally {
        pending.keys.endRun();
      }
      if (kept.length > 0) await this.#write(kept, run.report, pending.keys);
    } catch (error) {
      this.#tell(
        `the test files this run completed were not kept in the stores: ${messageOf(error)}`,
      );
    }
  }

  /**
   * The completed files with a record, whose run read nothing beyond their
   * key (`observedGrowth`), loaded no environment file their project's
   * keys lack, and whose inputs held still during it (`changedSince`): no
   * input changed, and none was written and ended as it was. Review
   * 0.1.433 B1: the second is the daemon's completion barrier
   * (`barredByTouch`, task 001-168): the run may have read bytes its key
   * does not name.
   */
  async #keepable(pending: Pending, run: GateRun): Promise<Kept[]> {
    const { report } = run;
    const completed = new Set(report.completedFiles.map(testFileId));
    const candidates: Kept[] = [];
    for (const [id, file] of pending.files) {
      const record = run.records.get(testFileId(file.ref))?.record ?? null;
      if (completed.has(id) && record !== null) candidates.push({ ...file, record });
    }
    if (candidates.length === 0) return [];
    const { keys } = pending;
    const grown = await observedGrowth({ root: this.#options.root, keys }, report, pending.run);
    const paths = new Set(candidates.flatMap((c) => c.paths));
    const moved = await changedSince(pending.snapshot, paths, pending.hasher);
    const environment = new Set(
      (report.environmentObserved ?? []).flatMap(({ project, paths: loaded }) => {
        const keyed = new Set(keys.environmentFiles(project));
        return loaded.some((path) => !keyed.has(path)) ? [project] : [];
      }),
    );
    const unsteady = (path: RelativePath) => moved.changed.has(path) || moved.touched.has(path);
    return candidates.filter(
      (c) =>
        !grown.has(testFileId(c.ref)) && !environment.has(c.ref.project) && !c.paths.some(unsteady),
    );
  }

  /**
   * Each file's record, then its results in one transaction, under the
   * worktree's daemon lock. A reader takes a file only with both, so a
   * stop between the two leaves a record no reader takes, which prune
   * removes. The stores are created as a daemon creates them. Each write
   * is one short transaction, retried in busy slices (`sliced`) until one
   * bound for the run: the files left then are told as not kept.
   */
  async #write(files: readonly Kept[], report: RunReport, keys: WorktreeKeys): Promise<void> {
    const { root, commonDir, policy } = this.#options;
    const now = this.#options.now ?? Date.now;
    const worktreeId = worktreeIdFor(root);
    const head = await this.#options.head();
    const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
    if (lock === null) {
      this.#tell(`${notKept(files.length)}: a daemon runs in this worktree, and it keeps its own`);
      return;
    }
    let written = 0;
    let store: Store | null = null;
    let code: CodeStore | null = null;
    try {
      const opened = openStore(commonDir);
      if (isStoreOpenFailure(opened)) throw new Error(`the store did not open: ${opened.reason}`);
      store = opened;
      const codeOpened = openCodeStore(commonDir, policy);
      if (isCodeStoreOpenFailure(codeOpened)) {
        throw new Error(`the code store did not open: ${codeOpened.reason}`);
      }
      code = codeOpened;
      const provenance: Provenance = {
        worktreeId,
        revision: store.revisions.latest(worktreeId)?.number ?? 0,
        commit: head.head,
        dirty: head.dirty,
        runId: `gate-${randomUUID()}`,
        recordedAt: now(),
      };
      const bound = this.#options.busyBoundMs ?? KEEP_BUSY_BOUND_MS;
      const at = { report, provenance, now, deadline: now() + bound };
      for (const file of files) {
        if (!(await keepFile(store, code, keys, { ...at, file }))) {
          const seconds = Number((bound / 1000).toFixed(1));
          const why = `the store stayed busy for ${seconds} s (another connection held its write lock)`;
          this.#tell(`${notKept(files.length - written)}: ${why}`);
          return;
        }
        written += 1;
      }
    } catch (error) {
      this.#tell(`${notKept(files.length - written)}: ${messageOf(error)}`);
    } finally {
      code?.close();
      store?.close();
      lock.release();
    }
  }

  #tell(text: string): void {
    if (this.#told.has(text)) return;
    this.#told.add(text);
    this.#options.note?.(text);
  }
}

/**
 * One file's record at its key, then its results there, as the daemon's
 * tier record stores them; `false` when the store stayed busy until
 * `deadline`, before its results were written.
 */
async function keepFile(
  store: Store,
  code: CodeStore,
  keys: WorktreeKeys,
  at: {
    readonly file: Kept;
    readonly report: RunReport;
    readonly provenance: Provenance;
    readonly now: () => EpochMs;
    readonly deadline: EpochMs;
  },
): Promise<boolean> {
  const { file, report, provenance, now, deadline } = at;
  const recordKey = { resultKey: file.key, providerVersion: COVERAGE_RECORD_VERSION };
  const shared = shareRecord(file.record, COVERAGE_RECORD_VERSION);
  if (!(await sliced(deadline, now, () => code.coverage.putParts(recordKey, shared, now())))) {
    return false;
  }
  // D8's file-level error expansion: the checks of the file's newest stored key, from any worktree.
  const previous = new Map(
    store.results.newestForTestFile(file.ref).map((r) => [checkId(r.check), r.check]),
  );
  const records = recordsForFile({
    ref: file.ref,
    key: file.key,
    report,
    previousChecks: [...previous.values()],
    provenance,
    describe: describeFailure,
  });
  const context = { store, keys, worktreeId: provenance.worktreeId, now };
  return sliced(deadline, now, () =>
    storeResults(context, records, healsUnheld(store, file.paths)),
  );
}

/**
 * `write`, one synchronous transaction, tried in busy slices of
 * `BUSY_SLICE_MS` with `busyBackoffMs` between tries; `false` once the
 * next try would start after `deadline`. A refused `BEGIN IMMEDIATE`
 * writes nothing, and the pause is awaited between tries, never inside a
 * transaction.
 */
async function sliced(
  deadline: EpochMs,
  now: () => EpochMs,
  write: () => unknown,
): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      withBusySliceSync(BUSY_SLICE_MS, write);
      return true;
    } catch (error) {
      if (!isBusy(error)) throw error;
    }
    const pause = busyBackoffMs(attempt);
    if (now() + pause >= deadline) return false;
    await delay(pause);
  }
}

/** The start of a note on `count` completed test files a run did not keep. */
function notKept(count: number): string {
  return `${count} completed test ${count === 1 ? "file was" : "files were"} not kept in the stores`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
