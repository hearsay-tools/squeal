import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createDelivery, readHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { appendNote } from "../../src/core/notes.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler, type SchedulerOptions } from "../../src/core/scheduler/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import {
  type CheckKey,
  type Consumer,
  DEFAULT_POLICY,
  type HarnessDelivery,
  MAIN_AGENT,
  type Policy,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type Scheduler,
  type StatusHeader,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { git } from "../hash/git-repo.js";
import { RecordingSink } from "./recording-sink.js";

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

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A git repository holding a copy of a fixture under `test/fixtures/scheduler`.
 * In `basic`, `src/gen/` is gitignored but present.
 */
export function createRepo(fixture: "basic" | "barrel" | "barrel-only" = "basic"): {
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
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
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
 * A real adapter that records every run. Calls are serialized like the Vitest
 * adapter's, and `beforeRun` runs inside that queue: while it is pending, a
 * tier is in flight and every later runner call waits behind it.
 */
export interface RecordingRunner extends RunnerAdapter {
  readonly runs: RecordedRun[];
  beforeRun: ((files: readonly TestFileRef[]) => void | Promise<void>) | null;
  /** Calls that reject with `failure` while listed. */
  readonly failing: Set<FailingCall>;
  failure: string;
}

function recording(inner: RunnerAdapter, environmentRoot?: string): RecordingRunner {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(call: () => Promise<T>): Promise<T> => {
    const next = queue.then(call);
    queue = next.catch(() => {});
    return next;
  };
  const guarded = <T>(name: FailingCall, call: () => Promise<T>): Promise<T> =>
    serial(() => (runner.failing.has(name) ? Promise.reject(new Error(runner.failure)) : call()));
  const runner: RecordingRunner = {
    name: inner.name,
    adapterVersion: inner.adapterVersion,
    runs: [],
    beforeRun: null,
    failing: new Set(),
    failure: "vitest.config.ts: Unexpected token",
    invalidate: (paths) => guarded("invalidate", () => inner.invalidate(paths)),
    affected: (paths) => guarded("affected", () => inner.affected(paths)),
    closure: (testFile) => guarded("closure", () => inner.closure(testFile)),
    enumerate: (testFile) => serial(() => inner.enumerate(testFile)),
    testFiles: () => guarded("testFiles", () => inner.testFiles()),
    environment: () =>
      guarded("environment", async () => {
        const environments = await inner.environment();
        if (environmentRoot === undefined) return environments;
        return environments.map((environment) => ({ ...environment, root: environmentRoot }));
      }),
    run: (files, options) =>
      serial(async () => {
        await runner.beforeRun?.(files);
        const report = await inner.run(files, options);
        runner.runs.push({ files, options, report });
        return report;
      }),
    close: () => inner.close(),
  };
  return runner;
}

export interface Harness {
  readonly root: string;
  readonly store: Store;
  readonly worktreeId: string;
  readonly runner: RecordingRunner;
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
}

export interface HarnessOptions {
  readonly tierSize?: number;
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
  const runner = recording(await createVitestAdapter({ root, note }), options.environmentRoot);
  for (const call of options.failing ?? []) runner.failing.add(call);
  const sink = new RecordingSink(store, worktreeId);
  const extraFiles: string[][] = [];
  const errors: Error[] = [];
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...options.policy,
    runner: {
      ...DEFAULT_POLICY.runner,
      tierSize: options.tierSize ?? 2,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  };
  scheduler = createScheduler({
    root,
    worktreeId,
    store,
    runner,
    sink,
    policy,
    squealVersion: "0.0.0-test",
    runsDir: storePaths(commonDir).runsDir,
    head: () => readHead(root),
    onExtraFiles: (paths) => extraFiles.push([...paths]),
    onError: (error) => errors.push(error),
    ...(options.reloadPolicy === undefined ? {} : { reloadPolicy: options.reloadPolicy }),
    ...(options.onReinstall === undefined ? {} : { onReinstall: options.onReinstall }),
  });
  cleanups.push(async () => {
    await scheduler.close();
    await runner.close();
    if (errors.length > 0 && options.allowErrors !== true) throw errors[0];
  });
  const hasher = createFsHasher(root, "sha1");
  const at = (path: string) => join(root, path);
  return {
    root,
    store,
    worktreeId,
    runner,
    sink,
    scheduler,
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
