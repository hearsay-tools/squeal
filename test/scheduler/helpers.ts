import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { createFsHasher } from "../../src/core/hash/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { createScheduler } from "../../src/core/scheduler/index.js";
import {
  isStoreOpenFailure,
  openStore,
  storePaths,
  worktreeIdFor,
} from "../../src/core/store/index.js";
import {
  type CheckKey,
  DEFAULT_POLICY,
  type Policy,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
  type Scheduler,
  type Store,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { git } from "../hash/git-repo.js";
import { MemorySink } from "./memory-sink.js";

const fixture = resolve(import.meta.dirname, "../fixtures/scheduler/basic");
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

/** A git repository holding a copy of the fixture, with `src/gen/` gitignored but present. */
export function createRepo(): { main: string; commonDir: string; dir: string } {
  mkdirSync(scratchDir, { recursive: true });
  const dir = join(scratchDir, randomUUID());
  const main = join(dir, "main");
  cpSync(fixture, main, { recursive: true });
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

/** A real adapter that records every run and can act just before one starts. */
export interface RecordingRunner extends RunnerAdapter {
  readonly runs: RecordedRun[];
  beforeRun: ((files: readonly TestFileRef[]) => void) | null;
}

function recording(inner: RunnerAdapter): RecordingRunner {
  const runner: RecordingRunner = {
    name: inner.name,
    adapterVersion: inner.adapterVersion,
    runs: [],
    beforeRun: null,
    invalidate: (paths) => inner.invalidate(paths),
    affected: (paths) => inner.affected(paths),
    closure: (testFile) => inner.closure(testFile),
    enumerate: (testFile) => inner.enumerate(testFile),
    testFiles: () => inner.testFiles(),
    environment: () => inner.environment(),
    async run(files, options) {
      runner.beforeRun?.(files);
      const report = await inner.run(files, options);
      runner.runs.push({ files, options, report });
      return report;
    },
    close: () => inner.close(),
  };
  return runner;
}

export interface Harness {
  readonly root: string;
  readonly store: Store;
  readonly worktreeId: string;
  readonly runner: RecordingRunner;
  readonly sink: MemorySink;
  readonly scheduler: Scheduler;
  readonly extraFiles: string[][];
  write(path: string, content: string): void;
  remove(path: string): void;
  /** Hands the scheduler a watch batch for `paths`, as the change feed would. */
  batch(...paths: string[]): Promise<void>;
  keyOf(path: string): CheckKey | null;
  /** Runs that ran `path`. */
  runsOf(path: string): RecordedRun[];
}

export interface HarnessOptions {
  readonly tierSize?: number;
  readonly policy?: Partial<Policy>;
}

/** A scheduler over a real Vitest adapter and the shared store, closed after the test. */
export async function openHarness(
  root: string,
  store: Store,
  commonDir: string,
  options: HarnessOptions = {},
): Promise<Harness> {
  const runner = recording(await createVitestAdapter({ root }));
  const worktreeId = worktreeIdFor(root);
  const sink = new MemorySink(store, worktreeId);
  const extraFiles: string[][] = [];
  const errors: Error[] = [];
  const policy: Policy = {
    ...DEFAULT_POLICY,
    ...options.policy,
    runner: { ...DEFAULT_POLICY.runner, tierSize: options.tierSize ?? 2 },
  };
  const scheduler = createScheduler({
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
  });
  cleanups.push(async () => {
    await scheduler.close();
    await runner.close();
    if (errors.length > 0) throw errors[0];
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
  };
}
