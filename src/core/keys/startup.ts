import { compare } from "../fs/index.js";
import type { ProjectName, RelativePath, Store } from "../types/index.js";

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
 * This worktree's view of the shared start-up sets. Read from the store at
 * the first ask and at each `refresh`, parsed only when the value changed.
 * `see` adds a run's paths to the view only, so the environments read again
 * before the run's record hold them; `write`, inside the record's
 * transaction, merges into the store what the view holds and the store
 * lacks, so two worktrees' daemons never drop each other's paths, and a
 * write a rolled-back transaction lost is made by the next record. Until
 * then the view is ahead of the store: an over-key in this daemon only.
 */
export class StartupSets {
  readonly #sets = new Map<ProjectName, Set<RelativePath>>();
  readonly #raw = new Map<ProjectName, string | null>();
  /** Projects `see` added paths to: `write` compares their views with the store. */
  readonly #seen = new Set<ProjectName>();

  constructor(private readonly store: Store) {}

  /** The start-up paths of `project`, sorted. Reads the project once. */
  of(project: ProjectName): readonly RelativePath[] {
    if (!this.#raw.has(project)) this.refresh([project]);
    return [...(this.#sets.get(project) ?? [])].sort(compare);
  }

  /** Merges what the store holds for `projects` into this view. Returns the projects whose set grew. */
  refresh(projects: Iterable<ProjectName>): ProjectName[] {
    const grown: ProjectName[] = [];
    for (const project of new Set(projects)) {
      const raw = this.store.meta.get(observedStartupMetaKey(project));
      if (this.#raw.get(project) === raw) continue;
      this.#raw.set(project, raw);
      if (this.#merge(project, parsePaths(raw)).length > 0) grown.push(project);
    }
    return grown;
  }

  /** Adds `paths` to `project`'s view, not to the store. Returns the new ones. */
  see(project: ProjectName, paths: readonly RelativePath[]): RelativePath[] {
    if (!this.#raw.has(project)) this.refresh([project]);
    const added = this.#merge(project, paths);
    if (added.length > 0) this.#seen.add(project);
    return added;
  }

  /** Merges into the store each seen project's paths it lacks, one transaction per project. */
  write(): void {
    for (const project of this.#seen) {
      const key = observedStartupMetaKey(project);
      this.store.transaction(() => {
        const stored = parsePaths(this.store.meta.get(key));
        const held = new Set(stored);
        const missing = [...(this.#sets.get(project) ?? [])].filter((p) => !held.has(p));
        if (missing.length === 0) return;
        this.store.meta.set(key, JSON.stringify([...stored, ...missing].sort(compare)));
        // another worktree's paths this write merged are read at the next `refresh`
        this.#raw.delete(project);
      });
    }
  }

  /** `see` and `write`: adds `paths` here and in the store. Returns the new ones. */
  add(project: ProjectName, paths: readonly RelativePath[]): RelativePath[] {
    const added = this.see(project, paths);
    this.write();
    return added;
  }

  #merge(project: ProjectName, paths: readonly RelativePath[]): RelativePath[] {
    const known = this.#sets.get(project) ?? new Set<RelativePath>();
    const added = paths.filter((p) => !known.has(p));
    for (const path of added) known.add(path);
    this.#sets.set(project, known);
    return added;
  }
}

/** A missing or malformed key reads as no paths. */
function parsePaths(raw: string | null): RelativePath[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
