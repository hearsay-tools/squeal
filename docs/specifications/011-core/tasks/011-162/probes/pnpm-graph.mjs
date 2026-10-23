// 011-162 probe, not product code: the design's lookup (section 1), identity (2) and trust rule (3)
// over pnpm's installed `node_modules/.pnpm/lock.yaml`, shaped like `InstalledGraph` so the core's
// `dependencyKeys` takes it unchanged (it calls only `identities` and `opaque`).
import { hash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parse } from "yaml";

export const PNPM_LOCKFILE = "node_modules/.pnpm/lock.yaml";
const IMPORTER_EDGES = ["dependencies", "devDependencies", "optionalDependencies"];
const SNAPSHOT_EDGES = ["dependencies", "optionalDependencies"];

// pnpm 10.32.0 `depPathToFilename` (dist/pnpm.cjs); pnpm 12.11.2 names every cezar folder the same.
export function depPathToFilename(depPath, max) {
  let name = unescaped(depPath).replace(/[\\/:*?"<>|#]/g, "+");
  if (name.includes("(")) name = name.replace(/\)$/, "").replace(/\)\(|\(|\)/g, "_");
  if (name.length > max || (name !== name.toLowerCase() && !name.startsWith("file+"))) {
    return `${name.substring(0, max - 33)}_${hash("sha256", name, "hex").substring(0, 32)}`;
  }
  return name;
}
function unescaped(depPath) {
  if (depPath.startsWith("file:")) return depPath.replace(":", "+");
  const at = depPath.indexOf("@", 1);
  return at === -1 ? depPath : `${depPath.substring(0, at)}@${depPath.slice(at + 1)}`;
}

/** The parsed install at `dir`, or `{ reason }` when the design keeps the whole fingerprint. */
export function readInstall(dir) {
  const t0 = performance.now();
  let lock;
  let modules;
  try {
    lock = parse(readFileSync(join(dir, PNPM_LOCKFILE), "utf8"));
    modules = parse(readFileSync(join(dir, "node_modules/.modules.yaml"), "utf8"));
  } catch (error) {
    return { reason: `unreadable: ${error.message.split("\n")[0]}` };
  }
  const parseMs = performance.now() - t0;
  if (modules?.nodeLinker !== "isolated") return { reason: `nodeLinker ${modules?.nodeLinker}` };
  if (modules.virtualStoreDir !== ".pnpm") return { reason: `virtualStoreDir ${modules.virtualStoreDir}` };
  if (modules.enableGlobalVirtualStore === true) return { reason: "global virtual store" };
  const max = modules.virtualStoreDirMaxLength ?? 120;
  const skipped = new Set(modules.skipped ?? []);
  const snapshots = lock?.snapshots ?? {};
  const dirOf = new Map();
  const idOfDir = new Map();
  for (const id of Object.keys(snapshots)) {
    const name = depPathToFilename(id, max);
    dirOf.set(id, name);
    idOfDir.set(name, id);
  }
  const hoisted = { private: new Map(), public: new Map() };
  for (const [id, aliases] of Object.entries(modules.hoistedDependencies ?? {})) {
    for (const [alias, kind] of Object.entries(aliases)) hoisted[kind]?.set(alias, id);
  }
  return { lock, modules, snapshots, dirOf, idOfDir, skipped, hoisted, parseMs };
}

/**
 * Section 3's rule: why `lock.yaml` does not describe the install, or `null`. Every snapshot not
 * skipped has its folder; no snapshot's folder, and no importer's `node_modules` entry, is newer
 * than `lock.yaml`; each importer's `node_modules` holds only its declared names (plus the public
 * hoisted at the root). A `.pnpm` folder no snapshot names is an orphan pnpm keeps until
 * `modules-cache-max-age` (7 days) and nothing links to: counted in `install.orphans`, not stale.
 * `ORPHANS_STALE=1` restores the first version, which counted them as unlisted.
 */
export function staleLock(dir, install) {
  const lockTime = lstatSync(join(dir, PNPM_LOCKFILE)).mtimeMs;
  const store = join(dir, "node_modules/.pnpm");
  const entries = readdirSync(store).filter((name) => name !== "node_modules" && name !== "lock.yaml");
  const present = new Set(entries);
  const orphans = entries.filter((name) => !install.idOfDir.has(name));
  install.orphans = orphans.length;
  const unlisted = process.env.ORPHANS_STALE === "1" ? orphans : [];
  const missing = [...install.dirOf]
    .filter(([id, name]) => !install.skipped.has(id) && !present.has(name))
    .map(([id]) => id);
  // npm's rule compares the package folder; here `.pnpm/<folder>/node_modules/<name>`.
  const newer = entries
    .filter((name) => install.idOfDir.has(name))
    .filter((name) => {
      const folder = join(store, name, "node_modules", nameOf(install.idOfDir.get(name)));
      return lstatSync(folder, { throwIfNoEntry: false }) === undefined
        ? missingFolder(name)
        : lstatSync(folder).mtimeMs > lockTime;
    });
  function missingFolder(name) {
    missing.push(`${name} (package folder)`);
    return false;
  }
  const undeclared = [];
  for (const [path, importer] of Object.entries(install.lock.importers ?? {})) {
    const local = path === "." ? "" : path;
    const declared = new Set(IMPORTER_EDGES.flatMap((field) => Object.keys(importer[field] ?? {})));
    if (local === "") for (const alias of install.hoisted.public.keys()) declared.add(alias);
    for (const name of namesIn(join(dir, local, "node_modules"))) {
      if (!declared.has(name)) undeclared.push(posix.join(local, "node_modules", name));
      else if (lstatSync(join(dir, local, "node_modules", name)).mtimeMs > lockTime) newer.push(name);
    }
  }
  const parts = [
    ["not listed in it", [...unlisted, ...undeclared]],
    ["newer than it", newer],
    ["missing", missing],
  ].filter(([, paths]) => paths.length > 0);
  return parts.length === 0 ? null : parts.map(([label, paths]) => `${label}: ${paths[0]}${paths.length > 1 ? ` and ${paths.length - 1} more` : ""}`).join("; ");
}

/** Package names in a `node_modules` folder, dot entries and `.bin` left out. */
function namesIn(modules) {
  let entries;
  try {
    entries = readdirSync(modules, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const child of readdirSync(join(modules, entry.name))) names.push(`${entry.name}/${child}`);
    } else names.push(entry.name);
  }
  return names;
}

