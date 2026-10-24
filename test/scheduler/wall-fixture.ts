import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  DEFAULT_POLICY,
  type Policy,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type Scheduler,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName } from "./claims-fixture.js";
import { RecordingSink } from "./recording-sink.js";

/*
 * Task 001-366: a scheduler over one worktree, a real store and a real pool
 * in a temporary directory, and a fake runner whose files report fixed
 * last-known durations while each run ends at once, so a test sees how a
 * backlog of heavy files is cut into tiers without waiting for them.
 */

export interface WallRun {
  readonly files: readonly TestFileRef[];
  /** `RunOptions.workers`: the tier's grant. */
  readonly workers: number | undefined;
}

/** Reports `durations` per file; a lane per path prefix and a width hook when given. */
export class WallRunner implements RunnerAdapter {
  readonly name = "wall";
  readonly adapterVersion = "1";
  readonly runs: WallRun[] = [];
  /** Runs in flight. */
  active = 0;
  #gate: { shut: Promise<void>; open: () => void } | null = null;

  /** `RunnerAdapter.lane`; absent, one lane. */
  declare readonly lane?: (testFile: TestFileRef) => string;
  /** `RunnerAdapter.tierWidth`; absent, the runner has none. */
  declare readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  /** `RunnerAdapter.tierPart`; absent, one part. */
  declare readonly tierPart?: (testFile: TestFileRef) => string;

  constructor(
    private readonly files: readonly TestFileRef[],
    /** Each file's reported duration in ms. */
    private readonly durations: (path: string) => number,
    hooks: Pick<WallOptions, "lane" | "tierWidth" | "tierPart"> = {},
  ) {
    if (hooks.lane !== undefined) this.lane = hooks.lane;
    if (hooks.tierWidth !== undefined) this.tierWidth = hooks.tierWidth;
    if (hooks.tierPart !== undefined) this.tierPart = hooks.tierPart;
  }

  /** Later runs wait until `release`. */
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

  invalidate = async () => ({ recreatedProjects: [] });
  affected = async () => ({ direct: [], transitive: [] });
  closure = async (testFile: TestFileRef) => ({ testFile, paths: [testFile.path] });
  enumerate = async () => [];
  testFiles = async () => this.files;
  environment = async () => [
    {
      project: "",
      runnerName: "wall",
      runnerVersion: "1",
      adapterVersion: "1",
      resolvedConfig: "{}",
      files: [],
    },
  ];
  close = async () => {};

  async run(files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    this.runs.push({ files: [...files], workers: options.workers });
    this.active += 1;
    try {
      await this.#gate?.shut;
    } finally {
      this.active -= 1;
    }
    return {
      end: "completed",
      durationMs: 1,
      completedFiles: files,
      results: files.map((testFile) => ({
        check: {
          kind: "test" as const,
          project: testFile.project,
          testPath: testFile.path,
          fullName: "passes",
        },
        outcome: "pass" as const,
        durationMs: this.durations(testFile.path),
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: null,
    };
  }
}

export interface WallSide {
  readonly runner: WallRunner;
  readonly scheduler: Scheduler;
  readonly store: Store;
  /** The pool's directory. */
  readonly dir: string;
  /** The tiers of the forced full run after the baseline, every duration known. */
  backlog(): Promise<WallRun[]>;
}

export interface WallOptions {
  /** Each file's reported duration in ms, by index. */
  readonly durations: readonly number[];
  readonly hostSlots: number;
  readonly tierSize?: number;
  readonly backlogTierSize?: number;
  readonly timeoutMs?: number | null;
  readonly lane?: (testFile: TestFileRef) => string;
  readonly tierWidth?: (testFile: TestFileRef, grant: number) => number;
  readonly tierPart?: (testFile: TestFileRef) => string;
}

/** A lone daemon over `durations.length` files, its pool `hostSlots` wide. */
export function wallSide(options: WallOptions): WallSide {
  const { main: root } = claimRepo(options.durations.length, {}, 0);
  const dir = join(mkdtempSync(join(tmpdir(), "squeal-wall-pool-")), "squeal-uid");
  onTestFinished(() => rmSync(join(dir, ".."), { recursive: true, force: true }));
  const commonDir = join(root, ".git");
  const opened = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(opened)) throw new Error(`store: ${JSON.stringify(opened)}`);
  const store: Store = opened;
  const worktreeId = worktreeIdFor(root);
  store.worktrees.upsert({
    id: worktreeId,
    root,
    commonDir,
    isMain: true,
    registeredAt: Date.now(),
    daemon: {
      socketPath: `/tmp/squeal-wall-${worktreeId}.sock`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 60_000,
      squealVersion: "0.0.0-test",
    },
  });
  const files = options.durations.map((_, i) => ({ project: "", path: fileName(i) }));
  const byPath = new Map(files.map((f, i) => [f.path, options.durations[i] ?? 1]));
  const runner = new WallRunner(files, (path) => byPath.get(path) ?? 1, options);
  const tierSize = options.tierSize ?? 4;
  // `backlog()` reads the durations the start baseline stored.
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...RUN_MISSING,
    runner: {
      ...DEFAULT_POLICY.runner,
      tierSize,
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
    // No live host CPU in the gate (row 011-182).
    capacity: { dir, hostSlots: options.hostSlots, host: null },
  });
  onTestFinished(async () => {
    runner.release();
    await scheduler.close();
    store.close();
  });
  return {
    runner,
    scheduler,
    store,
    dir,
    async backlog() {
      await scheduler.start();
      await scheduler.idle();
      const before = runner.runs.length;
      await scheduler.requestFullSuite({ force: true });
      await scheduler.idle();
      return runner.runs.slice(before);
    },
  };
}

/** List scheduling's bound on `durations` over `width` workers: `sum / W + (1 − 1/W) × longest`. */
export function wallOf(durations: readonly number[], width: number): number {
  const sum = durations.reduce((a, b) => a + b, 0);
  const longest = Math.max(0, ...durations);
  return sum / width + (1 - 1 / width) * longest;
}

/** `count` durations spread evenly from `from` to `to` ms, in a shuffled order. */
export function spread(count: number, from: number, to: number): number[] {
  const step = count > 1 ? (to - from) / (count - 1) : 0;
  const values = Array.from({ length: count }, (_, i) => Math.round(from + i * step));
  // A fixed interleave, so the queue's shortest-first order is the scheduler's doing.
  return values.map((_, i) => values[(i * 7) % count] ?? from);
}
