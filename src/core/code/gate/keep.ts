import { randomUUID } from "node:crypto";
import { acquireDaemonLock } from "../../daemon/lock.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import type { Hasher } from "../../hash/hasher.js";
import { testFileId } from "../../keys/reverse-index.js";
import {
  keepDecisions,
  keeps,
  type MergeHoldSource,
  mergeHoldOf,
  stillAsRead,
  unheldNow,
} from "../../run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { isStoreOpenFailure, openStore } from "../../store/open.js";
import { lockFileFor } from "../../store/paths.js";
import type { AbsolutePath, CommitSha, EpochMs } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { Policy } from "../../types/policy.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../store/open.js";
import type { CodeStore } from "../store/types.js";
import type { GateRun } from "./collect.js";
import { Expectations, type LookupSources, type Pending } from "./keep-expected.js";
import { writeHere } from "./keep-here.js";
import { NotKept } from "./keep-reasons.js";
import { DAEMON_KEEPS_ITS_OWN, type DaemonWaits, KeepUnknown, sentWriter } from "./keep-sent.js";
import {
  changedAfterLoss,
  databasesOf,
  InputCheck,
  KEEP_BUSY_BOUND_MS,
  type KeepWriter,
  type Kept,
  keepFile,
  notKept,
  perhapsKept,
  StoreWait,
} from "./keep-write.js";

/*
 * Spec 020 D17.3 (row 020-17c): the gate keeps each test file it ran to
 * completion, with its results and its coverage record, at the key a
 * daemon in the worktree gives it (D11.7), so the next run on the same
 * bytes, and a daemon, read it. It keeps a file only when the store
 * decision of its run evidence is "store at the key it ran under"
 * (`run-evidence/run-evidence.ts`, row 011-319): it completed, its inputs
 * held still for the whole run, and the run read nothing its key lacks.
 * The rows are the daemon's own
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
  /** Row 011-320: the merge hold, read at each decision and again at each write. */
  readonly #hold: MergeHoldSource;
  /** Row 011-320: the completed files not kept for their run's evidence, told at `flush`. */
  readonly #notKept = new NotKept();

  constructor(options: KeepOptions) {
    this.#options = options;
    this.#hold = mergeHoldOf(options.root);
  }

  /**
   * Before `runner`'s run: the files of `keyed` it will run, each at the
   * key the lookup gave it, with what `sources` reads (row 011-320).
   */
  expect(
    runner: GateRun["runner"],
    keys: WorktreeKeys,
    hasher: Hasher,
    keyed: ReadonlyMap<TestFileRef, CheckKey>,
    sources?: LookupSources,
  ): void {
    this.#expected.add(runner, keys, hasher, keyed, sources);
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
    for (const line of this.#notKept.take()) this.#tell(line);
    const queued = this.#queued.splice(0);
    if (queued.length === 0) return;
    let left = queued.flatMap((q) => q.files).length;
    try {
      const steady: Queued[] = [];
      for (const q of queued) {
        const files = await this.#steady(q.pending, q.files);
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
   * The completed files with a record whose store decision is "store at
   * the key it ran under" (`keepDecisions`): the run read nothing beyond
   * their key, loaded no environment file their project's keys lack, and
   * their inputs held still during it, none changed, and none written and
   * ended as it was (review 0.1.433 B1, the daemon's completion barrier).
   * Row 011-320: their runtime identity held, no merge holds a path their
   * key names, and no file entered or left a directory it lists. Each
   * other one waits in `#notKept` with its reason, for `flush` to tell.
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
    const { keys, hasher, snapshot: before, listed, runtime, revisions } = pending;
    const sources = {
      root: this.#options.root,
      keys,
      hasher,
      run: pending.run,
      before,
      hold: this.#hold,
      listed,
      ...(runtime === undefined ? {} : { runtime }),
      ...(revisions === undefined ? {} : { revisions }),
    };
    const decided = await keepDecisions(sources, candidates, report);
    const kept: Kept[] = [];
    for (const c of candidates) {
      const at = decided.get(testFileId(c.ref));
      if (at !== undefined && keeps(at.decision)) kept.push(c);
      else if (at !== undefined) this.#notKept.add(c.ref.path, at);
    }
    return kept;
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
    /** The files a merge held by their write: among `changed`. */
    const held: Kept[] = [];
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
      const check = new InputCheck();
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
          const steady = async () =>
            (await stillAsRead(pending.snapshot, [file], pending.hasher)).length > 0;
          const unheld = async () => {
            const free = (await unheldNow(this.#hold, [file])).length > 0;
            if (!free) held.push(file);
            return free;
          };
          const at = { file, report, provenance, databases, giveUp, check, steady, unheld };
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
      // A file that moved after a lost try, with no busy wait to tell it (review 0.1.450 R1-B2),
      // and one a merge holds by its write (review 0.1.458 B4), which a wait counts as moved.
      const lost = changed - held.length;
      if (!wait.waited && lost > 0) this.#tell(changedAfterLoss(lost));
      if (!wait.waited) for (const file of held) this.#notKept.add(file.ref.path, HELD);
      for (const line of this.#notKept.take()) this.#tell(line);
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

  /**
   * The files of `files` that may still be written at `flush`'s opening
   * check: their inputs hold the bytes the run read (D17.5), and no merge
   * holds one of them now (row 011-320). `keepFile` reads the hold again
   * before every try (review 0.1.458 B4).
   */
  async #steady(pending: Pending, files: readonly Kept[]): Promise<Kept[]> {
    const still = await stillAsRead(pending.snapshot, files, pending.hasher);
    return still.length === 0 ? still : unheldNow(this.#hold, still);
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

/** Why a file a merge holds by its write was not kept, as `NotKept` names it. */
const HELD = {
  cause: { kind: "held", paths: [] },
  reason: "a merge holds a path its key names",
} as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
