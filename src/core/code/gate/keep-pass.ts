import { acquireDaemonLock } from "../../daemon/lock.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import { type MergeHoldSource, stillAsRead, unheldNow } from "../../run-evidence/run-evidence.js";
import { isStoreOpenFailure, openStore } from "../../store/open.js";
import { lockFileFor } from "../../store/paths.js";
import type { AbsolutePath, CommitSha, EpochMs } from "../../types/common.js";
import type { Policy } from "../../types/policy.js";
import type { RunReport } from "../../types/runner.js";
import type { Store } from "../../types/store.js";
import type { CodeStore } from "../store/types.js";
import type { Pending } from "./keep-expected.js";
import { writerFor } from "./keep-here.js";
import type { NotKept } from "./keep-reasons.js";
import { keepSeen, type Seen } from "./keep-seen.js";
import { type DaemonWaits, KeepUnknown } from "./keep-sent.js";
import {
  changedAfterLoss,
  databasesOf,
  type InputCheck,
  KEEP_BUSY_BOUND_MS,
  type KeepWriter,
  type Kept,
  keepFile,
  notKept,
  perhapsKept,
  StoreWait,
} from "./keep-write.js";

/*
 * Spec 020 D17.3, D17.5 as amended by row 020-59: one pass of the keeper's
 * writes over what is queued. Each file's record, then its results in one
 * transaction, under the worktree's daemon lock. A reader takes a file only
 * with both, so a stop between the two leaves a record no reader takes,
 * which prune removes. The stores are created as a daemon creates them.
 * Each write is one short transaction, retried in busy slices (`sliced`).
 *
 * An early pass runs while the gate's other runs go on: at the first write
 * a busy store refuses, or any failure, it hands back every file it has not
 * written, tells nothing of the wait, and its files wait for the next pass.
 * The last pass runs once the report is out: it waits for a busy store up
 * to one bound from the first write it refused (`StoreWait`), and tells
 * what was not kept. From the first try that did not land on, each file is
 * checked again before each of its writes and after every pause (review
 * 0.1.444 B2), in every later pass too (`InputCheck`). Row 020-39: the
 * runs' reads are merged first, in one transaction tried as the files' are
 * (`keepSeen`). Row 020-48: where a daemon serves, it merges them (row
 * 021-20 sends it the writes); where none does, or one before that row, a
 * file kept at its grown key is told as not kept, and the others are
 * written.
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
   * How long the last pass waits for a store whose write lock another
   * connection holds, from the first write it refused, before the files
   * still queued are not kept; default `KEEP_BUSY_BOUND_MS` (D17.5).
   */
  readonly busyBoundMs?: number;
  /** How long a daemon that writes the files is waited for; default `DAEMON_WAITS` (review 0.1.450 B2). */
  readonly daemonWaits?: DaemonWaits;
}

/** One run's files that may be kept, and its reads to merge (row 020-39), until a pass writes them. */
export interface Queued {
  readonly files: readonly Kept[];
  readonly seen: readonly Seen[];
  readonly report: RunReport;
  readonly pending: Pending;
  /** The run id of its results' provenance, one per run whichever pass writes them. */
  readonly runId: string;
  /** Whether its files passed the opening input check of a pass (D17.5). */
  readonly checked?: true;
}

/** What one pass shares with the keeper. */
export interface PassContext {
  readonly options: KeepOptions;
  readonly hold: MergeHoldSource;
  readonly notKept: NotKept;
  /** Owed from the first try that did not land, in any pass. */
  readonly check: InputCheck;
  readonly tell: (text: string) => void;
  /** An early pass: a busy store or a failure ends it, and what it did not write is handed back. */
  readonly early: boolean;
  /** How many files earlier passes wrote: the last pass's wait names them. */
  readonly keptEarly: number;
}

/** What a pass wrote, and, of an early pass, what it hands back. */
export interface Pass {
  readonly written: number;
  readonly left: readonly Queued[];
}

/**
 * One pass over `runs`; it never throws. An early pass that cannot write
 * (its opening check or any step fails, or no writer is usable: the
 * worktree's lock is held with no fresh daemon to send to) hands back
 * every run it did not write, whole, its reads and grown-key files
 * included, and tells nothing (review 0.1.495 B1, B3). A run handed back
 * that way is checked again at its next pass (`unchecked`): its inputs
 * and the merge hold.
 */
