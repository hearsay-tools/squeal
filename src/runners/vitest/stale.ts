import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, join } from "node:path";
import type { TestProject, Vitest } from "vitest/node";
import { isRecord } from "../../core/fs/index.js";
import type { AbsolutePath, InvalidatedPath } from "../../core/types/index.js";
import { expandsFromDisk } from "./dynamic.js";
import { depToPath, resolutionBases, resolutionCandidates } from "./graph.js";

type ModuleGraph = TestProject["vite"]["environments"][string]["moduleGraph"];
type ModuleNode = NonNullable<ReturnType<ModuleGraph["getModuleById"]>>;
type Transform = NonNullable<ModuleNode["transformResult"]>;

/** Per instance: whether its module nodes carry Vite's internal `invalidationState`. */
const tracksSoftInvalidation = new WeakMap<Vitest, boolean>();

/** Instances that fell back to full invalidation and have said so once (reviews/wave-7.md S2). */
const fellBack = new WeakSet<Vitest>();

/**
 * Invalidates what the adds and deletes among `paths`, and the edited
 * `package.json` files, can make wrong; the caller has invalidated every path
 * itself. `note` hears the fallback to full invalidation once per instance.
 */
export function invalidateStructural(
  vitest: Vitest,
  paths: readonly { readonly kind: InvalidatedPath["kind"]; readonly abs: AbsolutePath }[],
  note: (text: string) => void,
): void {
  const structural = paths.filter((p) => p.kind !== "change" || isPackageJson(p.abs));
  if (structural.length > 0) {
    // Spec 001 D4: an add or delete re-transforms only the importers whose
    // resolution it can change, never the whole graph (lessons, defect 11).
    const added = structural.filter((p) => p.kind === "add").map((p) => p.abs);
    const deleted = structural.filter((p) => p.kind === "delete").map((p) => p.abs);
    const manifests = structural.filter((p) => p.kind === "change").map((p) => p.abs);
    const stale = staleTransforms(vitest, added, deleted, manifests);
    for (const file of stale ?? cachedFiles(vitest)) vitest.invalidateFile(file);
    if (stale === null && !fellBack.has(vitest)) {
      fellBack.add(vitest);
      note(FALLBACK_NOTE);
    }
    const testGlob = structural.some((p) =>
      vitest.projects.some((project) => project.matchesTestGlob(p.abs, () => "")),
    );
    if (testGlob) vitest.clearSpecificationsCache();
  }
}

/**
 * Files whose cached transforms an add, a delete or an edited `package.json`
 * (`manifests`) can make wrong, or `null`
 * when this Vite keeps no `invalidationState` and the stale set cannot be
 * known: the caller then invalidates every cached transform.
 *
 * Spec 001 D4: a cached transform holds each import as Vite resolved it, and
 * an unresolvable specifier verbatim. A deleted file stales every module that
 * imports it. An added file stales every module with:
 *
 * - an import whose target has it among its resolution candidates (D3), or a
 *   resolved one it would now shadow (extension, `index`, TypeScript twin);
 * - an import Vite could not resolve that is not relative: an alias,
 *   `tsconfig` `paths` or a package. Vite turns every resolved import into a
 *   `/…` or `/@fs/…` URL, packages included, so a bare dep is unresolved;
 * - a resolved import under a directory it would now shadow, which covers a
 *   directory resolved through its own `package.json`, and under the
 *   directory of an added or deleted `package.json`, and under the directory
 *   of a `package.json` whose entry the added path can now resolve: Vite fell
 *   back to the directory's `index` while that entry was missing;
 * - a resolved import under the directory of an edited `package.json`: the
 *   directory, or the package by name, may now resolve to another entry
 *   (reviews/wave-9.md S2);
 * - `import.meta.glob` or a template-literal dynamic import in its source.
 *
 * Every other transform stays cached (lessons, defect 11). The deleted files
 * themselves are left to the caller, which has invalidated them already.
 */
