import { compare } from "../../core/fs/index.js";
import type { RelativePath } from "../../core/types/index.js";
import type { PytestGraph } from "./graph/index.js";
import type { PytestObservedClosure } from "./run/observed.js";

/** Observed-only paths per test file of one project, worktree-relative (spec 007 D4, 003 D3). */
export type ObservedPaths = Readonly<Record<RelativePath, readonly RelativePath[]>>;

/**
 * The project's `pytest.observed.<project>` meta key, kept by the daemon so
 * the adapter never opens the store (003 D3 as amended).
 */
export interface ObservedStore {
  /** Every worktree's observations so far: read at start and at each refinement, so it must be cheap. */
  read(): ObservedPaths;
  /** Merges `additions` into the key, and into the stored closures, in one transaction. */
  write(additions: ObservedPaths): void;
  /** What start-up plugins imported beyond their static closure, every worktree's (B5). */
  readSession(): readonly RelativePath[];
  /** Merges `additions` into the session key in one transaction. */
  writeSession(additions: readonly RelativePath[]): void;
}

/**
 * What runs imported beyond the static graph, per test file (spec 007 D4,
 * D6: "an observed path outside it makes the result incomplete, is stored
 * with its hash, blocks inheritance when its content differs, and schedules
 * the file when it changes"). This worktree's runs add to it; the shared
 * store adds what other worktrees' runs found, read at start and at each
 * refinement. Growth another worktree found is reported once by
 * `takeGrown`, so the scheduler fetches those files' closures again; growth
 * this worktree's run found waits for the next edit, as 003 D3 has it.
 *
 * What start-up plugins (`pytest11`, `-p`) imported beyond their static
 * closure is the project's, not a test file's (review wave 2, B5): D2 puts
 * the plugins' closure in the environment, so these paths join its files,
 * as node:test's observed preloads do (003 D5, task 003-43).
 */
export class Observed {
  private readonly tests = new Map<RelativePath, Set<RelativePath>>();
  /** What processes each test file started found to import, by this worktree's runs. */
  private readonly spawned = new Map<RelativePath, Set<RelativePath>>();
  /** Test files whose set another worktree grew, not yet reported. */
  private readonly grown = new Set<RelativePath>();
  private readonly session = new Set<RelativePath>();
  /** The session paths the last `sessionPaths` returned: what the environment keys. */
  private keyed = new Set<RelativePath>();
  /** Another worktree grew the session set since the last `takeRecreate`. */
  private sessionGrew = false;

  constructor(
    private readonly graph: PytestGraph,
    private readonly store: ObservedStore | undefined,
    /** Paths never recorded: the environment's, which its hash covers. */
    private readonly outside: (path: RelativePath) => boolean,
    private readonly note: (text: string) => void,
  ) {
    this.refresh();
    this.grown.clear();
    this.sessionGrew = false;
  }

  /** Merges what the store holds now. */
  refresh(): void {
    if (this.store === undefined) return;
    let tests: ObservedPaths;
    let session: readonly RelativePath[];
    try {
      tests = this.store.read();
      session = this.store.readSession();
    } catch (error) {
      this.note(`could not read observed paths: ${String(error)}`);
      return;
    }
    for (const [testFile, paths] of Object.entries(tests)) {
      if (this.add(testFile, paths).length > 0) this.grown.add(testFile);
    }
    if (this.addSession(session).length > 0) this.sessionGrew = true;
  }

  /** The start-up plugins' observed-only paths, sorted, as the environment returns them now. */
  sessionPaths(): RelativePath[] {
    this.keyed = new Set(this.session);
    return [...this.session].sort(compare);
  }

  /**
   * True when the scheduler must read the environment again: another
   * worktree grew the session set, or `changed` holds a session path the
   * last environment did not carry.
   */
  takeRecreate(changed: readonly RelativePath[]): boolean {
    const recreate =
      this.sessionGrew || changed.some((p) => this.session.has(p) && !this.keyed.has(p));
    this.sessionGrew = false;
    return recreate;
  }

