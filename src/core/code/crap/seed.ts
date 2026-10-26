import type { CodeCheckId, CodeFile, CodeKnownState, FileCount } from "../../types/code.js";
import { readUncountable, spentFailure } from "../pass/failed.js";
import type { PassReport } from "../pass/types.js";
import type { CoverageChecks } from "./checks.js";
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
 * function the edit added is still a first-seen fail. It follows the
 * complexity pass's moves and removals since (D2; review 0.1.311 B1): a
 * function there as it began, renamed or moved before its file is seeded,
 * is seeded where it went, and one removed is not seeded under its name.
 *
 * Row 015-48: it reads those moves' counts within the step's budget too
 * (review 0.1.311-r2 N1), in their order and before any file is seeded. At
 * coverage's start it waits at a file its unit finds with no count, one the
 * counter gave up on aside, so a function the first count counts later is
 * seeded with the rest, not new: the unit reads those counts anyway, where
 * a check of every file before the seed was one read of 479 ms cold.
 */
export class Seed {
  readonly #files: readonly CodeFile[];
  readonly #again: boolean;
  /** Coverage's start: a file with no count holds the seed until it has one. */
  readonly #counted: boolean;
  /** Each file's place in `#files`: one at or past `#next` is not seeded yet. */
  readonly #places: ReadonlyMap<string, number>;
  #next = 0;
  /** By path, the functions its count had as the seed began; `null` once that count was pruned. */
  readonly #had = new Map<string, ReadonlySet<string> | null>();
  /** By path, functions of a file not seeded yet that an edit moved away or removed. */
  readonly #left = new Map<string, Set<string>>();
  /** By path, functions there as the seed began and not seeded yet, that an edit moved there. */
  readonly #came = new Map<string, Set<string>>();
  /** The moves and removals `follow` was given and `advance` has not read yet, in order. */
  readonly #followed: Followed[] = [];
  /** Row 015-64: the checks seeded, and the files left out, which a move into one does not seed. */
  readonly #checks: Pick<CoverageChecks, "measures" | "excluded">;

  constructor(
    files: readonly CodeFile[],
    again: boolean,
    counted = false,
    checks: Pick<CoverageChecks, "measures" | "excluded"> = {
      measures: COVERAGE_MEASURES,
      excluded: () => false,
    },
  ) {
    this.#files = files;
    this.#again = again;
    this.#counted = counted;
    this.#checks = checks;
    this.#places = new Map(files.map((f, place) => [f.path, place]));
  }

  /**
   * Seeds the next files while `work` allows: `done` once every file is
   * seeded, `uncounted` while a start's file waits for its count.
   */
  advance(
    input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
    countOf: (file: CodeFile) => FileCount | null,
    work: () => boolean,
  ): "done" | "more" | "uncounted" {
    if (!this.#caughtUp(input.store, work)) return "more";
    for (;;) {
      // Functions moved into a file seeded already, or one the seed's files did not have, first.
      const moved = [...this.#came.keys()].filter((path) => this.#waiting(path) === undefined);
      if (moved.length === 0 && this.#next >= this.#files.length) return "done";
      if (!work()) return "more";
      if (moved.length > 0) {
        const paths = moved.slice(0, SEED_FILES);
        this.#seed(
          input,
          paths.map((path) => ({ path, began: null })),
          countOf,
        );
        continue;
      }
      const files = this.#files.slice(this.#next, this.#next + SEED_FILES);
      if (this.#counted && !this.#allCounted(input, files, countOf)) return "uncounted";
      this.#next += files.length;
      this.#seed(
        input,
        files.map((began) => ({ path: began.path, began })),
        countOf,
      );
    }
  }

  /** An edit's moves and removals (D2), as the complexity pass applied them to its states. */
  follow(report: Pick<PassReport, "moves" | "removed">): void {
    for (const { from, to } of report.moves) this.#followed.push({ from, to });
    for (const check of report.removed) this.#followed.push({ from: check, to: null });
  }

  /** Reads what `follow` was given, one move or removal each time `work` allows; true once all is read. */
  #caughtUp(store: Store, work: () => boolean): boolean {
    let read = 0;
    for (const { from, to } of this.#followed) {
      if (!work()) break;
      read++;
      if (!this.#leave(store, from) || to === null) continue;
      const came = this.#came.get(to.path) ?? new Set();
      this.#came.set(to.path, came.add(functionKey(to)));
    }
    this.#followed.splice(0, read);
    return this.#followed.length === 0;
  }

  /**
   * Whether each of `files`, as the seed began, has a count now, or is gone,
   * too big or one the counter gave up on; a start waits for the others.
   */
  #allCounted(
    input: Pick<CoverageStepInput, "store" | "worktreeId">,
    files: readonly CodeFile[],
    countOf: (file: CodeFile) => FileCount | null,
  ): boolean {
    const { store, worktreeId } = input;
    const now = store.files.list(
      worktreeId,
      files.map((f) => f.path),
    );
    const uncounted = now.filter((f) => f.tooBig !== true && countOf(f) === null);
    if (uncounted.length === 0) return true;
    const failed = readUncountable(store.meta, worktreeId);
    return uncounted.every((f) => spentFailure(failed, f) !== null);
  }

  /** `check` leaves its file: true if it was there as the seed began and is not seeded yet. */
  #leave(store: Store, check: CodeCheckId): boolean {
    const key = functionKey(check);
    const came = this.#came.get(check.path);
    if (came?.delete(key) === true) {
      if (came.size === 0) this.#came.delete(check.path);
      return true;
    }
    const then = this.#waiting(check.path);
    if (then === undefined) return false;
    const left = this.#left.get(check.path) ?? new Set();
    // A function under a name that left before is one an edit added since.
    if (left.has(key)) return false;
    this.#left.set(check.path, left.add(key));
    const had = this.#hadOf(store, then);
    return had === null || had.has(key);
  }

