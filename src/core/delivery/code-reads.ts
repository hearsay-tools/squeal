import type { CodeEdit, CodeStore } from "../code/store/types.js";
import type { CodeKnownState, CodeMeasure } from "../types/code.js";
import type { WorktreeId } from "../types/common.js";

/*
 * Row 015-127: a tool boundary's complexity news reads the worktree's
 * failing states and its edited states in several steps: the delta, the
 * summary, the seed, the functions told over. Each measure's set is read
 * at most once in one transaction and given to every step that needs it
 * there. A reader belongs to one transaction: another one may see other
 * states, so it makes its own.
 */

/** The failing and edited states of one worktree, each measure's read once. */
export interface CodeReads {
  /** The failing states of `measures`, a measure after another, each in `states.list`'s order. */
  failing(measures: readonly CodeMeasure[]): readonly CodeKnownState[];
  /** The last edit of each state of `measures` that has one, a measure after another. */
  edits(measures: readonly CodeMeasure[]): readonly CodeEdit[];
}

/** A `CodeReads` of `worktreeId`; nothing is read until a step asks. */
export function codeReads(store: CodeStore, worktreeId: WorktreeId): CodeReads {
  const failing = new Map<CodeMeasure, readonly CodeKnownState[]>();
  const edits = new Map<CodeMeasure, readonly CodeEdit[]>();
  const once =
    <T>(cache: Map<CodeMeasure, readonly T[]>, read: (m: CodeMeasure) => readonly T[]) =>
    (measures: readonly CodeMeasure[]): readonly T[] =>
      measures.flatMap((measure) => {
        const known = cache.get(measure);
        if (known !== undefined) return known;
        const states = read(measure);
        cache.set(measure, states);
        return states;
      });
  return {
    failing: once(failing, (measure) =>
      store.states.list(worktreeId, { measure, outcome: "fail" }),
    ),
    edits: once(edits, (measure) => store.states.edits(worktreeId, measure)),
  };
}
