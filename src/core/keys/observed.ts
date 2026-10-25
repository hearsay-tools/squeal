import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { compare, isRecord } from "../fs/index.js";
import type {
  AbsolutePath,
  FileChange,
  FileHash,
  HashSource,
  ProjectName,
  RelativePath,
  Store,
  TestFileRef,
} from "../types/index.js";

/**
 * Spec 001 D3 as amended (task 001-132): the project paths a test file's runs
 * were observed to read, stat, list, load or execute, beyond its static
 * closure. One map per project from test path to paths, shared by every
 * worktree of the repository, merged and never pruned. A listed directory is
 * held as its listing path (`listingPath`).
 */
export function observedMetaKey(project: ProjectName): string {
  return `observed.${project}`;
}

/**
 * Spec 016 D4 (row 007-56): the paths that put their test file in `direct`
 * when they change (`ObservedInputs.direct`: what a process the test file
 * started imported), its closure's paths among them. The same map and rule
 * as {@link observedMetaKey}, in a key of its own: an older daemon parses
 * that key as test path to paths.
 */
export function observedDirectMetaKey(project: ProjectName): string {
  return `observedDirect.${project}`;
}

/**
 * The closure entry of a listed directory: its path with a trailing `/`, the
 * worktree root `./`. It hashes as the directory's entry names
 * (`Listings`), so a file added to it or removed re-keys the test file.
 */
export function listingPath(directory: RelativePath): RelativePath {
  return directory === "" ? "./" : `${directory}/`;
}

/** The directory of a listing path, or `null` for a file path. */
export function listedDirectory(path: RelativePath): RelativePath | null {
  if (!path.endsWith("/")) return null;
  return path === "./" ? "" : path.slice(0, -1);
}

/** The listing paths whose entry names an add or delete of `path` can change: every ancestor's. */
export function ancestorListings(path: RelativePath): RelativePath[] {
  const out = [listingPath("")];
  for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
    out.push(listingPath(path.slice(0, at)));
  }
  return out;
}

/** The worktree's own git entry, a key input by its kind (`gitEntryByKind`). */
export const GIT_ENTRY: RelativePath = ".git";

/**
 * `hashOf` with the worktree's own `.git` hashed by its kind (task 001-262):
 * a file or a directory, `null` when absent. A linked worktree's `.git` file
 * names the worktree, as the root path does, which no key holds; by its bytes
 * a test file that reads it would never inherit across worktrees. Untracked
 * while `hashOf` does not track it, so the stability check has its entry;
 * the kind is read when asked, since the watcher never sees `.git` change.
 * Nothing under `.git/` is observed (the recorder skips it).
 */
export function gitEntryByKind(root: AbsolutePath, hashOf: HashSource): HashSource {
  return (path) => {
    const hash = hashOf(path);
    if (path !== GIT_ENTRY || hash === undefined) return hash;
    const entry = statSync(join(root, path), { throwIfNoEntry: false });
    if (entry === undefined) return null;
    const kind = entry.isDirectory() ? "directory" : "file";
    return createHash("sha1").update(`.git ${kind}`).digest("hex");
  };
}

/**
 * This worktree's view of the shared observed sets and their `direct`
 * marks. Read from the store when created and at each `refresh`; `add`
 * merges into the store in one transaction, so two worktrees' daemons never
 * drop each other's paths. `mark` adds marks to the view only; `writeMarks`,
 * inside a record's transaction, merges into the store what the view holds
 * and the store lacks, so a write a rolled-back transaction lost is made by
 * the next record, as `StartupSets.write` does.
 */
export class ObservedSets {
  readonly #sets = new Map<string, Set<RelativePath>>();
  readonly #direct = new Map<string, Set<RelativePath>>();
  readonly #raw = new Map<ProjectName, { paths: string | null; direct: string | null }>();
  /** Test files `mark` marked a path of: `writeMarks` compares their views with the store. */
  readonly #marked = new Map<string, TestFileRef>();

