import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
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
 * marks, one `SharedPaths` per project and key. `see` and `mark` add to the
 * view only; `write`, inside the record's transaction, merges into the store
 * what the view holds and the store lacks.
 */
export class ObservedSets {
  readonly #paths = new Map<ProjectName, SharedPaths>();
  readonly #direct = new Map<ProjectName, SharedPaths>();

  constructor(private readonly store: Store) {}

  /** The observed paths of `testFile`, sorted; listing paths among them. Reads its project once. */
  of(testFile: TestFileRef): readonly RelativePath[] {
    return this.#pathsOf(testFile.project).of(testFile.path);
  }

  /** The paths that put `testFile` in `direct` (016 D4), sorted. */
  directOf(testFile: TestFileRef): readonly RelativePath[] {
    return this.#directOf(testFile.project).of(testFile.path);
  }

  /**
   * Merges what the store holds for `projects` into this view, read only
   * when it changed. Returns the test files whose set grew.
   */
  refresh(projects: Iterable<ProjectName>): TestFileRef[] {
    return [...new Set(projects)].flatMap((project) => {
      this.#directOf(project).refresh();
      return this.#pathsOf(project)
        .refresh()
        .map((path) => ({ project, path }));
    });
  }

  /** Adds `paths` to `testFile`'s set in this view, not in the store (row 016-29). Returns the new ones. */
  see(testFile: TestFileRef, paths: readonly RelativePath[]): RelativePath[] {
    return this.#pathsOf(testFile.project).see(testFile.path, paths);
  }

  /** `see`, then `write`: for a caller outside a record. */
  add(testFile: TestFileRef, paths: readonly RelativePath[]): RelativePath[] {
    const added = this.see(testFile, paths);
    this.write();
    return added;
  }

  /**
   * Adds `direct`, paths a process `testFile` started imported, to its marks
   * in this view, not in the store (row 007-56). Returns the new ones.
   */
  mark(testFile: TestFileRef, direct: readonly RelativePath[]): RelativePath[] {
    return this.#directOf(testFile.project).see(testFile.path, direct);
  }

  /** Merges into the store each set and mark the view holds and the store lacks. */
  write(): void {
    for (const paths of this.#paths.values()) paths.write();
    for (const direct of this.#direct.values()) direct.write();
  }

  #pathsOf(project: ProjectName): SharedPaths {
    return viewOf(
      this.#paths,
      project,
      () => new SharedPaths(this.store, observedMetaKey(project)),
    );
  }

  #directOf(project: ProjectName): SharedPaths {
    return viewOf(
      this.#direct,
      project,
      () => new SharedPaths(this.store, observedDirectMetaKey(project)),
    );
  }
}

/** The view of `project` in `views`, made by `make` at the first ask. */
export function viewOf<V>(views: Map<ProjectName, V>, project: ProjectName, make: () => V): V {
  const view = views.get(project) ?? make();
  views.set(project, view);
  return view;
}

/** The one entry of a key stored as an array of paths (`SharedPaths`, the list shape). */
const LIST = "";

/**
 * This worktree's view of the paths kept in one `meta` key that every
 * worktree of the repository shares, merges and never prunes (row 016-29): a
 * map of test path to paths, or, in the list shape, one array. Read from the
 * store at the first ask and at each `refresh`, parsed only when the value
 * changed; after that first ask only `refresh` reads it, so every entry that
 * grew from the store is reported once (row 016-31). `see` adds paths to the
 * view only. `write`, once per transaction,
 * reads the key inside it and merges what the view saw and the store lacks,
 * so two worktrees' daemons never drop each other's paths. A path stays
 * unwritten until a later `write` finds it stored, so the next record makes
 * a write a rolled-back transaction lost. Until then the view is ahead of
 * the store, and no committed result is keyed with the path.
 */
export class SharedPaths {
  readonly #sets = new Map<string, Set<RelativePath>>();
  /** The stored value last merged into the view; `undefined` until the first read. */
  #read: string | null | undefined = undefined;
  /** Per entry: the paths `see` added that no `write` has found stored yet. */
  readonly #unwritten = new Map<string, Set<RelativePath>>();

  constructor(
    private readonly store: Store,
    readonly key: string,
    private readonly shape: "map" | "list" = "map",
  ) {}

