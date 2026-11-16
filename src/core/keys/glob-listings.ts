import { compare } from "../fs/compare.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { ModuleGlobs } from "../types/runner.js";
import type { Store } from "../types/store.js";
import { listingPath, SharedPaths, viewOf } from "./observed.js";

/**
 * Row 023-13 (fix A, `023 research/glob-membership.md` 2): per project, a
 * map of module path to the listing paths its globs read. Shared by every
 * worktree of the repository, merged and never pruned, as the observed sets
 * (`observedMetaKey`); a key of its own, so it keys every closure that holds
 * the module whatever policy `observe.runtimeInputs` says.
 */
export function globListingsMetaKey(project: ProjectName): string {
  return `globListings.${project}`;
}

/**
 * This worktree's view of the shared glob listings. `see` adds a walk's
 * report to the view; `write`, inside the record's transaction, stores what
 * the store lacks; `of` gives a closure's listings from its module paths, so
 * a list stored before any walk reported them gains them too.
 */
export class GlobListings {
  readonly #projects = new Map<ProjectName, SharedPaths>();

  constructor(private readonly store: Store) {}

  /**
   * Adds `globs`, a runner's report for one closure, to the view: each
   * folder's listing path, and for a recursive one every listing `below`
   * gives (`Listings.below`), as an observed recursive listing is kept.
   */
  see(
    project: ProjectName,
    globs: readonly ModuleGlobs[],
    below: (directory: RelativePath) => readonly RelativePath[],
  ): void {
    if (globs.length === 0) return;
    const view = this.#view(project);
    for (const { path, directories, recursive } of globs) {
      const deep = new Set(recursive);
      const listings = directories.flatMap((directory) =>
        deep.has(directory) ? below(directory) : [listingPath(directory)],
      );
      view.see(path, [...new Set(listings)]);
    }
  }

  /** The listing paths the modules among `paths` glob, sorted and unique. */
  of(project: ProjectName, paths: readonly RelativePath[]): RelativePath[] {
    const view = this.#view(project);
    const out = new Set<RelativePath>();
    for (const path of paths) for (const listing of view.of(path)) out.add(listing);
    return [...out].sort(compare);
  }

  /** Stores what `see` added and the store lacks; inside the record's transaction. */
  write(): void {
    for (const view of this.#projects.values()) view.write();
  }

  #view(project: ProjectName): SharedPaths {
    return viewOf(
      this.#projects,
      project,
      () => new SharedPaths(this.store, globListingsMetaKey(project)),
    );
  }
}
