import { createHash } from "node:crypto";
import { runGit, sameList, splitNul } from "../fs/index.js";
import { type Hasher, type ObjectFormat, StatCache, seedStatCache } from "../hash/index.js";
import {
  absentReadAsOne,
  assembleClosure,
  coreEnvironmentInputs,
  createDeclaredInputs,
  createInputMatcher,
  type DeclaredInputs,
  type DependencyKeys,
  environmentHash,
  formerReadAsOne,
  gitEntryByKind,
  inputGlobs,
  KEY_FORMATS_READ_AS_ONE,
  type KeyChange,
  KeyIndex,
  Listings,
  listedDirectory,
  listingPath,
  ObservedSets,
  type ReadAsOne,
  StartupSets,
  sameInputs,
  testFileId,
  type UnmatchedInputs,
  unmatchedInputs,
} from "../keys/index.js";
import { type HeadState, reconcile, statCandidates } from "../revision/index.js";
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
  /** The paths the last `bootstrap` hashed for the first time, without a revision (row 011-91). */
  seededAtStart: readonly RelativePath[] = [];
  readonly isDeclaredInput = (path: RelativePath): boolean => this.#isDeclared(path);
  readonly #runnerClosures = new Map<string, RunnerClosure>();
  readonly #environments = new Map<ProjectName, RunnerEnvironment>();
  readonly #environmentFiles = new Set<RelativePath>();
  readonly #extra = new Set<RelativePath>();
  readonly #untracked = new Set<RelativePath>();
  /**
   * Gitignored paths bootstrap dropped from the cache: a predecessor hashed
   * them as declared inputs (004-50, 004-81). They
   * count as untracked, so a closure, an environment or a lockfile naming
   * one hashes it again and watches it.
   */
  readonly #dropped = new Set<RelativePath>();
  /**
   * Gitignored paths watched because the store named them: those bootstrap
   * found cached, and dropped paths a closure tracked again. A predecessor's
   * saved closure can name a path the runner's no longer does (its
   * declaration-only scratch, reviews/wave-5.6.md S1), and a removed
   * project's closures name none, so each is dropped once no closure,
   * environment, lockfile or observed read names it (row 011-36).
   */
  readonly #inherited = new Set<RelativePath>();
  /** Inherited paths the next `#release` judges: new ones, and those a replaced or removed closure named. */
  readonly #unjudged = new Set<RelativePath>();
  /** The environment names the lockfiles: no inherited path is judged before its first read. */
  #environmentsRead = false;
  readonly #lockfiles: Lockfiles;
  /** How each project's installed dependencies enter its keys (D3, task 001-105). */
  #dependencies = new Map<ProjectName, DependencyKeys>();
  /** Lockfile paths already checked against `.gitignore`. */
  readonly #ignoreChecked = new Set<RelativePath>();
  #declared: DeclaredInputs = createDeclaredInputs([], []);
  /** What runs observed beyond static closures, shared per project (D3, task 001-132). */
  readonly #observed: ObservedSets;
  /** What runs loaded at start-up beyond the environments, shared per project (016 D4). */
  readonly #startup: StartupSets;
  /** Test files whose observed set another worktree grew, not assembled again yet (016 D4, O9). */
  readonly #grownElsewhere = new Map<string, TestFileRef>();
  /** Entry names of listed directories, from the tracked files, else from disk (row 016-23). */
  readonly #listings: Listings;
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
    this.#listings = new Listings(() => this.#listedFiles(), options.root);
    this.#policy = options.policy;
    this.#isDeclared = createInputMatcher(inputGlobs(options.policy.inputs));
    this.cache = StatCache.load(options.store.fileHashes, options.worktreeId);
    this.#lockfiles = new Lockfiles(
      options.root,
      (text) => options.note?.(text),
      (text) => persistedNoteTexts(options.store, options.worktreeId).has(text),
    );
    this.#observed = new ObservedSets(options.store);
    this.#startup = new StartupSets(options.store);
    this.index = new KeyIndex(
      gitEntryByKind(options.root, (path) => {
        const directory = listedDirectory(path);
        if (directory !== null) return this.#listings.hashOf(directory);
        return this.#dropped.has(path) ? undefined : this.cache.hashOf(path);
      }),
    );
  }

  /**
   * Brings the stat cache up to date at daemon start. Cached paths are
   * reconciled, so what changed while no daemon ran becomes a revision.
   * Tracked and untracked files git knows and the cache does not are hashed
   * without a revision: there is nothing earlier to compare them with. So
   * are the files under a symlinked directory git lists, which the change
   * feed walks (task 001-166).
   * Cached paths git ignores entered the cache because a closure or an
   * environment named them, so they are watched again as extra files, until
   * a release finds nothing names them now (`#inherited`, row 011-36). A
   * daemon before 0.1.220 also hashed gitignored files under declared
   * inputs (a slow file's artifact, 004 D5 before task 004-81; scratch from
   * 0.1.60 to 0.1.73): those are dropped before reconciling, so they neither
   * make a revision nor key a test (004-50, reviews/wave-5.5.md B1). A
   * closure that still names one tracks it again.
   */
  async bootstrap(head: () => Promise<HeadState>): Promise<Revision | null> {
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
    const scratch: RelativePath[] = [];
    for (const path of await checkIgnored(this.options.root, unlisted)) {
      if (this.#isDeclared(path)) scratch.push(path);
      else {
        this.#extra.add(path);
        this.#inherit(path);
      }
    }
    this.#drop(scratch);
    let revision: Revision | null = null;
    if (this.cache.size > 0) {
      const paths = await statCandidates(this.cache.paths(), this.options.hasher);
      revision = await this.reconcile({ trigger: "start", paths }, head);
    }
    // Task 001-166: the files the change feed walks under a symlinked directory git lists.
    const linked = await linkedFiles(this.options.root, listed, this.extraFiles());
    this.seededAtStart = [...listed, ...linked].filter(
      (path) => this.cache.hashOf(path) === undefined,
    );
    await this.#seed(this.seededAtStart);
    this.#declared = createDeclaredInputs(this.#policy.inputs, this.#declarable());
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
   * lockfile is looked up from the project's root (review N8). Each project
   * gets its hashes at the formats read as one too (011 C3, task 011-38),
   * under the definition before task 011-85 (`formerReadAsOne`, 011-90), and
   * its current hash once more for the definition before 011-158, which keyed
   * absent closure paths (`absentReadAsOne`).
   */
  async setEnvironments(read: readonly RunnerEnvironment[]): Promise<KeyChange[]> {
    const { squealVersion, env } = this.options;
    const policy = this.#policy;
    const environments = this.#withStartup(read);
    const observedBefore = new Map(
      [...this.#environments.keys()].map((p) => [p, this.observes(p)]),
    );
    this.#environments.clear();
    this.#environmentFiles.clear();
    for (const environment of environments) {
      this.#environments.set(environment.project, environment);
      for (const path of environment.files) this.#environmentFiles.add(path);
    }
    this.#dependencies = await this.#lockfiles.set(environments);
    const lockPaths = this.#lockfiles.paths();
    const formerFiles = environments.flatMap((environment) => environment.formerFiles ?? []);
    await this.track([...this.#environmentFiles, ...formerFiles, ...lockPaths]);
    await this.#watchIgnored(lockPaths);
    // Row 011-36: what the last read named may be named by nothing now.
    this.#environmentsRead = true;
    this.#rejudge(this.#inherited);

    const hashOf = (path: RelativePath) => this.cache.hashOf(path);
    const packagesOf = (ref: TestFileRef) => this.#runnerClosures.get(testFileId(ref))?.packages;
    const hashes = new Map<ProjectName, EnvironmentHash>();
    const readAsOne = new Map<ProjectName, ReadAsOne[]>();
    const formats = Object.keys(KEY_FORMATS_READ_AS_ONE).map(Number);
    for (const environment of environments) {
      const dependencies = this.#dependencies.get(environment.project);
      const core = coreEnvironmentInputs({
        squealVersion,
        installedDependencies: dependencies?.environment ?? "none",
        allowlist: policy.env.allowlist,
        ...(env === undefined ? {} : { env }),
      });
      const hash = environmentHash(core, environment, hashOf);
      hashes.set(environment.project, hash);
      readAsOne.set(environment.project, [
        ...absentReadAsOne(hash),
        ...formats.map((format) => ({
          environment: environmentHash(core, environment, hashOf, format),
        })),
        ...formerReadAsOne(core, environment, dependencies, hashOf, packagesOf),
      ]);
    }
    // Task 001-105: each test file's packages are keyed against the new install.
    const installed = this.index.setInstalled(
      hashes,
      (ref) => {
        const runner = this.#runnerClosures.get(testFileId(ref));
        // Review wave-11b N1: no closure yet keys by the whole fingerprint, never by no packages.
        if (runner === undefined) return this.#dependencies.get(ref.project)?.of(undefined) ?? "";
        return this.#dependencySegment(runner);
      },
      readAsOne,
    );
    return [...installed, ...this.#reobserve(observedBefore)];
  }

  /**
   * 016 D4: each environment with its project's stored start-up paths among
   * its files, as `setClosure` adds the observed paths to a closure. Another
   * worktree's are read here, at each read of the environments.
   */
  #withStartup(environments: readonly RunnerEnvironment[]): RunnerEnvironment[] {
    this.#startup.refresh(environments.map((e) => e.project));
    return environments.map((environment) => {
      const startup = this.#startup.of(environment.project);
      if (startup.length === 0) return environment;
      return { ...environment, files: [...new Set([...environment.files, ...startup])] };
    });
  }

  /** 016 D4, O8: the closures of each project whose gate `observes` moved, assembled again. */
  #reobserve(before: ReadonlyMap<ProjectName, boolean>): KeyChange[] {
    const moved = new Set(
      [...this.#environments.keys()].filter((p) => (before.get(p) ?? false) !== this.observes(p)),
    );
    if (moved.size === 0) return [];
    return [...this.#runnerClosures.values()]
      .filter((runner) => moved.has(runner.testFile.project))
      .flatMap((runner) => this.setClosure(runner));
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
      this.#declared = createDeclaredInputs(policy.inputs, this.#declarable());
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
   * Sets a test file's closure: the runner's paths plus this worktree's
   * declared inputs, and while policy `observe.runtimeInputs` holds, the
   * paths its runs were observed to read (D3, task 001-132).
   */
  setClosure(runner: RunnerClosure): KeyChange[] {
    // Row 011-36: a path the replaced closure named may be named by nothing now.
    this.#rejudge(this.index.closure(runner.testFile)?.paths ?? []);
    this.#runnerClosures.set(testFileId(runner.testFile), runner);
    const observed = this.observes(runner.testFile.project)
      ? this.#observed.of(runner.testFile)
      : [];
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
    for (const ref of this.#observed.refresh(projects))
      this.#grownElsewhere.set(testFileId(ref), ref);
  }

  /**
   * 016 D4 (O9, task 003-26): reads what other worktrees observed for the
   * projects whose observed paths are module loads, and assembles again the
   * closure of every file whose set grew since, so a key this worktree holds
   * a result under takes the paths. Each refinement asks, the runner-only
   * one the daemon's timer queues too.
   */
  regrowObserved(): KeyChange[] {
    const loads = [...this.#environments.values()].filter((e) => e.observedLoads === true);
    this.refreshObserved(loads.map((e) => e.project));
    const changes = [...this.#grownElsewhere.values()].flatMap((ref) => {
      const runner = this.#runnerClosures.get(testFileId(ref));
      return runner === undefined ? [] : this.setClosure(runner);
    });
    this.#grownElsewhere.clear();
    return changes;
  }

  /**
   * 016 D4 (007 review wave 2.5, R1): reads the start-up paths other
   * worktrees stored for the projects whose observed paths are module loads,
   * and keys the environments last read with them when a set grew, so no
   * runner needs to recreate its project for them.
   */
  async regrowStartup(): Promise<KeyChange[]> {
    const loads = [...this.#environments.values()].filter((e) => e.observedLoads === true);
    if (this.#startup.refresh(loads.map((e) => e.project)).length === 0) return [];
    return this.setEnvironments([...this.#environments.values()]);
  }

  /** The observed set of `testFile`, whether or not policy keys with it. */
  observedOf(testFile: TestFileRef): readonly RelativePath[] {
    return this.#observed.of(testFile);
  }

  /** The paths that put `testFile` in `direct` (016 D4, row 007-56). */
  directOf(testFile: TestFileRef): readonly RelativePath[] {
    return this.#observed.directOf(testFile);
  }

  /**
   * 016 D4 (row 007-56): paths a process `testFile` started imported join
   * this worktree's marks; the record's transaction stores them (`writeSeen`).
   */
  markDirect(testFile: TestFileRef, paths: readonly RelativePath[]): void {
    this.#observed.mark(testFile, paths);
  }

  /**
   * 016 D4: a run's start-up paths (`RunReport.environmentObserved`) join
   * this worktree's view, so the environments read next hold them; the
   * record's transaction stores them (`writeSeen`).
   */
  seeStartup(project: ProjectName, paths: readonly RelativePath[]): void {
    this.#startup.see(project, paths);
  }

  /** Stores what `seeStartup` and `markDirect` added and the store lacks; inside the record's transaction. */
  writeSeen(): void {
    this.#startup.write();
    this.#observed.writeMarks();
  }

  /** The listing paths a recursive listing of `directory` reads (`Listings.below`, task 001-134). */
  listingsBelow(directory: RelativePath): RelativePath[] {
    return this.#listings.below(directory);
  }

  /**
   * True when what `project`'s runs observed keys its files: while policy
   * `observe.runtimeInputs` holds, and always for a project whose observed
   * paths are module loads (`RunnerEnvironment.observedLoads`, 016 D4, O8).
   */
  observes(project: ProjectName): boolean {
    return (
      this.#policy.observe.runtimeInputs || this.#environments.get(project)?.observedLoads === true
    );
  }

  /**
   * Re-keys the test files that listed a directory an add or delete among
   * `changes` changed the entries of (D3 as amended, task 001-132), or one
   * the watcher sees no file in whose names on disk changed (row 016-24).
   * Ignored files are no entries: what the watcher does not see keys by the
   * names `Listings` reads at each revision.
   */
  rekeyListings(changes: readonly FileChange[]): KeyChange[] {
    const moved = this.#listings.apply(changes.filter((c) => !this.#extra.has(c.path)));
    return moved.length === 0 ? [] : this.index.rekey(moved);
  }

  /**
   * A run of `testFile` listed `directories` (`ObservedInputs.directories`)
   * and ended: the names one the watcher sees no file in holds now are the
   * run's own (`Listings.ran`, row 016-24), when `testFile` alone lists it
   * here. Another reader of it still re-keys at the next revision.
   */
  listedByRun(testFile: TestFileRef, directories: readonly RelativePath[]): void {
    const id = testFileId(testFile);
    this.#listings.ran(
      directories.filter((directory) => {
        const readers = this.index.reverse.referencing([listingPath(directory)]);
        return readers.length > 0 && readers.every((ref) => testFileId(ref) === id);
      }),
    );
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
    // Row 011-36: what its closure or its runs named may be named by nothing now.
    if (this.#runnerClosures.delete(testFileId(ref))) this.#rejudge(this.#inherited);
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
    this.#declared = createDeclaredInputs(this.#policy.inputs, this.#declarable());
    return [...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner));
  }

  /**
   * Hashes the closure paths the stat cache did not track, then re-keys with
   * them.
   */
  async trackUntracked(): Promise<KeyChange[]> {
    const paths = [...this.#untracked];
    this.#untracked.clear();
    for (const path of paths) if (this.#dropped.has(path)) this.#inherit(path);
    if (paths.length > 0) await this.track(paths);
    this.#release();
    return paths.length === 0 ? [] : this.index.rekey(paths);
  }

  /** `path` is watched because the store named it: the next release judges it (`#inherited`). */
  #inherit(path: RelativePath): void {
    this.#inherited.add(path);
    this.#unjudged.add(path);
  }

  /** The next release judges again the inherited paths among `paths`. */
  #rejudge(paths: Iterable<RelativePath>): void {
    if (this.#inherited.size === 0) return;
    for (const path of paths) if (this.#inherited.has(path)) this.#unjudged.add(path);
  }

  /**
   * Drops the unjudged inherited paths nothing names now: the closures that
   * named them were saved ones, since replaced by the runner's or removed
   * (`#inherited`). A kept one is judged again only when what named it
   * changes, so a release costs nothing while nothing did.
   */
  #release(): void {
    if (this.#unjudged.size === 0 || !this.#environmentsRead) return;
    const named = new Set([...this.#environmentFiles, ...this.#lockfiles.paths()]);
    for (const environment of this.#environments.values()) {
      for (const path of environment.formerFiles ?? []) named.add(path);
    }
    for (const runner of this.#runnerClosures.values()) {
      for (const path of this.#observed.of(runner.testFile)) named.add(path);
    }
    const unnamed = [...this.#unjudged].filter(
      (path) => !named.has(path) && this.index.reverse.referencing([path]).length === 0,
    );
    this.#unjudged.clear();
    if (unnamed.length === 0) return;
    for (const path of unnamed) {
      this.#inherited.delete(path);
      this.#extra.delete(path);
    }
    this.#drop(unnamed);
    this.options.onExtraFiles(this.extraFiles());
  }

  /**
   * The files declared inputs are selected from: those git sees. A
   * gitignored file a closure or an environment named keys only the tests
   * that name it (004-50); none is a declared input, so no build output
   * Squeal does not produce keys a test (004 D5 as amended 2026-10-18).
   */
  #declarable(): RelativePath[] {
    return [...this.cache.paths()].filter((path) => !this.#extra.has(path));
  }

  /** Drops `paths` from the cache and the store; they count as untracked until tracked again. */
  #drop(paths: readonly RelativePath[]): void {
    if (paths.length === 0) return;
    const { store, worktreeId } = this.options;
    const updates = paths.map((path) => ({ kind: "delete", path }) as const);
    store.transaction(() => this.cache.flush(store.fileHashes, worktreeId, updates));
    for (const path of paths) this.#dropped.add(path);
  }

  /** Hashes the untracked ones among `paths`; the gitignored ones become extra files. */
  async track(paths: readonly RelativePath[]): Promise<void> {
    const untracked = [...new Set(paths)].filter(
      (path) => this.cache.hashOf(path) === undefined || this.#dropped.has(path),
    );
    if (untracked.length === 0) return;
    await this.#seed(untracked);
    for (const path of untracked) this.#dropped.delete(path);
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

  /** The files `project`'s environment hash was last read with (D3); none before the first read. */
  environmentFiles(project: ProjectName): readonly RelativePath[] {
    return this.#environments.get(project)?.files ?? [];
  }

  /** The runner `project`'s environment hash names (spec 016 D3); none before the first read. */
  runnerOf(project: ProjectName): string | undefined {
    return this.#environments.get(project)?.runnerName;
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