export async function writePass(runs: readonly Queued[], at: PassContext): Promise<Pass> {
  const { root, commonDir } = at.options;
  let state: PassState | null = null;
  let store: Store | null = null;
  let code: CodeStore | null = null;
  let lock: ReturnType<typeof acquireDaemonLock> = null;
  try {
    const opened = await openingCheck(runs, at);
    if (opened.length === 0) return { written: 0, left: [] };
    state = new PassState(opened);
    const head = await at.options.head();
    lock = acquireDaemonLock(lockFileFor(commonDir, worktreeIdFor(root)));
    const open = openStore(commonDir);
    if (isStoreOpenFailure(open)) throw new Error(`the store did not open: ${open.reason}`);
    store = open;
    const chosen = chooseWriter(store, lock !== null, state, at);
    if (chosen === null) {
      return at.early ? { written: 0, left: unchecked(state.left()) } : { written: 0, left: [] };
    }
    code = chosen.code;
    return await writeQueued(state, { store, writer: chosen.writer, head }, at);
  } catch (error) {
    const written = state?.written ?? 0;
    if (at.early) return { written, left: unchecked(state === null ? runs : state.left()) };
    const all = state?.all.length ?? runs.flatMap((q) => q.files).length;
    at.tell(failed(all - written, error));
    return { written, left: [] };
  } finally {
    code?.close();
    store?.close();
    lock?.release();
  }
}

/** `runs` with their opening check owed again, at the next pass. */
function unchecked(runs: readonly Queued[]): Queued[] {
  return runs.map(({ checked: _, ...q }) => q);
}

/** Where a pass is in its runs, and what it wrote. */
class PassState {
  queued: readonly Queued[];
  all: readonly Kept[];
  written = 0;
  changed = 0;
  merged = false;
  /** The files a merge held by their write: among `changed`. */
  readonly held: Kept[] = [];
  /** The queued run, and its next file. */
  cursor = { run: 0, file: 0 };

  constructor(queued: readonly Queued[]) {
    this.queued = queued;
    this.all = queued.flatMap((q) => q.files);
  }

  /** The runs left from the cursor on, with their reads while they were not merged. */
  left(): Queued[] {
    const { run, file } = this.cursor;
    return this.queued.flatMap((q, i) => {
      if (i < run) return [];
      const files = i === run ? q.files.slice(file) : q.files;
      const seen = this.merged ? [] : q.seen;
      return files.length + seen.length === 0 ? [] : [{ ...q, files, seen }];
    });
  }

  /** Only the files not kept at a grown key (row 020-39), each other told as not kept. */
  withoutGrown(notKept: NotKept): void {
    this.queued = withoutGrown(this.queued, notKept);
    this.all = this.queued.flatMap((q) => q.files);
  }
}

/**
 * The pass's writer (`writerFor`); `null` when none writes. The last pass
 * then tells its files as not kept; an early one tells nothing and leaves
 * its runs whole, to be tried again (review 0.1.495 B1).
 */
function chooseWriter(
  store: Store,
  locked: boolean,
  state: PassState,
  at: PassContext,
): ReturnType<typeof writerFor> {
  const { commonDir, policy, daemonWaits, root } = at.options;
  const now = at.options.now ?? Date.now;
  const seen = state.queued.flatMap((q) => q.seen).length;
  const files = state.all.filter((file) => file.grown === undefined).length;
  const worktreeId = worktreeIdFor(root);
  const writing = { commonDir, policy, worktreeId, now, daemonWaits, files, seen };
  const tell = at.early ? () => {} : at.tell;
  const chosen = writerFor(store, locked, { ...writing, tell, early: at.early });
  if (chosen === null && !at.early) state.withoutGrown(at.notKept);
  return chosen;
}

