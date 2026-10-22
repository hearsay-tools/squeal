import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler, type SchedulerOptions } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RevisionTrigger,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type Scheduler,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { claimRepo } from "./claims-fixture.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Task 011-22 (spec 011 C4 step 4 as amended 2026-10-20): worktrees of one
 * repository whose test files import plain source files, a real store and a
 * real per-user pool, and a fake runner whose files report fixed last-known
 * durations. A run takes each file's `realMs` on the next free of its
 * workers (its grant, else one per file) and honours a cancel: the files
 * that ended before it complete, the rest do not.
 */

export interface CatchUpFile {
  /** `""` when absent; project p's environment file is `p.config.json`, the root's `config.json`. */
  readonly project?: string;
  readonly path: string;
  /** The duration its results report, in ms. */
  readonly ms: number;
  /** What a run of it takes, in ms; 0 when absent. */
  readonly realMs?: number;
  /** Source paths its closure holds beside itself, each imported in one hop. */
  readonly imports: readonly string[];
  /** Source paths its closure holds that it reaches through another module (task 011-25). */
  readonly through?: readonly string[];
}

export interface CatchUpRun {
  readonly files: readonly TestFileRef[];
  /** `RunOptions.workers`: the tier's grant, absent for an edit's tier. */
  readonly workers: number | undefined;
  readonly startedAt: number;
  endedAt: number | null;
  cancelled: boolean;
  completed: readonly TestFileRef[];
}

type Hooks = Pick<CatchUpOptions, "lane" | "tierWidth" | "besideBacklog" | "backlogSlot"> & {
  /** `false`: a run ignores its `signal`, as node:test and pytest do; only `stop` ends it. */
  readonly cancels?: boolean;
};

const refOf = (file: CatchUpFile): TestFileRef => ({
  project: file.project ?? "",
  path: file.path,
});

/** `promise`, or the abort of `signal`, whichever comes first. */
function until(promise: Promise<unknown>, signal: AbortSignal | undefined): Promise<unknown> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.resolve();
  return Promise.race([
    promise,
    new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
  ]);
}

export class CatchUpRunner implements RunnerAdapter {
  readonly name = "catch-up";
  readonly adapterVersion = "1";
  readonly runs: CatchUpRun[] = [];
  /** Runs in flight. */
  active = 0;
  readonly failing = new Set<string>();
  /** Called with a run's files as it starts. */
  beforeRun: ((files: readonly TestFileRef[]) => void) | null = null;
  declare readonly lane?: (testFile: TestFileRef) => string;
  declare readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  declare readonly besideBacklog?: (testFile: TestFileRef) => boolean;
  declare readonly backlogSlot?: (testFile: TestFileRef) => number | null;
  #gate: { shut: Promise<void>; open: () => void } | null = null;
  readonly #byPath: ReadonlyMap<string, CatchUpFile>;
  readonly #cancels: boolean;

  constructor(
    private readonly files: readonly CatchUpFile[],
    { cancels = true, ...hooks }: Hooks = {},
  ) {
    this.#byPath = new Map(files.map((f) => [f.path, f]));
    this.#cancels = cancels;
    for (const [name, hook] of Object.entries(hooks))
      if (hook !== undefined) Object.assign(this, { [name]: hook });
  }

  /** Later runs wait until `release` or their cancel. */
  hold(): void {
    let open = () => {};
    const shut = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.#gate ??= { shut, open };
  }

  release(): void {
    this.#gate?.open();
    this.#gate = null;
  }

  /** The runs that held `path`, in start order. */
  runsOf(path: string): CatchUpRun[] {
    return this.runs.filter((run) => run.files.some((f) => f.path === path));
  }

  invalidate = async () => ({ recreatedProjects: [] });
  /** The runner's split (task 011-25): a changed file or a one-hop import is direct, `through` transitive. */
  affected = async (changed: readonly string[]) => {
    const hit = (paths: readonly string[] = []) => paths.some((path) => changed.includes(path));
    const direct = this.files.filter((f) => changed.includes(f.path) || hit(f.imports));
    const transitive = this.files.filter((f) => !direct.includes(f) && hit(f.through));
    return { direct: direct.map(refOf), transitive: transitive.map(refOf) };
  };
  closure = async (testFile: TestFileRef) => {
    const file = this.#byPath.get(testFile.path);
    return { testFile, paths: [testFile.path, ...(file?.imports ?? []), ...(file?.through ?? [])] };
  };
  enumerate = async () => [];
  testFiles = async () => this.files.map(refOf);
  environment = async () =>
    [...new Set(this.files.map((f) => f.project ?? ""))].map((project) => ({
      project,
      runnerName: "catch-up",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [configOf(project)],
    }));
  close = async () => {};

