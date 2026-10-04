import type {
  CheckKey,
  Closure,
  EnvironmentHash,
  FileHash,
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
  readonly key: CheckKey;
}

/** One closure path, shared by every closure that references it. */
interface PathEntry {
  hash: FileHash | null;
  segment: string;
  references: number;
}

interface Keyed {
  readonly closure: Closure;
  /** `closure.paths` in order. */
  readonly entries: readonly PathEntry[];
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
 * environment hash are set.
 */
export class KeyIndex {
  readonly reverse = new ReverseIndex();
  private readonly keyed = new Map<string, Keyed>();
  private readonly paths = new Map<RelativePath, PathEntry>();
  private readonly environments = new Map<ProjectName, EnvironmentHash>();

  constructor(private readonly hashOf: (path: RelativePath) => FileHash | null) {}

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
   * Sets or replaces a test file's closure and keys it. Every path's hash is
   * read again; a path whose hash changed without a `rekey` also re-keys the
   * other test files that reference it.
   */
  setClosure(closure: Closure): KeyChange[] {
    const id = testFileId(closure.testFile);
    const previous = this.keyed.get(id);
    const stale: RelativePath[] = [];
    const entries = closure.paths.map((path) => {
      const entry = this.acquire(path);
      if (entry.references > 1 && this.refresh(path, entry)) stale.push(path);
      return entry;
    });
    if (previous) this.release(previous.closure.paths);
    this.keyed.set(id, { closure, entries, key: previous?.key ?? null });
    this.reverse.set(closure.testFile, closure.paths);

    const affected = this.reverse.referencing(stale).filter((ref) => testFileId(ref) !== id);
    return this.recompute([closure.testFile, ...affected]);
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
      const segments = keyed.entries.map((entry) => entry.segment);
      const key = keyFromSegments(envHash, testFile, segments);
      if (key === keyed.key) continue;
      changes.push({ testFile, previous: keyed.key, key });
      keyed.key = key;
    }
    return changes;
  }

  /** The entry of `path` with one more reference; a new entry reads the hash. */
  private acquire(path: RelativePath): PathEntry {
    let entry = this.paths.get(path);
    if (!entry) {
      const hash = this.hashOf(path);
      entry = { hash, segment: encodeSegment(path, hash), references: 0 };
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
    entry.segment = encodeSegment(path, hash);
    return true;
  }
}
