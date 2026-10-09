import { createHash } from "node:crypto";
import { runGit, sameList, splitNul } from "../fs/index.js";
import { type Hasher, type ObjectFormat, StatCache, seedStatCache } from "../hash/index.js";
import {
  artifactGlobs,
  assembleClosure,
  coreEnvironmentInputs,
  createDeclaredInputs,
  createInputMatcher,
  type DeclaredInputs,
  type DependencyKeys,
  environmentHash,
  ignoredInputs,
  inputGlobs,
  type KeyChange,
  KeyIndex,
  Listings,
  listedDirectory,
  ObservedSets,
  sameInputs,
  testFileId,
  type UnmatchedInputs,
  unmatchedInputs,
} from "../keys/index.js";
import { type HeadState, reconcile, statCandidates } from "../revision/index.js";
import { inheritsAcrossWorktrees } from "../slow/index.js";
import type {
  AbsolutePath,
  CandidateBatch,
  EnvironmentHash,
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
import { linkedFiles } from "../watcher/linked-files.js";
import { Lockfiles } from "./lockfiles.js";
import { persistedNoteTexts } from "./notes.js";
import { slowView } from "./slow.js";

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
  /** Records a status note: a stale hidden lockfile, once per change (task 001-104). */
  readonly note?: (text: string) => void;
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
  readonly isDeclaredInput = (path: RelativePath): boolean => this.#isDeclared(path);
  readonly #runnerClosures = new Map<string, RunnerClosure>();
  readonly #environments = new Map<ProjectName, RunnerEnvironment>();
  readonly #environmentFiles = new Set<RelativePath>();
  readonly #extra = new Set<RelativePath>();
  readonly #untracked = new Set<RelativePath>();
  readonly #lockfiles: Lockfiles;
  /** How each project's installed dependencies enter its keys (D3, task 001-105). */
  #dependencies = new Map<ProjectName, DependencyKeys>();
  /** Lockfile paths already checked against `.gitignore`. */
  readonly #ignoreChecked = new Set<RelativePath>();
  #declared: DeclaredInputs = createDeclaredInputs([], []);
  /**
   * True when the gitignored files policy `inputs` selects are to be listed
   * again at the next `trackUntracked`: the policy changed, or a rebuild
   * changed one and may have added others no watch reports (lessons defect 7).
   */
  #ignoredStale = false;
  /** What runs observed beyond static closures, shared per project (D3, task 001-132). */
  readonly #observed: ObservedSets;
  /** Entry names of listed directories, from the tracked files. */
  readonly #listings = new Listings(() => this.#listedFiles());
  /**
   * Paths `track` first hashed while runs were in flight, each with the
   * number of the last run begun by then: no hash from before a later run
   * holds them (task 001-134). Tiers of two lanes overlap (task 001-140), so
   * the set is cleared only when a run begins with none in flight.
   */
  readonly #firstHashed = new Map<RelativePath, number>();
  #runsBegun = 0;
  #runsInFlight = 0;
  #policy: Policy;
  #isDeclared: (path: RelativePath) => boolean;

  constructor(private readonly options: KeyingOptions) {
    this.#policy = options.policy;
    this.#isDeclared = createInputMatcher(inputGlobs(options.policy.inputs));
    this.cache = StatCache.load(options.store.fileHashes, options.worktreeId);
    this.#lockfiles = new Lockfiles(
      options.root,
      (text) => options.note?.(text),
      (text) => persistedNoteTexts(options.store, options.worktreeId).has(text),
    );
    this.#observed = new ObservedSets(options.store);
    this.index = new KeyIndex((path) => {
      const directory = listedDirectory(path);
      return directory === null ? this.cache.hashOf(path) : this.#listings.hashOf(directory);
    });
  }

  /**
   * Brings the stat cache up to date at daemon start. Cached paths are
   * reconciled, so what changed while no daemon ran becomes a revision.
   * Tracked and untracked files git knows and the cache does not are hashed
   * without a revision: there is nothing earlier to compare them with. So
   * are the files under a symlinked directory git lists, which the change
   * feed walks (task 001-166).
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
    // Task 001-166: the files the change feed walks under a symlinked directory git lists.
    const linked = await linkedFiles(this.options.root, listed, this.extraFiles());
    await this.#seed(
      [...listed, ...linked].filter((path) => this.cache.hashOf(path) === undefined),
    );
    await this.#trackIgnoredInputs();
    this.#declared = createDeclaredInputs(this.#policy.inputs, this.#knownFiles());
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
    const { squealVersion, env } = this.options;
    const policy = this.#policy;
    this.#environments.clear();
    this.#environmentFiles.clear();
    for (const environment of environments) {
      this.#environments.set(environment.project, environment);
      for (const path of environment.files) this.#environmentFiles.add(path);
    }
    this.#dependencies = await this.#lockfiles.set(environments);
    const lockPaths = this.#lockfiles.paths();
    await this.track([...this.#environmentFiles, ...lockPaths]);
    await this.#watchIgnored(lockPaths);

    const hashOf = (path: RelativePath) => this.cache.hashOf(path);
    const hashes = new Map<ProjectName, EnvironmentHash>();
    for (const environment of environments) {
      const core = coreEnvironmentInputs({
        squealVersion,
        installedDependencies: this.#dependencies.get(environment.project)?.environment ?? "none",
        allowlist: policy.env.allowlist,
        ...(env === undefined ? {} : { env }),
      });
      hashes.set(environment.project, environmentHash(core, environment, hashOf));
    }
    // Task 001-105: each test file's packages are keyed against the new install.
    return this.index.setInstalled(hashes, (ref) => {
      const runner = this.#runnerClosures.get(testFileId(ref));
      // Review wave-11b N1: no closure yet keys by the whole fingerprint, never by no packages.
      if (runner === undefined) return this.#dependencies.get(ref.project)?.of(undefined) ?? "";
      return this.#dependencySegment(runner);
    });
  }

  /** A test file's installed-dependency segment of its key (D3, task 001-105). */
  #dependencySegment(runner: RunnerClosure): string {
    return this.#dependencies.get(runner.testFile.project)?.of(runner.packages) ?? "";
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
    return [...inputs].flatMap(([project, changed]) => this.#provisional(project, changed));
  }

  /** A provisional environment hash for `project` from its current one and what changed. */
  #provisional(project: ProjectName, changed: unknown): KeyChange[] {
    const previous = this.index.environment(project);
    if (previous === undefined) return [];
    const encoded = JSON.stringify([PROVISIONAL_ENVIRONMENT, previous, changed]);
    return this.index.setEnvironment(project, createHash("sha256").update(encoded).digest("hex"));
  }

  /**
   * Applies a reloaded policy (spec 001 D11, review S3). New `inputs`:
   * declared inputs are selected again and every closure re-assembled with
   * them. A new `env.allowlist`: every environment hash moves to a
   * provisional one in this call, so no key keeps a result of the old
   * environment; `environment: true` asks the caller to read the
   * environments again, which sets the real hash with the new allowlist.
   */
  setPolicy(policy: Policy): { changes: KeyChange[]; environment: boolean } {
    const previous = this.#policy;
    this.#policy = policy;
    const changes: KeyChange[] = [];
    if (!sameInputs(previous.inputs, policy.inputs)) {
      this.#isDeclared = createInputMatcher(inputGlobs(policy.inputs));
      this.#declared = createDeclaredInputs(policy.inputs, this.#knownFiles());
      this.#ignoredStale = true;
      changes.push(
        ...[...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner)),
      );
    }
    // Task 001-132: observed paths join or leave every closure, and the
    // runner's adapter version moves with the recorder.
    const observe = previous.observe.runtimeInputs !== policy.observe.runtimeInputs;
    if (observe) {
      changes.push(
        ...[...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner)),
      );
    }
    const allowlist = !sameList(previous.env.allowlist, policy.env.allowlist);
    if (allowlist || observe) {
      const moved = [
        ["env.allowlist", policy.env.allowlist],
        ["observe", observe],
      ];
      for (const project of this.#environments.keys()) {
        changes.push(...this.#provisional(project, moved));
      }
    }
    return { changes, environment: allowlist || observe };
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
   * What a reconciliation pass that found no change reconciles too, because
   * it is in an ignored directory no watch batch reports: installed lockfiles
   * that are not the ones the environment was last hashed with. A first
   * install created one, or another package manager's replaced it; the old
   * and new paths, so the move becomes a revision (review N3).
   */
  async lockfileCandidates(): Promise<RelativePath[]> {
    return this.#lockfiles.moved();
  }

  /**
   * What every reconciliation pass reconciles too, whatever else it found:
   * the gitignored files of slow files' declared artifacts (`#ignoredArtifacts`),
   * not watched yet, a path already hashed included. A file a rebuild only
   * added joins the key as an add (004-33, reviews/wave-4.6.md B1). Watches
   * them from here on.
   */
  async ignoredCandidates(): Promise<RelativePath[]> {
    const listed = await this.#ignoredArtifacts();
    const unwatched = listed.filter((path) => !this.#extra.has(path));
    if (unwatched.length === 0) return [];
    for (const path of unwatched) this.#extra.add(path);
    this.options.onExtraFiles(this.extraFiles());
    return unwatched;
  }

  /**
   * Sets a test file's closure: the runner's paths plus this worktree's
   * declared inputs, and while policy `observe.runtimeInputs` holds, the
   * paths its runs were observed to read (D3, task 001-132).
   */
  setClosure(runner: RunnerClosure): KeyChange[] {
    this.#runnerClosures.set(testFileId(runner.testFile), runner);
    const observed = this.#policy.observe.runtimeInputs ? this.#observed.of(runner.testFile) : [];
    const update = this.index.setClosure(
      assembleClosure(runner, this.#declared.for(runner.testFile.path), observed),
      this.#dependencySegment(runner),
    );
    for (const path of update.untracked) this.#untracked.add(path);
    return update.changes;
  }

  /**
   * Adds what a run of `testFile` observed beyond its closure (`additions`,
   * tracked by the caller) to the shared set, then keys the file with them
   * (D5 as amended, task 001-132). Without the runner's closure the file is
   * not keyed yet, and the set waits for its first `setClosure`.
   */
  addObserved(testFile: TestFileRef, additions: readonly RelativePath[]): KeyChange[] {
    this.#observed.add(testFile, additions);
    const runner = this.#runnerClosures.get(testFileId(testFile));
    return runner === undefined ? [] : this.setClosure(runner);
  }

  /** Reads what other worktrees observed for `projects` since the last read. */
  refreshObserved(projects: Iterable<ProjectName>): void {
    this.#observed.refresh(projects);
  }

  /** The observed set of `testFile`, whether or not policy keys with it. */
  observedOf(testFile: TestFileRef): readonly RelativePath[] {
    return this.#observed.of(testFile);
  }

  /** The listing paths a recursive listing of `directory` reads (`Listings.below`, task 001-134). */
  listingsBelow(directory: RelativePath): RelativePath[] {
    return this.#listings.below(directory);
  }

  /** True while policy `observe.runtimeInputs` holds. */
  get observing(): boolean {
    return this.#policy.observe.runtimeInputs;
  }

  /**
   * Re-keys the test files that listed a directory an add or delete among
   * `changes` changed the entries of (D3 as amended, task 001-132). Ignored
   * files are no entries: what the watcher does not see cannot key.
   */
  rekeyListings(changes: readonly FileChange[]): KeyChange[] {
    const moved = this.#listings.apply(changes.filter((c) => !this.#extra.has(c.path)));
    return moved.length === 0 ? [] : this.index.rekey(moved);
  }

  /** The existing files policy `inputs` selects for the test file at `path` (spec 004 D6). */
  declaredFor(path: RelativePath): readonly RelativePath[] {
    return this.#declared.for(path);
  }

  /** Entries of policy `inputs` that select no test file among `testFiles` or no known file (review wave 4.5, S5). */
  unmatchedInputs(testFiles: Iterable<RelativePath>): UnmatchedInputs {
    return unmatchedInputs(this.#policy.inputs, testFiles, this.#knownFiles());
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
    if (changes.some((c) => this.#extra.has(c.path) && this.isDeclaredInput(c.path))) {
      this.#ignoredStale = true;
    }
    const structural = changes.some(
      (c) => (c.oldHash === null || c.newHash === null) && this.isDeclaredInput(c.path),
    );
    if (!structural) return null;
    this.#declared = createDeclaredInputs(this.#policy.inputs, this.#knownFiles());
    return [...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner));
  }

  /**
   * Hashes the closure paths the stat cache did not track, then re-keys with
   * them. Lists the gitignored declared inputs again first when they may
   * have moved (`#ignoredStale`), and re-keys with any new ones.
   */
  async trackUntracked(): Promise<KeyChange[]> {
    const declared = this.#ignoredStale ? await this.#relistIgnoredInputs() : [];
    const paths = [...this.#untracked];
    this.#untracked.clear();
    if (paths.length === 0) return declared;
    await this.track(paths);
    return [...declared, ...this.index.rekey(paths)];
  }

  /** Lists and tracks the gitignored declared inputs; re-keys every closure when one is new. */
  async #relistIgnoredInputs(): Promise<KeyChange[]> {
    const before = this.#extra.size;
    await this.#trackIgnoredInputs();
    if (this.#extra.size === before) return [];
    this.#declared = createDeclaredInputs(this.#policy.inputs, this.#knownFiles());
    return [...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner));
  }

  /**
   * Spec 004 D6, lessons defect 7: a declared input git ignores, such as a
   * build output, is hashed and watched like a gitignored closure path, so
   * it keys the test files that declare it.
   */
  async #trackIgnoredInputs(): Promise<void> {
    this.#ignoredStale = false;
    await this.track(await this.#ignoredArtifacts());
  }

  /**
   * The gitignored files a slow file's declared artifact selects (spec 004
   * D5): only entries of policy `inputs` whose test-file glob selects a slow
   * file list them, and none is a test file or under a directory a slow
   * glob covers (D6's rule). A test's own gitignored scratch files never key
   * it, so no run feeds its own inputs (lessons defect 10).
   */
  async #ignoredArtifacts(): Promise<RelativePath[]> {
    const view = slowView(this.#policy);
    if (!view.declared) return [];
    const isSlow = createInputMatcher(view.globs);
    const globs = artifactGlobs(this.#policy.inputs, this.#knownFiles(), isSlow);
    if (globs.length === 0) return [];
    const testFiles = new Set([...this.#runnerClosures.values()].map((r) => r.testFile.path));
    const listed = await ignoredInputs(this.options.root, globs);
    return listed.filter((path) =>
      inheritsAcrossWorktrees({ path, slow: true }, [path], testFiles, view.globs),
    );
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

  /** A tier starts: paths hashed from here on hold no value from before its run. Returns the run's number. */
  beginRun(): number {
    if (this.#runsInFlight === 0) this.#firstHashed.clear();
    this.#runsInFlight += 1;
    this.#runsBegun += 1;
    return this.#runsBegun;
  }

  /** A tier `beginRun` started was recorded or put back. */
  endRun(): void {
    this.#runsInFlight = Math.max(0, this.#runsInFlight - 1);
  }

  /**
   * True when `track` first hashed `path` after run `run` began: the stat
   * cache held neither its hash nor its absence when the run started, so what
   * the run read cannot be compared with anything (D5 as amended, task 001-134).
   */
  firstHashedDuringRun(path: RelativePath, run: number): boolean {
    return (this.#firstHashed.get(path) ?? 0) >= run;
  }

  /** Gitignored paths watched anyway (D2), sorted. */
  extraFiles(): RelativePath[] {
    return [...this.#extra].sort();
  }

  /** What the stability check compares for a test file: its closure, its project's environment files, its lockfile. */
  stabilityPaths(ref: TestFileRef): RelativePath[] {
    const paths = new Set(this.index.closure(ref)?.paths ?? []);
    for (const path of this.#environments.get(ref.project)?.files ?? []) paths.add(path);
    const lockfile = this.#lockfiles.of(ref.project);
    if (lockfile !== null) paths.add(lockfile);
    return [...paths];
  }

  /** Projects whose environment hash reads `path`. */
  #projectsReading(path: RelativePath): ProjectName[] {
    const projects = new Set(this.#lockfiles.projectsReading(path));
    for (const [project, environment] of this.#environments) {
      if (environment.files.includes(path)) projects.add(project);
    }
    return [...projects];
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
    for (const path of paths) {
      if (!this.#firstHashed.has(path)) this.#firstHashed.set(path, this.#runsBegun);
    }
    store.transaction(() => this.cache.flush(store.fileHashes, worktreeId));
  }

  /** The files a listing names: present, and seen by git (not extra). */
  *#listedFiles(): Iterable<RelativePath> {
    for (const path of this.cache.paths()) {
      if (!this.#extra.has(path) && this.cache.hashOf(path)) yield path;
    }
  }

  #knownFiles(): RelativePath[] {
    return [...this.cache.paths(), ...this.#extra];
  }
}
