import type { UnknownCause } from "../../types/code-delivery.js";
import type { EpochMs, RelativePath, WorktreeId } from "../../types/common.js";
import type { CheckKey, TestFileRef } from "../../types/keys.js";
import type { ClosureIndex } from "../../types/scheduler.js";
import type { Store } from "../../types/store.js";
import type { TestFileKeyRecord } from "../../types/store-records.js";
import { COVERAGE_RECORD_VERSION } from "../coverage/record.js";
import { IN_PROCESS_ENVIRONMENTS, RECORDING_RUNNERS } from "../coverage/runtime.js";
import { RESULT_WAITS_MS } from "../coverage/writer.js";
import type { CodeCoverageRepo } from "../store/types.js";
import type { LoaderMap } from "./loader-map.js";

/*
 * Spec 015 D9: the test files that load each source, by this worktree's own
 * closures (011 C3's key index, which the daemon's scheduler keeps), and
 * whether each has a current result with a coverage record. The main
 * store's closure of a test file is the newest any worktree stored, so it
 * can be another branch's (review 0.1.297 B3).
 */

/** Why a loader can have no record now: one union with the delivery's count by cause. */
export type { UnknownCause };

/**
 * Why a loader is not ready yet: `imports`, its closure is not known here,
 * so it may load any source; `run`, no current result at its key;
 * `record`, a result whose record may still come.
 */
export type PendingReason = "imports" | "run" | "record";

/**
 * One loader's condition: ready with a record, waiting for one, or unable
 * to have one. A ready one names the record by when it was stored (row
 * 015-44); one whose runner gives no records names it (row 015-75).
 */
export type LoaderCondition =
  | { readonly kind: "ready"; readonly key: CheckKey; readonly storedAt: EpochMs }
  | { readonly kind: "pending"; readonly reason: PendingReason; readonly until?: EpochMs }
  | { readonly kind: "unknown"; readonly cause: UnknownCause; readonly runner?: string };

export interface Loader {
  readonly testFile: TestFileRef;
  readonly condition: LoaderCondition;
}

/** Each source path's loaders, and the earliest time a waiting record turns `unknown`. */
export interface Loaders {
  /** The worktree has test files listed; before that no source can be judged. */
  readonly listed: boolean;
  readonly of: (path: RelativePath) => readonly Loader[];
  /** Listed test files whose closure is not known here: each is a loader of every source. */
  readonly withoutImports: number;
  readonly wakeAt: EpochMs | null;
}

/**
 * How long a current result may wait for its record: the writer's last
 * look for the result, from the mapping's end (`RESULT_WAITS_MS`).
 */
export const RECORD_WAIT_MS = RESULT_WAITS_MS.reduce((a: number, b) => a + b, 0);

/**
 * How long a record past its wait is waited for while the writer has work
 * in hand: a stored record nudges sooner (review 0.1.297 S1).
 */
export const BUSY_RECHECK_MS = 5_000;

export interface LoaderInputs {
  readonly main: Pick<Store, "testFileKeys" | "results">;
  /** This worktree's own closures; `null` while its scheduler has not started. */
  readonly closures: ClosureIndex | null;
  readonly coverage: Pick<CodeCoverageRepo, "storedAt">;
  readonly worktreeId: WorktreeId;
  readonly now: EpochMs;
  /** The records' writer has payloads to map or results to wait for. */
  readonly writing: boolean;
  /** Conditions that cannot change at a key, kept across reads by the caller. */
  readonly settled?: Map<CheckKey, LoaderCondition>;
}