  /**
   * The pending states of the functions this seed holds in `files`, for
   * each check with no state (row 015-64: a check switched on has none);
   * `began` is a file as the seed began, `null` for one seeded already or
   * that the seed did not have, which holds only what came.
   */
  #seed(
    input: Pick<CoverageStepInput, "store" | "worktreeId" | "revision">,
    files: readonly { readonly path: string; readonly began: CodeFile | null }[],
    countOf: (file: CodeFile) => FileCount | null,
  ): void {
    const { store, worktreeId, revision } = input;
    const paths = files.map((f) => f.path);
    const now = new Map(store.files.list(worktreeId, paths).map((f) => [f.path, f]));
    const { measures, excluded } = this.#checks;
    const known = new Set(
      this.#again
        ? []
        : measures.flatMap((measure) =>
            store.states
              .list(worktreeId, { measure, paths })
              .map((s) => `${measure}\0${functionKey(s.check)}\0${s.check.path}`),
          ),
    );
    const states: CodeKnownState[] = [];
    for (const { path, began } of files) {
      const file = now.get(path);
      const chosen = this.#chosen(store, began, file, countOf);
      this.#came.delete(path);
      this.#left.delete(path);
      this.#had.delete(path);
      if (file === undefined || excluded(path)) continue;
      for (const fn of chosen) {
        for (const measure of measures) {
          if (known.has(`${measure}\0${functionKey(fn)}\0${path}`)) continue;
          states.push({
            worktreeId,
            check: checkOf(path, fn),
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

  /**
   * `file`'s functions to seed: those moved there, and with `then`, those
   * its count had as the seed began, none an edit added or took away since.
   */
  #chosen(
    store: Store,
    then: CodeFile | null,
    file: CodeFile | undefined,
    countOf: (file: CodeFile) => FileCount | null,
  ): readonly Fn[] {
    // A file gone or too big since the seed began has nothing to seed.
    if (file === undefined || file.tooBig === true) return [];
    const functions = countOf(file)?.functions ?? [];
    const came = this.#came.get(file.path);
    const left = then === null ? undefined : this.#left.get(file.path);
    const same = then?.blob === file.blob && then.counterVersion === file.counterVersion;
    if (same && came === undefined && left === undefined) return functions;
    // A count pruned since: quiet rather than a false fail.
    const had = then === null ? new Set<string>() : this.#hadOf(store, then);
    return functions.filter((fn) => {
      const key = functionKey(fn);
      return came?.has(key) === true || ((had === null || had.has(key)) && left?.has(key) !== true);
    });
  }

  /** The file at `path` as the seed began, while it is not seeded yet. */
  #waiting(path: string): CodeFile | undefined {
    const place = this.#places.get(path);
    return place === undefined || place < this.#next ? undefined : this.#files[place];
  }

  /** The functions `then`'s count had, read once. */
  #hadOf(store: Store, then: CodeFile): ReadonlySet<string> | null {
    const known = this.#had.get(then.path);
    if (known !== undefined) return known;
    const count = store.counts.get(then.blob, then.language, then.counterVersion);
    const had = count === null ? null : new Set(count.functions.map(functionKey));
    this.#had.set(then.path, had);
    return had;
  }
}

type Fn = FileCount["functions"][number];
type Store = CoverageStepInput["store"];
/** A move `follow` was given, or a removal, whose `to` is `null`. */
type Followed = { readonly from: CodeCheckId; readonly to: CodeCheckId | null };
