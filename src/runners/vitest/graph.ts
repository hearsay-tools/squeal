import { existsSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { TestProject } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";
import { environmentPackage, moduleLoads } from "./loads.js";

/** Files reached from some entry files through the transform graph. */
export interface ImportClosure {
  /** Existing files, entries included. May contain `node_modules` and paths outside the root. */
  readonly files: ReadonlySet<AbsolutePath>;
  /**
   * Import targets that do not exist on disk: deleted files, and unresolved
   * relative specifiers resolved against their importer (extension as
   * written, possibly none).
   */
  readonly missing: ReadonlySet<AbsolutePath>;
  /**
   * Package specifiers Vite left as written, by importing file: a package it
   * did not resolve. Task 001-105: keyed as Node would look them up. A
   * package name, or `<name>/package.json` for a read of its manifest
   * (review wave-11d S1).
   */
  readonly bare: ReadonlyMap<AbsolutePath, ReadonlySet<string>>;
  /** Node builtins the walked files import, without `node:` or a subpath. */
  readonly builtins: ReadonlySet<string>;
  /**
   * Packages looked up from the project root, `root`: the environment an
   * entry's docblock names (review wave-11b B1). Vitest reads the docblock of
   * a test file only.
   */
  readonly rooted: ReadonlySet<string>;
  readonly root: AbsolutePath;
}

/** One hop of the transform graph out of a project file. */
interface ImportTargets {
  readonly targets: readonly AbsolutePath[];
  readonly bare: readonly string[];
  readonly builtins: readonly string[];
  /** The package of the environment the file's docblock names. */
  readonly environment: string | null;
}

const BUILTINS: ReadonlySet<string> = new Set(
  builtinModules.map((name) => name.split("/")[0] ?? name),
);

/**
 * Transitive static and dynamic imports of `entries` in the project's `ssr`
 * environment. Transforms, never executes; reuses cached transforms.
 *
 * Mirrors Vitest's own `getAffectedModules` walk (research vitest-internals
 * Q2) with two differences: missing targets are kept, because Vitest's walk
 * drops the edge to a deleted file and loses its importers, and a file that
 * fails to transform ends the walk on that branch instead of rejecting.
 */
export async function importClosure(
  project: TestProject,
  entries: readonly AbsolutePath[],
): Promise<ImportClosure> {
  const files = new Set<AbsolutePath>();
  const missing = new Set<AbsolutePath>();
  const bare = new Map<AbsolutePath, ReadonlySet<string>>();
  const builtins = new Set<string>();
  const rooted = new Set<string>();
  const entrySet = new Set(entries);

  const visit = async (file: AbsolutePath): Promise<void> => {
    if (files.has(file) || missing.has(file)) return;
    if (!existsSync(file)) {
      missing.add(file);
      return;
    }
    files.add(file);
    if (file.includes("node_modules")) return;
    const hop = await importTargets(project, file);
    if (hop.bare.length > 0) bare.set(file, new Set(hop.bare));
    for (const name of hop.builtins) builtins.add(name);
    if (hop.environment !== null && entrySet.has(file)) rooted.add(hop.environment);
    await Promise.all(hop.targets.map(visit));
  };

  await Promise.all(entries.map(visit));
  return { files, missing, bare, builtins, rooted, root: project.config.root };
}

/**
 * What `file` imports in one hop, statically or dynamically: existing files
 * and missing targets, as `importClosure` reports them, without `file`.
 * Spec 001 D5 step 4: "test files that import a changed path directly
 * according to the runner's module graph".
 */
export async function directImports(
  project: TestProject,
  file: AbsolutePath,
): Promise<ImportClosure> {
  const files = new Set<AbsolutePath>();
  const missing = new Set<AbsolutePath>();
  const hop = await importTargets(project, file);
  for (const target of hop.targets) {
    (existsSync(target) ? files : missing).add(target);
  }
  const bare = new Map(hop.bare.length > 0 ? [[file, new Set(hop.bare)]] : []);
  const rooted = new Set(hop.environment === null ? [] : [hop.environment]);
  return {
    files,
    missing,
    bare,
    builtins: new Set(hop.builtins),
    rooted,
    root: project.config.root,
  };
}

/** One hop of the transform graph: the import targets of an existing project file. */
async function importTargets(project: TestProject, file: AbsolutePath): Promise<ImportTargets> {
  const environment = project.vite.environments.ssr;
  if (!environment) {
    throw new Error(`vitest adapter: project "${project.name}" has no ssr environment`);
  }
  let transformed: Awaited<ReturnType<typeof environment.transformRequest>>;
  try {
    transformed =
      environment.moduleGraph.getModuleById(file)?.transformResult ??
      (await environment.transformRequest(file));
  } catch {
    // A syntax error: the file stays in the closure and its run reports
    // the error as a file-level error. Its imports are unknown until fixed.
    return NO_TARGETS;
  }
  if (!transformed) return NO_TARGETS;
  const targets: AbsolutePath[] = [];
  const bare: string[] = [];
  const builtins: string[] = [];
  const add = (specifier: string): void => {
    const builtin = builtinOf(specifier);
    if (builtin !== null) builtins.push(builtin);
    else {
      const name = packageName(specifier);
      if (name !== null) bare.push(isManifest(specifier, name) ? specifier : name);
    }
  };
  for (const dep of [...(transformed.deps ?? []), ...(transformed.dynamicDeps ?? [])]) {
    const target = depToPath(dep, file, project.config.root);
    if (target !== null) targets.push(target);
    else add(dep);
  }
  // Review wave-11b B2: a `require` Vite does not see. One no specifier
  // names can reach any package, as `module` can. Review wave-11d S3: a
  // relative one reaches a file, walked like an import's.
  const loads = moduleLoads(file, transformed);
  for (const specifier of loads.requires) {
    if (isRelative(specifier)) {
      const target = requireTarget(file, specifier);
      if (target === null) builtins.push("module");
      else targets.push(target);
    } else if (builtinOf(specifier) !== null || packageName(specifier) !== null) add(specifier);
    // An absolute path or a `#` import, not resolved here: it can load anything.
    else builtins.push("module");
  }
  if (loads.unnamed) builtins.push("module");
  const named = loads.environment === null ? null : environmentPackage(loads.environment);
  return { targets, bare, builtins, environment: named };
}

const NO_TARGETS: ImportTargets = { targets: [], bare: [], builtins: [], environment: null };

/** Whether `specifier` reads the manifest of package `name`, and so loads none of its code. */
function isManifest(specifier: string, name: string): boolean {
  return (specifier.split("?")[0] ?? specifier) === `${name}/package.json`;
}

function isRelative(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  );
}

