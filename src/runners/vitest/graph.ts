import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { TestProject } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";

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
}

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
  const environment = project.vite.environments.ssr;
  if (!environment) {
    throw new Error(`vitest adapter: project "${project.name}" has no ssr environment`);
  }
  const files = new Set<AbsolutePath>();
  const missing = new Set<AbsolutePath>();

  const visit = async (file: AbsolutePath): Promise<void> => {
    if (files.has(file) || missing.has(file)) return;
    if (!existsSync(file)) {
      missing.add(file);
      return;
    }
    files.add(file);
    if (file.includes("node_modules")) return;
    let transformed: Awaited<ReturnType<typeof environment.transformRequest>>;
    try {
      transformed =
        environment.moduleGraph.getModuleById(file)?.transformResult ??
        (await environment.transformRequest(file));
    } catch {
      // A syntax error: the file stays in the closure and its run reports
      // the error as a file-level error. Its imports are unknown until fixed.
      return;
    }
    if (!transformed) return;
    const deps = [...(transformed.deps ?? []), ...(transformed.dynamicDeps ?? [])];
    await Promise.all(
      deps.map((dep) => {
        const target = depToPath(dep, file, project.config.root);
        return target === null ? undefined : visit(target);
      }),
    );
  };

  await Promise.all(entries.map(visit));
  return { files, missing };
}

/** A transform dependency as a filesystem path, or `null` for virtual and bare ids. */
function depToPath(dep: string, importer: AbsolutePath, root: AbsolutePath): AbsolutePath | null {
  if (dep.startsWith("/@fs/")) return dep.slice("/@fs".length);
  if (dep.startsWith("/@") || dep.startsWith("\0") || dep.includes(":")) return null;
  if (dep.startsWith("/")) return join(root, dep.split("?")[0] ?? dep);
  // Vite keeps a relative specifier it could not resolve (target missing).
  if (dep.startsWith("./") || dep.startsWith("../")) return resolve(dirname(importer), dep);
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

/** True when `path` is a missing import target, allowing for a specifier written without extension. */
export function isMissingTarget(closure: ImportClosure, path: AbsolutePath): boolean {
  if (closure.missing.has(path)) return true;
  const ext = extname(path);
  return ext !== "" && closure.missing.has(path.slice(0, -ext.length));
}
