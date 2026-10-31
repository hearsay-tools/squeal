import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createDelivery, readHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { appendNote } from "../../src/core/notes.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler, type SchedulerOptions } from "../../src/core/scheduler/index.js";
import { recordOptimizerOff } from "../../src/core/state/optimizer-note.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  type CheckKey,
  type Consumer,
  DEFAULT_POLICY,
  type HarnessDelivery,
  MAIN_AGENT,
  type NodeTestProject,
  type Policy,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type Scheduler,
  type StatusHeader,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createNodeTestAdapter } from "../../src/runners/node-test/adapter.js";
import { VitestAdapter } from "../../src/runners/vitest/adapter.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { loadVitest } from "../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../src/runners/vitest/paths.js";
import { git } from "../hash/git-repo.js";
import { type Phase, PhaseTrace, type TraceOptions } from "./phase-trace.js";
import { movableClock } from "./quiet-clock.js";
import { RecordingSink } from "./recording-sink.js";
import { HARNESS_INCARNATION } from "./store-wait.js";

const fixtures = resolve(import.meta.dirname, "../fixtures/scheduler");
/** Inside the repository, so fixture copies resolve `vitest` from its `node_modules`. Git-ignored. */
const scratchDir = resolve(import.meta.dirname, "../fixtures/scheduler/.tmp");

/** Real Vitest instances and real runs; a loaded machine needs headroom. */
export const SLOW = { timeout: 120_000 } as const;

export const ALL_TEST_FILES = [
  "test/gen.test.ts",
  "test/math.test.ts",
  "test/plain.test.ts",
  "test/strings.test.ts",
  "test/upper.test.ts",
];

export const ref = (path: string): TestFileRef => ({ project: "", path });

const cleanups: (() => Promise<void> | void)[] = [];
/** The tests' phase traces (row 011-281): a failed test's keeps its tmp dir and prints its report. */
const traces: PhaseTrace[] = [];

/** Runs the registered cleanups now, newest first; one that throws leaves the older ones registered. */
export async function cleanUp(): Promise<void> {
  for (let cleanup = cleanups.pop(); cleanup !== undefined; cleanup = cleanups.pop())
    await cleanup();
}

// A scheduler's close waits for its run in flight and then closes Vitest: past
// the 10 s hook default under a loaded full suite (task 001-309).
afterEach(async (context) => {
  for (const trace of traces) {
    const report = context.task.result?.state === "fail" ? trace.failed() : null;
    if (report !== null) console.error(report);
  }
  try {
    await cleanUp();
  } finally {
    cleanups.length = 0;
    traces.length = 0;
  }
}, SLOW.timeout);

/** Within the 120 s test timeout, room for the stall report and the hook's own timeout. */
const TRACE_BUDGET_MS = 100_000;
/** Each traced cleanup step: three fit in the 120 s hook timeout. */
const TRACE_CLEANUP_MS = 30_000;

/** A phase trace for a test of `repo` (row 011-281); pass it as `HarnessOptions.trace`. */
export function traceRepo(
  repo: { dir: string; commonDir: string },
  options: Partial<Omit<TraceOptions, "kept">> = {},
): PhaseTrace {
  const { database, runsDir } = storePaths(repo.commonDir);
  const trace = new PhaseTrace({
    budgetMs: TRACE_BUDGET_MS,
    cleanupMs: TRACE_CLEANUP_MS,
    stall: null,
    ...options,
    kept: { dir: repo.dir, database, runsDir },
  });
  traces.push(trace);
  return trace;
}

/**
 * A git repository holding a copy of a fixture under `test/fixtures/scheduler`.
 * In `basic`, `src/gen/` is gitignored but present.
 */