  constructor(private readonly store: Store) {}

  /** The observed paths of `testFile`, sorted; listing paths among them. Reads its project once. */
  of(testFile: TestFileRef): readonly RelativePath[] {
    return this.#read(this.#sets, testFile);
  }

  /** The paths that put `testFile` in `direct` (016 D4), sorted. */
  directOf(testFile: TestFileRef): readonly RelativePath[] {
    return this.#read(this.#direct, testFile);
  }

  /**
   * Merges what the store holds for `projects` into this view, read only
   * when it changed. Returns the test files whose set grew.
   */
  refresh(projects: Iterable<ProjectName>): TestFileRef[] {
    const grown: TestFileRef[] = [];
    for (const project of new Set(projects)) {
      const raw = {
        paths: this.store.meta.get(observedMetaKey(project)),
        direct: this.store.meta.get(observedDirectMetaKey(project)),
      };
      const last = this.#raw.get(project);
      if (last?.paths === raw.paths && last.direct === raw.direct) continue;
      this.#raw.set(project, raw);
      for (const [path, paths] of Object.entries(parse(raw.paths))) {
        const testFile = { project, path };
        if (merge(this.#sets, testFile, paths).length > 0) grown.push(testFile);
      }
      for (const [path, paths] of Object.entries(parse(raw.direct))) {
        merge(this.#direct, { project, path }, paths);
      }
    }
    return grown;
  }

  /** Adds `paths` to `testFile`'s set, here and in the store. Returns the new ones. */
  add(testFile: TestFileRef, paths: readonly RelativePath[]): RelativePath[] {
    const added = merge(this.#sets, testFile, paths);
    if (added.length === 0) return [];
    const key = observedMetaKey(testFile.project);
    this.store.transaction(() => {
      this.store.meta.set(key, merged(this.store.meta.get(key), testFile, added));
      // other test files' growth this write merged is read at the next `refresh`
      this.#raw.delete(testFile.project);
    });
    return added;
  }

  /**
   * Adds `direct`, paths a process `testFile` started imported, to its marks
   * in this view, not in the store (row 007-56). Returns the new ones.
   */
  mark(testFile: TestFileRef, direct: readonly RelativePath[]): RelativePath[] {
    if (!this.#raw.has(testFile.project)) this.refresh([testFile.project]);
    const added = merge(this.#direct, testFile, direct);
    if (added.length > 0) this.#marked.set(id(testFile), testFile);
    return added;
  }

  /** Merges into the store each marked file's marks it lacks, one transaction per project. */
  writeMarks(): void {
    const projects = new Set([...this.#marked.values()].map((f) => f.project));
    for (const project of projects) {
      const key = observedDirectMetaKey(project);
      this.store.transaction(() => {
        const stored = parse(this.store.meta.get(key));
        let raw: string | null = null;
        for (const testFile of this.#marked.values()) {
          if (testFile.project !== project) continue;
          const held = new Set(stored[testFile.path] ?? []);
          const missing = this.directOf(testFile).filter((p) => !held.has(p));
          if (missing.length === 0) continue;
          raw = merged(raw ?? this.store.meta.get(key), testFile, missing);
        }
        if (raw === null) return;
        this.store.meta.set(key, raw);
        this.#raw.delete(project);
      });
    }
  }

  #read(sets: Map<string, Set<RelativePath>>, testFile: TestFileRef): readonly RelativePath[] {
    if (!this.#raw.has(testFile.project)) this.refresh([testFile.project]);
    const set = sets.get(id(testFile));
    return set === undefined ? [] : [...set].sort(compare);
  }
}

function merge(
  sets: Map<string, Set<RelativePath>>,
  testFile: TestFileRef,
  paths: readonly RelativePath[],
): RelativePath[] {
  const key = id(testFile);
  const known = sets.get(key) ?? new Set<RelativePath>();
  const added = paths.filter((p) => !known.has(p));
  for (const path of added) known.add(path);
  sets.set(key, known);
  return added;
}

/** The stored map `raw` with `added` merged into `testFile`'s entry, as stored: sorted. */
function merged(raw: string | null, testFile: TestFileRef, added: readonly RelativePath[]): string {
  const map = parse(raw);
  map[testFile.path] = [...new Set([...(map[testFile.path] ?? []), ...added])].sort(compare);
  return JSON.stringify(Object.fromEntries(Object.entries(map).sort(([a], [b]) => compare(a, b))));
}

/**
 * The entry names of every directory, from the files the watcher tracks: a
 * directory's entries are the names of its files and of its subdirectories
 * that hold a tracked file. Built on first use, then kept by `apply`.
 */
export class Listings {
  /** directory -> entry name -> tracked files below it. */
  #entries: Map<RelativePath, Map<string, number>> | null = null;

  constructor(private readonly files: () => Iterable<RelativePath>) {}

  /** The hash of `directory`'s sorted entry names; `null` when it has none. */
  hashOf(directory: RelativePath): FileHash | null {
    const names = this.#index().get(directory);
    if (names === undefined || names.size === 0) return null;
    const sorted = [...names.keys()].sort(compare);
    return createHash("sha1").update(sorted.join("\0")).digest("hex");
  }

  /**
   * The listing paths of `directory` and of every directory below it that
   * holds a tracked file, sorted: what a recursive listing of `directory`
   * returned names from (review wave 12d, B5; task 001-134). An add or delete
   * anywhere below moves one of them, since each holds immediate names only.
   */
  below(directory: RelativePath): RelativePath[] {
    const prefix = directory === "" ? "" : `${directory}/`;
    const out = [listingPath(directory)];
    for (const [listed, names] of this.#index()) {
      if (listed !== directory && listed.startsWith(prefix) && names.size > 0) {
        out.push(listingPath(listed));
      }
    }
    return out.sort(compare);
  }

  /** Applies the adds and deletes among `changes`; returns the listing paths they may move. */
  apply(changes: readonly FileChange[]): RelativePath[] {
    const moved = new Set<RelativePath>();
    for (const change of changes) {
      const added = change.oldHash === null && change.newHash !== null;
      const deleted = change.newHash === null && change.oldHash !== null;
      if (!added && !deleted) continue;
      for (const listing of ancestorListings(change.path)) moved.add(listing);
      if (this.#entries !== null) this.#count(this.#entries, change.path, added ? 1 : -1);
    }
    return [...moved];
  }

  #index(): Map<RelativePath, Map<string, number>> {
    if (this.#entries === null) {
      const entries = new Map<RelativePath, Map<string, number>>();
      for (const path of this.files()) this.#count(entries, path, 1);
      this.#entries = entries;
    }
    return this.#entries;
  }

  #count(entries: Map<RelativePath, Map<string, number>>, path: RelativePath, by: 1 | -1): void {
    let directory = "";
    let rest = path;
    for (;;) {
      const at = rest.indexOf("/");
      const name = at < 0 ? rest : rest.slice(0, at);
      const names = entries.get(directory) ?? new Map<string, number>();
      const count = (names.get(name) ?? 0) + by;
      if (count > 0) names.set(name, count);
      else names.delete(name);
      entries.set(directory, names);
      if (at < 0) return;
      directory = directory === "" ? name : `${directory}/${name}`;
      rest = rest.slice(at + 1);
    }
  }
}

function id(testFile: TestFileRef): string {
  return `${testFile.project}\0${testFile.path}`;
}

/** A missing or malformed key reads as nothing observed. */
function parse(raw: string | null): Record<RelativePath, RelativePath[]> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([testFile, paths]) =>
      Array.isArray(paths) ? [[testFile, paths.filter((p) => typeof p === "string")]] : [],
    ),
  );
}
