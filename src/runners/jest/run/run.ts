import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toAbsolute } from "../../../core/fs/paths.js";
import { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import {
  expandedVariables,
  slotOf,
  slotPool,
  slotVariables,
} from "../../../core/runner-host/slots.js";
import type { AbsolutePath } from "../../../core/types/common.js";
import type { TestFileRef } from "../../../core/types/keys.js";
import type { SlotPolicy } from "../../../core/types/policy.js";
import type { JestProject } from "../../../core/types/policy-jest.js";
import type { RunReport } from "../../../core/types/runner.js";
import { logGoneReport, makeLogDir, markLogDir } from "../../log-dir.js";
import { observeEnv, unobservedEnv } from "../../observe/runtime.js";
import { startGroup } from "../../process/group.js";
import { runLogJson } from "../../run-summary.js";
import {
  batchCoverageDir,
  COVERAGE_DIR_VARIABLE,
  coverageGroups,
  dropUnkept,
  JEST_COVERAGE_ARGS,
  type JestCoveragePayload,
  payloadsOf,
} from "../coverage.js";
import { type JestInstall, tsNodeHygiene } from "../resolve.js";
import { parseJestEvents, readEvents, sizeOf } from "./events.js";
import { type BatchOutcome, ending, readJestBatch } from "./results.js";
import { type JestWarmPool, KILL_GRACE_MS, type WarmRun, type WarmStart } from "./warm.js";
import { writeWrapperConfig } from "./wrapper-config.js";

export { KILL_GRACE_MS };

export interface JestRunOptions {
  /** The worktree root, a real path. */
  readonly root: AbsolutePath;
  /** `slots` is spec 027's, read when the policy gives Jest projects one. */
  readonly project: JestProject & { readonly slots?: SlotPolicy };
  readonly install: JestInstall;
  readonly files: readonly TestFileRef[];
  readonly logDir: AbsolutePath;
  /** Squeal's deadline for the whole tier (`runner.timeoutMs`); `null` for none. */
  readonly timeoutMs: number | null;
  /** Batches running at once (the tier size); default every batch. */
  readonly concurrency?: number;
  /** Files per batch; default the project's `batchSize`, else 5 (D4.1). */
  readonly batchSize?: number;
  /** A slow file (004) runs in a batch of its own. */
  readonly alone?: (testFile: TestFileRef) => boolean;
  /** Squeal's folder for the wrapper config and Jest's cache; default one per worktree and project under the OS's temp folder. */
  readonly cacheDir?: AbsolutePath;
  /** The environment the batches start from; default this process's. */
  readonly runEnv?: NodeJS.ProcessEnv;
  /** What the processes add to their environment (`RunOptions.childEnv`). */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** A `squeal stop`'s cancel: the running batches are stopped, no other starts, and only completed files report. */
  readonly signal?: AbortSignal;
  /** Default `squeal-reporter.cjs` beside this module (`jestRuntimeDir`). */
  readonly reporterPath?: AbsolutePath;
  /** Default `observe-runtime.cjs` beside the reporter; `null` runs Jest's own runtime. */
  readonly observeRuntimePath?: AbsolutePath | null;
  /** Loads `recorder.cjs` into each batch (`observeEnv`); absent, nothing is recorded. */
  readonly observe?: {
    readonly recorder: AbsolutePath;
    readonly out: AbsolutePath;
    readonly skip: readonly AbsolutePath[];
  };
  /**
   * Spec 028 D5.3: the files `covered` names run in batches of their own
   * with `JEST_COVERAGE_ARGS`, each writing its payloads to a folder of
   * `dir`; absent, no batch takes coverage.
   */
  readonly coverage?: {
    readonly dir: AbsolutePath;
    readonly covered: (testFile: TestFileRef) => boolean;
  };
  /**
   * Spec 028 D7: batches run on these warm workers when nothing asks for a
   * Jest process per batch: no `args`, no global setup or teardown
   * (`hasGlobalHooks`), no slot templates. Absent, a process per batch.
   */
  readonly warmPool?: JestWarmPool;
  /** The project's config names a `globalSetup` or `globalTeardown`, which only a Jest process runs. */
  readonly hasGlobalHooks?: boolean;
}

export interface JestRun {
  readonly report: RunReport;
  /** The payloads of the files the report completes; every other payload is deleted. */
  readonly coverage: readonly JestCoveragePayload[];
  /**
   * Review 0.1.648 B1: of the completed files a warm worker ran, the worktree
   * modules Node loaded in it for its batches (`WarmRun.runtimeHostModules`):
   * read by each, though a cached module is never read again. Absent: none.
   */
  readonly hostObserved?: readonly HostObserved[];
}

/** A completed test file and the worktree modules its warm worker's Node used for it; absolute. */
export interface HostObserved {
  readonly testFile: TestFileRef;
  readonly paths: readonly AbsolutePath[];
}

export const DEFAULT_BATCH_SIZE = 5;

/** One Jest process of a tier; events past its `cut` are not trusted. */
interface Batch extends BatchOutcome {
  readonly args: readonly string[];
  readonly events: string;
  /** Where its reporter writes its payloads; `null` for a batch without coverage. */
  readonly coverage: AbsolutePath | null;
  payloads: readonly JestCoveragePayload[];
  /** D7: the warm worker's pid that ran it; `null` for a process of its own. */
  worker: number | null;
  /** The worktree modules its warm worker's Node used (`WarmRun.runtimeHostModules`). */
  hostModules: readonly AbsolutePath[];
}

/**
 * Runs a tier of Jest files (spec 028 D4): batches of `batchSize` files, up
 * to `concurrency` at once, each `node <jest bin>` in its own process group
 * from the project's `cwd`, on a wrapper config (`writeWrapperConfig`) and
 * with `squeal-reporter.cjs` writing `<logDir>/events-<i>.jsonl`. Each batch
 * holds a slot (spec 027 D1) whose values expand the project's `env`
 * templates. On the deadline or a stop every running group gets SIGTERM,
 * then SIGKILL, and batches not yet started stay unrun; the events written
 * before the signal keep their files (Kit K8), and a file without a
 * `fileResult` line by then is unfinished.
 */
export async function runJest(options: JestRunOptions): Promise<JestRun> {
  const started = performance.now();
  const { project, install, root } = options;
  const paths = new WorktreePaths(root);
  const config = toAbsolute(root, project.config);
  const cwd = project.cwd === undefined ? dirname(config) : toAbsolute(root, project.cwd);
  const ours = markLogDir(options.logDir);
  if (ours === null) return { report: logGoneReport(options.logDir), coverage: [] };
  const cacheDir = options.cacheDir ?? defaultCacheDir(root, project);
  const runtimeDir = jestRuntimeDir();
  const wrapper = writeWrapperConfig({
    cacheDir,
    config,
    jestConfig: install.config,
    ...(project.project === undefined ? {} : { project: project.project }),
    observeRuntimePath:
      options.observeRuntimePath === undefined
        ? (join(runtimeDir, "observe-runtime.cjs") as AbsolutePath)
        : options.observeRuntimePath,
  });
  const reporter = options.reporterPath ?? join(runtimeDir, "squeal-reporter.cjs");
  const common = (covered: boolean) => [
    install.bin,
    "--config",
    wrapper,
    "--runInBand",
    "--ci",
    "--forceExit",
    "--testLocationInResults",
    "--cacheDirectory",
    join(cacheDir, "jest"),
    `--reporters=${reporter}`,
    // Paths, not patterns: the same on 29 and 30, and no file name is read as a regex.
    "--runTestsByPath",
    ...project.args,
    // After the project's own arguments, so its `--coverage=false` does not turn Squeal's off.
    ...(covered ? JEST_COVERAGE_ARGS : []),
    "--",
  ];
  const size = options.batchSize ?? project.batchSize ?? DEFAULT_BATCH_SIZE;
  const { coverage } = options;
  const batches: Batch[] = coverageGroups(options.files, coverage?.covered)
    .flatMap(({ files, covered }) => split(files, size, options.alone).map((f) => ({ f, covered })))
    .map(({ f: files, covered }, index) => ({
      index,
      files,
      args: [...common(covered), ...files.map((f) => toAbsolute(root, f.path))],
      events: join(options.logDir, `events-${index}.jsonl`),
      coverage: covered && coverage !== undefined ? batchCoverageDir(coverage.dir, index) : null,
      payloads: [],
      worker: null,
      hostModules: [],
      exit: null,
      cut: null,
      reports: [],
    }));

  const base = baseEnv(options, config);
  const running = new Map<Batch, { kill(signal: NodeJS.Signals): void }>();
  let expired = false;
  let cancelled = false;
  const timers: NodeJS.Timeout[] = [];
  const stopped = new AbortController();
  const stopAll = () => {
    stopped.abort();
    for (const [batch, group] of running) {
      batch.cut ??= sizeOf(batch.events);
      group.kill("SIGTERM");
    }
    timers.push(
      setTimeout(() => {
        for (const group of running.values()) group.kill("SIGKILL");
      }, KILL_GRACE_MS),
    );
  };
  if (options.timeoutMs !== null) {
    timers.push(
      setTimeout(() => {
        expired = true;
        stopAll();
      }, options.timeoutMs),
    );
  }
  const onAbort = () => {
    cancelled = true;
    stopAll();
  };
  if (options.signal?.aborted === true) cancelled = true;
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  const slots = slotPool(root, project.name, project.slots?.max);
  const warm = warmPoolOf(options);
  const warmStart = (covered: boolean, env: NodeJS.ProcessEnv): WarmStart => ({
    workerPath: join(runtimeDir, "warm-worker.cjs") as AbsolutePath,
    root,
    install,
    cwd,
    wrapperPath: wrapper,
    jestCacheDir: join(cacheDir, "jest") as AbsolutePath,
    reporterPath: reporter,
    coverage: covered,
    observing: options.observe !== undefined,
    env: { ...env, ...observed(options, env) },
    logDir: join(cacheDir, "warm") as AbsolutePath,
  });
  const runBatch = async (batch: Batch, held: number) => {
    const slot = slotOf(root, held);
    // Spec 027 D2.1: the slot expands the project's templates before `childEnv` goes over them.
    const own = { ...base, ...expandedVariables(base, project.env, slot) };
    const marks = {
      ...options.childEnv,
      ...slotVariables(slot, project.slots?.toxParallelEnv === true),
    };
    // Made here, never by the reporter: a removed log folder stays removed (row 018-38).
    const coverageDir =
      batch.coverage !== null && makeLogDir(batch.coverage) ? batch.coverage : undefined;
    const stderr = join(options.logDir, `stderr-${batch.index}.log`);
    let group: Pick<WarmRun, "exited" | "kill">;
    let hostModules: Promise<readonly AbsolutePath[]> | null = null;
    if (warm === undefined) {
      const env = {
        ...own,
        ...marks,
        SQUEAL_JEST_EVENTS: batch.events,
        SQUEAL_JEST_RUNTIME: install.runtime,
        [COVERAGE_DIR_VARIABLE]: coverageDir,
      };
      group = startGroup({
        command: process.execPath,
        args: batch.args,
        cwd,
        env: { ...env, ...observed(options, env) },
        stdout: join(options.logDir, `stdout-${batch.index}.log`),
        stderr,
      });
    } else {
      // D7: a run's marks go per batch, so a worker serves every run of the same start.
      const run = warm.run(
        warmStart(batch.coverage !== null, { ...own, SQUEAL_JEST_RUNTIME: install.runtime }),
        {
          files: batch.files.map((f) => toAbsolute(root, f.path)),
          eventsFile: batch.events,
          coverageDir: coverageDir ?? null,
          ...(options.observe === undefined
            ? {}
            : {
                observe: {
                  out: options.observe.out,
                  skip: [...options.observe.skip, options.logDir],
                },
              }),
          env: marks,
          stderr,
        },
      );
      batch.worker = run.pid ?? null;
      hostModules = run.runtimeHostModules;
      group = run;
    }
    running.set(batch, group);
    batch.exit = await group.exited;
    running.delete(batch);
    if (hostModules !== null) batch.hostModules = await hostModules;
    const events = parseJestEvents(readEvents(batch.events, batch.cut));
    batch.reports = readJestBatch(events, batch.files, paths);
    if (batch.coverage !== null) {
      batch.payloads = payloadsOf(
        events,
        batch.reports.map((r) => r.testFile),
        paths,
      );
    }
  };
  const queue = [...batches];
  const worker = async () => {
    for (
      let b = queue.shift();
      b !== undefined && !expired && !cancelled && ours();
      b = queue.shift()
    ) {
      const held = await slots.acquire(stopped.signal);
      if (held === null) break;
      try {
        if (expired || cancelled || !ours()) break;
        await runBatch(b, held);
      } finally {
        slots.release(held);
      }
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? batches.length, batches.length));
  try {
    await Promise.all(Array.from({ length: width }, worker));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  const { end, failure, done } = ending(batches, { expired, cancelled }, { ...options, paths });
  const loaded = done.filter((f) => f.loaded.length > 0);
  const report: RunReport = {
    end,
    durationMs: Math.round(performance.now() - started),
    completedFiles: done.map((f) => f.testFile),
    results: done.flatMap((f) => f.results),
    fileErrors: done.flatMap((f) => (f.fileError === null ? [] : [f.fileError])),
    failure,
    fileDurations: done.map((f) => ({ testFile: f.testFile, durationMs: f.durationMs })),
    ...(loaded.length === 0
      ? {}
      : { loaded: loaded.map((f) => ({ testFile: f.testFile, paths: f.loaded })) }),
  };
  const completed = new Set(report.completedFiles);
  const hostObserved = batches.flatMap((b) =>
    b.hostModules.length === 0
      ? []
      : b.files
          .filter((f) => completed.has(f))
          .map((testFile) => ({ testFile, paths: b.hostModules })),
  );
  const covered = batches.flatMap((b) => b.payloads).filter((p) => completed.has(p.testFile));
  const dirs = batches.flatMap((b) => (b.coverage === null ? [] : [b.coverage]));
  // Row 018-38: a log folder removed, or made again, while the batches ran took their records.
  if (!ours()) {
    dropUnkept(dirs, []);
    return { report: logGoneReport(options.logDir), coverage: [] };
  }
  dropUnkept(dirs, covered);
  const log = batches.map((b) => ({
    files: b.files.map((f) => f.path),
    command: b.worker === null ? [process.execPath, ...b.args] : null,
    worker: b.worker,
    exit: b.exit,
    cut: b.cut,
  }));
  writeFileSync(join(options.logDir, "run.json"), runLogJson({ cwd, batches: log }, report));
  return { report, coverage: covered, ...(hostObserved.length === 0 ? {} : { hostObserved }) };
}

/**
 * The environment every batch starts from: the run's, the project's `env`
 * over it unexpanded, `NODE_ENV=test` when neither sets it (as `jest-cli`'s
 * bin does), and D2.2's ts-node pin for a TypeScript config on Jest 29.
 */
function baseEnv(options: JestRunOptions, config: AbsolutePath): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(options.runEnv ?? process.env), ...options.project.env };
  return {
    ...env,
    NODE_ENV: env.NODE_ENV ?? "test",
    ...tsNodeHygiene(options.install.major, config, options.root, env),
    // The observer's standalone output is for its own tests, never a run's.
    SQUEAL_JEST_LOADED_OUT: undefined,
  };
}

