import type { ProjectName } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";
import type { Store } from "../types/store.js";
import { SharedPaths, viewOf } from "./observed.js";

/** Shared positive module evidence, owned by the core as the raw observation keys are. */
export function observedModulesMetaKey(project: ProjectName): string {
  return `observedModules.${project}`;
}

/** Positive module evidence shares the raw observations' monotonic transaction rule. */
export class ModuleSets {
  readonly #projects = new Map<string, SharedPaths>();
  constructor(private readonly store: Store) {}
  #view(project: string): SharedPaths {
    return viewOf(
      this.#projects,
      project,
      () => new SharedPaths(this.store, observedModulesMetaKey(project)),
    );
  }
  of(ref: TestFileRef): readonly string[] {
    return this.#view(ref.project).of(ref.path);
  }
  mark(ref: TestFileRef, paths: readonly string[]): void {
    this.#view(ref.project).see(ref.path, paths);
  }
  refresh(projects: readonly string[]): TestFileRef[] {
    return [...new Set(projects)].flatMap((project) =>
      this.#view(project)
        .refresh()
        .map((path) => ({ project, path })),
    );
  }
  write(): void {
    for (const view of this.#projects.values()) view.write();
  }
}
