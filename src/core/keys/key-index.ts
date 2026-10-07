import type {
  CheckKey,
  Closure,
  EnvironmentHash,
  FileHash,
  HashSource,
  ProjectName,
  RelativePath,
  TestFileRef,
} from "../types/index.js";
import { encodeSegment, keyFromSegments } from "./check-key.js";
import { ReverseIndex, testFileId } from "./reverse-index.js";

/** A test file whose key changed. */
export interface KeyChange {
  readonly testFile: TestFileRef;
  /** `null` the first time the test file is keyed. */
  readonly previous: CheckKey | null;
  /** `null` when the test file lost its key: its new closure has an untracked path. */
  readonly key: CheckKey | null;
}

/** What `KeyIndex.setClosure` did. */
export interface ClosureUpdate {
  readonly changes: KeyChange[];
  /**
   * The closure's paths the hash source does not track, in closure order. The
   * test file stays unkeyed until each is hashed into the stat cache and
   * passed to `rekey`.
   */
  readonly untracked: RelativePath[];
}

/** One closure path, shared by every closure that references it. */
interface PathEntry {
  /** `undefined` while the hash source does not track the path. */
  hash: FileHash | null | undefined;
  segment: string;
  references: number;
}

interface Keyed {
  readonly closure: Closure;
  /** `closure.paths` in order. */
  readonly entries: readonly PathEntry[];
  /** The installed-dependency segment of the key (task 001-105). */
  dependencies: string;
  key: CheckKey | null;
}

/**
 * Current closures, environment hashes and check keys of one worktree, kept
 * up to date incrementally.
 *
 * Spec 001 D3: "Incremental maintenance follows Bazel, Nx and the git index:
 * a stat cache [...], a reverse index `path -> test files`, and
 * re-computation only of the keys that reference a changed path."
 *
 * `hashOf` reads the current file hashes, normally `StatCache.hashOf`. The
 * index remembers the hash of every closure path and reads it again only for
 * paths passed to `rekey` and for the paths of a closure passed to
 * `setClosure`. So update the stat cache first, then call `rekey` with every
 * changed path. A test file has a key once both its closure and its project's
 * environment hash are set, and no path of its closure is untracked (`hashOf`
 * returns `undefined`). Spec 001 D2: "A test file is never keyed while any of
 * its closure paths is untracked by the stat cache."
 */
export class KeyIndex {
  readonly reverse = new ReverseIndex();
  private readonly keyed = new Map<string, Keyed>();
  private readonly paths = new Map<RelativePath, PathEntry>();
  private readonly environments = new Map<ProjectName, EnvironmentHash>();

  constructor(private readonly hashOf: HashSource) {}

  key(testFile: TestFileRef): CheckKey | null {
    return this.keyed.get(testFileId(testFile))?.key ?? null;
  }

  closure(testFile: TestFileRef): Closure | undefined {
    return this.keyed.get(testFileId(testFile))?.closure;
  }

  environment(project: ProjectName): EnvironmentHash | undefined {
    return this.environments.get(project);
  }

  /** Sets a project's environment hash and re-keys its test files. */
  setEnvironment(project: ProjectName, envHash: EnvironmentHash): KeyChange[] {
    if (this.environments.get(project) === envHash) return [];
    this.environments.set(project, envHash);
    return this.recompute(this.reverse.testFiles().filter((ref) => ref.project === project));
  }

  /**
   * Sets the environment hash of each project in `environments` and the
   * installed-dependency segment of each of their test files, then re-keys
   * once each test file whose project hash or segment moved, so no key
   * passes through a mix of old and new inputs (task 001-105).
   */
  setInstalled(
    environments: ReadonlyMap<ProjectName, EnvironmentHash>,
    dependenciesOf: (testFile: TestFileRef) => string,
  ): KeyChange[] {
    const moved = new Set<ProjectName>();
    for (const [project, envHash] of environments) {
      if (this.environments.get(project) !== envHash) moved.add(project);
      this.environments.set(project, envHash);
    }
    const changed = this.reverse.testFiles().filter((ref) => {
      const keyed = this.keyed.get(testFileId(ref));
      if (!keyed || !environments.has(ref.project)) return false;
      const dependencies = dependenciesOf(ref);
      if (dependencies === keyed.dependencies) return moved.has(ref.project);
      keyed.dependencies = dependencies;
      return true;
    });
    return this.recompute(changed);
  }