  /**
   * Records what a run's start-up imported beyond what a key already holds,
   * `plugins`, the plugins' static closure, and a module in the static
   * closure of every one of the `listed` test files, as a root conftest's
   * `pytest_plugins` are, and returns every such path of the run, keyed or
   * not: `RunReport.environmentObserved`, so the core stores nothing for a
   * file whose key lacked one and runs it again under the key that holds it.
   */
  recordSession(
    seen: readonly RelativePath[],
    plugins: readonly RelativePath[],
    listed: number,
  ): RelativePath[] {
    const known = new Set(plugins);
    const everywhere = (path: RelativePath) => {
      const { direct, transitive } = this.graph.affected([path]);
      return direct.length + transitive.length >= listed;
    };
    const paths = seen.filter((p) => !known.has(p) && !this.outside(p) && !everywhere(p));
    const added = this.addSession(paths);
    if (this.store !== undefined && added.length > 0) {
      try {
        this.store.writeSession(added);
      } catch (error) {
        this.note(`could not store observed paths: ${String(error)}`);
      }
    }
    return [...paths].sort(compare);
  }

  private addSession(paths: readonly RelativePath[]): RelativePath[] {
    const added = paths.filter((p) => !this.session.has(p) && !this.outside(p));
    for (const path of added) this.session.add(path);
    return added;
  }

  /** The observed-only paths of one test file. */
  of(testFile: RelativePath): ReadonlySet<RelativePath> | undefined {
    return this.tests.get(testFile);
  }

  /** Listed test files another worktree's observations re-key, once each. */
  takeGrown(listed: ReadonlySet<RelativePath>): RelativePath[] {
    const out = [...this.grown].filter((f) => listed.has(f)).sort(compare);
    this.grown.clear();
    return out;
  }

  /**
   * Records what each completed, listed file of a run imported beyond its
   * static closure. The run's own result is stored under the key it ran
   * under, without these paths (003 D3, kept for 007 by the coordinator,
   * review wave 1 input 4): another worktree keys the file with them from
   * the stored closure and re-runs it once. A spare run, never a stale pass.
   */
  record(seen: readonly PytestObservedClosure[], listed: ReadonlySet<RelativePath>): void {
    const additions: Record<RelativePath, RelativePath[]> = {};
    for (const { testFile, paths, spawned } of seen) {
      if (!listed.has(testFile.path)) continue;
      this.recordSpawned(testFile.path, spawned);
      const closure = new Set(this.graph.closure(testFile.path).paths);
      const added = this.add(
        testFile.path,
        paths.filter((p) => !closure.has(p)),
      );
      if (added.length > 0) additions[testFile.path] = added;
    }
    if (this.store === undefined || Object.keys(additions).length === 0) return;
    try {
      this.store.write(additions);
    } catch (error) {
      this.note(`could not store observed paths: ${String(error)}`);
    }
  }

  /**
   * What the processes a test file started found (task 007-55): one hop from
   * the test file, as a static import is. This worktree's runs only: the
   * store keeps them among the observed paths, which another worktree and a
   * restarted daemon read as `transitive` until the file runs here.
   */
  private recordSpawned(testFile: RelativePath, paths: readonly RelativePath[]): void {
    const known = this.spawned.get(testFile) ?? new Set<RelativePath>();
    const added = paths.filter((p) => !known.has(p) && !this.outside(p));
    if (added.length === 0) return;
    for (const path of added) known.add(path);
    this.spawned.set(testFile, known);
    this.graph.recordSpawned(testFile, [...known]);
  }

  /** Adds paths to one test file's set; returns the new ones. */
  private add(testFile: RelativePath, paths: readonly RelativePath[]): RelativePath[] {
    const known = this.tests.get(testFile) ?? new Set<RelativePath>();
    const added = paths.filter((p) => !known.has(p) && !this.outside(p));
    if (added.length === 0) return [];
    for (const path of added) known.add(path);
    this.tests.set(testFile, known);
    this.graph.recordObserved(testFile, [...known]);
    return added;
  }
}
