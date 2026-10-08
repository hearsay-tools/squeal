import { createHash } from "node:crypto";
import { compare, isRecord } from "../fs/index.js";
import type {
  FileChange,
  FileHash,
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

/**
 * This worktree's view of the shared observed sets. Read from the store when
 * created and at each `refresh`; `add` merges into the store in one
 * transaction, so two worktrees' daemons never drop each other's paths.
 */
export class ObservedSets {
  readonly #sets = new Map<string, Set<RelativePath>>();
  readonly #raw = new Map<ProjectName, string | null>();

  constructor(private readonly store: Store) {}

  /** The observed paths of `testFile`, sorted; listing paths among them. Reads its project once. */
  of(testFile: TestFileRef): readonly RelativePath[] {
    if (!this.#raw.has(testFile.project)) this.refresh([testFile.project]);
    const set = this.#sets.get(id(testFile));
    return set === undefined ? [] : [...set].sort(compare);
  }

  /**
   * Merges what the store holds for `projects` into this view, read only
   * when it changed. Returns the test files whose set grew.
   */
  refresh(projects: Iterable<ProjectName>): TestFileRef[] {
    const grown: TestFileRef[] = [];
    for (const project of new Set(projects)) {
      const raw = this.store.meta.get(observedMetaKey(project));
      if (this.#raw.get(project) === raw) continue;
      this.#raw.set(project, raw);
      for (const [path, paths] of Object.entries(parse(raw))) {
        const testFile = { project, path };
        if (this.#merge(testFile, paths).length > 0) grown.push(testFile);
      }
    }
    return grown;
  }

  /** Adds `paths` to `testFile`'s set here and in the store. Returns the new ones. */
  add(testFile: TestFileRef, paths: readonly RelativePath[]): RelativePath[] {
    const added = this.#merge(testFile, paths);
    if (added.length === 0) return [];
    const key = observedMetaKey(testFile.project);
    this.store.transaction(() => {
      const merged = parse(this.store.meta.get(key));
      const known = new Set([...(merged[testFile.path] ?? []), ...added]);
      merged[testFile.path] = [...known].sort(compare);
      const value = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => compare(a, b)));
      this.store.meta.set(key, JSON.stringify(value));
      // other test files' growth this write merged is read at the next `refresh`
      this.#raw.delete(testFile.project);
    });
    return added;
  }

  #merge(testFile: TestFileRef, paths: readonly RelativePath[]): RelativePath[] {
    const key = id(testFile);
    const known = this.#sets.get(key) ?? new Set<RelativePath>();
    const added = paths.filter((p) => !known.has(p));
    for (const path of added) known.add(path);
    this.#sets.set(key, known);
    return added;
  }
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