const VIRTUAL = "node_modules/.pnpm/";

/** The installed pnpm graph of one install: `InstalledGraph`'s two methods over `lock.yaml`. */
export class PnpmGraph {
  #closures = new Map();
  #folders = new Map();
  constructor(dir, base, install, scans, { edges = true } = {}) {
    this.dir = dir;
    this.base = base;
    this.install = install;
    this.scans = scans;
    this.edges = edges;
    this.unknown = 0;
  }

  identities(imports, exclude) {
    const found = new Set();
    const starts = new Set();
    for (const { from, name, manifest } of imports) {
      const local = this.#local(from);
      const target = local === null ? null : this.#resolve(local, name);
      if (target === null) found.add(`absent:${local ?? from}>${name}`);
      else if (target.startsWith("workspace:") || target.startsWith("unknown:")) found.add(target);
      else if (manifest === true) found.add(this.#identity(target));
      else starts.add(target);
    }
    for (const id of starts) for (const identity of this.#closure(id)) found.add(identity);
    return [...found].filter((identity) => !exclude?.has(identity)).sort();
  }

  opaque(identities) {
    return identities.some((identity) => {
      if (identity.startsWith("unknown:") || identity.startsWith("nointegrity:")) return true;
      const folder = this.#folders.get(identity);
      return folder !== undefined && this.scans.opaque(`${this.dir}\0${identity}`, join(this.dir, folder));
    });
  }

  #local(from) {
    if (this.base === "") return from;
    if (from === this.base) return "";
    return from.startsWith(`${this.base}/`) ? from.slice(this.base.length + 1) : null;
  }

  /** A snapshot id, `workspace:<path>`, `unknown:<…>` or `null` (absent). */
  #resolve(from, name) {
    if (from.startsWith(VIRTUAL)) {
      // A package entry Vite resolved: `node_modules/.pnpm/<folder>` and the package's own name,
      // or a sibling the folder's `node_modules` links (its edges), then the hoisted ones.
      const folder = from.slice(VIRTUAL.length).split("/")[0];
      const id = this.install.idOfDir.get(folder);
      if (id === undefined) return `unknown:${folder}`;
      if (nameOf(id) === name) return id;
      const ref = edgeRef(this.install.snapshots[id], name);
      if (ref !== undefined) return childId(name, ref);
      return this.install.hoisted.private.get(name) ?? this.#fromImporters("", name);
    }
    return this.#fromImporters(from, name);
  }