export function staleTransforms(
  vitest: Vitest,
  added: readonly AbsolutePath[],
  deleted: readonly AbsolutePath[],
  manifests: readonly AbsolutePath[] = [],
): Set<AbsolutePath> | null {
  const stale = new Set<AbsolutePath>();
  const gone = new Set<AbsolutePath>(deleted);
  for (const project of vitest.projects) {
    for (const environment of Object.values(project.vite.environments)) {
      const extensions = environment.config.resolve.extensions;
      const targets = new Set<AbsolutePath>(deleted);
      const directories = [...added, ...deleted, ...manifests]
        .filter(isPackageJson)
        .map((p) => `${dirname(p)}/`);
      for (const path of added) {
        const bases = resolutionBases(path, extensions);
        for (const base of bases) {
          for (const candidate of resolutionCandidates(base, extensions)) targets.add(candidate);
          // A directory's `package.json` wins over its `index`, so an `index` shadows nothing under it.
          if (base !== dirname(path)) directories.push(`${base}/`);
        }
        for (const dir of entryDirectories(path, bases, project.config.root)) {
          directories.push(`${dir}/`);
        }
      }
      const reresolves = (dep: string, file: AbsolutePath): boolean => {
        const path = depToPath(dep, file, project.config.root);
        if (path === null) return added.length > 0 && isUnresolvedBare(dep);
        return targets.has(path) || directories.some((dir) => path.startsWith(dir));
      };
      for (const [file, modules] of environment.moduleGraph.fileToModulesMap) {
        if (stale.has(file) || gone.has(file)) continue;
        for (const module of modules) {
          if (!knowsSoftInvalidation(vitest, module)) return null;
          const result = cachedTransform(module);
          if (!result) continue;
          const deps = [...(result.deps ?? []), ...(result.dynamicDeps ?? [])];
          if (
            deps.some((dep) => reresolves(dep, file)) ||
            (added.length > 0 && expandsFromDisk(file, result))
          ) {
            stale.add(file);
            break;
          }
        }
      }
    }
  }
  return stale;
}

const isPackageJson = (path: AbsolutePath) => basename(path) === "package.json";

/**
 * Reviews/wave-7.5.md B2: the ancestors of `path` below `root` whose
 * `package.json` names, as `main`, `module` or a string `exports` or
 * `exports["."]`, an entry that `path` is among the resolution candidates of.
 */
function entryDirectories(
  path: AbsolutePath,
  bases: readonly AbsolutePath[],
  root: AbsolutePath,
): AbsolutePath[] {
  const found: AbsolutePath[] = [];
  for (let dir = dirname(path); dir.startsWith(`${root}/`); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    // `join` keeps a trailing slash; `"main": "lib/"` names `lib` (reviews/wave-7.6.md N1).
    const named = packageEntries(manifest).map((entry) => join(dir, entry).replace(/\/+$/, ""));
    if (named.some((entry) => bases.includes(entry))) found.push(dir);
  }
  return found;
}

/** The entry fields of a `package.json` that name one file; none when it cannot be read. */
function packageEntries(manifest: AbsolutePath): string[] {
  let fields: unknown;
  try {
    fields = JSON.parse(readFileSync(manifest, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(fields)) return [];
  const dot = isRecord(fields.exports) ? fields.exports["."] : fields.exports;
  return [fields.main, fields.module, dot].filter(
    (entry): entry is string => typeof entry === "string",
  );
}

/** A dep Vite left as written that is neither a path, a virtual id nor a Node builtin. */
function isUnresolvedBare(dep: string): boolean {
  return (
    !dep.startsWith("/") &&
    !dep.startsWith(".") &&
    !dep.startsWith("\0") &&
    !dep.includes(":") &&
    !isBuiltin(dep)
  );
}

/**
 * Reviews/wave-7.md S2: `invalidationState` is internal to Vite. Checked once
 * per instance on its first module node, so a Vite that renamed it falls back
 * to full invalidation instead of missing soft-invalidated importers.
 */
function knowsSoftInvalidation(vitest: Vitest, module: ModuleNode): boolean {
  let known = tracksSoftInvalidation.get(vitest);
  if (known === undefined) {
    known = "invalidationState" in module;
    tracksSoftInvalidation.set(vitest, known);
  }
  return known;
}

/**
 * The transform a module will reuse: its result, or the one Vite keeps when
 * it soft-invalidates an importer (internal `invalidationState`). Invalidating
 * a file soft-invalidates its importers, and a soft-invalidated module is
 * re-served with its old resolutions, so both count.
 */
function cachedTransform(module: ModuleNode): Transform | null {
  if (module.transformResult) return module.transformResult;
  const state = (module as { invalidationState?: unknown }).invalidationState;
  return typeof state === "object" && state !== null ? (state as Transform) : null;
}

export const FALLBACK_NOTE =
  "vitest adapter: this Vite keeps no `invalidationState` on its module nodes, so every add or delete invalidates every cached transform; `affected` after one costs a cold walk (spec 001 D4)";

/** Every file with a module in some environment: the full invalidation `staleTransforms` falls back to. */
export function cachedFiles(vitest: Vitest): Set<string> {
  const files = new Set<string>();
  for (const project of vitest.projects) {
    for (const environment of Object.values(project.vite.environments)) {
      for (const file of environment.moduleGraph.fileToModulesMap.keys()) files.add(file);
    }
  }
  return files;
}