/** The extensions Node's `require` tries, in its order. */
const REQUIRE_EXTENSIONS = [".js", ".json", ".node"];

/**
 * The file a relative `require` from `importer` loads, as Node resolves it:
 * the path, the path with each extension, then the `index` of a directory.
 * A path where nothing exists is returned as is, a missing target whose
 * resolution candidates the closure holds. `null` for a directory with a
 * `package.json`, whose `main` is not resolved here, or with no `index`
 * (review wave-11d S3).
 */
function requireTarget(importer: AbsolutePath, specifier: string): AbsolutePath | null {
  const path = resolve(dirname(importer), specifier);
  const kind = (candidate: string) => statSync(candidate, { throwIfNoEntry: false });
  if (kind(path)?.isFile()) return path;
  for (const ext of REQUIRE_EXTENSIONS) if (kind(`${path}${ext}`)?.isFile()) return `${path}${ext}`;
  if (!kind(path)?.isDirectory()) return path;
  if (existsSync(join(path, "package.json"))) return null;
  for (const ext of REQUIRE_EXTENSIONS) {
    const index = join(path, `index${ext}`);
    if (kind(index)?.isFile()) return index;
  }
  return null;
}

/** The builtin a specifier names (`node:fs/promises`, `fs`), without `node:` or a subpath. */
export function builtinOf(specifier: string): string | null {
  const path = specifier.split("?")[0] ?? specifier;
  if (path.startsWith("node:")) return path.slice("node:".length).split("/")[0] ?? null;
  const first = path.split("/")[0] ?? path;
  return BUILTINS.has(first) && !path.includes(":") ? first : null;
}

