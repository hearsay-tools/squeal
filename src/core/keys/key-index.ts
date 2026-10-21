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
  /** `keysReadAsOne`'s keys, computed at the first call for `key` and those entries. */
  readAsOne?: {
    readonly key: CheckKey;
    readonly environments: readonly ReadAsOne[];
    readonly keys: readonly CheckKey[];
  };
}

/**
 * A project's environment hash at a format or definition read as one (011
 * C3): a format's (task 011-38) or the definition's before task 011-85,
 * which also names the installed-dependency segment a test file read then.
 */
export interface ReadAsOne {
  readonly environment: EnvironmentHash;
  /** A test file whose segment is `from` reads `to`; absent, every segment is its own. */
  readonly segment?: { readonly from: string; readonly to: string };
}

/** A test file and its keys at the formats and definitions read as one (`KeyIndex.keysReadAsOne`). */
export interface KeysReadAsOne {
  readonly testFile: TestFileRef;
  readonly keys: readonly CheckKey[];
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
  /** Each project's environment hashes at the formats and definitions read as one (011-38, 011-90). */
  private readonly readAsOne = new Map<ProjectName, readonly ReadAsOne[]>();
  /** The test file each current key belongs to, by `testFileId`. */
  private readonly ids = new Map<CheckKey, string>();

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

  /**
   * Sets a project's environment hash and re-keys its test files.
   * `readAsOne` holds its hashes at the formats read as one; a provisional
   * hash has none.
   */
  setEnvironment(
    project: ProjectName,
    envHash: EnvironmentHash,
    readAsOne: readonly ReadAsOne[] = [],
  ): KeyChange[] {
    this.readAsOne.set(project, readAsOne);
    if (this.environments.get(project) === envHash) return [];
    this.environments.set(project, envHash);
    return this.recompute(this.reverse.testFiles().filter((ref) => ref.project === project));
  }

  /**
   * Sets the environment hash of each project in `environments` and the
   * installed-dependency segment of each of their test files, then re-keys
   * once each test file whose project hash or segment moved, so no key
   * passes through a mix of old and new inputs (task 001-105). `readAsOne`
   * holds each project's hashes at the formats read as one (task 011-38) and
   * under the definition before task 011-85 (011-90).
   */
  setInstalled(
    environments: ReadonlyMap<ProjectName, EnvironmentHash>,
    dependenciesOf: (testFile: TestFileRef) => string,
    readAsOne: ReadonlyMap<ProjectName, readonly ReadAsOne[]> = new Map(),
  ): KeyChange[] {
    const moved = new Set<ProjectName>();
    for (const [project, envHash] of environments) {
      if (this.environments.get(project) !== envHash) moved.add(project);
      this.environments.set(project, envHash);
      this.readAsOne.set(project, readAsOne.get(project) ?? []);
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
    if (keyed.key !== null) this.ids.delete(keyed.key);
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

  /**
   * The test file whose current key is `key`, with its keys at the formats
   * read as one (spec 011 C3 as amended 2026-10-20, task 011-38) and under
   * the definition before task 011-85 (011-90), computed over the segments
   * the index holds, each entry's segment rule applied, once per key. `null`
   * when no test file holds `key` now.
   */
  keysReadAsOne(key: CheckKey): KeysReadAsOne | null {
    const id = this.ids.get(key);
    const keyed = id === undefined ? undefined : this.keyed.get(id);
    if (keyed === undefined || keyed.key !== key) return null;
    const { testFile } = keyed.closure;
    const environments = this.readAsOne.get(testFile.project) ?? [];
    let memo = keyed.readAsOne;
    if (memo?.key !== key || memo.environments !== environments) {
      const keys = environments.flatMap(
        (entry) => this.keyOf(keyed, entry.environment, entry.segment) ?? [],
      );
      memo = { key, environments, keys };
      keyed.readAsOne = memo;
    }
    return { testFile, keys: memo.keys };
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
      const id = testFileId(testFile);
      if (keyed.key !== null && this.ids.get(keyed.key) === id) this.ids.delete(keyed.key);
      if (key !== null) this.ids.set(key, id);
      keyed.key = key;
    }
    return changes;
  }

  /** `null` while any closure path is untracked. `rule` replaces the installed-dependency segment it names. */
  private keyOf(
    keyed: Keyed,
    envHash: EnvironmentHash,
    rule?: ReadAsOne["segment"],
  ): CheckKey | null {
    const segments: string[] = [];
    for (const entry of keyed.entries) {
      if (entry.hash === undefined) return null;
      segments.push(entry.segment);
    }
    const dependencies = rule?.from === keyed.dependencies ? rule.to : keyed.dependencies;
    return keyFromSegments(envHash, keyed.closure.testFile, segments, dependencies);
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
