import type { CodeFile, CodeKnownState, FileCount } from "../../types/code.js";
import { checkOf } from "./judge.js";
import type { CoverageStepInput } from "./step.js";
import { functionKey } from "./summary.js";

/** Spec 015 D9: the states a coverage step keeps per function, beside complexity. */
export const COVERAGE_MEASURES = ["crap", "uncovered"] as const;

/** The files a unit of the seed reads together, with one read of their states (row 015-47). */
export const SEED_FILES = 32;

/**
 * A `pending` state for each function with no coverage state, so its first
 * judgement is quiet: the functions there when coverage started, or that a
 * first count or recount brought. With `again`, every state is pending
 * again: the provider's records changed meaning.
 *
 * Row 015-47: `SEED_FILES` at a time, as far as the step's budget allows,
 * so a seed goes on over several steps (429 to 489 ms in one turn on
 * 011-197's stores). It holds the files as they were when it began: a file
 * an edit changed since seeds only the functions its count had then, so a
 * function the edit added is still a first-seen fail.
 */
export class Seed {
  readonly #files: readonly CodeFile[];
  readonly #again: boolean;
  #next = 0;

  constructor(files: readonly CodeFile[], again: boolean) {
    this.#files = files;
    this.#again = again;
  }

  /** Seeds the next files while `work` allows; true once every file is seeded. */
  advance(
    input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
    countOf: (file: CodeFile) => FileCount | null,
    work: () => boolean,
  ): boolean {
    while (this.#next < this.#files.length) {
      if (!work()) return false;
      const files = this.#files.slice(this.#next, this.#next + SEED_FILES);
      this.#next += files.length;
      seedFiles(input, files, countOf, this.#again);
    }
    return true;
  }
}

/** The pending states of the functions of `files`, as the seed began, with no `crap` state. */
function seedFiles(
  input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
  files: readonly CodeFile[],
  countOf: (file: CodeFile) => FileCount | null,
  again: boolean,
): void {
  const { store, worktreeId, revision } = input;
  const paths = files.map((f) => f.path);
  const now = new Map(store.files.list(worktreeId, paths).map((f) => [f.path, f]));
  const known = new Set(
    again
      ? []
      : store.states
          .list(worktreeId, { measure: "crap", paths })
          .map((s) => `${functionKey(s.check)}\0${s.check.path}`),
  );
  const states: CodeKnownState[] = [];
  for (const then of files) {
    const file = now.get(then.path);
    // A file gone or too big since the seed began has nothing to seed.
    if (file === undefined || file.tooBig === true) continue;
    for (const fn of functionsOf(store, then, file, countOf)) {
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

/** `file`'s functions that its count at `then` had too: none an edit since added. */
function functionsOf(
  store: CoverageStepInput["store"],
  then: CodeFile,
  file: CodeFile,
  countOf: (file: CodeFile) => FileCount | null,
): readonly FileCount["functions"][number][] {
  const functions = countOf(file)?.functions ?? [];
  if (then.blob === file.blob && then.counterVersion === file.counterVersion) return functions;
  const before = store.counts.get(then.blob, then.language, then.counterVersion);
  if (before === null) return functions;
  const had = new Set(before.functions.map(functionKey));
  return functions.filter((fn) => had.has(functionKey(fn)));
}