/** The runs' reads, then each file, by `writer`. */
async function writeQueued(
  state: PassState,
  opened: {
    readonly store: Store;
    readonly writer: KeepWriter;
    readonly head: { readonly head: CommitSha; readonly dirty: boolean };
  },
  at: PassContext,
): Promise<Pass> {
  const { store, writer, head } = opened;
  const { commonDir, root } = at.options;
  const now = at.options.now ?? Date.now;
  const { tell, check } = at;
  const boundMs = at.early ? 0 : (at.options.busyBoundMs ?? KEEP_BUSY_BOUND_MS);
  const quiet = at.early ? () => {} : tell;
  const wait = new StoreWait({ now, boundMs, tell: quiet, keptEarly: at.keptEarly });
  const databases = databasesOf(commonDir);
  const giveUp = (database: AbsolutePath) =>
    at.early ||
    state.all.length === 0 ||
    wait.giveUp(database, state.all.slice(state.written + state.changed));
  const spent = (): Pass => {
    if (at.early) return { written: state.written, left: state.left() };
    if (state.all.length > 0) tell(wait.spent(state.all.length - state.written, state.changed));
    return { written: state.written, left: [] };
  };
  const seen = state.queued.flatMap((q) => q.seen);
  const merged = await keepSeen(writer, seen, { database: databases.main, giveUp, check });
  if (merged === "spent") return spent();
  state.merged = true;
  if (merged === "older") state.withoutGrown(at.notKept);
  const worktreeId = worktreeIdFor(root);
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  let freed = false;
  for (const [i, { files, report, pending, runId }] of state.queued.entries()) {
    const commit = { commit: head.head, dirty: head.dirty };
    const provenance = { worktreeId, revision, ...commit, runId, recordedAt: now() };
    const stores = { store, keys: pending.keys, writer };
    for (const [j, file] of files.entries()) {
      state.cursor = { run: i, file: j };
      const steady = async () =>
        (await stillAsRead(pending.snapshot, [file], pending.hasher)).length > 0;
      const unheld = async () => {
        const free = (await unheldNow(at.hold, [file])).length > 0;
        if (!free) state.held.push(file);
        return free;
      };
      const one = { file, report, provenance, databases, giveUp, check, steady, unheld };
      const outcome = await keepFile(stores, one);
      if (outcome === "spent") return spent();
      if (outcome === "changed") state.changed += 1;
      else {
        state.written += 1;
        freed ||= wait.waited;
      }
    }
  }
  state.cursor = { run: state.queued.length, file: 0 };
  const { written, changed, held } = state;
  wait.done({ written, changed, freed });
  if (!wait.waited) tellUnwaited(changed, held, at);
  return { written, left: [] };
}

/**
 * The runs of `runs` with only the files that may still be written at a
 * pass's opening check, each run checked once: their inputs hold the
 * bytes the run read (D17.5), and no merge holds one of them now (row
 * 011-320). `keepFile` reads the hold again before every try (review
 * 0.1.458 B4), and the inputs once a try did not land.
 */
async function openingCheck(runs: readonly Queued[], at: PassContext): Promise<Queued[]> {
  const steady: Queued[] = [];
  for (const q of runs) {
    let files = q.files;
    if (q.checked === undefined) {
      const still = await stillAsRead(q.pending.snapshot, q.files, q.pending.hasher);
      files = still.length === 0 ? still : await unheldNow(at.hold, still);
    }
    if (files.length > 0 || q.seen.length > 0) steady.push({ ...q, files, checked: true });
  }
  return steady;
}

/**
 * With no busy wait to tell them: the files that moved after a lost try
 * (review 0.1.450 R1-B2), in the last pass, and those a merge holds by their write (review
 * 0.1.458 B4), which a wait counts as moved; `held` is among `changed`.
 */
function tellUnwaited(changed: number, held: readonly Kept[], at: PassContext): void {
  const lost = changed - held.length;
  // Row 020-59: a file moved after a busy store's refusal in an early pass is dropped as the
  // opening check drops one; one moved after a try a daemon never received is told.
  if (lost > 0 && at.check.lost) at.tell(changedAfterLoss(lost));
  for (const file of held) at.notKept.add(file.ref.path, HELD);
}

/**
 * `runs` without their files kept at a grown key, each told as not kept
 * for it (row 020-39), when no writer merged the reads that key holds:
 * no daemon serves, or one before row 020-48 does.
 */
export function withoutGrown(runs: readonly Queued[], notKept: NotKept): Queued[] {
  return runs.map((q) => {
    const files = q.files.filter((file) => {
      if (file.grown !== undefined) notKept.add(file.ref.path, file.grown);
      return file.grown === undefined;
    });
    return { ...q, files };
  });
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

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