  /** Node's walk from a project directory: each importer's declared names, then the public hoisted. */
  #fromImporters(from, name) {
    for (let dir = from; ; dir = parent(dir)) {
      const importer = this.install.lock.importers?.[dir === "" ? "." : dir];
      if (importer !== undefined) {
        for (const field of IMPORTER_EDGES) {
          const spec = importer[field]?.[name];
          if (spec === undefined) continue;
          const ref = typeof spec === "string" ? spec : spec.version;
          if (ref.startsWith("link:")) return `workspace:${posix.normalize(posix.join(dir, ref.slice(5)))}`;
          return childId(name, ref);
        }
      }
      if (dir === "") return this.install.hoisted.public.get(name) ?? null;
    }
  }

  #identity(id) {
    const snapshot = this.install.snapshots[id];
    if (snapshot === undefined) return `unknown:${id}`;
    const base = id.replace(/\(.*$/, "");
    const integrity = this.install.lock.packages?.[base]?.resolution?.integrity;
    if (integrity === undefined) return `nointegrity:${id}`;
    if (this.install.skipped.has(id)) return `skipped:${id}#${integrity}`;
    const edges = this.edges
      ? SNAPSHOT_EDGES.flatMap((field) => Object.entries(snapshot[field] ?? {}).map(([n, r]) => `${n}@${r}`)).sort()
      : [];
    return edges.length === 0 ? `${id}#${integrity}` : `${id}#${integrity}>${edges.join(",")}`;
  }

  #closure(start) {
    const memo = this.#closures.get(start);
    if (memo !== undefined) return memo;
    const identities = [];
    const seen = new Set();
    const stack = [start];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (id.startsWith("workspace:") || id.startsWith("unknown:")) {
        identities.push(id);
        continue;
      }
      const identity = this.#identity(id);
      if (!identity.startsWith(`${id}#`)) {
        identities.push(identity);
        continue;
      }
      const folder = `${VIRTUAL}${this.install.dirOf.get(id)}/node_modules/${nameOf(id)}`;
      if (this.scans.typesOnly(`${this.dir}\0${identity}`, join(this.dir, folder))) {
        identities.push(`${id}@types-only`);
        continue;
      }
      identities.push(identity);
      this.#folders.set(identity, folder);
      const snapshot = this.install.snapshots[id];
      for (const field of SNAPSHOT_EDGES) {
        for (const [name, ref] of Object.entries(snapshot[field] ?? {})) stack.push(childId(name, ref));
      }
    }
    this.#closures.set(start, identities);
    return identities;
  }
}

/** The package name of a snapshot id: `@scope/name` or `name`, before the version's `@`. */
export function nameOf(id) {
  return id.slice(0, id.indexOf("@", 1));
}

function edgeRef(snapshot, name) {
  for (const field of SNAPSHOT_EDGES) {
    const ref = snapshot?.[field]?.[name];
    if (ref !== undefined) return ref;
  }
  return undefined;
}

/** The snapshot an edge names: `name@ref`, or the ref itself for an alias (`other@1.0.0`). */
function childId(name, ref) {
  if (ref.startsWith("link:")) return `workspace:${ref.slice(5)}`;
  const plain = ref.replace(/\(.*$/, "");
  return plain.indexOf("@", 1) > 0 ? ref : `${name}@${ref}`;
}

function parent(dir) {
  const up = posix.dirname(dir);
  return up === "." ? "" : up;
}
