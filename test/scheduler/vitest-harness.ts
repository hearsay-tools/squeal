import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCompositeRunner } from "../../src/core/daemon/composite-runner.js";
import { withSlowInstance } from "../../src/core/daemon/slow-instance.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { WorktreePaths } from "../../src/core/fs/worktree-paths.js";
import { createFsHasher } from "../../src/core/hash/hasher.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { appendNote } from "../../src/core/notes.js";
import { statCandidates } from "../../src/core/revision/reconcile.js";
import type { SchedulerOptions } from "../../src/core/scheduler/options.js";
import { createScheduler } from "../../src/core/scheduler/scheduler.js";
import { readHeader } from "../../src/core/state/header.js";
import { recordOptimizerOff } from "../../src/core/state/optimizer-note.js";
import { storePaths } from "../../src/core/store/paths.js";
import { type Consumer, type HarnessDelivery, MAIN_AGENT } from "../../src/core/types/delivery.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { RunnerAdapter, RunOptions } from "../../src/core/types/runner.js";
import type { Scheduler } from "../../src/core/types/scheduler.js";
import type { StatusHeader } from "../../src/core/types/status.js";
import type { Store } from "../../src/core/types/store.js";
import { VitestAdapter } from "../../src/runners/vitest/adapter.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { loadVitest } from "../../src/runners/vitest/load.js";
import { onCleanUp } from "./cleanup.js";
import type { PhaseTrace } from "./phase-trace.js";
import { movableClock } from "./quiet-clock.js";
import {
  type FailingCall,
  type RecordedRun,
  type RecordingRunner,
  recordingRunner,
} from "./recording-runner.js";
import { RecordingSink } from "./recording-sink.js";
import { ref } from "./repo.js";
import { HARNESS_INCARNATION } from "./store-wait.js";

export interface Harness {
  readonly root: string;
  readonly store: Store;
  readonly worktreeId: string;
  /** The Vitest adapter; with `HarnessOptions.parts` or `adapters` one part of the scheduler's composite. */
  readonly runner: RecordingRunner;
  /** Awaited before every run the scheduler starts, the other parts' too, with the options it chose. */
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

/** What a runner part beside Vitest is built with: the harness's note, and the policy as last reloaded. */
export interface PartContext {
  readonly root: string;
  readonly note: (text: string) => void;
  readonly policy: () => Policy | null;
}

export interface HarnessOptions {
  /** node:test projects need `openHarness` from `./node-test-harness.js`; here they fail the type check, also through a spread. */
  readonly nodeTest?: never;
  readonly nodeTestTierSize?: never;
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
  /**
   * Runner parts behind the daemon's composite after Vitest, built when the
   * harness opens (spec 003 D7: node:test's, `node-test-harness.ts`).
   */
  readonly parts?: (context: PartContext) => Promise<readonly RunnerAdapter[]>;
  /** Adapters behind the composite after `parts`, as built (task 007-26: a pytest one). */
  readonly adapters?: readonly RunnerAdapter[];
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

/** The policy a harness starts with: `DEFAULT_POLICY` under the test's, with edit-sized tiers. */
function harnessPolicy(options: HarnessOptions): Policy {
  return {
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
}

/** The scheduler options a test hands through as given, and the harness's default incarnation. */
function passedThrough(options: HarnessOptions): Partial<SchedulerOptions> {
  return {
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
    incarnation: options.incarnation ?? HARNESS_INCARNATION,
    ...(options.predecessor === undefined ? {} : { predecessor: options.predecessor }),
  };
}

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
  const runner = recordingRunner(
    inner,
    options.environmentRoot,
    options.runnerPartBesideRun,
    trace,
  );
  for (const call of options.failing ?? []) runner.failing.add(call);
  const parts = (await options.parts?.({ root, note, policy: () => current })) ?? [];
  const others = [...parts, ...(options.adapters ?? [])];
  const composite = others.length === 0 ? runner : createCompositeRunner([runner, ...others]);
  const gate: Harness["gate"] = { before: null };
  // Delegates to `composite` at each call, so a test that replaces `h.runner.closure` is still heard.
  const schedulerRunner: RunnerAdapter = Object.create(composite, {
    run: {
      value: async (files: readonly TestFileRef[], runOptions: RunOptions) => {
        await gate.before?.(files, runOptions);
        return composite.run(files, runOptions);
      },
    },
  });
  const sink = new RecordingSink(store, worktreeId);
  const extraFiles: string[][] = [];
  const errors: Error[] = [];
  const policy = harnessPolicy(options);
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
    ...passedThrough(options),
    now: clock.now,
  });
  onCleanUp(async () => {
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
