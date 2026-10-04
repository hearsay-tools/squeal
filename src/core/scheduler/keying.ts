import { runGit, splitNul, toRelative } from "../fs/index.js";
import { type Hasher, type ObjectFormat, StatCache, seedStatCache } from "../hash/index.js";
import {
  assembleClosure,
  type CoreEnvironmentOptions,
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
  FileChange,
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
  #declared: RelativePath[] = [];
  #lockfile: { path: RelativePath; patches: RelativePath | null } | null = null;

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
   * runner files and the installed lockfile are hashed first.
   */
  async setEnvironments(environments: readonly RunnerEnvironment[]): Promise<KeyChange[]> {
    const { root, policy, squealVersion, env } = this.options;
    const lockfile = await findInstalledLockfile(root, root);
    const relative = (path: AbsolutePath | null) => (path === null ? null : toRelative(root, path));
    const lockPath = relative(lockfile?.path ?? null);
    this.#lockfile =
      lockPath === null ? null : { path: lockPath, patches: relative(lockfile?.patches ?? null) };

    this.#environments.clear();
    this.#environmentFiles.clear();
    for (const environment of environments) {
      this.#environments.set(environment.project, environment);
      for (const path of environment.files) this.#environmentFiles.add(path);
    }
    await this.track([...this.#environmentFiles, ...(lockPath === null ? [] : [lockPath])]);

    const coreOptions: CoreEnvironmentOptions = {
      squealVersion,
      installedDependencies: await installedDependenciesFingerprint(root, root),
      allowlist: policy.env.allowlist,
      ...(env === undefined ? {} : { env }),
    };
    const core = coreEnvironmentInputs(coreOptions);
    const hashOf = (path: RelativePath) => this.cache.hashOf(path);
    return environments.flatMap((environment) =>
      this.index.setEnvironment(environment.project, environmentHash(core, environment, hashOf)),
    );
  }

  /**
   * True when a change to `path` can change an environment hash: a runner
   * file (config, setup files and their closures), the installed lockfile, or
   * a file under its patches directory.
   */
  isEnvironmentInput(path: RelativePath): boolean {
    if (this.#environmentFiles.has(path)) return true;
    const lockfile = this.#lockfile;
    if (lockfile === null) return false;
    return (
      path === lockfile.path ||
      (lockfile.patches !== null && path.startsWith(`${lockfile.patches}/`))
    );
  }

  /**
   * True when the installed lockfile is not the one the environment was last
   * hashed with: a first install created one, or another package manager's
   * replaced it. Its old path is watched; a new one is in an ignored
   * directory no watch batch reports, so reconciliation passes ask here.
   */
  async lockfileMoved(): Promise<boolean> {
    const { root } = this.options;
    const found = await findInstalledLockfile(root, root);
    const path = found === null ? null : toRelative(root, found.path);
    return path !== (this.#lockfile?.path ?? null);
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

  /** What the stability check compares for a test file: its closure, its project's environment files, the lockfile. */
  stabilityPaths(ref: TestFileRef): RelativePath[] {
    const paths = new Set(this.index.closure(ref)?.paths ?? []);
    for (const path of this.#environments.get(ref.project)?.files ?? []) paths.add(path);
    if (this.#lockfile !== null) paths.add(this.#lockfile.path);
    return [...paths];
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
