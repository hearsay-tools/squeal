import type {
  CheckKey,
  ClosureIndex,
  EpochMs,
  RelativePath,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  WorktreeId,
} from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION } from "../coverage/record.js";
import { RESULT_WAITS_MS } from "../coverage/writer.js";
import type { CodeCoverageRepo } from "../store/types.js";

/*
 * Spec 015 D9: the test files that load each source, by this worktree's own
 * closures (011 C3's key index, which the daemon's scheduler keeps), and
 * whether each has a current result with a coverage record. The main
 * store's closure of a test file is the newest any worktree stored, so it
 * can be another branch's (review 0.1.297 B3).
 */

/** Why a loader can have no record now, so the sources it loads read `unknown` (D9). */
export type UnknownCause =
  /** Its current result has no record and none is coming: D8's skips, a focused run, a runner without coverage. */
  | "no-record"
  /** A test at its key was skipped, so its record cannot show what that test runs. */
  | "skipped"
  /** It has no key: its closure or its project's environment is not known. */
  | "unkeyed"
  /** Its record names the source among those whose bytes it could not confirm. */
  | "unread";

/**
 * Why a loader is not ready yet: `imports`, its closure is not known here,
 * so it may load any source; `run`, no current result at its key;
 * `record`, a result whose record may still come.
 */
export type PendingReason = "imports" | "run" | "record";

/**
 * One loader's condition: ready with a record, waiting for one, or unable
 * to have one. A ready one names the record by when it was stored (row
 * 015-44).
 */
export type LoaderCondition =
  | { readonly kind: "ready"; readonly key: CheckKey; readonly storedAt: EpochMs }
  | { readonly kind: "pending"; readonly reason: PendingReason; readonly until?: EpochMs }
  | { readonly kind: "unknown"; readonly cause: UnknownCause };

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
  const record = { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION };
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

/**
 * Spec 015 D9: every listed test file of the worktree with its own closure
 * and condition. A test file whose closure is not known here may load any
 * source, so it is a pending loader of each until its closure comes; one
 * whose key the main store's row does not hold yet waits for that row.
 *
 * Row 015-45 (review 0.1.305 S1): it is read a test file at a time, so a
 * step reads it within its budget: the listing is one unit, and each test
 * file's result lookups and closure walk are one more. The map is given out
 * only once every listed test file is read, so no step judges from part of
 * it. Its inputs are those of its start.
 */
export class LoaderBuild {
  readonly #inputs: LoaderInputs;
  #rows: readonly TestFileKeyRecord[] | null = null;
  #next = 0;
  readonly #byPath = new Map<RelativePath, Loader[]>();
  readonly #everywhere: Loader[] = [];
  #wakeAt: EpochMs | null = null;

  constructor(inputs: LoaderInputs) {
    this.#inputs = inputs;
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
    const byPath = this.#byPath;
    const everywhere = this.#everywhere;
    return {
      listed: this.#rows.length > 0,
      of: (path) => {
        const own = byPath.get(path) ?? [];
        return everywhere.length === 0 ? own : [...own, ...everywhere];
      },
      withoutImports: everywhere.length,
      wakeAt: this.#wakeAt,
    };
  }

  #read(row: TestFileKeyRecord): void {
    const inputs = this.#inputs;
    const paths = inputs.closures?.closure(row.testFile)?.paths;
    if (paths === undefined) {
      this.#everywhere.push({
        testFile: row.testFile,
        condition: { kind: "pending", reason: "imports" },
      });
      return;
    }
    const condition =
      inputs.closures?.key(row.testFile) === row.key
        ? conditionAt(inputs, row.testFile, row.key, row.pending !== null)
        : ({ kind: "pending", reason: "run" } as const);
    if (condition.kind === "pending" && condition.until !== undefined) {
      this.#wakeAt = Math.min(this.#wakeAt ?? condition.until, condition.until);
    }
    const loader = { testFile: row.testFile, condition };
    for (const path of paths) {
      if (path === row.testFile.path) continue;
      const list = this.#byPath.get(path);
      if (list === undefined) this.#byPath.set(path, [loader]);
      else list.push(loader);
    }
  }
}
