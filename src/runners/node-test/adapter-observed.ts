import { compare } from "../../core/fs/index.js";
import type { RelativePath } from "../../core/types/index.js";
import type { ObservedPaths, ObservedStore } from "./adapter.js";
import type { NodeTestGraph } from "./graph/index.js";
import type { ObservedClosure } from "./run/observed.js";

/**
 * What runs loaded beyond the static graph, for one project (spec 003 D3,
 * D5): per test file, and for the preloads (review wave 2, B1). This
 * worktree's runs add to it; the shared store adds what other worktrees'
 * runs found, read at start and again at each refinement (S2).
 *
 * Growth this worktree's own run found waits, as D3 has it, for the next
 * edit of the path. Growth another worktree found may sit under a key this
 * worktree already holds a result for, so it is reported at the next
 * refinement: its test files as affected, which re-fetches their closures,
 * and preload paths as a recreated project, which re-reads the environment.
 */
export class Observed {
  private readonly tests = new Map<RelativePath, Set<RelativePath>>();
  private readonly preloadSet = new Set<RelativePath>();
  /** Test files whose set another worktree grew, not yet reported by `affected`. */
  private readonly grown = new Set<RelativePath>();
  /** Another worktree grew the preload set since the last `invalidate`. */
  private preloadsGrew = false;
  /** The preload paths the last `environment()` returned, so the scheduler keyed. */
  private keyed: ReadonlySet<RelativePath> = new Set();

  constructor(
    private readonly graph: NodeTestGraph,
    private readonly store: ObservedStore | undefined,
    private readonly note: (text: string) => void,
  ) {
    this.refresh();
    this.grown.clear();
    this.preloadsGrew = false;
  }

  /** Merges what the store holds now; another worktree's additions are reported next. */
  refresh(): void {
    if (this.store === undefined) return;
    let tests: ObservedPaths;
    let preloads: readonly RelativePath[];
    try {
      tests = this.store.read();
      preloads = this.store.readPreloads();
    } catch (error) {
      this.note(`could not read observed paths: ${String(error)}`);
      return;
    }
    for (const [testFile, paths] of Object.entries(tests)) {
      if (this.addTest(testFile, paths).length > 0) this.grown.add(testFile);
    }
    if (this.addPreloads(preloads).length > 0) this.preloadsGrew = true;
  }

  /** The observed-only paths of one test file. */
  of(testFile: RelativePath): ReadonlySet<RelativePath> | undefined {
    return this.tests.get(testFile);
  }

  /** The preloads' observed-only paths, sorted, as the environment returns them now. */
  preloads(): RelativePath[] {
    this.keyed = new Set(this.preloadSet);
    return [...this.preloadSet].sort(compare);
  }

  /** Test files another worktree's observations re-key, once each. */
  takeGrown(listed: ReadonlySet<RelativePath>): RelativePath[] {
    const out = [...this.grown].filter((f) => listed.has(f)).sort(compare);
    this.grown.clear();
    return out;
  }

  /**
   * True when the scheduler must read the environment again: another
   * worktree grew the preload set, or `changed` holds an observed preload
   * path the last environment did not carry.
   */
  takeRecreate(changed: readonly RelativePath[]): boolean {
    const recreate =
      this.preloadsGrew || changed.some((p) => this.preloadSet.has(p) && !this.keyed.has(p));
    this.preloadsGrew = false;
    return recreate;
  }

  /**
   * D3, D5: what each completed, listed file and its preloads loaded beyond
   * the static graph. Returns the preloads' observed-only paths of this run,
   * sorted, so the scheduler keeps no result of a file whose key lacked
   * one (task 003-43).
   */
  record(seen: readonly ObservedClosure[], listed: ReadonlySet<RelativePath>): RelativePath[] {
    const tests: Record<RelativePath, RelativePath[]> = {};
    const preloadStatic = new Set(this.graph.preloads().paths);
    const preloads = new Set<RelativePath>();
    for (const { testFile, paths, preloadPaths } of seen) {
      if (!listed.has(testFile.path)) continue;
      for (const path of preloadPaths) if (!preloadStatic.has(path)) preloads.add(path);
      const closure = new Set(this.graph.closure(testFile.path).paths);
      const added = this.addTest(
        testFile.path,
        paths.filter((p) => !closure.has(p)),
      );
      if (added.length > 0) tests[testFile.path] = added;
    }
    const addedPreloads = this.addPreloads([...preloads]);
    if (this.store !== undefined) {
      try {
        if (Object.keys(tests).length > 0) this.store.write(tests);
        if (addedPreloads.length > 0) this.store.writePreloads(addedPreloads);
      } catch (error) {
        this.note(`could not store observed paths: ${String(error)}`);
      }
    }
    return [...preloads].sort(compare);
  }

  /** Adds paths to one test file's set; returns the new ones. */
  private addTest(testFile: RelativePath, paths: readonly RelativePath[]): RelativePath[] {
    const known = this.tests.get(testFile) ?? new Set<RelativePath>();
    const added = paths.filter((p) => !known.has(p));
    if (added.length === 0) return [];
    for (const path of added) known.add(path);
    this.tests.set(testFile, known);
    this.graph.recordObserved(testFile, [...known]);
    return added;
  }

  private addPreloads(paths: readonly RelativePath[]): RelativePath[] {
    const added = paths.filter((p) => !this.preloadSet.has(p));
    if (added.length === 0) return [];
    for (const path of added) this.preloadSet.add(path);
    this.graph.recordObservedPreloads([...this.preloadSet]);
    return added;
  }
}
