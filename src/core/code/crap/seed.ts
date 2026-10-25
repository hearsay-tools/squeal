import type { CodeFile, CodeKnownState, FileCount } from "../../types/code.js";
import { checkOf } from "./judge.js";
import type { CoverageStepInput } from "./step.js";
import { functionKey } from "./summary.js";

/** Spec 015 D9: the states a coverage step keeps per function, beside complexity. */
export const COVERAGE_MEASURES = ["crap", "uncovered"] as const;

/**
 * A `pending` state for each function with no coverage state, so its first
 * judgement is quiet: the functions there when coverage started, or that a
 * first count or recount brought. With `again`, every state is pending
 * again: the provider's records changed meaning.
 */
export function seed(
  input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
  files: readonly CodeFile[],
  countOf: (file: CodeFile) => FileCount | null,
  again: boolean,
): void {
  const { store, worktreeId, revision } = input;
  const known = new Set(
    again
      ? []
      : store.states
          .list(worktreeId, { measure: "crap" })
          .map((s) => `${functionKey(s.check)}\0${s.check.path}`),
  );
  const states: CodeKnownState[] = [];
  for (const file of files) {
    for (const fn of countOf(file)?.functions ?? []) {
      if (known.has(`${functionKey(fn)}\0${file.path}`)) continue;
      for (const measure of COVERAGE_MEASURES) {
        states.push({
          worktreeId,
          check: checkOf(file.path, fn),
          measure,
          outcome: "pending",
          value: null,
          threshold: null,
          countedAt: revision,
          blob: file.blob,
          changedAt: revision,
        });
      }
    }
  }
  store.states.upsertMany(states);
}