/** The package a bare specifier names (`@s/p/sub` is `@s/p`), or `null` for anything else. */
export function packageName(specifier: string): string | null {
  const path = specifier.split("?")[0] ?? specifier;
  if (path === "" || /^[./\\\0#]/.test(path) || path.includes(":")) return null;
  const match = /^(?:@[^/]+\/)?[^/]+/.exec(path);
  return match?.[0] ?? null;
}

/** A transform dependency as a filesystem path, or `null` for virtual and bare ids. */
export function depToPath(
  dep: string,
  importer: AbsolutePath,
  root: AbsolutePath,
): AbsolutePath | null {
  if (dep.startsWith("\0") || dep.includes(":")) return null;
  // Review wave 7, N1: `?raw`, `?url` and the like name the same file.
  const path = dep.split("?")[0] ?? dep;
  if (path.startsWith("/@fs/")) return path.slice("/@fs".length);
  if (path.startsWith("/@")) return null;
  if (path.startsWith("/")) return join(root, path);
  // Vite keeps a relative specifier it could not resolve (target missing).
  if (path.startsWith("./") || path.startsWith("../")) return resolve(dirname(importer), path);
  return null;
}

/** Vite resolves a JavaScript specifier to its TypeScript twin when the importer is TypeScript. */
const TYPESCRIPT_TWINS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/**
 * Every path whose appearance could resolve a missing import target: the
 * target itself, the target with each extension, `index` with each extension
 * inside it, and the TypeScript twin of a JavaScript extension.
 *
 * Spec 001 D3: the closure has "for every unresolved import the target path
 * and its resolution candidates (each configured extension and `index`
 * file)". A candidate that never appears only costs a longer closure; a
 * missing candidate lets a result be inherited where the import resolves.
 */
export function resolutionCandidates(
  target: AbsolutePath,
  extensions: readonly string[],
): AbsolutePath[] {
  const ext = extname(target);
  const twins = (TYPESCRIPT_TWINS[ext] ?? []).map((twin) => target.slice(0, -ext.length) + twin);
  return [
    target,
    ...extensions.map((e) => `${target}${e}`),
    ...extensions.map((e) => join(target, `index${e}`)),
    ...twins,
  ];
}

/**
 * The inverse of `resolutionCandidates`: every import target that has `path`
 * among its candidates. An import of one of these targets may resolve to
 * `path` once it exists, whether it was unresolved or resolved to another
 * candidate before.
 */
export function resolutionBases(path: AbsolutePath, extensions: readonly string[]): AbsolutePath[] {
  const ext = extname(path);
  const bases = [path];
  if (ext === "") return bases;
  if (extensions.includes(ext)) {
    bases.push(path.slice(0, -ext.length));
    if (basename(path) === `index${ext}`) bases.push(dirname(path));
  }
  for (const [js, twins] of Object.entries(TYPESCRIPT_TWINS)) {
    if (twins.includes(ext)) bases.push(path.slice(0, -ext.length) + js);
  }
  return bases;
}

/** True when `path` is a missing import target, allowing for a specifier written without extension. */
export function isMissingTarget(closure: ImportClosure, path: AbsolutePath): boolean {
  if (closure.missing.has(path)) return true;
  const ext = extname(path);
  return ext !== "" && closure.missing.has(path.slice(0, -ext.length));
}
