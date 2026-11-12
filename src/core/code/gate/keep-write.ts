import { compare } from "../../fs/compare.js";
import { checkId } from "../../scheduler/files.js";
import { healsUnheld } from "../../scheduler/hold.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { recordsForFile } from "../../scheduler/records.js";
import { storeResults } from "../../scheduler/store-results.js";
import { describeFailure } from "../../state/fingerprint.js";
import { describeHolders, lockHolders } from "../../store/lock-holders.js";
import { storePaths } from "../../store/paths.js";
import { slicedWrite } from "../../store/sliced-write.js";
import type { AbsolutePath, EpochMs } from "../../types/common.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import type { Provenance } from "../../types/store-records.js";
import { shareRecord } from "../coverage/parts.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import type { CoverageRecord } from "../coverage/types.js";
import { codeStorePath } from "../store/open.js";
import type { CodeStore } from "../store/types.js";
import type { Expected } from "./keep-expected.js";

/*
 * Spec 020 D17.5 (row 020-28, #192): how the keeper writes its files once
 * the report is out. Each write is one short transaction, tried again in
 * busy slices (`slicedWrite`), never held across an await. One bound
 * counts from the first write a busy store refused; stderr names the files
 * that wait and the process that holds the write lock (spec 021 D5) before
 * the wait, and what was not kept when the bound runs out.
 */

/** D17.5: how long the keeper waits for a busy store, from the first write it refused. */
export const KEEP_BUSY_BOUND_MS = 30_000;

/** A completed file that may be written. */
export interface Kept extends Expected {
  readonly record: CoverageRecord;
}

/** How many file names a note lists before it counts the rest. */
const NAMED = 5;

/**
 * D17.5's one wait over the keeper's writes: started by the first write a
 * busy store refused, told once then, and spent `boundMs` later.
 */
export class StoreWait {
  readonly #options: StoreWaitOptions;
  #since: EpochMs | null = null;
  #database: AbsolutePath | null = null;

  constructor(options: StoreWaitOptions) {
    this.#options = options;
  }

  /**
   * Asked after each try that `database` refused as busy: whether the
   * bound is spent. The first names the files of `left` and the lock's
   * holder before the wait.
   */
  giveUp(database: AbsolutePath, left: readonly Kept[]): boolean {
    const { now, boundMs, tell } = this.#options;
    this.#database = database;
    if (this.#since === null) {
      this.#since = now();
      const wait = `waiting up to ${seconds(boundMs)} s to keep ${completed(left.length)}`;
      tell(`the store is busy (${holderOf(database)}); ${wait}: ${names(left)}`);
    }
    return now() - this.#since >= boundMs;
  }

  /** The note once every file is written: after a wait only, how long it took. */
  done(written: number): void {
    const { now, tell } = this.#options;
    if (this.#since === null || written === 0) return;
    tell(`the store was free after ${seconds(now() - this.#since)} s: ${completed(written)} kept`);
  }

  /** The note when the bound ran out with `left` files not written. */
  spent(left: number): string {
    const busy = this.#database === null ? "" : ` (${holderOf(this.#database)})`;
    const again = `the next run will run ${left === 1 ? "it" : "them"} again`;
    return `${notKept(left)}: the store stayed busy for ${seconds(this.#options.boundMs)} s${busy}; ${again}`;
  }
}

export interface StoreWaitOptions {
  readonly now: () => EpochMs;
  readonly boundMs: number;
  readonly tell: (text: string) => void;
}

/** The databases a file's write touches, as `lockHolders` reads them. */
export function databasesOf(commonDir: AbsolutePath): {
  readonly main: AbsolutePath;
  readonly code: AbsolutePath;
} {
  return { main: storePaths(commonDir).database, code: codeStorePath(commonDir) };
}

/**
 * One file's record at its key, then its results there, as the daemon's
 * tier record stores them; `false` once `giveUp`, asked with the database
 * after each busy try, says so, before its results were written.
 */
export async function keepFile(
  stores: { readonly store: Store; readonly code: CodeStore; readonly keys: WorktreeKeys },
  at: {
    readonly file: Kept;
    readonly report: RunReport;
    readonly provenance: Provenance;
    readonly now: () => EpochMs;
    readonly databases: ReturnType<typeof databasesOf>;
    readonly giveUp: (database: AbsolutePath) => boolean;
  },
): Promise<boolean> {
  const { store, code, keys } = stores;
  const { file, report, provenance, now, databases, giveUp } = at;
  const recordKey = { resultKey: file.key, providerVersion: COVERAGE_RECORD_VERSION };
  const shared = shareRecord(file.record, COVERAGE_RECORD_VERSION);
  // One transaction in busy slices; `false` once `giveUp` says so.
  const written = async (database: AbsolutePath, write: () => unknown) => {
    const wrote = () => {
      write();
      return true;
    };
    return (await slicedWrite(wrote, () => giveUp(database))) === true;
  };
  const put = () => code.coverage.putParts(recordKey, shared, now());
  if (!(await written(databases.code, put))) return false;
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
  const results = () => storeResults(context, records, healsUnheld(store, file.paths));
  return written(databases.main, results);
}

/** The start of a note on `count` completed test files that were not kept. */
export function notKept(count: number): string {
  return `${completed(count)} ${count === 1 ? "was" : "were"} not kept in the stores`;
}

function completed(count: number): string {
  return `${count} completed test ${count === 1 ? "file" : "files"}`;
}

/**
 * Spec 021 D5: who holds `database`'s write lock, read from `/proc` only.
 * It opens no descriptor of the store's files, so this process's own locks
 * on them stay (the store's coordinator, 2026-11-12).
 */
function holderOf(database: AbsolutePath): string {
  return describeHolders(lockHolders(database));
}

/** The paths of `files` in order, the first `NAMED` of them, then how many more. */
function names(files: readonly Kept[]): string {
  const shown = files
    .map((f) => f.ref.path)
    .sort(compare)
    .slice(0, NAMED);
  const more = files.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

function seconds(ms: number): number {
  return Number((ms / 1000).toFixed(1));
}
