import { randomUUID } from "node:crypto";
import { acquireDaemonLock } from "../../daemon/lock.js";
import { worktreeIdFor } from "../../fs/git-layout.js";
import type { Hasher } from "../../hash/hasher.js";
import type { StatCache } from "../../hash/stat-cache.js";
import { testFileId } from "../../keys/reverse-index.js";
import { checkId } from "../../scheduler/files.js";
import { healsUnheld } from "../../scheduler/hold.js";
import type { WorktreeKeys } from "../../scheduler/keying.js";
import { observedGrowth } from "../../scheduler/observed.js";
import { recordsForFile } from "../../scheduler/records.js";
import { changedSince, snapshotInputs } from "../../scheduler/stability.js";
import { storeResults } from "../../scheduler/store-results.js";
import { describeFailure } from "../../state/fingerprint.js";
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
import { refKey } from "./records.js";

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

export interface KeepOptions {
  readonly root: AbsolutePath;
  /** The repository's git common directory, which holds the stores. */
  readonly commonDir: AbsolutePath;
  /** The policy the keys take; the code store opens only with `complexity.enabled`. */
  readonly policy: Policy;
  /** The commit the runs ran at and whether the tree was dirty: the results' provenance. */
  readonly head: () => Promise<{ readonly head: CommitSha; readonly dirty: boolean }>;
  /** Why a run's files were not kept, told once each. */
  readonly note: (text: string) => void;
  readonly now?: () => EpochMs;
}

/** A file a lookup keyed and found nothing for: it runs, and may be kept. */
interface Expected {
  readonly ref: TestFileRef;
  readonly key: CheckKey;
  /** What its stability check compares: its closure, its environment files, its lockfile. */
  readonly paths: readonly RelativePath[];
}

/** One runner's files about to run, with their inputs as the lookup found them. */
interface Pending {
  readonly keys: WorktreeKeys;
  readonly hasher: Hasher;
  /** `WorktreeKeys.beginRun`'s number, for the reads first hashed after it. */
  readonly run: number;
  readonly snapshot: StatCache;
  readonly files: ReadonlyMap<string, Expected>;
}

/** A completed file that may be written. */
interface Kept extends Expected {
  readonly record: CoverageRecord;
}

export class Keeper {
  readonly #options: KeepOptions;
  readonly #pending = new Map<GateRun["runner"], Pending>();
  readonly #told = new Set<string>();

  constructor(options: KeepOptions) {
    this.#options = options;
  }

  /**
   * Before `runner`'s run: the files of `keyed` it will run, each at the
   * key the lookup gave it. Their inputs are copied from the stat cache
   * now, as the daemon copies a tier's when it selects it.
   */
  expect(
    runner: GateRun["runner"],
    keys: WorktreeKeys,
    hasher: Hasher,
    keyed: ReadonlyMap<TestFileRef, CheckKey>,
  ): void {
    const files = new Map<string, Expected>();
    for (const [ref, key] of keyed) {
      files.set(testFileId(ref), { ref, key, paths: keys.stabilityPaths(ref) });
    }
    if (files.size === 0) return;
    const paths = new Set([...files.values()].flatMap((f) => f.paths));
    const snapshot = snapshotInputs(keys.cache, paths);
    this.#pending.set(runner, { keys, hasher, run: keys.beginRun(), snapshot, files });
  }

  /** After `run`: writes each file `expect` named that it may keep; a failure only costs the write. */
  async ran(run: GateRun): Promise<void> {
    const pending = this.#pending.get(run.runner);
    if (pending === undefined) return;
    this.#pending.delete(run.runner);
    let kept: readonly Kept[];
    try {
      kept = await this.#keepable(pending, run);
    } finally {
      pending.keys.endRun();
    }
    if (kept.length > 0) await this.#write(kept, run.report, pending.keys);
  }

  /**
   * The completed files with a record, whose run read nothing beyond their
   * key (`observedGrowth`), loaded no environment file their project's
   * keys lack, and whose inputs did not change during it (`changedSince`).
   */
  async #keepable(pending: Pending, run: GateRun): Promise<Kept[]> {
    const { report } = run;
    const completed = new Set(report.completedFiles.map(testFileId));
    const candidates: Kept[] = [];
    for (const [id, file] of pending.files) {
      const record = run.records.get(refKey(file.ref))?.record ?? null;
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
    return candidates.filter(
      (c) =>
        !grown.has(testFileId(c.ref)) &&
        !environment.has(c.ref.project) &&
        !c.paths.some((path) => moved.changed.has(path)),
    );
  }

  /**
   * Each file's record, then its results in one transaction, under the
   * worktree's daemon lock. A reader takes a file only with both, so a
   * stop between the two leaves a record no reader takes, which prune
   * removes. The stores are created as a daemon creates them.
   */
  async #write(files: readonly Kept[], report: RunReport, keys: WorktreeKeys): Promise<void> {
    const { root, commonDir, policy } = this.#options;
    const now = this.#options.now ?? Date.now;
    const worktreeId = worktreeIdFor(root);
    const head = await this.#options.head();
    const lock = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
    if (lock === null) {
      this.#tell("a daemon runs in this worktree, so the gate keeps no results in the stores");
      return;
    }
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
      for (const file of files) keepFile(store, code, keys, { file, report, provenance, now });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.#tell(`the gate kept no more results in the stores: ${why}`);
    } finally {
      code?.close();
      store?.close();
      lock.release();
    }
  }

  #tell(text: string): void {
    if (this.#told.has(text)) return;
    this.#told.add(text);
    this.#options.note(text);
  }
}

/** One file's record at its key, then its results there, as the daemon's tier record stores them. */
function keepFile(
  store: Store,
  code: CodeStore,
  keys: WorktreeKeys,
  at: {
    readonly file: Kept;
    readonly report: RunReport;
    readonly provenance: Provenance;
    readonly now: () => EpochMs;
  },
): void {
  const { file, report, provenance, now } = at;
  const recordKey = { resultKey: file.key, providerVersion: COVERAGE_RECORD_VERSION };
  code.coverage.putParts(recordKey, shareRecord(file.record, COVERAGE_RECORD_VERSION), now());
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
  storeResults(context, records, healsUnheld(store, file.paths));
}
