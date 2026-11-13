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
import type { CodeStore } from "../store/types.js";
import type { GateRun } from "./collect.js";
import { Expectations, type LookupSources, type Pending } from "./keep-expected.js";
import { writerFor } from "./keep-here.js";
import { NotKept } from "./keep-reasons.js";
import { atStoreKey, keepSeen, type Seen, seenOf } from "./keep-seen.js";
import { type DaemonWaits, KeepUnknown } from "./keep-sent.js";
import {
  changedAfterLoss,
  databasesOf,
  InputCheck,
  KEEP_BUSY_BOUND_MS,
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

/** One run's files that may be kept, and its reads to merge (row 020-39), until `flush` writes them. */
interface Queued {
  readonly files: readonly Kept[];
  readonly seen: readonly Seen[];
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
    this.#tellNotKept();
    const queued = this.#queued.splice(0);
    if (queued.length === 0) return;
    let left = queued.flatMap((q) => q.files).length;
    try {
      const steady: Queued[] = [];
      for (const q of queued) {
        const files = await this.#steady(q.pending, q.files);
        if (files.length > 0 || q.seen.length > 0) steady.push({ ...q, files });
      }
      left = steady.flatMap((q) => q.files).length;
      if (steady.length > 0) await this.#write(steady);
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
      let kept: { readonly files: readonly Kept[]; readonly seen: readonly Seen[] };
      try {
        kept = await this.#keepable(pending, run);
      } finally {
        pending.keys.endRun();
      }
      const { files, seen } = kept;
      if (files.length + seen.length > 0)
        this.#queued.push({ files, seen, report: run.report, pending });
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
   * Row 020-39: a file whose run read beyond its key, all of it known
   * before the run and held still, is kept at the key with those reads
   * (`atStoreKey`); the runs' reads are merged as the daemon's are (`seen`).
   */
  async #keepable(
    pending: Pending,
    run: GateRun,
  ): Promise<{ readonly files: Kept[]; readonly seen: Seen[] }> {
    const { report } = run;
    const completed = new Set(report.completedFiles.map(testFileId));
    const candidates: Kept[] = [];
    for (const [id, file] of pending.files) {
      const record = run.records.get(testFileId(file.ref))?.record ?? null;
      if (completed.has(id) && record !== null) candidates.push({ ...file, record });
    }
    if (candidates.length === 0) return { files: [], seen: [] };
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
      if (at === undefined) continue;
      const file = keeps(at.decision) ? atStoreKey(keys, before, c, at) : null;
      if (file !== null) kept.push(file);
      else this.#notKept.add(c.ref.path, at);
    }
    return { files: kept, seen: seenOf(keys, report, candidates, decided) };
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
   * B2): the opening check of `flush` no longer holds after a wait. Row
   * 020-39: the runs' reads are merged first, in one transaction tried as
   * the files' are (`keepSeen`). Row 020-48: where a daemon serves, it
   * merges them (row 021-20 sends it the writes); where none does, or one
   * before that row, a file kept at its grown key is told as not kept, as
   * before, and the others are written. With no file to write, the merge
   * takes one try and no wait: the next run merges again.
   */
  async #write(runs: readonly Queued[]): Promise<void> {
    const { root, commonDir, policy, daemonWaits } = this.#options;
    const now = this.#options.now ?? Date.now;
    const worktreeId = worktreeIdFor(root);
    const head = await this.#options.head();
    const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
    const seen = runs.flatMap((q) => q.seen);
    let queued = runs;
    let all = queued.flatMap((q) => q.files);
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
      const tell = (text: string) => this.#tell(text);
      const files = all.filter((file) => file.grown === undefined).length;
      const at = {
        commonDir,
        policy,
        worktreeId,
        now,
        daemonWaits,
        files,
        seen: seen.length,
        tell,
      };
      const chosen = writerFor(store, lock !== null, at);
      if (chosen === null) {
        this.#withoutGrown(runs);
        return;
      }
      code = chosen.code;
      const { writer } = chosen;
      const boundMs = this.#options.busyBoundMs ?? KEEP_BUSY_BOUND_MS;
      const wait = new StoreWait({ now, boundMs, tell: (text) => this.#tell(text) });
      const check = new InputCheck();
      const databases = databasesOf(commonDir);
      const giveUp = (database: AbsolutePath) =>
        all.length === 0 || wait.giveUp(database, all.slice(written + changed));
      const merge = { database: databases.main, giveUp, check };
      const merged = await keepSeen(writer, seen, merge);
      if (merged === "spent") {
        if (all.length > 0) this.#tell(wait.spent(all.length, 0));
        return;
      }
      if (merged === "older") {
        queued = this.#withoutGrown(runs);
        all = queued.flatMap((q) => q.files);
      }
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
      if (!wait.waited) this.#tellUnwaited(changed, held);
    } catch (error) {
      this.#tell(failed(all.length - written, error));
    } finally {
      this.#tellNotKept();
      code?.close();
      store?.close();
      lock?.release();
    }
  }

  /**
   * With no busy wait to tell them: the files that moved after a lost try
   * (review 0.1.450 R1-B2), and those a merge holds by their write (review
   * 0.1.458 B4), which a wait counts as moved; `held` is among `changed`.
   */
  #tellUnwaited(changed: number, held: readonly Kept[]): void {
    const lost = changed - held.length;
    if (lost > 0) this.#tell(changedAfterLoss(lost));
    for (const file of held) this.#notKept.add(file.ref.path, HELD);
  }

  #tellNotKept(): void {
    for (const line of this.#notKept.take()) this.#tell(line);
  }

  /**
   * `runs` without their files kept at a grown key, each told as not kept
   * for it (row 020-39), when no writer merged the reads that key holds:
   * no daemon serves, or one before row 020-48 does.
   */
  #withoutGrown(runs: readonly Queued[]): Queued[] {
    return runs.map((q) => {
      const files = q.files.filter((file) => {
        if (file.grown !== undefined) this.#notKept.add(file.ref.path, file.grown);
        return file.grown === undefined;
      });
      return { ...q, files };
    });
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

/** Why a file a merge holds by its write was not kept, as `NotKept` names it. */
const HELD = {
  cause: { kind: "held", paths: [] },
  reason: "a merge holds a path its key names",
} as const;

/** The note on the `left` files not written once `error` ended the writes. */
function failed(left: number, error: unknown): string {
  if (error instanceof KeepUnknown) return perhapsKept(left, error.message);
  return `${notKept(left)}: ${messageOf(error)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