/** The condition of one test file at its current key. */
function conditionAt(
  inputs: LoaderInputs,
  testFile: TestFileRef,
  key: CheckKey | null,
  queued: boolean,
): LoaderCondition {
  if (key === null) return { kind: "unknown", cause: "unkeyed" };
  if (queued) return { kind: "pending", reason: "run" };
  const record = { resultKey: key, providerVersion: COVERAGE_RECORD_VERSION };
  const keep = (condition: LoaderCondition) => {
    inputs.settled?.set(key, condition);
    return condition;
  };
  const settled = inputs.settled?.get(key);
  if (settled?.kind === "ready") {
    // Row 015-44: a later run at the key may have stored its record over the one it names.
    const storedAt = inputs.coverage.storedAt(record);
    if (storedAt === settled.storedAt) return settled;
    if (storedAt !== null) return keep({ kind: "ready", key, storedAt });
    inputs.settled?.delete(key);
  } else if (settled !== undefined) return settled;
  const results = inputs.main.results
    .byKey(key, 0)
    .filter((r) => r.check.project === testFile.project && r.check.testPath === testFile.path);
  if (results.length === 0) return { kind: "pending", reason: "run" };
  if (results.some((r) => r.outcome === "skip")) return keep({ kind: "unknown", cause: "skipped" });
  const storedAt = inputs.coverage.storedAt(record);
  if (storedAt !== null) return keep({ kind: "ready", key, storedAt });
  const stored = Math.max(...results.map((r) => r.provenance.recordedAt));
  const until = stored + RECORD_WAIT_MS;
  if (until > inputs.now) return { kind: "pending", reason: "record", until };
  if (inputs.writing) {
    return { kind: "pending", reason: "record", until: inputs.now + BUSY_RECHECK_MS };
  }
  return { kind: "unknown", cause: "no-record" };
}

/** A test file whose closure is not known here waits for it. */
const IMPORTS: LoaderCondition = { kind: "pending", reason: "imports" };

/**
 * Spec 015 D9: every listed test file of the worktree with its own closure
 * and condition. A test file whose closure is not known here may load any
 * source, so it is a pending loader of each until its closure comes; one
 * whose key the main store's row does not hold yet waits for that row.
 *
 * Row 015-45 (review 0.1.305 S1): it is read a test file at a time, so a
 * step reads it within its budget: the listing is one unit, and each test
 * file's result lookups are one more. The map is given out only once every
 * listed test file is read, so no step judges from part of it. Its inputs
 * are those of its start.
 *
 * Row 021-31 (D21.4): it reads into `map`, kept across reads, which moves
 * only the sources of a test file whose closure or condition changed.
 */
export class LoaderBuild {
  readonly #inputs: LoaderInputs;
  readonly #map: LoaderMap;
  #rows: readonly TestFileKeyRecord[] | null = null;
  #next = 0;
  #wakeAt: EpochMs | null = null;

  constructor(inputs: LoaderInputs, map: LoaderMap) {
    this.#inputs = inputs;
    this.#map = map;
    map.begin();
  }

  /** Reads one unit each time `work` allows; the whole map once every test file is read, else `null`. */
  advance(work: () => boolean): Loaders | null {
    const { main, worktreeId } = this.#inputs;
    if (this.#rows === null) {
      if (!work()) return null;
      this.#rows = main.testFileKeys.list(worktreeId);
    }
    for (; this.#next < this.#rows.length; this.#next++) {
      const row = this.#rows[this.#next];
      if (row === undefined || !work()) return null;
      this.#read(row);
    }
    const map = this.#map;
    const listed = this.#rows.length > 0;
    map.end(listed);
    return {
      listed,
      of: (path) => map.of(path),
      withoutImports: map.withoutImports,
      wakeAt: this.#wakeAt,
    };
  }

  #read(row: TestFileKeyRecord): void {
    const inputs = this.#inputs;
    const paths = inputs.closures?.closure(row.testFile)?.paths;
    if (paths === undefined) {
      this.#map.place(row.testFile, IMPORTS, undefined, undefined);
      return;
    }
    // Row 015-75: a runner without records gives none at any key. Rows 015-75 and 015-86: a
    // project's environment that runs in each of its test files' processes is loaded by each.
    const environment = inputs.closures?.environment?.(row.testFile.project);
    const unrecorded = environment !== undefined && !RECORDING_RUNNERS.has(environment.runner);
    const inProcess = environment !== undefined && IN_PROCESS_ENVIRONMENTS.has(environment.runner);
    const condition: LoaderCondition = unrecorded
      ? { kind: "unknown", cause: "no-record", runner: environment.runner }
      : inputs.closures?.key(row.testFile) === row.key
        ? conditionAt(inputs, row.testFile, row.key, row.pending !== null)
        : { kind: "pending", reason: "run" };
    if (condition.kind === "pending" && condition.until !== undefined) {
      this.#wakeAt = Math.min(this.#wakeAt ?? condition.until, condition.until);
    }
    this.#map.place(row.testFile, condition, paths, inProcess ? environment.files : undefined);
  }
}
