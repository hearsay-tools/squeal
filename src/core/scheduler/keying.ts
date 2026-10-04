import { createHash } from "node:crypto";
import { join } from "node:path";
import { runGit, splitNul, toRelative } from "../fs/index.js";
import { type Hasher, type ObjectFormat, StatCache, seedStatCache } from "../hash/index.js";
import {
  assembleClosure,
  coreEnvironmentInputs,
  createInputMatcher,
  environmentHash,
  findInstalledLockfile,
  installedDependenciesFingerprint,
  type KeyChange,
  KeyIndex,
  selectDeclaredInputs,
  testFileId,
} from "../keys/index.js";
import { type HeadState, reconcile, statCandidates } from "../revision/index.js";
import type {
  AbsolutePath,
  CandidateBatch,
  CoreEnvironmentInputs,
  FileChange,
  FileHash,
  Policy,
  ProjectName,
  RelativePath,
  Revision,
  RunnerClosure,
  RunnerEnvironment,
  Store,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { checkIgnored } from "../watcher/git.js";

export interface KeyingOptions {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly store: Store;
  readonly hasher: Hasher;
  readonly objectFormat: ObjectFormat;
  readonly policy: Policy;
  readonly squealVersion: string;
  /** Allow-listed variables are read from here. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Called with every extra file whenever the list grows. */
  readonly onExtraFiles: (paths: readonly RelativePath[]) => void;
}

/** An installed lockfile and its patches directory, relative to the worktree root. */
interface Lockfile {
  readonly path: RelativePath;
  readonly patches: RelativePath | null;
}

/** Bumped when the provisional encoding changes; never equal to a real environment hash. */
const PROVISIONAL_ENVIRONMENT = "squeal-provisional-environment/1";

/**
 * The stat cache, closures, environments and keys of one worktree.
 *
 * Spec 001 D2: "Gitignored files that appear in a known closure (generated
 * code) and the installed-dependency lockfile that the environment hash reads
 * are added to the stat cache and watched individually [...]. A test file is
 * never keyed while any of its closure paths is untracked by the stat cache."
 * Every path a closure or environment names is hashed into the stat cache
 * before it is keyed (review B2); the gitignored ones become extra files.
 */
export class WorktreeKeys {
  readonly cache: StatCache;
  readonly index: KeyIndex;
  readonly isDeclaredInput: (path: RelativePath) => boolean;
  readonly #runnerClosures = new Map<string, RunnerClosure>();
  readonly #environments = new Map<ProjectName, RunnerEnvironment>();
  readonly #environmentFiles = new Set<RelativePath>();
  readonly #extra = new Set<RelativePath>();
  readonly #untracked = new Set<RelativePath>();
  /** Installed lockfile of each project (review N8). */
  readonly #lockfiles = new Map<ProjectName, Lockfile | null>();
  /** Lockfile paths `lockfileCandidates` found moved, and the projects that read them. */
  readonly #movedLockfiles = new Map<RelativePath, ProjectName[]>();
  /** Lockfile paths already checked against `.gitignore`. */
  readonly #ignoreChecked = new Set<RelativePath>();
  #declared: RelativePath[] = [];

  constructor(private readonly options: KeyingOptions) {
    this.cache = StatCache.load(options.store.fileHashes, options.worktreeId);
    this.index = new KeyIndex((path) => this.cache.hashOf(path));
    this.isDeclaredInput = createInputMatcher(options.policy.inputs);
  }

  /**
   * Brings the stat cache up to date at daemon start. Cached paths are
   * reconciled, so what changed while no daemon ran becomes a revision.
   * Tracked and untracked files git knows and the cache does not are hashed
   * without a revision: there is nothing earlier to compare them with.
   * Cached paths git ignores entered the cache because a closure or an
   * environment named them, so they are watched again as extra files.
   */
  async bootstrap(head: () => Promise<HeadState>): Promise<Revision | null> {
    let revision: Revision | null = null;
    if (this.cache.size > 0) {
      const paths = await statCandidates(this.cache.paths(), this.options.hasher);
      revision = await this.reconcile({ trigger: "start", paths }, head);
    }
    const listed = splitNul(
      await runGit(this.options.root, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ]),
    );
    const known = new Set(listed);
    const unlisted = [...this.cache.paths()].filter((path) => !known.has(path));
    for (const path of await checkIgnored(this.options.root, unlisted)) this.#extra.add(path);
    await this.#seed(listed.filter((path) => this.cache.hashOf(path) === undefined));
    this.#declared = selectDeclaredInputs(this.options.policy.inputs, this.#knownFiles());
    return revision;
  }

  /** `reconcile` on this worktree's cache. Calls must not overlap (the scheduler's lock). */
  async reconcile(batch: CandidateBatch, head: () => Promise<HeadState>): Promise<Revision | null> {
    const { worktreeId, store, hasher } = this.options;
    return reconcile(batch, this.cache, hasher, { worktreeId, store, head });
  }

  /**
   * Sets the environment hash of every project from runner output (D3). The
   * runner files and each project's installed lockfile are hashed first; the
   * lockfile is looked up from the project's root (review N8).
   */
  async setEnvironments(environments: readonly RunnerEnvironment[]): Promise<KeyChange[]> {
    const { root, policy, squealVersion, env } = this.options;
    this.#environments.clear();
    this.#environmentFiles.clear();
    this.#lockfiles.clear();
    this.#movedLockfiles.clear();
    const cores = new Map<ProjectName, CoreEnvironmentInputs>();
    for (const environment of environments) {
      this.#environments.set(environment.project, environment);
      for (const path of environment.files) this.#environmentFiles.add(path);
      const projectRoot = this.#projectRoot(environment);
      this.#lockfiles.set(environment.project, await this.#findLockfile(projectRoot));
      const installedDependencies = await installedDependenciesFingerprint(projectRoot, root);
      cores.set(
        environment.project,
        coreEnvironmentInputs({
          squealVersion,
          installedDependencies,
          allowlist: policy.env.allowlist,
          ...(env === undefined ? {} : { env }),
        }),
      );
    }
    const lockPaths = this.#lockfilePaths();
    await this.track([...this.#environmentFiles, ...lockPaths]);
    await this.#watchIgnored(lockPaths);

    const hashOf = (path: RelativePath) => this.cache.hashOf(path);
    return environments.flatMap((environment) => {
      const core = cores.get(environment.project) as CoreEnvironmentInputs;
      return this.index.setEnvironment(
        environment.project,
        environmentHash(core, environment, hashOf),
      );
    });
  }

  /**
   * Moves the environment hash of every project whose environment inputs are
   * among `changes`, without the runner, so their keys move in the same
   * transaction as the revision (review B2). The provisional hash never
   * equals a real one, so its keys find no stored result; `setEnvironments`
   * replaces it once the runner answers.
   */
  provisionalEnvironments(changes: readonly FileChange[]): KeyChange[] {
    const inputs = new Map<ProjectName, [RelativePath, FileHash | null][]>();
    for (const change of changes) {
      for (const project of this.#projectsReading(change.path)) {
        inputs.set(project, [...(inputs.get(project) ?? []), [change.path, change.newHash]]);
      }
    }
    return [...inputs].flatMap(([project, changed]) => {
      const previous = this.index.environment(project);
      if (previous === undefined) return [];
      const encoded = JSON.stringify([PROVISIONAL_ENVIRONMENT, previous, changed]);
      return this.index.setEnvironment(project, createHash("sha256").update(encoded).digest("hex"));
    });
  }

  /**
   * True when a change to `path` can change an environment hash: a runner
   * file (config, setup files and their closures), an installed lockfile, or
   * a file under its patches directory.
   */
  isEnvironmentInput(path: RelativePath): boolean {
    return this.#projectsReading(path).length > 0;
  }

  /**
   * Installed lockfiles that are not the ones the environment was last hashed
   * with: a first install created one, or another package manager's replaced
   * it. Returns the old and new paths, so a reconciliation of them records
   * the move as a revision (review N3). Their old paths are watched; a new
   * one is in an ignored directory no watch batch reports, so reconciliation
   * passes ask here.
   */
  async lockfileCandidates(): Promise<RelativePath[]> {
    this.#movedLockfiles.clear();
    for (const [project, environment] of this.#environments) {
      const found = await this.#findLockfile(this.#projectRoot(environment));
      const previous = this.#lockfiles.get(project) ?? null;
      if (found?.path === previous?.path) continue;
      for (const path of [previous?.path, found?.path]) {
        if (path === undefined) continue;
        this.#movedLockfiles.set(path, [...(this.#movedLockfiles.get(path) ?? []), project]);
      }
    }
    return [...this.#movedLockfiles.keys()].sort();
  }

  /** Sets a test file's closure: the runner's paths plus this worktree's declared inputs (D3). */
  setClosure(runner: RunnerClosure): KeyChange[] {
    this.#runnerClosures.set(testFileId(runner.testFile), runner);
    const update = this.index.setClosure(assembleClosure(runner, this.#declared));
    for (const path of update.untracked) this.#untracked.add(path);
    return update.changes;
  }

  removeTestFile(ref: TestFileRef): void {
    this.#runnerClosures.delete(testFileId(ref));
    this.index.removeTestFile(ref);
  }

  /**
   * Re-selects declared inputs when one was added or deleted, and re-assembles
   * every closure with them. Returns the key changes, or `null` when no
   * declared input was added or deleted.
   */
  updateDeclaredInputs(changes: readonly FileChange[]): KeyChange[] | null {
    const structural = changes.some(
      (c) => (c.oldHash === null || c.newHash === null) && this.isDeclaredInput(c.path),
    );
    if (!structural) return null;
    this.#declared = selectDeclaredInputs(this.options.policy.inputs, this.#knownFiles());
    return [...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner));
  }

  /** Hashes the closure paths the stat cache did not track, then re-keys with them. */
  async trackUntracked(): Promise<KeyChange[]> {
    const paths = [...this.#untracked];
    this.#untracked.clear();
    if (paths.length === 0) return [];
    await this.track(paths);
    return this.index.rekey(paths);
  }

  /** Hashes the untracked ones among `paths`; the gitignored ones become extra files. */
  async track(paths: readonly RelativePath[]): Promise<void> {
    const untracked = [...new Set(paths)].filter((path) => this.cache.hashOf(path) === undefined);
    if (untracked.length === 0) return;
    await this.#seed(untracked);
    const ignored = await checkIgnored(this.options.root, untracked);
    const before = this.#extra.size;
    for (const path of ignored) this.#extra.add(path);
    if (this.#extra.size > before) this.options.onExtraFiles(this.extraFiles());
  }

  /** Gitignored paths watched anyway (D2), sorted. */
  extraFiles(): RelativePath[] {
    return [...this.#extra].sort();
  }

  /** What the stability check compares for a test file: its closure, its project's environment files, its lockfile. */
  stabilityPaths(ref: TestFileRef): RelativePath[] {
    const paths = new Set(this.index.closure(ref)?.paths ?? []);
    for (const path of this.#environments.get(ref.project)?.files ?? []) paths.add(path);
    const lockfile = this.#lockfiles.get(ref.project);
    if (lockfile) paths.add(lockfile.path);
    return [...paths];
  }

  /** Projects whose environment hash reads `path`. */
  #projectsReading(path: RelativePath): ProjectName[] {
    const projects = new Set(this.#movedLockfiles.get(path));
    for (const [project, environment] of this.#environments) {
      if (environment.files.includes(path)) projects.add(project);
      const lockfile = this.#lockfiles.get(project);
      if (!lockfile) continue;
      if (path === lockfile.path) projects.add(project);
      if (lockfile.patches !== null && path.startsWith(`${lockfile.patches}/`))
        projects.add(project);
    }
    return [...projects];
  }

  #projectRoot(environment: RunnerEnvironment): AbsolutePath {
    const { root } = this.options;
    return environment.root === undefined || environment.root === ""
      ? root
      : join(root, environment.root);
  }

  async #findLockfile(projectRoot: AbsolutePath): Promise<Lockfile | null> {
    const { root } = this.options;
    const found = await findInstalledLockfile(projectRoot, root);
    if (found === null) return null;
    const path = toRelative(root, found.path);
    if (path === null) return null;
    return { path, patches: found.patches === null ? null : toRelative(root, found.patches) };
  }

  #lockfilePaths(): RelativePath[] {
    const paths = new Set<RelativePath>();
    for (const lockfile of this.#lockfiles.values()) if (lockfile) paths.add(lockfile.path);
    return [...paths];
  }

  /** Lockfiles tracked by a reconciliation, not by `track`, are watched too when gitignored (D2). */
  async #watchIgnored(paths: readonly RelativePath[]): Promise<void> {
    const unchecked = paths.filter(
      (path) => !this.#extra.has(path) && !this.#ignoreChecked.has(path),
    );
    if (unchecked.length === 0) return;
    for (const path of unchecked) this.#ignoreChecked.add(path);
    const ignored = await checkIgnored(this.options.root, unchecked);
    const before = this.#extra.size;
    for (const path of ignored) this.#extra.add(path);
    if (this.#extra.size > before) this.options.onExtraFiles(this.extraFiles());
  }

  async #seed(paths: readonly RelativePath[]): Promise<void> {
    if (paths.length === 0) return;
    const { root, objectFormat, hasher, store, worktreeId } = this.options;
    await seedStatCache(this.cache, root, paths, { objectFormat, hasher });
    store.transaction(() => this.cache.flush(store.fileHashes, worktreeId));
  }

  #knownFiles(): RelativePath[] {
    return [...this.cache.paths(), ...this.#extra];
  }
}
