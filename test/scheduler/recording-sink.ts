import { createStateSink } from "../../src/core/state/index.js";
import type {
  CheckId,
  KnownState,
  RevisionNumber,
  StateProvenance,
  StateSink,
  Store,
  TestFileRef,
  Transition,
  WorktreeId,
} from "../../src/core/types/index.js";

export type SinkCall =
  | {
      readonly method: "applyResults";
      readonly revision: RevisionNumber;
      readonly results: Parameters<StateSink["applyResults"]>[2];
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
      readonly checkpointId: string | null;
    }
  | { readonly method: "retire"; readonly checks: readonly CheckId[] };

/**
 * The store-backed `StateSink` of task 001-21 for one worktree, recording
 * every call. States are read back from `known_states` (review S7: scheduler
 * tests run through the real sink).
 */
export class RecordingSink implements StateSink {
  readonly calls: SinkCall[] = [];
  readonly #inner: StateSink;

  constructor(
    private readonly store: Store,
    readonly worktreeId: WorktreeId,
  ) {
    this.#inner = createStateSink(store);
  }

  applyResults(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    results: Parameters<StateSink["applyResults"]>[2],
    provenance: StateProvenance,
  ): readonly Transition[] {
    this.#own(worktreeId);
    const { checkpointId } = provenance;
    this.calls.push({ method: "applyResults", revision, results, checkpointId });
    return this.#inner.applyResults(worktreeId, revision, results, provenance);
  }

  markUnknown(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    testFiles: readonly TestFileRef[],
    reason: string,
  ): readonly Transition[] {
    this.#own(worktreeId);
    this.calls.push({ method: "markUnknown", revision, testFiles, reason });
    return this.#inner.markUnknown(worktreeId, revision, testFiles, reason);
  }

  refresh(
    worktreeId: WorktreeId,
    revision: RevisionNumber,
    provenance: StateProvenance,
    testFiles?: readonly TestFileRef[],
  ): readonly Transition[] {
    this.#own(worktreeId);
    const { checkpointId } = provenance;
    this.calls.push({ method: "refresh", revision, testFiles, checkpointId });
    return this.#inner.refresh(worktreeId, revision, provenance, testFiles);
  }

  retire(worktreeId: WorktreeId, checks: readonly CheckId[]): void {
    this.#own(worktreeId);
    this.calls.push({ method: "retire", checks });
    this.#inner.retire(worktreeId, checks);
  }

  /** Every call of one method. */
  callsOf<M extends SinkCall["method"]>(method: M): Extract<SinkCall, { method: M }>[] {
    return this.calls.filter((c): c is Extract<SinkCall, { method: M }> => c.method === method);
  }

  stateOf(check: CheckId): KnownState | null {
    return this.store.knownStates.get(this.worktreeId, check);
  }

  states(): readonly KnownState[] {
    return this.store.knownStates.list(this.worktreeId);
  }

  #own(worktreeId: WorktreeId): void {
    if (worktreeId !== this.worktreeId) {
      throw new Error(`recording sink of ${this.worktreeId} called for ${worktreeId}`);
    }
  }
}
