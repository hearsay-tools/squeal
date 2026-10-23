import { join, posix } from "node:path";
import { compare, isRecord } from "../fs/index.js";
import type { AbsolutePath, PackageImport, RelativePath } from "../types/index.js";
import { PackageScans } from "./package-scans.js";
import type { PackageGraph } from "./packages.js";
import { type PnpmLockfile, pnpmFolderName } from "./pnpm-lockfile.js";

/** pnpm's virtual store, relative to the directory that holds `node_modules`. */
const VIRTUAL_STORE = "node_modules/.pnpm/";

/** pnpm's default `virtualStoreDirMaxLength`. */
const FOLDER_MAX_LENGTH = 120;

/**
 * The installed pnpm dependency graph of one install, from its
 * `node_modules/.pnpm/lock.yaml` and `node_modules/.modules.yaml`.
 *
 * Task 011-162 (011 C11, design sections 1 and 2): a package entry Vite
 * resolved, `node_modules/.pnpm/<folder>/node_modules/<name>/…`, is the
 * snapshot whose folder pnpm names `<folder>` (`pnpmFolderName`); another
 * name from such a folder resolves through that snapshot's edges, pnpm's
 * private hoisting, then the root. A bare or required name resolves to the
 * nearest importer at or above the importer's directory that declares it,
 * at the root also to a name hoisted publicly. A key holds `<snapshot
 * id>#<integrity>` and the snapshot's resolved edges, sorted; the closure
 * follows each snapshot's `dependencies` and `optionalDependencies`, which
 * hold its resolved peers. A skipped optional package keys by its identity
 * and is neither expanded nor scanned. A folder no snapshot names and a
 * snapshot without an integrity are opaque, so the file keys by the whole
 * fingerprint. Markers as for npm (`InstalledGraph`): `absent:`,
 * `workspace:`, `@types-only`.
 */
export class PnpmGraph implements PackageGraph {
  /** The `.pnpm` folder of each snapshot, by id. */
  readonly folders: ReadonlyMap<string, string>;
  /** Snapshots `.modules.yaml` lists as skipped: optional packages pnpm did not install. */
  readonly skipped: ReadonlySet<string>;
  /** The snapshot each publicly hoisted name at the root links to. */
  readonly publicHoisted: ReadonlyMap<string, string>;
  /** The snapshot each privately hoisted name in `.pnpm/node_modules` links to. */
  readonly privateHoisted: ReadonlyMap<string, string>;
  readonly #snapshotOf = new Map<string, string>();
  readonly #closures = new Map<string, readonly string[]>();
  /** The package folder of each installed identity a closure produced. */
  readonly #packageFolders = new Map<string, string>();

  /**
   * `base` is the directory holding `node_modules`, relative to the worktree
   * root (`""` for the root); `modules` is `.modules.yaml` as parsed JSON.
   * `scans` caches the on-disk scans by identity.
   */
  constructor(
    readonly dir: AbsolutePath,
    readonly base: RelativePath,
    readonly lockfile: PnpmLockfile,
    modules: Readonly<Record<string, unknown>>,
    private readonly scans: PackageScans = new PackageScans(),
  ) {
    const max = modules.virtualStoreDirMaxLength;
    const length = typeof max === "number" ? max : FOLDER_MAX_LENGTH;
    const folders = new Map<string, string>();
    for (const id of lockfile.snapshots.keys()) {
      const folder = pnpmFolderName(id, length);
      folders.set(id, folder);
      this.#snapshotOf.set(folder, id);
    }
    this.folders = folders;
    const skipped = Array.isArray(modules.skipped) ? modules.skipped : [];
    this.skipped = new Set(skipped.filter((id) => typeof id === "string"));
    const publicHoisted = new Map<string, string>();
    const privateHoisted = new Map<string, string>();
    const hoisted = isRecord(modules.hoistedDependencies) ? modules.hoistedDependencies : {};
    for (const [id, aliases] of Object.entries(hoisted)) {
      if (!isRecord(aliases)) continue;
      for (const [alias, kind] of Object.entries(aliases)) {
        if (kind === "public") publicHoisted.set(alias, id);
        else if (kind === "private") privateHoisted.set(alias, id);
      }
    }
    this.publicHoisted = publicHoisted;
    this.privateHoisted = privateHoisted;
  }

