import { testFileId } from "../../src/core/keys/index.js";
import { checkId } from "../../src/core/scheduler/files.js";
import type {
  CheckId,
  CheckKey,
  KnownOutcome,
  ResultOrigin,
  ResultRecord,
  RevisionNumber,
  StateProvenance,
  StateSink,
  Store,
  TestFileKeyRecord,
  TestFileRef,
  Transition,
  Validity,
  WorktreeId,
} from "../../src/core/types/index.js";

/** What the fake knows about one check. */
export interface MemoryState {
  readonly check: CheckId;
  readonly outcome: KnownOutcome;
  readonly validity: Validity;
  readonly origin: ResultOrigin | null;
  readonly key: CheckKey | null;
  readonly revision: RevisionNumber;
}

export type SinkCall =
  | {
      readonly method: "applyResults";
      readonly revision: RevisionNumber;
      readonly results: readonly ResultRecord[];
      readonly checkpointId: string | null;
    }
  | {
      readonly method: "markUnknown";
      readonly revision: RevisionNumber;
      readonly testFiles: readonly TestFileRef[];
      readonly reason: string;
    }
  | {
      readonly method: "refresh";
      readonly revision: RevisionNumber;
      readonly testFiles: readonly TestFileRef[] | undefined;
    }
  | { readonly method: "retire"; readonly checks: readonly CheckId[] };

/**
 * In-memory `StateSink` for one worktree, standing in for task 001-21. It
 * keeps outcome, validity and origin per check, classifying validity against
 * `test_file_keys` as the contract says, and records every call. No
 * transitions, no fingerprints.
 */
export class MemorySink implements StateSink {
  readonly states = new Map<string, MemoryState>();
  readonly calls: SinkCall[] = [];

  constructor(
    private readonly store: Store,
    readonly worktreeId: WorktreeId,
  ) {}

  applyResults(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    results: readonly ResultRecord[],
    provenance: StateProvenance,
  ): readonly Transition[] {
    this.#own(worktreeId);
    this.calls.push({
      method: "applyResults",
      revision,
      results,
      checkpointId: provenance.checkpointId,
    });
    this.#apply(revision, results, this.#keys());
    return [];
  }

  markUnknown(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
    reason: string,
  ): readonly Transition[] {
    this.#own(worktreeId);
    this.calls.push({ method: "markUnknown", revision, testFiles, reason });
    const ids = new Set(testFiles.map(testFileId));
    for (const [id, state] of this.states) {
      if (!ids.has(fileOf(state.check))) continue;
      this.states.set(id, { ...state, outcome: "unknown", validity: "unknown", revision });
    }
    return [];
  }

  refresh(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    _provenance: StateProvenance,
    testFiles?: readonly TestFileRef[],
  ): readonly Transition[] {
    this.#own(worktreeId);
    this.calls.push({ method: "refresh", revision, testFiles });
    const keys = this.#keys();
    if (testFiles !== undefined) {
      const ids = new Set(testFiles.map(testFileId));
      for (const id of keys.keys()) if (!ids.has(id)) keys.delete(id);
    }
    for (const row of keys.values()) {
      const results = this.store.results.byKey(row.key);
      if (results.length > 0) this.#apply(revision, results, keys);
    }
    for (const [id, state] of this.states) {
      const row = keys.get(fileOf(state.check));
      if (row === undefined || state.key === row.key) continue;
      const validity: Validity =
        row.pending !== null ? "pending" : state.outcome === "unknown" ? "unknown" : "stale";
      this.states.set(id, { ...state, validity });
    }
    return [];
  }

  retire(worktreeId: WorktreeId, checks: readonly CheckId[]): void {
    this.#own(worktreeId);
    this.calls.push({ method: "retire", checks });
    for (const check of checks) this.states.delete(checkId(check));
  }

  /** Every call of one method. */
  callsOf<M extends SinkCall["method"]>(method: M): Extract<SinkCall, { method: M }>[] {
    return this.calls.filter((c): c is Extract<SinkCall, { method: M }> => c.method === method);
  }

  stateOf(check: CheckId): MemoryState | undefined {
    return this.states.get(checkId(check));
  }

  #apply(
    revision: RevisionNumber,
    results: readonly ResultRecord[],
    keys: ReadonlyMap<string, TestFileKeyRecord>,
  ): void {
    for (const result of results) {
      const row = keys.get(fileOf(result.check));
      const validity: Validity =
        row?.key !== result.key ? "stale" : row.pending !== null ? "pending" : "current";
      const origin: ResultOrigin =
        result.provenance.worktreeId === this.worktreeId
          ? { kind: "own" }
          : {
              kind: "inherited",
              worktreeId: result.provenance.worktreeId,
              commit: result.provenance.commit,
            };
      this.states.set(checkId(result.check), {
        check: result.check,
        outcome: result.outcome,
        validity,
        origin,
        key: result.key,
        revision,
      });
    }
  }

  #keys(): Map<string, TestFileKeyRecord> {
    return new Map(
      this.store.testFileKeys.list(this.worktreeId).map((row) => [testFileId(row.testFile), row]),
    );
  }

  #own(worktreeId: WorktreeId): void {
    if (worktreeId !== this.worktreeId) {
      throw new Error(`memory sink of ${this.worktreeId} called for ${worktreeId}`);
    }
  }
}

function fileOf(check: CheckId): string {
  return testFileId({ project: check.project, path: check.testPath });
}
