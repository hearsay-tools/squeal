import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { AbsolutePath } from "../../../core/types/index.js";
import type { MappedModule } from "../environment/index.js";
import { readOptional } from "../environment/site.js";

/**
 * Import roots of a worktree without an environment, from `pyproject.toml`
 * files alone (spec 007 D4 as amended from 007-04): what a plain `uv sync`
 * would write as editable `.pth` path lines and finder mappings.
 */
export interface DerivedRoots {
  /** Path entries in the order `site` would add them: by `.pth` file name. */
  readonly pthPaths: readonly AbsolutePath[];
  readonly mapped: readonly MappedModule[];
  /** Layouts the derivation does not read (a `setup.py`, hatch `include` globs, an unknown backend). */
  readonly notes: readonly string[];
}

type Table = Readonly<Record<string, unknown>>;

/**
 * 007-04's `roots.mjs derive`: the root project when it is a package, the
 * uv workspace members reachable from its dependencies and `dev` group, and
 * `[tool.uv.sources]` paths with `editable = true`, each by its build
 * backend's editable layout (uv_build, hatchling, setuptools, flit_core,
 * poetry-core, pdm-backend).
 */
export function deriveRoots(root: AbsolutePath): DerivedRoots {
  const entries: { pth: string; path: AbsolutePath }[] = [];
  const mapped: MappedModule[] = [];
  const notes: string[] = [];
  const top = readPyproject(root, notes);
  if (top === null) return { pthPaths: [], mapped, notes };
  const installed = new Map<AbsolutePath, Table>();
  if (nameOf(top) !== undefined && isPackage(top)) installed.set(root, top);
  const members = workspaceMembers(root, top, notes);
  const seen = new Set<string>();
  const walk = (dir: AbsolutePath, project: Table): void => {
    const sources = (get(project, "tool", "uv", "sources") ??
      get(top, "tool", "uv", "sources") ??
      {}) as Table;
    for (const dep of dependencyNames(project)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      const source = Object.entries(sources).find(([name]) => normalize(name) === dep)?.[1] as
        | Table
        | undefined;
      const member = members.get(dep);
      if (member !== undefined && (source === undefined || source.workspace === true)) {
        if (isPackage(member.project)) installed.set(member.dir, member.project);
        walk(member.dir, member.project);
      } else if (typeof source?.path === "string" && source.editable === true) {
        const path = resolve(dir, source.path);
        const inside = path.startsWith(root + sep);
        const project = inside ? readPyproject(path, notes) : null;
        if (project !== null) installed.set(path, project);
        else if (!inside)
          notes.push(`editable path source ${dep} outside the worktree: ${source.path}`);
      }
    }
  };
  walk(root, top);
  for (const [dir, project] of installed) {
    layout(dir, project, {
      entry: (pth, path) => entries.push({ pth, path }),
      map: (module, path, finder) => mapped.push({ module, path, finder }),
      note: (text) => notes.push(`${relative(root, dir) || "."}: ${text}`),
    });
  }
  entries.sort((a, b) => (a.pth < b.pth ? -1 : a.pth > b.pth ? 1 : 0));
  const pthPaths: AbsolutePath[] = [];
  for (const { path } of entries) if (isDir(path) && !pthPaths.includes(path)) pthPaths.push(path);
  return { pthPaths, mapped, notes };
}

interface Sink {
  entry(pth: string, path: AbsolutePath): void;
  map(module: string, path: AbsolutePath, finder: MappedModule["finder"]): void;
  note(text: string): void;
}