  /** The sorted identities of every installed package `imports` can load, without those in `exclude`. */
  identities(imports: readonly PackageImport[], exclude?: ReadonlySet<string>): string[] {
    const found = new Set<string>();
    const starts = new Set<string>();
    for (const { from, name, manifest } of imports) {
      const local = this.#local(from);
      const target = local === null ? null : this.#resolve(local, name);
      if (target === null) found.add(`absent:${local ?? from}>${name}`);
      else if (isMarker(target)) found.add(target);
      else if (manifest === true) found.add(this.#identity(target));
      else starts.add(target);
    }
    for (const id of starts) {
      for (const identity of this.#closure(id)) found.add(identity);
    }
    return [...found].filter((identity) => !exclude?.has(identity)).sort(compare);
  }

  /**
   * Whether one of `identities`, as `identities()` returned them, is a
   * folder no snapshot names, a snapshot without an integrity, or a package
   * whose code reaches `child_process`, `worker_threads`, `module` or
   * `cluster` (task 001-109). Scanned once per identity.
   */
  opaque(identities: readonly string[]): boolean {
    return identities.some((identity) => {
      if (identity.startsWith("unknown:") || identity.startsWith("nointegrity:")) return true;
      const folder = this.#packageFolders.get(identity);
      return (
        folder !== undefined && this.scans.opaque(this.#scanId(identity), join(this.dir, folder))
      );
    });
  }

  /** A worktree-relative directory relative to the install, or `null` when outside it. */
  #local(from: RelativePath): string | null {
    const prefix = this.base === "" ? "" : `${this.base}/`;
    if (from === this.base) return "";
    return from.startsWith(prefix) ? from.slice(prefix.length) : null;
  }

  /** The snapshot id `name` resolves to from `from`, a marker, or `null` when absent. */
  #resolve(from: string, name: string): string | null {
    if (!from.startsWith(VIRTUAL_STORE)) return this.#fromImporters(from, name);
    const folder = from.slice(VIRTUAL_STORE.length).split("/")[0] ?? "";
    const id = this.#snapshotOf.get(folder);
    if (id === undefined) return `unknown:${folder}`;
    if (nameOf(id) === name) return id;
    const ref = this.lockfile.snapshots.get(id)?.get(name);
    if (ref !== undefined) return childOf(name, ref);
    return this.privateHoisted.get(name) ?? this.#fromImporters("", name);
  }

  /** Node's walk from a project directory: pnpm creates `node_modules` only in importers. */
  #fromImporters(from: string, name: string): string | null {
    for (let dir = from; ; dir = parent(dir)) {
      const ref = this.lockfile.importers.get(dir === "" ? "." : dir)?.get(name);
      if (ref?.startsWith("link:")) return workspace(dir, ref);
      if (ref !== undefined) return childOf(name, ref);
      if (dir === "") return this.publicHoisted.get(name) ?? null;
    }
  }

  /** `<id>#<integrity>` and its sorted edges, or a marker the closure does not expand. */
  #identity(id: string): string {
    const edges = this.lockfile.snapshots.get(id);
    if (edges === undefined) return `unknown:${id}`;
    const integrity = this.lockfile.integrity.get(id.replace(/\(.*$/, ""));
    if (integrity === undefined) return `nointegrity:${id}`;
    if (this.skipped.has(id)) return `skipped:${id}#${integrity}`;
    const names = [...edges].map(([name, ref]) => `${name}@${ref}`).sort(compare);
    return names.length === 0 ? `${id}#${integrity}` : `${id}#${integrity}>${names.join(",")}`;
  }

  /** Identities of `start` and everything it can load, memoized per snapshot. */
  #closure(start: string): readonly string[] {
    const memo = this.#closures.get(start);
    if (memo !== undefined) return memo;
    const identities: string[] = [];
    const seen = new Set<string>();
    const stack = [start];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const identity = isMarker(id) ? id : this.#identity(id);
      if (!identity.startsWith(`${id}#`)) {
        identities.push(identity);
        continue;
      }
      const folder = `${VIRTUAL_STORE}${this.folders.get(id)}/node_modules/${nameOf(id)}`;
      if (this.scans.typesOnly(this.#scanId(identity), join(this.dir, folder))) {
        identities.push(`${id}@types-only`);
        continue;
      }
      identities.push(identity);
      this.#packageFolders.set(identity, folder);
      for (const [name, ref] of this.lockfile.snapshots.get(id) ?? [])
        stack.push(childOf(name, ref));
    }
    this.#closures.set(start, identities);
    return identities;
  }

  /** An identity is unique within one install; the install's directory makes it unique across. */
  #scanId(identity: string): string {
    return `${this.dir}\0${identity}`;
  }
}

/** A lookup result that is no snapshot id: a workspace or a folder no snapshot names. */
function isMarker(target: string): boolean {
  return target.startsWith("workspace:") || target.startsWith("unknown:");
}

/** The package name of a snapshot id: `name` or `@scope/name`, before the version's `@`. */
function nameOf(id: string): string {
  return id.slice(0, id.indexOf("@", 1));
}

/** The snapshot an edge names: `name@ref`, or the ref itself for an alias (`other@1.0.0`). */
export function childOf(name: string, ref: string): string {
  if (ref.startsWith("link:")) return workspace("", ref);
  return ref.replace(/\(.*$/, "").indexOf("@", 1) > 0 ? ref : `${name}@${ref}`;
}

/** A `link:` version as the workspace it names, relative to the install. */
function workspace(dir: string, ref: string): string {
  return `workspace:${posix.normalize(posix.join(dir, ref.slice("link:".length)))}`;
}

function parent(dir: string): string {
  const up = posix.dirname(dir);
  return up === "." ? "" : up;
}
