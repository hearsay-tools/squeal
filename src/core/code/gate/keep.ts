import { randomUUID } from "node:crypto";
import { acquireDaemonLock } from "../../daemon/lock.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import type { Hasher } from "../../hash/hasher.js";
import { testFileId } from "../../keys/reverse-index.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { observedGrowth } from "../../scheduler/observed.js";
import { changedSince } from "../../scheduler/stability.js";
import { isStoreOpenFailure, openStore } from "../../store/open.js";
import { lockFileFor } from "../../store/paths.js";
import type { AbsolutePath, CommitSha, EpochMs, RelativePath } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../store/open.js";
import type { CodeStore } from "../store/types.js";
import type { GateRun } from "./collect.js";
import { Expectations, type Pending } from "./keep-expected.js";
import { DAEMON_KEEPS_ITS_OWN, type DaemonWaits, KeepUnknown, sentWriter } from "./keep-sent.js";
import {
  databasesOf,
  KEEP_BUSY_BOUND_MS,
  type KeepWriter,
  type Kept,
  keepFile,
  notKept,
  perhapsKept,
  StoreWait,
  writeHere,
} from "./keep-write.js";

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
 * D17.5 (row 020-28, #192): each run's files are queued, and written by
 * `flush` once the report is out, so a busy store never delays the verdict.
 * Review 0.1.444 B2: once the store was busy, each file's inputs are read
 * again after every pause and before each of its writes.
 */

export interface KeepOptions {
  readonly root: AbsolutePath;
  /** The repository's git common directory, which holds the stores. */
  readonly commonDir: AbsolutePath;
  /** The policy the keys take; the code store opens only with `complexity.enabled`. */
  readonly policy: Policy;
  /** The commit the runs ran at and whether the tree was dirty: the results' provenance. */
  readonly head: () => Promise<{ readonly head: CommitSha; readonly dirty: boolean }>;
  /** Why files were not kept, told once each, and a busy store's wait; dropped when absent. */
  readonly note?: (text: string) => void;
  readonly now?: () => EpochMs;
  /**
   * How long `flush` waits for a store whose write lock another connection
   * holds, from the first write it refused, before the files it has not
   * written are not kept; default `KEEP_BUSY_BOUND_MS` (D17.5).
   */
  readonly busyBoundMs?: number;
  /** How long a daemon that writes the files is waited for; default `DAEMON_WAITS` (review 0.1.450 B2). */
  readonly daemonWaits?: DaemonWaits;
}

/** One run's files that may be kept, until `flush` writes them. */
interface Queued {
  readonly files: readonly Kept[];
  readonly report: RunReport;
  readonly pending: Pending;
}

export class Keeper {
  readonly #options: KeepOptions;
  readonly #expected = new Expectations();
  readonly #queued: Queued[] = [];
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
   * After `run`: queues each file it may keep of the lookups that expected
   * one of its files (review 0.1.433 B2), for `flush`; a failure only
   * costs the write.
   */
  async ran(run: GateRun): Promise<void> {
    for (const pending of this.#expected.take(run)) await this.#queue(pending, run);
  }

  /**
   * D17.5, once the report is out: writes every queued file whose inputs
   * still hold the bytes its run read. A busy store is waited for up to
   * the bound, counted from the first write it refused, and a file whose
   * inputs moved during the wait is not written; a failure only costs the
   * files not yet written, told once, and never throws.
   */
  async flush(): Promise<void> {
    const queued = this.#queued.splice(0);
    if (queued.length === 0) return;
    let left = queued.flatMap((q) => q.files).length;
    try {
      const steady: Queued[] = [];
      for (const q of queued) {
        const files = await steadyOf(q.files, q.pending);
        if (files.length > 0) steady.push({ ...q, files });
      }
      left = steady.flatMap((q) => q.files).length;
      if (left > 0) await this.#write(steady);
    } catch (error) {
      this.#tell(`${notKept(left)}: ${messageOf(error)}`);
    }
  }

  /** Ends what no run took, such as a runner the budget ended before, and drops the queue. */
  close(): void {
    this.#expected.close();
    this.#queued.splice(0);
  }

  async #queue(pending: Pending, run: GateRun): Promise<void> {
    try {
      let kept: readonly Kept[];
      try {
        kept = await this.#keepable(pending, run);
      } finally {
        pending.keys.endRun();
      }
      if (kept.length > 0) this.#queued.push({ files: kept, report: run.report, pending });
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
   * is one short transaction, retried in busy slices until one bound from
   * the first busy write (`StoreWait`); the files not written then are
   * told as not kept. From that first busy write on, each file is checked
   * again before each of its writes and after every pause (review 0.1.444
   * B2): the opening check of `flush` no longer holds after a wait.
   */
  async #write(queued: readonly Queued[]): Promise<void> {
    const { root, commonDir, policy } = this.#options;
    const now = this.#options.now ?? Date.now;
    const worktreeId = worktreeIdFor(root);
    const head = await this.#options.head();
    const all = queued.flatMap((q) => q.files);
    const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
    let written = 0;
    let changed = 0;
    let freed = false;
    let store: Store | null = null;
    let code: CodeStore | null = null;
    try {
      const opened = openStore(commonDir);
      if (isStoreOpenFailure(opened)) throw new Error(`the store did not open: ${opened.reason}`);
      store = opened;
      let writer: KeepWriter;
      if (lock === null) {
        const sent = sentWriter(store, worktreeId, now(), this.#options.daemonWaits);
        if (sent === null) {
          this.#tell(`${notKept(all.length)}: ${DAEMON_KEEPS_ITS_OWN}`);
          return;
        }
        writer = sent;
      } else {
        code = openCode(commonDir, policy);
        writer = writeHere({ store, code }, worktreeId, now);
      }
      const boundMs = this.#options.busyBoundMs ?? KEEP_BUSY_BOUND_MS;
      const wait = new StoreWait({ now, boundMs, tell: (text) => this.#tell(text) });
      const databases = databasesOf(commonDir);
      const giveUp = (database: AbsolutePath) =>
        wait.giveUp(database, all.slice(written + changed));
      const revision = store.revisions.latest(worktreeId)?.number ?? 0;
      for (const { files, report, pending } of queued) {
        const provenance = {
          worktreeId,
          revision,
          commit: head.head,
          dirty: head.dirty,
          runId: `gate-${randomUUID()}`,
          recordedAt: now(),
        };
        const stores = { store, keys: pending.keys, writer };
        for (const file of files) {
          const steady = async () => !wait.waited || (await steadyOf([file], pending)).length > 0;
          const at = { file, report, provenance, databases, giveUp, steady };
          const outcome = await keepFile(stores, at);
          if (outcome === "spent") {
            this.#tell(wait.spent(all.length - written, changed));
            return;
          }
          if (outcome === "changed") changed += 1;
          else {
            written += 1;
            freed ||= wait.waited;
          }
        }
      }
      wait.done({ written, changed, freed });
    } catch (error) {
      const left = all.length - written;
      const unknown = error instanceof KeepUnknown;
      this.#tell(
        unknown ? perhapsKept(left, error.message) : `${notKept(left)}: ${messageOf(error)}`,
      );
    } finally {
      code?.close();
      store?.close();
      lock?.release();
    }
  }

  #tell(text: string): void {
    if (this.#told.has(text)) return;
    this.#told.add(text);
    this.#options.note?.(text);
  }
}

/** The code store for the keeper's own writes, created as a daemon creates it. */
function openCode(commonDir: AbsolutePath, policy: Policy): CodeStore {
  const code = openCodeStore(commonDir, policy);
  if (isCodeStoreOpenFailure(code)) throw new Error(`the code store did not open: ${code.reason}`);
  return code;
}

/**
 * D17.5: the files of `files` none of whose inputs changed since
 * `pending`'s lookup, read again at the write; a file whose bytes moved
 * after its run is not kept, and the next run keys it anew.
 */
async function steadyOf(files: readonly Kept[], pending: Pending): Promise<readonly Kept[]> {
  const paths = new Set(files.flatMap((f) => f.paths));
  const { changed } = await changedSince(pending.snapshot, paths, pending.hasher);
  return files.filter((f) => !f.paths.some((path) => changed.has(path)));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