export function createRepo(fixture: "basic" | "barrel" | "barrel-only" | "observed" = "basic"): {
  main: string;
  commonDir: string;
  dir: string;
} {
  mkdirSync(scratchDir, { recursive: true });
  const dir = join(scratchDir, randomUUID());
  const main = join(dir, "main");
  cpSync(join(fixtures, fixture), main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  cleanups.push(() => {
    if (!traces.some((trace) => trace.keeps(dir))) rmSync(dir, { recursive: true, force: true });
  });
  return { main: realpathSync(main), commonDir: realpathSync(join(main, ".git")), dir };
}

/** `git worktree add` of `main` at `dir/name`, with the generated file codegen would write. */
export function addWorktree(main: string, dir: string, name: string): string {
  const root = join(dir, name);
  git(main, ["worktree", "add", "-q", "-b", name, root]);
  cpSync(join(main, "src/gen"), join(root, "src/gen"), { recursive: true });
  return realpathSync(root);
}

export function openRepoStore(commonDir: string): Store {
  const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  cleanups.push(() => store.close());
  return store;
}

export interface RecordedRun {
  readonly files: readonly TestFileRef[];
  readonly options: RunOptions;
  readonly report: RunReport;
}

/** Adapter calls a test can make reject. */
export type FailingCall = "invalidate" | "affected" | "closure" | "testFiles" | "environment";

/**
 * A real adapter that records every run. Calls are serialized as the Vitest
 * adapter's were before task 001-150, and `beforeRun` runs inside that
 * queue: while it is pending, a tier is in flight and every later runner
 * call waits behind it. With `HarnessOptions.runnerPartBesideRun` there is
 * no queue here: `beforeRun` waits first, and the adapter orders its own
 * calls (`Gate`).
 */
export interface RecordingRunner extends RunnerAdapter {
  readonly runs: RecordedRun[];
  beforeRun: ((files: readonly TestFileRef[]) => void | Promise<void>) | null;
  /** Calls that reject with `failure` while listed. */
  readonly failing: Set<FailingCall>;
  failure: string;
}

/** A span's detail: the first paths and how many more. */
const named = (paths: readonly string[]) =>
  paths.length <= 3
    ? paths.join(", ")
    : `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more`;

function recording(
  inner: RunnerAdapter,
  environmentRoot?: string,
  besideRun = false,
  trace?: PhaseTrace,
): RecordingRunner {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(
    call: () => Promise<T>,
    detail: string,
    phase: Phase = "refinement",
    outcome?: (answer: T) => string,
  ): Promise<T> => {
    const marked = trace === undefined ? call : trace.call(phase, detail, call, outcome);
    if (besideRun) return marked();
    const next = queue.then(marked);
    queue = next.catch(() => {});
    return next;
  };
  const guarded = <T>(name: FailingCall, call: () => Promise<T>, detail = ""): Promise<T> =>
    serial(
      () => (runner.failing.has(name) ? Promise.reject(new Error(runner.failure)) : call()),
      detail === "" ? name : `${name} ${detail}`,
    );
  const runner: RecordingRunner = {
    name: inner.name,
    adapterVersion: inner.adapterVersion,
    runs: [],
    beforeRun: null,
    failing: new Set(),
    failure: "vitest.config.ts: Unexpected token",
    invalidate: (paths) =>
      guarded("invalidate", () => inner.invalidate(paths), named(paths.map((p) => p.path))),
    affected: (paths) => guarded("affected", () => inner.affected(paths), named(paths)),
    closure: (testFile) => guarded("closure", () => inner.closure(testFile), testFile.path),
    enumerate: (testFile) => serial(() => inner.enumerate(testFile), `enumerate ${testFile.path}`),
    testFiles: () => guarded("testFiles", () => inner.testFiles()),
    omittedTestFiles: () => inner.omittedTestFiles?.() ?? 0,
    slowWidth: (testFiles) => inner.slowWidth?.(testFiles) ?? testFiles.length,
    environment: () =>
      guarded("environment", async () => {
        const environments = await inner.environment();
        if (environmentRoot === undefined) return environments;
        return environments.map((environment) => ({ ...environment, root: environmentRoot }));
      }),
    run: async (files, options) => {
      if (besideRun) await runner.beforeRun?.(files);
      return serial(
        async () => {
          if (!besideRun) await runner.beforeRun?.(files);
          const report = await inner.run(files, options);
          runner.runs.push({ files, options, report });
          return report;
        },
        `${named(files.map((f) => f.path))}; run ${options.runId}`,
        "runner.run",
        (report) => report.end,
      );
    },
    close: () => inner.close(),
  };
  // Row 011-211: a slow instance's close reaches it.
  const release = inner.releaseLane?.bind(inner);
  if (release !== undefined) runner.releaseLane = release;
  return runner;
}

export interface Harness {
  readonly root: string;
  readonly store: Store;
  readonly worktreeId: string;
  /** The Vitest adapter; with `HarnessOptions.nodeTest` one part of the scheduler's composite. */
  readonly runner: RecordingRunner;
  /** Awaited before every run the scheduler starts, node:test's too, with the options it chose. */
  readonly gate: {
    before: ((files: readonly TestFileRef[], options: RunOptions) => unknown) | null;
  };
  readonly sink: RecordingSink;
  readonly scheduler: Scheduler;
  readonly extraFiles: string[][];
  /** Errors the scheduler reported through `onError`; the first fails the test at cleanup. */
  readonly errors: Error[];
  write(path: string, content: string): void;
  remove(path: string): void;
  /** Hands the scheduler a watch batch for `paths`, as the change feed would. */
  batch(...paths: string[]): Promise<void>;
  keyOf(path: string): CheckKey | null;
  /** Runs that ran `path`. */
  runsOf(path: string): RecordedRun[];
  /** The delivery header as hooks read it (D6). */
  header(): StatusHeader;
  /** A consumer of this worktree registered with a real `HarnessDelivery`. */
  consumer(sessionId?: string): Promise<{ delivery: HarnessDelivery; consumer: Consumer }>;
  /** The scheduler's clock: `HarnessOptions.now`, or the host's, plus what `advance` added. */
  now(): number;
  /** Moves the scheduler's clock `ms` ahead (row 011-153). */
  advance(ms: number): void;
}

export interface HarnessOptions {
  readonly tierSize?: number;
  /** Policy `runner.backlogTierSize`; default `tierSize`, so backlog work keeps edit-sized tiers. */
  readonly backlogTierSize?: number;
  /** Policy `runner.timeoutMs`; default `DEFAULT_POLICY`'s. */
  readonly timeoutMs?: number | null;
  readonly policy?: Partial<Policy>;
  /** Make these adapter calls reject from the start. */
  readonly failing?: readonly FailingCall[];
  /** Reported as every project's `RunnerEnvironment.root`. */
  readonly environmentRoot?: string;
  /** Errors are expected: do not fail the test on `onError`. */
  readonly allowErrors?: boolean;
  /** `SchedulerOptions.reloadPolicy`. */
  readonly reloadPolicy?: SchedulerOptions["reloadPolicy"];
  /** `SchedulerOptions.onReinstall`. */
  readonly onReinstall?: SchedulerOptions["onReinstall"];
  /** `SchedulerOptions.onListed` (row 015-52). */
  readonly onListed?: SchedulerOptions["onListed"];
  /** The adapter records runtime inputs while policy `observe.runtimeInputs` holds (task 001-132). */
  readonly observe?: boolean;
  /** `SchedulerOptions.slow` (spec 004): give tests with slow files their own slot directory. */
  readonly slow?: SchedulerOptions["slow"];
  /** A slow lane's runs go to a Vitest instance of their own, as the daemon's do (`withSlowInstance`, row 011-211). */
  readonly slowInstance?: boolean;
  /** `SchedulerOptions.capacity` (001 D11 Capacity): a pool in a temporary directory. Default none. */
  readonly capacity?: SchedulerOptions["capacity"];
  /** node:test projects beside Vitest, behind the daemon's composite (spec 003 D7). */
  readonly nodeTest?: readonly NodeTestProject[];
  /** Adapters behind the composite after node:test's, as built (task 007-26: a pytest one). */
  readonly adapters?: readonly RunnerAdapter[];
  /** Their processes at once follow policy `runner.tierSize`, as the daemon's adapters do (task 004-37). */
  readonly nodeTestTierSize?: boolean;
  /**
   * `beforeRun` holds a run without holding the Vitest adapter's other
   * calls, and the recorder adds no queue of its own: the adapter's
   * runner part overlaps its runs (task 001-150).
   */
  readonly runnerPartBesideRun?: boolean;
  /** `SchedulerOptions.rerunCap` (task 001-171). */
  readonly rerunCap?: number;
  /** `SchedulerOptions.hostLoad` (001-368). */
  readonly hostLoad?: SchedulerOptions["hostLoad"];
  /** `SchedulerOptions.runnerPartMs` (task 001-228). */
  readonly runnerPartMs?: number;
  /** Task 001-422: the pump resumes after a busy store, reporting here. */
  readonly busyWaits?: SchedulerOptions["busyWaits"];
  /** `SchedulerOptions.busySliceMs`: how long a sliced write waits on a busy store (row 011-126). */
  readonly busySliceMs?: number;
  /** `SchedulerOptions.now`: the clock the store's re-key moves are stamped with (task 001-258). */
  readonly now?: () => number;
  /** `SchedulerOptions.incarnation`; default `HARNESS_INCARNATION`, the daemon `liveDaemon` registers. */
  readonly incarnation?: string;
  /** `SchedulerOptions.predecessor`; default not known, so the first commit takes in what was left. */
  readonly predecessor?: string | null;
  /** Marks the runner's calls and bounds the cleanup (`traceRepo`, row 011-281); default none. */
  readonly trace?: PhaseTrace;
}

/** A Vitest instance per slow pass, as the daemon's `slowVitest` makes. */
const slowVitest =
  (root: string, node: Awaited<ReturnType<typeof loadVitest>>, observe?: () => boolean) =>
  (): RunnerAdapter =>
    new VitestAdapter(new WorktreePaths(root), node, undefined, observe);

/** A scheduler over a real Vitest adapter and the shared store, closed after the test. */
export async function openHarness(
  root: string,
  store: Store,
  commonDir: string,
  options: HarnessOptions = {},
): Promise<Harness> {
  const worktreeId = worktreeIdFor(root);
  let scheduler: Scheduler | null = null;
  // As the daemon's note: persisted for `squeal status`, stamped with the revision (D7).
  const note = (text: string) =>
    appendNote(store, worktreeId, {
      at: Date.now(),
      revision: scheduler?.status().revision ?? null,
      text,
    });
  // The policy as the last reload left it, which the observing adapter reads as the daemon's does.
  let current: Policy | null = null;
  const observe =
    options.observe === true ? () => current?.observe.runtimeInputs ?? false : undefined;
  const optimizer = (projects: readonly string[]) =>
    recordOptimizerOff(store, worktreeId, projects);
  const adapter = await createVitestAdapter({
    root,
    note,
    optimizer,
    ...(observe ? { observe } : {}),
  });
  const inner =
    options.slowInstance === true
      ? withSlowInstance(adapter, slowVitest(root, await loadVitest(root), observe))
      : adapter;
  const { trace } = options;
  const runner = recording(inner, options.environmentRoot, options.runnerPartBesideRun, trace);
  for (const call of options.failing ?? []) runner.failing.add(call);
  const nodeTest = await Promise.all(
    (options.nodeTest ?? []).map((project) =>
      createNodeTestAdapter(project, {
        root,
        note,
        ...(options.nodeTestTierSize === true
          ? { concurrency: () => current?.runner.tierSize ?? 1 }
          : {}),
      }),
    ),
  );
  const others = [...nodeTest, ...(options.adapters ?? [])];
  const parts = others.length === 0 ? runner : createCompositeRunner([runner, ...others]);
  const gate: Harness["gate"] = { before: null };
  // Delegates to `parts` at each call, so a test that replaces `h.runner.closure` is still heard.
  const schedulerRunner: RunnerAdapter = Object.create(parts, {
    run: {
      value: async (files: readonly TestFileRef[], runOptions: RunOptions) => {
        await gate.before?.(files, runOptions);
        return parts.run(files, runOptions);
      },
    },
  });
  const sink = new RecordingSink(store, worktreeId);
  const extraFiles: string[][] = [];
  const errors: Error[] = [];
  const policy: Policy = {
    ...DEFAULT_POLICY,
    // An observing harness turns the recorder on unless the test says otherwise (it is off by default while
    // reviews/wave-12d.md is repaired).
    ...(options.observe === true ? { observe: { runtimeInputs: true } } : {}),
    ...options.policy,
    runner: {
      ...DEFAULT_POLICY.runner,
      tierSize: options.tierSize ?? 2,
      backlogTierSize: options.backlogTierSize ?? options.tierSize ?? 2,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  };
  current = policy;
  const reload = options.reloadPolicy;
  const clock = movableClock(options.now);
  scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner: schedulerRunner,
    sink,
    policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onExtraFiles: (paths) => extraFiles.push([...paths]),
    onError: (error) => errors.push(error),
    ...(reload === undefined
      ? {}
      : {
          reloadPolicy: (changes) => {
            const next = reload(changes);
            if (next !== null) current = next;
            return next;
          },
        }),
    ...(options.onReinstall === undefined ? {} : { onReinstall: options.onReinstall }),
    ...(options.onListed === undefined ? {} : { onListed: options.onListed }),
    ...(options.slow === undefined ? {} : { slow: options.slow }),
    // A pool reads the host's busy cores only when the test gives it some (row 011-182).
    ...(options.capacity === undefined ? {} : { capacity: { host: null, ...options.capacity } }),
    ...(options.rerunCap === undefined ? {} : { rerunCap: options.rerunCap }),
    ...(options.hostLoad === undefined ? {} : { hostLoad: options.hostLoad }),
    ...(options.runnerPartMs === undefined ? {} : { runnerPartMs: options.runnerPartMs }),
    ...(options.busyWaits === undefined ? {} : { busyWaits: options.busyWaits }),
    ...(options.busySliceMs === undefined ? {} : { busySliceMs: options.busySliceMs }),
    now: clock.now,
    incarnation: options.incarnation ?? HARNESS_INCARNATION,
    ...(options.predecessor === undefined ? {} : { predecessor: options.predecessor }),
  });
  cleanups.push(async () => {
    if (trace === undefined) {
      await scheduler.close();
      await schedulerRunner.close();
    } else await trace.close(scheduler, schedulerRunner);
    if (errors.length > 0 && options.allowErrors !== true) throw errors[0];
  });
  trace?.watch({ scheduler, store, worktreeId, runs: runner.runs, errors });
  const hasher = createFsHasher(root, "sha1");
  const at = (path: string) => join(root, path);
  return {
    root,
    store,
    worktreeId,
    runner,
    gate,
    sink,
    scheduler,
    now: clock.now,
    advance: clock.advance,
    extraFiles,
    errors,
    write(path, content) {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), content);
    },
    remove: (path) => rmSync(at(path), { force: true }),
    async batch(...paths) {
      await scheduler.handleBatch({ trigger: "watch", paths: await statCandidates(paths, hasher) });
    },
    keyOf(path) {
      const id = testFileId(ref(path));
      const row = store.testFileKeys.list(worktreeId).find((r) => testFileId(r.testFile) === id);
      return row?.key ?? null;
    },
    runsOf: (path) => runner.runs.filter((run) => run.files.some((f) => f.path === path)),
    header: () => readHeader(store, worktreeId),
    async consumer(sessionId = "session") {
      const delivery = createDelivery(store, {
        status: {
          build: () => ({
            schemaVersion: 1,
            available: false,
            reason: "timeout",
            message: "status is not under test here",
          }),
        },
      });
      const consumer: Consumer = { worktreeId, sessionId, agentId: MAIN_AGENT };
      await delivery.register(consumer);
      return { delivery, consumer };
    },
  };
}
