import { join } from "node:path";
import { toRelative } from "../fs/index.js";
import {
  type DependencyKeys,
  dependencyKeys,
  findInstalledLockfile,
  type InstalledDependencies,
  installedDependencies,
} from "../keys/index.js";
import type { AbsolutePath, ProjectName, RelativePath, RunnerEnvironment } from "../types/index.js";

/** An installed lockfile and its patches directory, relative to the worktree root. */
interface Lockfile {
  readonly path: RelativePath;
  readonly patches: RelativePath | null;
}

interface Project {
  readonly root: AbsolutePath;
  readonly lockfile: Lockfile | null;
}

/**
 * The installed lockfile of each runner project, looked up from the project's
 * root (`RunnerEnvironment.root`, the worktree root when absent), so a
 * workspace package with its own `node_modules` is hashed and watched
 * (review N8). Spec 001 D3: "the installed-dependency fingerprint (installed
 * lockfile metadata under `node_modules` plus `patches/`)".
 */
export class Lockfiles {
  readonly #projects = new Map<ProjectName, Project>();
  /** Lockfile paths `moved` found, and the projects that read them. */
  readonly #moved = new Map<RelativePath, ProjectName[]>();
  /** The stale-lockfile note last given per lockfile path, so each is noted once. */
  readonly #notes = new Map<RelativePath, string | null>();
  /** Types-only scans by package identity, kept across installs (`InstalledGraph`). */
  readonly #typesOnly = new Map<string, boolean>();

  /** `note` records a stale hidden lockfile (task 001-104) as a status note, once per change. */
  constructor(
    private readonly root: AbsolutePath,
    private readonly note: (text: string) => void = () => {},
  ) {}

  /**
   * Finds each project's lockfile. Returns how each project's installed
   * dependencies enter its keys (D3, task 001-105). A lockfile several
   * projects share is read once.
   */
  async set(environments: readonly RunnerEnvironment[]): Promise<Map<ProjectName, DependencyKeys>> {
    this.#projects.clear();
    this.#moved.clear();
    const read = new Map<RelativePath | null, InstalledDependencies>();
    const keys = new Map<ProjectName, DependencyKeys>();
    for (const environment of environments) {
      const root =
        environment.root === undefined || environment.root === ""
          ? this.root
          : join(this.root, environment.root);
      const lockfile = await this.#find(root);
      this.#projects.set(environment.project, { root, lockfile });
      const path = lockfile?.path ?? null;
      let installed = read.get(path);
      if (installed === undefined) {
        installed = await installedDependencies(root, this.root, this.#typesOnly);
        read.set(path, installed);
        if (path !== null) this.#noteOnce(path, installed.note);
      }
      keys.set(environment.project, dependencyKeys(installed, environment.packages));
    }
    return keys;
  }

  #noteOnce(path: RelativePath, note: string | null): void {
    if (this.#notes.get(path) === note) return;
    this.#notes.set(path, note);
    if (note !== null) this.note(note);
  }

  /** Every project's lockfile path, once each. */
  paths(): RelativePath[] {
    const paths = new Set<RelativePath>();
    for (const { lockfile } of this.#projects.values()) if (lockfile) paths.add(lockfile.path);
    return [...paths];
  }

  /** The lockfile path of one project, or `null`. */
  of(project: ProjectName): RelativePath | null {
    return this.#projects.get(project)?.lockfile?.path ?? null;
  }

  /** Projects whose fingerprint reads `path`: their lockfile, a file under its patches, or a moved lockfile. */
  projectsReading(path: RelativePath): ProjectName[] {
    const projects = new Set(this.#moved.get(path));
    for (const [project, { lockfile }] of this.#projects) {
      if (!lockfile) continue;
      if (path === lockfile.path) projects.add(project);
      if (lockfile.patches !== null && path.startsWith(`${lockfile.patches}/`))
        projects.add(project);
    }
    return [...projects];
  }

  /**
   * Lockfiles that are not the ones the fingerprints were taken from: a first
   * install created one, or another package manager's replaced it. Returns
   * the old and new paths, sorted.
   */
  async moved(): Promise<RelativePath[]> {
    this.#moved.clear();
    for (const [project, { root, lockfile }] of this.#projects) {
      const found = await this.#find(root);
      if (found?.path === lockfile?.path) continue;
      for (const path of [lockfile?.path, found?.path]) {
        if (path === undefined) continue;
        this.#moved.set(path, [...(this.#moved.get(path) ?? []), project]);
      }
    }
    return [...this.#moved.keys()].sort();
  }

  async #find(projectRoot: AbsolutePath): Promise<Lockfile | null> {
    const found = await findInstalledLockfile(projectRoot, this.root);
    if (found === null) return null;
    const path = toRelative(this.root, found.path);
    if (path === null) return null;
    return { path, patches: found.patches === null ? null : toRelative(this.root, found.patches) };
  }
}