  /** The paths of `entry`, sorted; the list shape's entry is `""`. */
  of(entry: string = LIST): readonly RelativePath[] {
    if (this.#read === undefined) this.refresh();
    return [...(this.#sets.get(entry) ?? [])].sort(compare);
  }

  /** Merges what the store holds into the view, when it changed. Returns the entries that grew. */
  refresh(): string[] {
    const { key } = this;
    const raw = this.store.meta.get(key);
    if (raw === this.#read) return [];
    this.#read = raw;
    const grown: string[] = [];
    for (const [entry, paths] of Object.entries(parse(raw, this.shape))) {
      if (merge(this.#sets, entry, paths).length > 0) grown.push(entry);
    }
    return grown;
  }

  /** Adds `paths` to `entry` in the view, not in the store. Returns the new ones. */
  see(entry: string, paths: readonly RelativePath[]): RelativePath[] {
    if (this.#read === undefined) this.refresh();
    const added = merge(this.#sets, entry, paths);
    if (added.length > 0) merge(this.#unwritten, entry, added);
    return added;
  }

  /** Merges into the store the paths `see` added that it lacks, in one transaction. */
  write(): void {
    if (this.#unwritten.size === 0) return;
    const { key } = this;
    this.store.transaction(() => {
      const stored = parse(this.store.meta.get(key), this.shape);
      let missing = false;
      for (const [entry, paths] of this.#unwritten) {
        const held = new Set(stored[entry] ?? []);
        const lacked = [...paths].filter((p) => !held.has(p));
        if (lacked.length === 0) this.#unwritten.delete(entry);
        else {
          stored[entry] = [...held, ...lacked].sort(compare);
          missing = true;
        }
      }
      if (!missing) return;
      // other worktrees' paths this write merged reach the view, as growth, at the next `refresh`
      this.store.meta.set(key, format(stored, this.shape));
    });
  }
}

function merge(
  sets: Map<string, Set<RelativePath>>,
  entry: string,
  paths: readonly RelativePath[],
): RelativePath[] {
  const known = sets.get(entry) ?? new Set<RelativePath>();
  const added = paths.filter((p) => !known.has(p));
  for (const path of added) known.add(path);
  sets.set(entry, known);
  return added;
}

/** The stored text of `entries`, as every daemon writes it: entries and paths sorted. */
function format(entries: Record<string, RelativePath[]>, shape: "map" | "list"): string {
  if (shape === "list") return JSON.stringify(entries[LIST] ?? []);
  return JSON.stringify(
    Object.fromEntries(Object.entries(entries).sort(([a], [b]) => compare(a, b))),
  );
}

/**
 * The hashes of a listed directory the watcher sees no file in that holds no
 * names on disk (row 016-26): absent, or empty. No list of names joins to
 * either text, since no name is empty, so neither keys as a listing of
 * names, nor as none, as every such listing did before 0.1.316.
 */
export const ABSENT_LISTING: FileHash = createHash("sha1").update("\0absent").digest("hex");
const EMPTY_LISTING: FileHash = createHash("sha1").update("\0empty").digest("hex");

/**
 * The entry names of every directory, from the files the watcher tracks: a
 * directory's entries are the names of its files and of its subdirectories
 * that hold a tracked file. Built on first use, then kept by `apply`. A
 * directory the watcher sees no file in, a git-ignored one say, has the
 * names on disk below `root` instead, read when its key is computed (row
 * 016-23), and again at each revision (`apply`, row 016-24): no change the
 * watcher reports moves them. Absent or empty there, it hashes as a marker
 * of its own (row 016-26).
 */
export class Listings {
  /** directory -> entry name -> tracked files below it. */
  #entries: Map<RelativePath, Map<string, number>> | null = null;
  /** Each directory hashed from disk -> the hash of the names last seen there (row 016-24). */
  readonly #seen = new Map<RelativePath, FileHash>();

  constructor(
    private readonly files: () => Iterable<RelativePath>,
    private readonly root: AbsolutePath,
  ) {}

  /** The hash of `directory`'s sorted entry names; a marker when it holds none. */
  hashOf(directory: RelativePath): FileHash {
    const names = this.#index().get(directory);
    if (names !== undefined && names.size > 0) {
      this.#seen.delete(directory);
      return namesHash([...names.keys()]);
    }
    const hash = this.#onDisk(directory);
    this.#seen.set(directory, hash);
    return hash;
  }

  /**
   * A run of the only test file that lists `directories` ended (row 016-24):
   * the names each one hashed from disk holds now are that run's own, a test
   * that writes into the directory it lists say. `apply` then moves its
   * listing only when its names differ from these; the keys keep the names
   * the run began with.
   */
  ran(directories: readonly RelativePath[]): void {
    for (const directory of directories) {
      if (this.#seen.has(directory)) this.#seen.set(directory, this.#onDisk(directory));
    }
  }

  /** The hash of the names `directory` holds on disk, a marker when it holds none. */
  #onDisk(directory: RelativePath): FileHash {
    let names: string[];
    try {
      names = readdirSync(join(this.root, directory));
    } catch {
      return ABSENT_LISTING;
    }
    return names.length === 0 ? EMPTY_LISTING : namesHash(names);
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

  /**
   * Applies the adds and deletes among `changes`, and reads each directory
   * hashed from disk again (row 016-24); returns the listing paths they may
   * move: those the changes reach, and those whose names differ from the
   * names last seen.
   */
  apply(changes: readonly FileChange[]): RelativePath[] {
    const moved = new Set<RelativePath>();
    for (const change of changes) {
      const added = change.oldHash === null && change.newHash !== null;
      const deleted = change.newHash === null && change.oldHash !== null;
      if (!added && !deleted) continue;
      for (const listing of ancestorListings(change.path)) moved.add(listing);
      if (this.#entries !== null) this.#count(this.#entries, change.path, added ? 1 : -1);
    }
    for (const [directory, seen] of this.#seen) {
      const hash = this.#onDisk(directory);
      if (hash === seen) continue;
      this.#seen.set(directory, hash);
      moved.add(listingPath(directory));
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

/** The hash of a listing's entry names, sorted. */
function namesHash(names: string[]): FileHash {
  return createHash("sha1").update(names.sort(compare).join("\0")).digest("hex");
}

/** A missing or malformed key reads as nothing observed; a list as its one entry. */
function parse(raw: string | null, shape: "map" | "list"): Record<string, RelativePath[]> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  const entries = shape === "list" ? { [LIST]: value } : value;
  if (!isRecord(entries)) return {};
  return Object.fromEntries(
    Object.entries(entries).flatMap(([entry, paths]) =>
      Array.isArray(paths) ? [[entry, paths.filter((p) => typeof p === "string")]] : [],
    ),
  );
}