/** One project's editable roots, by its build backend (007-04 Q1, read in each backend's source). */
function layout(dir: AbsolutePath, project: Table, sink: Sink): void {
  const backend = String(get(project, "build-system", "build-backend") ?? "");
  const name = nameOf(project) ?? "";
  const n = normalize(name);
  const module = name.replace(/[-.]/g, "_");
  if (backend.startsWith("hatchling")) hatchling(dir, project, name, sink);
  else if (backend.startsWith("setuptools")) setuptools(dir, project, sink);
  else if (backend.startsWith("pdm.backend")) {
    const build = (get(project, "tool", "pdm", "build") ?? {}) as Table;
    const packageDir =
      build["package-dir"] ?? (isDir(join(dir, "src")) && !build.includes ? "src" : "");
    if ((build["editable-backend"] ?? "path") !== "path")
      sink.note("pdm editables backend not read");
    sink.entry(`_editable_impl_${n}.pth`, join(dir, String(packageDir)));
  } else if (backend.startsWith("flit_core")) {
    const mod = String(get(project, "tool", "flit", "module", "name") ?? module);
    const path = mod.replace(/\./g, "/");
    const inSrc = isDir(join(dir, "src", path)) || isFile(join(dir, "src", `${path}.py`));
    sink.entry(`${mod}.pth`, inSrc ? join(dir, "src") : dir);
  } else if (backend.startsWith("poetry.core")) {
    const declared = get(project, "tool", "poetry", "packages") as Table[] | undefined;
    const from = declared?.map((p) => String(p.from ?? ".")) ?? [
      isDir(join(dir, "src", module)) ? "src" : ".",
    ];
    for (const base of new Set(from)) sink.entry(`${module}.pth`, join(dir, base));
  } else if (backend === "uv_build") {
    const root = get(project, "tool", "uv", "build-backend", "module-root");
    sink.entry(`${n}.pth`, join(dir, typeof root === "string" ? root : "src"));
  } else {
    sink.note(`build backend "${backend}" not read; resolved with an environment only`);
  }
}

function hatchling(dir: AbsolutePath, project: Table, name: string, sink: Sink): void {
  const wheel = (get(project, "tool", "hatch", "build", "targets", "wheel") ?? {}) as Table;
  const build = (get(project, "tool", "hatch", "build") ?? {}) as Table;
  const option = (key: string) => (wheel[key] ?? build[key]) as unknown;
  const n = normalize(name);
  const devDirs = option("dev-mode-dirs") as string[] | undefined;
  if (devDirs !== undefined) {
    for (const d of devDirs) sink.entry(`_${n}.pth`, join(dir, d));
    return;
  }
  if (option("include") !== undefined) sink.note("hatch include globs not read");
  let packages = option("packages") as string[] | undefined;
  let only = option("only-include") as string[] | undefined;
  if (packages === undefined && only === undefined && option("include") === undefined) {
    for (const candidate of [name.replace(/[-.]/g, "_"), n]) {
      if (isFile(join(dir, candidate, "__init__.py"))) packages = [candidate];
      else if (isFile(join(dir, "src", candidate, "__init__.py"))) packages = [`src/${candidate}`];
      else if (isFile(join(dir, `${candidate}.py`))) only = [`${candidate}.py`];
      else continue;
      break;
    }
  }
  const exposed = [...(packages ?? []), ...(only ?? [])].map((p) => join(dir, p));
  if (option("dev-mode-exact") === true) {
    for (const path of exposed) {
      const module = path.slice(path.lastIndexOf(sep) + 1).replace(/\.py$/, "");
      sink.map(module, isDir(path) ? join(path, "__init__.py") : path, "editables");
    }
    return;
  }
  for (const parent of new Set(exposed.map((p) => resolve(p, "..")))) {
    sink.entry(`_editable_impl_${n}.pth`, parent);
  }
}

