import type { TestProject, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";
import { depToPath, resolutionBases, resolutionCandidates } from "./graph.js";

type ModuleGraph = TestProject["vite"]["environments"][string]["moduleGraph"];
type ModuleNode = NonNullable<ReturnType<ModuleGraph["getModuleById"]>>;
type Transform = NonNullable<ModuleNode["transformResult"]>;

/**
 * Files whose cached transforms an add or delete can make wrong.
 *
 * Spec 001 D4: a cached transform holds each import as Vite resolved it, and
 * an unresolvable relative specifier verbatim. A deleted file stales the
 * transform of every module that imports it. An added file stales every
 * module with an import that could now resolve to it: an unresolved target
 * that has it among its resolution candidates (D3), or a resolved one that
 * it would now shadow, under the same `resolve.extensions`, `index` and
 * TypeScript-twin rules. Every other transform stays cached (lessons,
 * defect 11). Only relative and root-relative imports are read, as in D3.
 */
export function staleTransforms(
  vitest: Vitest,
  added: readonly AbsolutePath[],
  deleted: readonly AbsolutePath[],
): Set<AbsolutePath> {
  const stale = new Set<AbsolutePath>(deleted);
  for (const project of vitest.projects) {
    for (const environment of Object.values(project.vite.environments)) {
      const extensions = environment.config.resolve.extensions;
      const targets = new Set<AbsolutePath>(deleted);
      for (const path of added) {
        for (const base of resolutionBases(path, extensions)) {
          for (const candidate of resolutionCandidates(base, extensions)) targets.add(candidate);
        }
      }
      for (const [file, modules] of environment.moduleGraph.fileToModulesMap) {
        if (stale.has(file)) continue;
        for (const module of modules) {
          const result = cachedTransform(module);
          if (!result) continue;
          const deps = [...(result.deps ?? []), ...(result.dynamicDeps ?? [])];
          if (deps.some((dep) => targets.has(depToPath(dep, file, project.config.root) ?? ""))) {
            stale.add(file);
            break;
          }
        }
      }
    }
  }
  return stale;
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
