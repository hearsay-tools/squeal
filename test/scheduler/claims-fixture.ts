import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type EpochMs,
  type Policy,
  type RunEnd,
  type RunnerAdapter,
  type RunReport,
  type Scheduler,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Task 001-205: two schedulers over worktrees of one repository and one real
 * store, each with a fake runner whose runs a test can hold. Test files are
 * plain files; each one's closure is itself, so equal bytes are equal keys.
 */

export const fileName = (i: number) => `test/f${String(i).padStart(2, "0")}.test.ts`;

/** A repository of `count` test files and a linked worktree `other` beside it. */
export function claimRepo(count: number): { main: string; other: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-claims-")));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const main = join(dir, "main");
  mkdirSync(join(main, "test"), { recursive: true });
  for (let i = 0; i < count; i++) writeFileSync(join(main, fileName(i)), `// file ${i}\n`);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  const other = join(dir, "other");
  git(main, ["worktree", "add", "-q", "-b", "other", other]);
  return { main, other };
}

function gate(): { shut: Promise<void>; open: () => void } {
  let open = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { shut, open };
}

/** A runner whose runs a test can hold, end otherwise, and fail per path. */
export class FakeRunner implements RunnerAdapter {
  readonly name = "fake";
  readonly adapterVersion = "1";
  /** The files of every run, in start order. */
  readonly runs: TestFileRef[][] = [];
  /** Runs in flight. */
  active = 0;
  end: RunEnd = "completed";
  readonly failing = new Set<string>();
  /** Called with a run's files while it is in flight. */
  during: ((files: readonly TestFileRef[]) => void | Promise<void>) | null = null;
  #gate: { shut: Promise<void>; open: () => void } | null = null;

  constructor(
    private readonly files: readonly TestFileRef[],
    private readonly runMs = 20,
  ) {}

  /** Later runs wait until `release`. */
  hold(): void {
    this.#gate ??= gate();
  }

  release(): void {
    this.#gate?.open();
    this.#gate = null;
  }

  /** How many runs ran `path`. */
  ran(path: string): number {
    return this.runs.filter((files) => files.some((f) => f.path === path)).length;
  }

  invalidate = async () => ({ recreatedProjects: [] });
  affected = async () => ({ direct: [], transitive: [] });
  closure = async (testFile: TestFileRef) => ({ testFile, paths: [testFile.path] });
  enumerate = async () => [];
  testFiles = async () => this.files;
  environment = async () => [
    {
      project: "",
      runnerName: "fake",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [],
    },
  ];
  close = async () => {};

  async run(files: readonly TestFileRef[]): Promise<RunReport> {
    this.runs.push([...files]);
    this.active += 1;
    try {
      await this.during?.(files);
      await new Promise((resolve) => setTimeout(resolve, this.runMs));
      await this.#gate?.shut;
    } finally {
      this.active -= 1;
    }
    const completed = this.end === "completed";
    return {
      end: this.end,
      durationMs: this.runMs,
      completedFiles: completed ? files : [],
      results: completed
        ? files.map((testFile) => ({
            check: {
              kind: "test" as const,
              project: testFile.project,
              testPath: testFile.path,
              fullName: "passes",
            },
            outcome: this.failing.has(testFile.path) ? ("fail" as const) : ("pass" as const),
            durationMs: 1,
            location: null,
            errors: this.failing.has(testFile.path)
              ? [{ name: "Error", message: "no", stack: null, location: null, diff: null }]
              : [],
          }))
        : [],
      fileErrors: [],
      failure: completed ? null : `run ${this.end}`,
    };
  }
}

export interface Side {
  /** This side's own connection to the shared store, as a daemon's. */
  readonly store: Store;
  readonly root: string;
  readonly worktreeId: string;
  readonly runner: FakeRunner;
  readonly scheduler: Scheduler;
  /** Stops this side's heartbeat, as a killed daemon's. */
  stopBeat(): void;
  /** Hands the scheduler a watch batch for `paths`. */
  batch(...paths: string[]): Promise<void>;
  /** The phase of `path`'s row. */
  phase(path: string): string | null | undefined;
  keyOf(path: string): string | null | undefined;
  /** How many of its files have a passing current result. */
  passing(): number;
}

export interface SideOptions {
  readonly count: number;
  readonly tierSize?: number;
  readonly backlogTierSize?: number;
  readonly timeoutMs?: number | null;
  readonly heartbeatMs?: number;
  readonly policy?: Partial<Policy>;
  readonly now?: () => EpochMs;
  readonly runMs?: number;
  /** `SchedulerOptions.rerunCap` (task 001-171). */
  readonly rerunCap?: number;
  /** Wraps the store the scheduler is given. */
  readonly wrap?: (store: Store) => Store;
}

/** A scheduler of the worktree at `root`, its daemon live in the store while it beats. */
export function side(root: string, options: SideOptions): Side {
  const commonDir = realpathSync(join(root, "..", "main", ".git"));
  const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  const store: Store = opened;
  const worktreeId = worktreeIdFor(root);
  const now = options.now ?? Date.now;
  const interval = options.heartbeatMs ?? 60_000;
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir: join(root, ".git"),
    isMain: false,
    registeredAt: now(),
    daemon: {
      socketPath: `/tmp/squeal-claims-${worktreeId}.sock`,
      startedAt: now(),
      heartbeatAt: now(),
      heartbeatIntervalMs: interval,
      squealVersion: "0.0.0-test",
    },
  });
  const beat = setInterval(() => store.worktrees.heartbeat(worktreeId, now()), interval / 5);
  const files = Array.from({ length: options.count }, (_, i) => ({
    project: "",
    path: fileName(i),
  }));
  const runner = new FakeRunner(files, options.runMs);
  const tierSize = options.tierSize ?? 4;
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...options.policy,
    runner: {
      ...DEFAULT_POLICY.runner,
      tierSize,
      backlogTierSize: options.backlogTierSize ?? tierSize,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  };
  const scheduler = createScheduler({
    root,
    worktreeId,
    store: options.wrap?.(store) ?? store,
    runner,
    sink: new RecordingSink(store, worktreeId),
    policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    now,
    ...(options.rerunCap === undefined ? {} : { rerunCap: options.rerunCap }),
  });
  onTestFinished(async () => {
    clearInterval(beat);
    runner.release();
    await scheduler.close();
    store.close();
  });
  const row = (path: string) =>
    store.testFileKeys.list(worktreeId).find((r) => r.testFile.path === path);
  const hasher = createFsHasher(root, "sha1");
  return {
    store,
    root,
    worktreeId,
    runner,
    scheduler,
    stopBeat: () => clearInterval(beat),
    async batch(...paths) {
      await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates(paths, hasher) });
    },
    phase: (path) => row(path)?.pending,
    keyOf: (path) => row(path)?.key,
    passing: () =>
      store.knownStates
        .list(worktreeId)
        .filter((s) => s.check.kind === "test" && s.outcome === "pass" && s.validity === "current")
        .length,
  };
}
