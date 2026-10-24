import { testFileId } from "../../keys/index.js";
import type {
  CheckKey,
  EpochMs,
  RelativePath,
  Store,
  TestFileRef,
  WorktreeId,
} from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION } from "../coverage/record.js";
import { RESULT_WAITS_MS } from "../coverage/writer.js";
import type { CodeCoverageRepo } from "../store/types.js";

/*
 * Spec 015 D9: the test files that load each source, by the closures the
 * main store keeps (011 C3's reverse index, stored per test file), and
 * whether each has a current result with a coverage record. Read from the
 * stores, so it needs no daemon.
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

/** One loader's condition: ready with a record, waiting for one, or unable to have one. */
export type LoaderCondition =
  | { readonly kind: "ready"; readonly key: CheckKey }
  | { readonly kind: "pending"; readonly reason: "run" | "record"; readonly until?: EpochMs }
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
  readonly wakeAt: EpochMs | null;
}

/**
 * How long a current result may wait for its record: the writer's last
 * look for the result, from the mapping's end (`RESULT_WAITS_MS`).
 */
export const RECORD_WAIT_MS = RESULT_WAITS_MS.reduce((a: number, b) => a + b, 0);

export interface LoaderInputs {
  readonly main: Pick<Store, "testFileKeys" | "testFiles" | "results">;
  readonly coverage: Pick<CodeCoverageRepo, "has">;
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
  const settled = inputs.settled?.get(key);
  if (settled !== undefined) return settled;
  const results = inputs.main.results
    .byKey(key, 0)
    .filter((r) => r.check.project === testFile.project && r.check.testPath === testFile.path);
  if (results.length === 0) return { kind: "pending", reason: "run" };
  let condition: LoaderCondition | null = null;
  if (results.some((r) => r.outcome === "skip")) condition = { kind: "unknown", cause: "skipped" };
  else if (inputs.coverage.has({ resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION })) {
    condition = { kind: "ready", key };
  }
  if (condition !== null) {
    inputs.settled?.set(key, condition);
    return condition;
  }
  const stored = Math.max(...results.map((r) => r.provenance.recordedAt));
  const until = stored + RECORD_WAIT_MS;
  if (inputs.writing || until > inputs.now) return { kind: "pending", reason: "record", until };
  return { kind: "unknown", cause: "no-record" };
}

/**
 * Spec 015 D9: every listed test file of the worktree with its closure and
 * condition. A test file with no stored closure loads no source Squeal
 * knows of; one whose closure was stored by another worktree is read as
 * this one's, the newest closure being the one keys are made from (001 D8).
 */
export function readLoaders(inputs: LoaderInputs): Loaders {
  const rows = inputs.main.testFileKeys.list(inputs.worktreeId);
  const closures = new Map(
    inputs.main.testFiles.list().map((r) => [testFileId(r.testFile), r.closure.paths]),
  );
  const byPath = new Map<RelativePath, Loader[]>();
  let wakeAt: EpochMs | null = null;
  for (const row of rows) {
    const paths = closures.get(testFileId(row.testFile));
    if (paths === undefined) continue;
    const condition = conditionAt(inputs, row.testFile, row.key, row.pending !== null);
    if (condition.kind === "pending" && condition.until !== undefined) {
      wakeAt = Math.min(wakeAt ?? condition.until, condition.until);
    }
    const loader = { testFile: row.testFile, condition };
    for (const path of paths) {
      if (path === row.testFile.path) continue;
      const list = byPath.get(path);
      if (list === undefined) byPath.set(path, [loader]);
      else list.push(loader);
    }
  }
  return { listed: rows.length > 0, of: (path) => byPath.get(path) ?? [], wakeAt };
}