  async run(files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    const run: CatchUpRun = {
      files: [...files],
      workers: options.workers,
      startedAt: performance.now(),
      endedAt: null,
      cancelled: false,
      completed: [],
    };
    this.runs.push(run);
    this.beforeRun?.(files);
    this.active += 1;
    const signals = [this.#cancels ? options.signal : undefined, options.stop].filter(
      (s) => s !== undefined,
    );
    const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
    try {
      const gate = this.#gate?.shut;
      if (gate !== undefined) await until(gate, signal);
      const free = Array.from({ length: Math.max(1, options.workers ?? files.length) }, () => 0);
      const ends = files.map((f) => {
        const at = Math.min(...free);
        const i = free.indexOf(at);
        free[i] = at + (this.#byPath.get(f.path)?.realMs ?? 0);
        return free[i] ?? 0;
      });
      const began = performance.now();
      if (!signal?.aborted) {
        await until(new Promise((r) => setTimeout(r, Math.max(0, ...free))), signal);
      }
      run.cancelled = signal?.aborted === true;
      const elapsed = run.cancelled ? performance.now() - began : Number.POSITIVE_INFINITY;
      run.completed =
        gate !== undefined && run.cancelled
          ? []
          : files.filter((_, i) => (ends[i] ?? 0) <= elapsed);
    } finally {
      this.active -= 1;
      run.endedAt = performance.now();
    }
    return this.#report(run);
  }

  #report(run: CatchUpRun): RunReport {
    return {
      end: "completed",
      durationMs: (run.endedAt ?? run.startedAt) - run.startedAt,
      completedFiles: run.completed,
      results: run.completed.map((testFile) => {
        const failing = this.failing.has(testFile.path);
        return {
          check: {
            kind: "test" as const,
            project: testFile.project,
            testPath: testFile.path,
            fullName: "runs",
          },
          outcome: failing ? ("fail" as const) : ("pass" as const),
          durationMs: this.#byPath.get(testFile.path)?.ms ?? 1,
          location: null,
          errors: failing
            ? [{ name: "Error", message: "no", stack: null, location: null, diff: null }]
            : [],
        };
      }),
      fileErrors: [],
      failure: run.cancelled ? "cancelled" : null,
    };
  }
}

export interface CatchUpOptions {
  readonly files: readonly CatchUpFile[];
  readonly hostSlots: number;
  readonly tierSize?: number;
  readonly backlogTierSize?: number;
  readonly timeoutMs?: number | null;
  readonly policy?: Partial<Policy>;
  readonly lane?: (testFile: TestFileRef) => string;
  readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  readonly besideBacklog?: (testFile: TestFileRef) => boolean;
  readonly backlogSlot?: (testFile: TestFileRef) => number | null;
  /** `false`: runs ignore a cancel, as node:test's and pytest's do. */
  readonly cancels?: boolean;
  /** `SchedulerOptions.runnerPartMs`: the bound on one runner-part call. */
  readonly runnerPartMs?: number;
  /** `SchedulerOptions.resumesRest`: the start resumes a rest (row 011-91). */
  readonly resumesRest?: boolean;
  /** `SchedulerOptions.now`: the scheduler's clock (row 011-94). */
  readonly now?: () => number;
  /** Further `SchedulerOptions`: the runtime directory, the slow tier's (rows 011-106, 004). */
  readonly scheduler?: Pick<SchedulerOptions, "runtimeDir" | "onReinstall" | "slow">;
}

/** Project `project`'s environment file. */
export const configOf = (project: string) =>
  project === "" ? "config.json" : `${project}.config.json`;

export interface CatchUpRepo {
  readonly main: string;
  readonly other: string;
  /** The per-user pool every side of the repository shares. */
  readonly poolDir: string;
}

/**
 * A repository holding `files`, the sources they import, `config.json` and
 * the `others` paths (a declared input, say), and one worktree beside.
 */