  /**
   * Sets or replaces a test file's closure and keys it. Every path's hash is
   * read again; a path whose hash changed without a `rekey` also re-keys the
   * other test files that reference it. While any path is untracked the test
   * file has no key, and a key it had is dropped (a change to `null`).
   * `dependencies` is its installed-dependency segment (task 001-105).
   */
  setClosure(closure: Closure, dependencies = ""): ClosureUpdate {
    const id = testFileId(closure.testFile);
    const previous = this.keyed.get(id);
    const stale: RelativePath[] = [];
    const entries = closure.paths.map((path) => {
      const entry = this.acquire(path);
      if (entry.references > 1 && this.refresh(path, entry)) stale.push(path);
      return entry;
    });
    if (previous) this.release(previous.closure.paths);
    this.keyed.set(id, { closure, entries, dependencies, key: previous?.key ?? null });
    this.reverse.set(closure.testFile, closure.paths);

    const affected = this.reverse.referencing(stale).filter((ref) => testFileId(ref) !== id);
    const untracked = closure.paths.filter((_, i) => entries[i]?.hash === undefined);
    return { changes: this.recompute([closure.testFile, ...affected]), untracked };
  }

  /** Forgets a deleted test file. Returns whether it was known. */
  removeTestFile(testFile: TestFileRef): boolean {
    const id = testFileId(testFile);
    const keyed = this.keyed.get(id);
    if (!keyed) return false;
    this.keyed.delete(id);
    this.reverse.remove(testFile);
    this.release(keyed.closure.paths);
    return true;
  }

  /** Re-reads the hashes of `changedPaths` and re-keys only the test files that reference one. */
  rekey(changedPaths: Iterable<RelativePath>): KeyChange[] {
    const changed: RelativePath[] = [];
    for (const path of new Set(changedPaths)) {
      const entry = this.paths.get(path);
      if (entry && this.refresh(path, entry)) changed.push(path);
    }
    return this.recompute(this.reverse.referencing(changed));
  }

  private recompute(testFiles: readonly TestFileRef[]): KeyChange[] {
    const changes: KeyChange[] = [];
    for (const testFile of testFiles) {
      const keyed = this.keyed.get(testFileId(testFile));
      const envHash = this.environments.get(testFile.project);
      if (!keyed || envHash === undefined) continue;
      const key = this.keyOf(keyed, envHash);
      if (key === keyed.key) continue;
      changes.push({ testFile, previous: keyed.key, key });
      keyed.key = key;
    }
    return changes;
  }

  /** `null` while any closure path is untracked. */
  private keyOf(keyed: Keyed, envHash: EnvironmentHash): CheckKey | null {
    const segments: string[] = [];
    for (const entry of keyed.entries) {
      if (entry.hash === undefined) return null;
      segments.push(entry.segment);
    }
    return keyFromSegments(envHash, keyed.closure.testFile, segments, keyed.dependencies);
  }

  /** The entry of `path` with one more reference; a new entry reads the hash. */
  private acquire(path: RelativePath): PathEntry {
    let entry = this.paths.get(path);
    if (!entry) {
      const hash = this.hashOf(path);
      entry = { hash, segment: encodeSegment(path, hash ?? null), references: 0 };
      this.paths.set(path, entry);
    }
    entry.references++;
    return entry;
  }

  private release(paths: readonly RelativePath[]): void {
    for (const path of paths) {
      const entry = this.paths.get(path);
      if (entry && --entry.references === 0) this.paths.delete(path);
    }
  }

  /** Reads the hash of `path` again. True when it changed. */
  private refresh(path: RelativePath, entry: PathEntry): boolean {
    const hash = this.hashOf(path);
    if (hash === entry.hash) return false;
    entry.hash = hash;
    entry.segment = encodeSegment(path, hash ?? null);
    return true;
  }
}
