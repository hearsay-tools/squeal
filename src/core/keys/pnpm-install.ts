import { createHash } from "node:crypto";
import { type Dirent, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { compare, isRecord } from "../fs/index.js";
import type { AbsolutePath, RelativePath } from "../types/index.js";
import type { PackageScans } from "./package-scans.js";
import { childOf, PnpmGraph } from "./pnpm-graph.js";
import { PNPM_LOCKFILE, readPnpmLockfile } from "./pnpm-lockfile.js";

/** pnpm's record of the install's layout, relative to the directory that holds `node_modules`. */
const PNPM_MODULES = "node_modules/.modules.yaml";

/** pnpm's virtual store, relative to the same directory. */
const VIRTUAL_STORE = "node_modules/.pnpm";

/** Bumped when the fallback encoding below changes. */
const PACKAGE_FOLDERS_ENCODING = "squeal-pnpm-package-folders/1";

/**
 * A pnpm install as per-package keys read it: its graph, or why `lock.yaml`
 * does not describe it and the fingerprint of its package folders.
 */
export type PnpmInstall =
  | { readonly graph: PnpmGraph; readonly stale: null; readonly folders?: undefined }
  | { readonly graph: null; readonly stale: string; readonly folders: string };

/**
 * Task 011-162 R2 (011 C11, design sections 3 and 4): the graph of the pnpm
 * install at `dir`, or `null` where keys hold the whole fingerprint. Only
 * pnpm's default layout is read: `.modules.yaml` with `nodeLinker:
 * isolated` and the virtual store `.pnpm` inside the install, and a
 * `lock.yaml` the reader knows (lockfile 9). `nodeLinker: hoisted` has no
 * folder map; under the global virtual store every package lies outside
 * the worktree, where C11 leaves an entry out. A read install is stale
 * where `stalePnpmLockfile` says so.
 */
export function readPnpmInstall(
  dir: AbsolutePath,
  base: RelativePath,
  text: string,
  scans?: PackageScans,
): PnpmInstall | null {
  const modules = layoutOf(dir);
  if (modules === null) return null;
  const lockfile = readPnpmLockfile(text);
  if (lockfile === null) return null;
  const graph = new PnpmGraph(dir, base, lockfile, modules, scans);
  const stale = stalePnpmLockfile(dir, graph);
  if (stale === null) return { graph, stale };
  return {
    graph: null,
    stale,
    folders: pnpmPackageFoldersFingerprint(dir, lockfile.importers.keys()),
  };
}

/** `.modules.yaml`, JSON under pnpm 10 and 12, where it records pnpm's default layout. */
function layoutOf(dir: AbsolutePath): Readonly<Record<string, unknown>> | null {
  let modules: unknown;
  try {
    modules = JSON.parse(readFileSync(join(dir, PNPM_MODULES), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(modules) || modules.nodeLinker !== "isolated") return null;
  if (modules.virtualStoreDir !== ".pnpm" || modules.enableGlobalVirtualStore === true) return null;
  return modules;
}

/**
 * Why `lock.yaml` does not describe the pnpm install at `dir`, as one
 * sentence fragment, or `null` when it does.
 *
 * Task 011-162 (011 C11, design section 3): npm's rule (task 001-104) on
 * pnpm's layout. Every snapshot not skipped has its package folder
 * `.pnpm/<folder>/node_modules/<name>`; no such folder is newer than
 * `lock.yaml`; each importer's `node_modules` holds only the names it
 * declares and, at the root, those hoisted publicly, dot entries left out,
 * and none of them is newer than `lock.yaml`. Folders and links compare
 * with `lstat`. A `.pnpm` folder no snapshot names is an orphan pnpm keeps
 * until `modules-cache-max-age` and nothing links to: ignored.
 *
 * Review 0.1.282 B2: and every link a lookup resolves through exists, so
 * Node never walks past a missing one to a package the graph does not
 * name: each name an importer declares, each hoisted name, public and
 * private, and each edge beside a package folder, unless it names a
 * skipped package.
 */
export function stalePnpmLockfile(dir: AbsolutePath, graph: PnpmGraph): string | null {
  const lockTime = lstatSync(join(dir, PNPM_LOCKFILE)).mtimeMs;
  const unlisted: string[] = [];
  const newer: string[] = [];
  const missing: string[] = [];
  const absent = (path: string) =>
    lstatSync(join(dir, path), { throwIfNoEntry: false }) === undefined;
  for (const [id, folder] of graph.folders) {
    if (graph.skipped.has(id)) continue;
    const modules = `${VIRTUAL_STORE}/${folder}/node_modules`;
    const path = `${modules}/${id.slice(0, id.indexOf("@", 1))}`;
    const stat = lstatSync(join(dir, path), { throwIfNoEntry: false });
    if (stat === undefined) missing.push(path);
    else if (stat.mtimeMs > lockTime) newer.push(path);
    for (const [name, ref] of graph.lockfile.snapshots.get(id) ?? []) {
      const edge = `${modules}/${name}`;
      if (!graph.skipped.has(childOf(name, ref)) && absent(edge)) missing.push(edge);
    }
  }
  for (const [at, hoisted] of [
    ["node_modules", graph.publicHoisted],
    [`${VIRTUAL_STORE}/node_modules`, graph.privateHoisted],
  ] as const) {
    for (const [alias, id] of hoisted) {
      if (!graph.skipped.has(id) && absent(`${at}/${alias}`)) missing.push(`${at}/${alias}`);
    }
  }
  for (const [importer, declared] of graph.lockfile.importers) {
    const modules = importer === "." ? "node_modules" : `${importer}/node_modules`;
    const present = new Set(namesIn(join(dir, modules)));
    for (const name of present) {
      const path = `${modules}/${name}`;
      if (!declared.has(name) && !(importer === "." && graph.publicHoisted.has(name))) {
        unlisted.push(path);
      } else if (lstatSync(join(dir, path)).mtimeMs > lockTime) newer.push(path);
    }
    for (const [name, ref] of declared) {
      if (!present.has(name) && !graph.skipped.has(childOf(name, ref))) {
        missing.push(`${modules}/${name}`);
      }
    }
  }
  const parts = [
    ["not listed in it", unlisted],
    ["newer than it", newer],
    ["missing", missing],
  ] as const;
  const reasons = parts
    .filter(([, paths]) => paths.length > 0)
    .map(([label, paths]) => `${label}: ${example(paths)}`);
  return reasons.length === 0 ? null : reasons.join("; ");
}

/**
 * Fingerprint of the pnpm install at `dir` from its package folders, for
 * when `lock.yaml` does not describe it: each entry of each importer's
 * `node_modules`, the root's among them, of the private hoisting and of
 * each `.pnpm` folder's `node_modules`, a folder by its path and its
 * `package.json` name and version and then its own `node_modules`, a link
 * by its path and target, unread. Adding, removing, moving, retargeting or
 * re-versioning a package changes it.
 */
function pnpmPackageFoldersFingerprint(dir: AbsolutePath, importers: Iterable<string>): string {
  const roots = new Set(["node_modules", `${VIRTUAL_STORE}/node_modules`]);
  for (const importer of importers)
    roots.add(importer === "." ? "node_modules" : `${importer}/node_modules`);
  for (const folder of entriesOf(join(dir, VIRTUAL_STORE))) {
    if (folder.isDirectory() && folder.name !== "node_modules") {
      roots.add(`${VIRTUAL_STORE}/${folder.name}/node_modules`);
    }
  }
  const entries: unknown[] = [];
  const walk = (at: string): void => {
    for (const name of namesIn(join(dir, at))) {
      const path = `${at}/${name}`;
      const link = lstatSync(join(dir, path)).isSymbolicLink();
      entries.push(
        link ? [path, "link", readlinkSync(join(dir, path))] : [path, ...manifestOf(dir, path)],
      );
      if (!link) walk(`${path}/node_modules`);
    }
  };
  for (const at of [...roots].sort(compare)) walk(at);
  return createHash("sha256")
    .update(JSON.stringify([PACKAGE_FOLDERS_ENCODING, entries]))
    .digest("hex");
}

/** Package names in a `node_modules` folder, sorted, dot entries and `.bin` left out. */
function namesIn(modules: string): string[] {
  const names: string[] = [];
  for (const entry of entriesOf(modules)) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const child of entriesOf(join(modules, entry.name)))
        names.push(`${entry.name}/${child.name}`);
    } else names.push(entry.name);
  }
  return names.sort(compare);
}

function entriesOf(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** A folder's `package.json` name and version; `null` for each that is absent or unreadable. */
function manifestOf(dir: AbsolutePath, path: string): [unknown, unknown] {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(dir, path, "package.json"), "utf8"));
    return isRecord(manifest) ? [manifest.name ?? null, manifest.version ?? null] : [null, null];
  } catch {
    return [null, null];
  }
}

/** The first path, sorted, and how many more. */
function example(paths: readonly string[]): string {
  const [first] = [...paths].sort(compare);
  return paths.length === 1 ? `${first}` : `${first} and ${paths.length - 1} more`;
}
