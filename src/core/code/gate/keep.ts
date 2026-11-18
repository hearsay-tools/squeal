import { randomUUID } from "node:crypto";
import type { Hasher } from "../../hash/hasher.js";
import { testFileId } from "../../keys/reverse-index.js";
import {
  keepDecisions,
  keeps,
  type MergeHoldSource,
  mergeHoldOf,
} from "../../run-evidence/run-evidence.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { GateRun } from "./collect.js";
import { Expectations, type LookupSources, type Pending, type Taken } from "./keep-expected.js";
import { type KeepOptions, messageOf, type Pass, type Queued, writePass } from "./keep-pass.js";
import { EarlyWrites, type PassEnd } from "./keep-queue.js";
import { NotKept } from "./keep-reasons.js";
import { atStoreKey, type Seen, seenOf } from "./keep-seen.js";
import { InputCheck, type Kept, keptCount } from "./keep-write.js";

export type { KeepOptions } from "./keep-pass.js";

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
 * D17.5 (row 020-28, #192): a busy store never delays the verdict.
 * Review 0.1.444 B2: once the store was busy, each file's inputs are read
 * again after every pause and before each of its writes. Row 020-59 (#201,
 * #202, #216): each run's decided files are written while the gate's other
 * runs go on (`EarlyWrites`), so a killed gate keeps what it wrote; a busy
 * store hands them back to a later pass, and only what is still queued
 * once the report is out waits the bound, in `flush`'s last pass.
 */

export class Keeper {
  readonly #options: KeepOptions;
  readonly #expected = new Expectations();
  readonly #queued: Queued[] = [];
  readonly #told = new Set<string>();
  /** Row 011-320: the merge hold, read at each decision and again at each write. */
  readonly #hold: MergeHoldSource;
  /** Row 011-320: the completed files not kept for their run's evidence, told at `flush`. */
  readonly #notKept = new NotKept();
  /** The files a pass did not keep for their write (a grown key, a merge hold), told after the last pass. */
  readonly #passNotKept = new NotKept();
  /** Row 020-59: the passes while the runs go on. */
  readonly #early: EarlyWrites;
  /** Owed from the first try that did not land, in any pass (review 0.1.444 B2). */
  readonly #check = new InputCheck();
  /** What the early passes would tell, told at `flush`: what no pass tells before the report. */
  readonly #deferred: string[] = [];
  /** How many files the early passes wrote. */
  #keptEarly = 0;
  /** Row 020-68: how many files the runs completed, each counted by the run that decides it. */
  #completed = 0;
  /** Row 020-68, review 0.1.508 B1: the files kept, and those a daemon may have kept. */
  readonly #tally = new KeptTally();

  constructor(options: KeepOptions) {
    this.#options = options;
    this.#hold = mergeHoldOf(options.root);
    this.#early = new EarlyWrites(() => this.#earlyPass(), options.pause);
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
   * one of its files (review 0.1.433 B2), and starts a pass that writes
   * them while the other runs go on, which this does not wait for (row
   * 020-59); a failure only costs the write.
   */
  async ran(run: GateRun): Promise<void> {
    for (const taken of this.#expected.take(run)) await this.#queue(taken, run);
    this.#early.kick();
  }

  /**
   * D17.5, once the report is out: ends the passes while the runs went on,
   * waiting only for the one writing, which gives up at its next busy
   * refusal; then writes what is still queued, waiting for a busy store
   * while writes land (row 020-67), and tells what was not kept; a failure
   * only costs the files not yet written, told once, and never throws.
   * Last, when a run completed a file, how many of them are kept (row
   * 020-68).
   */
  async flush(): Promise<void> {
    await this.#early.stop();
    this.#tellNotKept(this.#notKept);
    for (const text of this.#deferred.splice(0)) this.#tell(text);
    const queued = this.#queued.splice(0);
    if (queued.length > 0) this.#tally.heard(await writePass(queued, this.#pass(false)));
    this.#tellNotKept(this.#passNotKept);
    // Row 020-68 (#220): how many completed files are kept, so an agent knows what a rerun runs.
    if (this.#completed === 0) return;
    const counts = { completed: this.#completed, early: this.#keptEarly };
    this.#tell(keptCount({ ...counts, kept: this.#tally.kept, unknown: this.#tally.unknown }));
  }

  /**
   * Row 023-18 (D2): why each completed file was not kept, by path, for a
   * caller that reports files one by one (`squeal status --at --run`).
   */
  notKeptFiles(): ReadonlyMap<string, string> {
    return new Map([...this.#notKept.files(), ...this.#passNotKept.files()]);
  }

  /**
   * Review wave-11 B1: each file a pass wrote, with the key it was written
   * at, for a caller that reads its outcome back (`squeal status --at
   * --run`, proof sides); a file a daemon took without saying how it went
   * is not in it.
   */
  keptFiles(): readonly KeptAt[] {
    return this.#tally.files();
  }

  /** Ends what no run took, such as a runner the budget ended before, and drops the queue. */
  close(): void {
    void this.#early.stop();
    this.#expected.close();
    this.#queued.splice(0);
  }

  /** Row 020-59: one pass while the runs go on; what a busy store refused goes back to the queue's head. */
  async #earlyPass(): Promise<PassEnd> {
    const queued = this.#queued.splice(0);
    if (queued.length === 0) return "done";
    const pass = await writePass(queued, this.#pass(true));
    const { written, left } = pass;
    this.#keptEarly += written;
    this.#tally.heard(pass);
    if (left.length === 0) return "done";
    this.#queued.unshift(...left);
    return "left";
  }

  #pass(early: boolean) {
    return {
      options: this.#options,
      hold: this.#hold,
      notKept: this.#passNotKept,
      check: this.#check,
      tell: early
        ? (text: string) => this.#deferred.push(text)
        : (text: string) => this.#tell(text),
      early,
      keptEarly: this.#keptEarly,
    };
  }

  async #queue({ pending, endsRun }: Taken, run: GateRun): Promise<void> {
    try {
      let kept: { readonly files: readonly Kept[]; readonly seen: readonly Seen[] };
      try {
        kept = await this.#keepable(pending, run);
      } finally {
        if (endsRun) pending.keys.endRun();
      }
      const { files, seen } = kept;
      if (files.length + seen.length > 0) {
        this.#queued.push({
          files,
          seen,
          report: run.report,
          pending,
          runId: `gate-${randomUUID()}`,
        });
      }
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
    for (const id of pending.files.keys()) if (completed.has(id)) this.#completed += 1;
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

  #tellNotKept(notKept: NotKept): void {
    for (const line of notKept.take()) this.#tell(line);
  }

  #tell(text: string): void {
    if (this.#told.has(text)) return;
    this.#told.add(text);
    this.#options.note?.(text);
  }
}

/**
 * Review 0.1.508 B1: the files the keeper's passes kept, their results
 * written, and those a daemon took a write of without saying how it went.
 * A file a later pass wrote is kept, though an earlier try's outcome was
 * not known; one kept stays kept.
 */
/** Review wave-11 B1: one file a pass wrote: its test file and the key it holds its results at. */
export interface KeptAt {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
}

export class KeptTally {
  readonly #kept = new Set<string>();
  readonly #files = new Map<string, KeptAt>();
  readonly #unknown = new Set<string>();

  get kept(): number {
    return this.#kept.size;
  }

  get unknown(): number {
    return this.#unknown.size;
  }

  heard(pass: Pick<Pass, "kept" | "unknown">): void {
    for (const file of pass.kept ?? []) {
      this.#kept.add(fileOf(file));
      this.#files.set(fileOf(file), { ref: file.ref, key: file.key });
      this.#unknown.delete(fileOf(file));
    }
    for (const file of pass.unknown ?? []) {
      if (!this.#kept.has(fileOf(file))) this.#unknown.add(fileOf(file));
    }
  }

  /** The files kept, each at the key written. */
  files(): KeptAt[] {
    return [...this.#files.values()];
  }
}

/** One completed file, as the keeper counts it: its test file at its key. */
function fileOf(file: Kept): string {
  return `${testFileId(file.ref)}\0${file.key}`;
}