/** The recorder's variables when the run observes, else another Squeal's recorder taken out. */
function observed(options: JestRunOptions, env: NodeJS.ProcessEnv): Record<string, string> {
  const { observe } = options;
  if (observe === undefined) return unobservedEnv(env);
  const settings = {
    out: observe.out,
    root: options.root,
    skip: [...observe.skip, options.logDir],
  };
  return observeEnv(observe.recorder, settings, env.NODE_OPTIONS);
}

/** `{slot}`, `{slot0}` or `{worktreeSlot}` in a project's `env` (spec 027 D2.1). */
const SLOT_TEMPLATE = /\{(slot|slot0|worktreeSlot)\}/;

/**
 * D7: the warm pool, when nothing of the project needs a Jest process per
 * batch: its own `args`, a global setup or teardown, or a slot per batch.
 */
function warmPoolOf(options: JestRunOptions): JestWarmPool | undefined {
  const { project } = options;
  if (options.warmPool === undefined || options.hasGlobalHooks === true) return undefined;
  if (project.args.length > 0 || project.slots !== undefined) return undefined;
  if (Object.values(project.env).some((value) => SLOT_TEMPLATE.test(value))) return undefined;
  return options.warmPool;
}

/** The tier in batches of `size`, in the order given; a file `alone` names gets one of its own. */
export function split(
  files: readonly TestFileRef[],
  size: number,
  alone?: (testFile: TestFileRef) => boolean,
): TestFileRef[][] {
  const batches: TestFileRef[][] = [];
  let open: TestFileRef[] = [];
  for (const file of files) {
    if (alone?.(file) === true) batches.push([file]);
    else {
      open.push(file);
      if (open.length === Math.max(1, size)) {
        batches.push(open);
        open = [];
      }
    }
  }
  if (open.length > 0) batches.push(open);
  return batches;
}

/** Where the wrapper and Jest's transform cache go: outside the worktree, one folder per worktree and project. */
function defaultCacheDir(root: AbsolutePath, project: JestProject): AbsolutePath {
  const id = createHash("sha256").update(`${root}\0${project.name}`).digest("hex").slice(0, 16);
  return join(tmpdir(), "squeal-jest", id) as AbsolutePath;
}

/**
 * Where `squeal-reporter.cjs` sits relative to `module`, the running code's
 * own file: from a bundled CLI at `<plugin>/dist/cli/`, the plugin's
 * `dist/jest/`; from the TypeScript sources, `runtime/` beside `run/`.
 */
export function jestRuntimeDir(module: URL = new URL(import.meta.url)): AbsolutePath {
  const tried: string[] = [];
  for (const candidate of ["../jest/", "../runtime/"]) {
    const dir = fileURLToPath(new URL(candidate, module));
    if (existsSync(join(dir, "squeal-reporter.cjs"))) return dir.replace(/\/$/, "") as AbsolutePath;
    tried.push(dir);
  }
  throw new Error(`jest runtime files not found beside ${module.href}: tried ${tried.join(", ")}`);
}
