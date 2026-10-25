import type { ProjectName, RelativePath, Store } from "../types/index.js";
import { SharedPaths, viewOf } from "./observed.js";

/**
 * Spec 016 D4: the start-up paths of one project, what its runs loaded
 * before any test file (`RunReport.environmentObserved`: node:test preloads,
 * pytest's start-up plugins), beyond the environment's own files. A sorted
 * array, shared by every worktree of the repository, merged and never
 * pruned, as `observed.<project>` is. They are environment inputs.
 */
export function observedStartupMetaKey(project: ProjectName): string {
  return `observedStartup.${project}`;
}

/**
 * This worktree's view of the shared start-up sets, one `SharedPaths` of the
 * list shape per project. `see` adds a run's paths to the view only, so the
 * environments read again before the run's record hold them; `write`, inside
 * the record's transaction, merges into the store what the view holds and
 * the store lacks.
 */
export class StartupSets {
  readonly #views = new Map<ProjectName, SharedPaths>();

  constructor(private readonly store: Store) {}

  /** The start-up paths of `project`, sorted. Reads the project once. */
  of(project: ProjectName): readonly RelativePath[] {
    return this.#viewOf(project).of();
  }

  /** Merges what the store holds for `projects` into this view. Returns the projects whose set grew. */
  refresh(projects: Iterable<ProjectName>): ProjectName[] {
    return [...new Set(projects)].filter((project) => this.#viewOf(project).refresh().length > 0);
  }

  /** Adds `paths` to `project`'s view, not to the store. Returns the new ones. */
  see(project: ProjectName, paths: readonly RelativePath[]): RelativePath[] {
    return this.#viewOf(project).see("", paths);
  }

  /** Merges into the store each project's paths the view holds and the store lacks. */
  write(): void {
    for (const view of this.#views.values()) view.write();
  }

  #viewOf(project: ProjectName): SharedPaths {
    return viewOf(
      this.#views,
      project,
      () => new SharedPaths(this.store, observedStartupMetaKey(project), "list"),
    );
  }
}