export function catchUpRepo(
  files: readonly CatchUpFile[],
  others: readonly string[] = [],
): CatchUpRepo {
  const extra: Record<string, string> = {};
  for (const path of others) extra[path] = `// ${path}\n`;
  for (const file of files) {
    extra[configOf(file.project ?? "")] = "{}\n";
    extra[file.path] = `// ${file.path}\n`;
    for (const source of [...file.imports, ...(file.through ?? [])])
      extra[source] = `// ${source}\n`;
  }
  const { main, other } = claimRepo(0, extra, 1);
  const pool = realpathSync(mkdtempSync(join(tmpdir(), "squeal-catch-up-pool-")));
  onTestFinished(() => rmSync(pool, { recursive: true, force: true }));
  return { main, other, poolDir: join(pool, "squeal-uid") };
}

export interface CatchUpSide {
  readonly root: string;
  readonly store: Store;
  readonly worktreeId: string;
  readonly runner: CatchUpRunner;
  readonly scheduler: Scheduler;
  /** Appends a line to each path, then hands the scheduler one batch of them as `trigger`. */
  edit(trigger: RevisionTrigger, ...paths: string[]): Promise<void>;
  /** Appends a line to each path, with no batch. */
  touch(...paths: string[]): void;
  /** Whether `path`'s checks are current, passing or failing. */
  current(path: string): boolean;
}

/** A scheduler of the worktree at `root`, its daemon live in the store, over the repository's pool. */
export function catchUpSide(repo: CatchUpRepo, root: string, options: CatchUpOptions): CatchUpSide {
  const commonDir = join(repo.main, ".git");
  const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  const store: Store = opened;
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: root === repo.main,
    registeredAt: Date.now(),
    daemon: {
      socketPath: `/tmp/squeal-catch-up-${worktreeId}.sock`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 60_000,
      squealVersion: "0.0.0-test",
    },
  });
  const beat = setInterval(() => store.worktrees.heartbeat(worktreeId, Date.now()), 12_000);
  const { lane, tierWidth, besideBacklog, backlogSlot, cancels } = options;
  const runner = new CatchUpRunner(options.files, {
    ...(lane === undefined ? {} : { lane }),
    ...(tierWidth === undefined ? {} : { tierWidth }),
    ...(besideBacklog === undefined ? {} : { besideBacklog }),
    ...(backlogSlot === undefined ? {} : { backlogSlot }),
    ...(cancels === undefined ? {} : { cancels }),
  });
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...options.policy,
    runner: {
      ...DEFAULT_POLICY.runner,
      tierSize: options.tierSize ?? 4,
      backlogTierSize: options.backlogTierSize ?? 200,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  };
  const scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    capacity: { dir: repo.poolDir, hostSlots: options.hostSlots },
    ...(options.runnerPartMs === undefined ? {} : { runnerPartMs: options.runnerPartMs }),
    ...(options.resumesRest === undefined ? {} : { resumesRest: options.resumesRest }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...options.scheduler,
  });
  onTestFinished(async () => {
    clearInterval(beat);
    runner.release();
    await scheduler.close();
    store.close();
  });
  const hasher = createFsHasher(root, "sha1");
  let edits = 0;
  const touch = (...paths: string[]) => {
    edits += 1;
    for (const path of paths) appendFileSync(join(root, path), `// edit ${edits}\n`);
  };
  return {
    root,
    store,
    worktreeId,
    runner,
    scheduler,
    touch,
    async edit(trigger, ...paths) {
      touch(...paths);
      await scheduler.handleBatch({ trigger, paths: await statCandidates(paths, hasher) });
    },
    current: (path) => {
      const states = store.knownStates.list(worktreeId).filter((s) => s.check.testPath === path);
      return states.length > 0 && states.every((s) => s.validity === "current");
    },
  };
}

/** `count` test files `test/fNNN.test.ts` of `ms`, file i importing `sources[i % sources.length]`. */
export function testFiles(
  count: number,
  sources: readonly string[],
  ms: (i: number) => number,
  realMs: (i: number) => number = () => 0,
): CatchUpFile[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `test/f${String(i).padStart(3, "0")}.test.ts`,
    ms: ms(i),
    realMs: realMs(i),
    imports: sources.length === 0 ? [] : [sources[i % sources.length] ?? ""],
  }));
}

/** `count` source paths `src/sNN.ts`. */
export const sources = (count: number, prefix = "s"): string[] =>
  Array.from({ length: count }, (_, i) => `src/${prefix}${String(i).padStart(2, "0")}.ts`);
