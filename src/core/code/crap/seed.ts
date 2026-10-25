import type { CodeFile, CodeKnownState, FileCount } from "../../types/code.js";
import type { RelativePath } from "../../types/index.js";
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
 *
 * Row 015-47: a file at a time, as far as the step's budget allows, so a
 * seed goes on over several steps (429 to 489 ms in one turn on 011-197's
 * stores). It holds the files as they were when it began: a file an edit
 * changed since seeds only the functions its count had then, so a function
 * the edit added is still a first-seen fail.
 */
export class Seed {
  readonly #files: readonly CodeFile[];
  readonly #again: boolean;
  #next = 0;

  constructor(files: readonly CodeFile[], again: boolean) {
    this.#files = files;
    this.#again = again;
  }

  /**
   * Seeds the next files while `work` allows, `files` the counted files
   * now; true once every file is seeded.
   */
  advance(
    input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
    files: readonly CodeFile[],
    countOf: (file: CodeFile) => FileCount | null,
    work: () => boolean,
  ): boolean {
    const now = new Map<RelativePath, CodeFile>(files.map((f) => [f.path, f]));
    while (this.#next < this.#files.length) {
      if (!work()) return false;
      const then = this.#files[this.#next++];
      const file = then === undefined ? undefined : now.get(then.path);
      // A file gone since the seed began has nothing to seed.
      if (then === undefined || file === undefined) continue;
      seedFile(input, then, file, countOf, this.#again);
    }
    return true;
  }
}

/** The pending states of `file`'s functions with none, of those its count at `then` had too. */
function seedFile(
  input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
  then: CodeFile,
  file: CodeFile,
  countOf: (file: CodeFile) => FileCount | null,
  again: boolean,
): void {
  const { store, worktreeId, revision } = input;
  const functions = countOf(file)?.functions ?? [];
  if (functions.length === 0) return;
  const before =
    then.blob === file.blob && then.counterVersion === file.counterVersion
      ? null
      : store.counts.get(then.blob, then.language, then.counterVersion);
  const had = before === null ? null : new Set(before.functions.map(functionKey));
  const known = new Set(
    again
      ? []
      : store.states
          .list(worktreeId, { measure: "crap", paths: [file.path] })
          .map((s) => functionKey(s.check)),
  );
  const states: CodeKnownState[] = [];
  for (const fn of functions) {
    const key = functionKey(fn);
    if (known.has(key) || (had !== null && !had.has(key))) continue;
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
  store.states.upsertMany(states);
}