function setuptools(dir: AbsolutePath, project: Table, sink: Sink): void {
  const st = (get(project, "tool", "setuptools") ?? {}) as Table;
  let packageDir = (st["package-dir"] ?? {}) as Record<string, string>;
  const find = get(st, "packages", "find") as Table | undefined;
  if (isFile(join(dir, "setup.py"))) {
    sink.note("setup.py present; its code is not read, resolved with an environment only");
  }
  const where = find?.where as string[] | undefined;
  if (where !== undefined) {
    if (where.length === 1) packageDir = { "": where[0] as string };
    else sink.note("several packages.find.where; the finder mapping is not read");
  }
  if (
    st["package-dir"] === undefined &&
    find === undefined &&
    st.packages === undefined &&
    isDir(join(dir, "src"))
  ) {
    packageDir = { "": "src" };
  }
  const version = String(get(project, "project", "version") ?? "0");
  const keys = Object.keys(packageDir);
  if (keys.length === 1 && keys[0] === "") {
    const n = normalize(String(nameOf(project)));
    sink.entry(`__editable__.${n}-${version}.pth`, join(dir, packageDir[""] as string));
    return;
  }
  // A flat or mapped layout: setuptools writes a finder MAPPING of the top-level packages.
  const listed = Array.isArray(st.packages)
    ? (st.packages as string[]).filter((p) => !p.includes("."))
    : null;
  const packages =
    listed ??
    listDir(dir).filter(
      (d) =>
        isFile(join(dir, d, "__init__.py")) && !/^(?:tests?|docs?|examples?|build|dist)$/.test(d),
    );
  for (const p of packages) {
    const base = packageDir[p] ?? (packageDir[""] !== undefined ? join(packageDir[""], p) : p);
    sink.map(p, join(dir, base), "setuptools");
  }
}

/** uv workspace members by normalized name; globs match one directory level per `*` segment. */
function workspaceMembers(
  root: AbsolutePath,
  top: Table,
  notes: string[],
): Map<string, { dir: AbsolutePath; project: Table }> {
  const members = new Map<string, { dir: AbsolutePath; project: Table }>();
  for (const glob of (get(top, "tool", "uv", "workspace", "members") ?? []) as string[]) {
    let dirs = [root];
    for (const part of glob.split("/")) {
      const pattern = new RegExp(
        `^${part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      dirs = part.includes("*")
        ? dirs.flatMap((d) =>
            listDir(d)
              .filter((x) => pattern.test(x))
              .map((x) => join(d, x)),
          )
        : dirs.map((d) => join(d, part));
    }
    for (const dir of dirs) {
      const project = isDir(dir) ? readPyproject(dir, notes) : null;
      const name = project === null ? undefined : nameOf(project);
      if (project !== null && name !== undefined) members.set(normalize(name), { dir, project });
    }
  }
  return members;
}

function readPyproject(dir: AbsolutePath, notes: string[]): Table | null {
  const text = readOptional(join(dir, "pyproject.toml"));
  if (text === null) return null;
  try {
    return parseToml(text) as Table;
  } catch (error) {
    notes.push(
      `${join(dir, "pyproject.toml")} does not parse: ${(error as Error).message.split("\n")[0]}`,
    );
    return null;
  }
}

const get = (table: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>(
    (at, key) => (at !== null && typeof at === "object" ? (at as Table)[key] : undefined),
    table,
  );

function nameOf(project: Table): string | undefined {
  const name = get(project, "project", "name") ?? get(project, "tool", "poetry", "name");
  return typeof name === "string" ? name : undefined;
}

/** uv installs a project with a build system, unless `tool.uv.package` says otherwise. */
function isPackage(project: Table): boolean {
  const flag = get(project, "tool", "uv", "package");
  return typeof flag === "boolean"
    ? flag
    : get(project, "build-system", "build-backend") !== undefined;
}

/** PEP 503 then underscores, as `.pth` file names spell a distribution. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "_");
}

function dependencyNames(project: Table): string[] {
  const deps = (get(project, "project", "dependencies") ?? []) as unknown[];
  const dev = (get(project, "dependency-groups", "dev") ?? []) as unknown[];
  return [...deps, ...dev]
    .filter((d): d is string => typeof d === "string")
    .map((d) => /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(d)?.[0])
    .filter((d): d is string => d !== undefined)
    .map(normalize);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
