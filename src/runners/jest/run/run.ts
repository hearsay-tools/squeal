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
import { logGoneReport, markLogDir } from "../../log-dir.js";
import { observeEnv, unobservedEnv } from "../../observe/runtime.js";
import { startGroup } from "../../process/group.js";
import { runLogJson } from "../../run-summary.js";
import { type JestInstall, tsNodeHygiene } from "../resolve.js";
import { parseJestEvents, readEvents, sizeOf } from "./events.js";
import { type BatchOutcome, ending, readJestBatch } from "./results.js";
import { writeWrapperConfig } from "./wrapper-config.js";

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
}

export interface JestRun {
  readonly report: RunReport;
}

export const DEFAULT_BATCH_SIZE = 5;

/** SIGKILL follows SIGTERM after this long (D4.2). */
export const KILL_GRACE_MS = 2_000;

/** One Jest process of a tier; events past its `cut` are not trusted. */
interface Batch extends BatchOutcome {
  readonly args: readonly string[];
  readonly events: string;
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
  if (ours === null) return { report: logGoneReport(options.logDir) };
  const cacheDir = options.cacheDir ?? defaultCacheDir(root, project);
  const runtimeDir = jestRuntimeDir();
  const wrapper = writeWrapperConfig({
    cacheDir,
    config,
    jestConfig: install.config,
    observeRuntimePath:
      options.observeRuntimePath === undefined
        ? (join(runtimeDir, "observe-runtime.cjs") as AbsolutePath)
        : options.observeRuntimePath,
  });
  const reporter = options.reporterPath ?? join(runtimeDir, "squeal-reporter.cjs");
  const common = [
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
    "--",
  ];
  const batches: Batch[] = split(
    options.files,
    options.batchSize ?? project.batchSize ?? DEFAULT_BATCH_SIZE,
    options.alone,
  ).map((files, index) => ({
    index,
    files,
    args: [...common, ...files.map((f) => toAbsolute(root, f.path))],
    events: join(options.logDir, `events-${index}.jsonl`),
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
  const runBatch = async (batch: Batch, held: number) => {
    const slot = slotOf(root, held);
    const env = {
      // Spec 027 D2.1: the slot expands the project's templates before `childEnv` goes over them.
      ...base,
      ...expandedVariables(base, project.env, slot),
      ...options.childEnv,
      ...slotVariables(slot, project.slots?.toxParallelEnv === true),
      SQUEAL_JEST_EVENTS: batch.events,
      SQUEAL_JEST_RUNTIME: install.runtime,
    };
    const group = startGroup({
      command: process.execPath,
      args: batch.args,
      cwd,
      env: { ...env, ...observed(options, env) },
      stdout: join(options.logDir, `stdout-${batch.index}.log`),
      stderr: join(options.logDir, `stderr-${batch.index}.log`),
    });
    running.set(batch, group);
    batch.exit = await group.exited;
    running.delete(batch);
    batch.reports = readJestBatch(
      parseJestEvents(readEvents(batch.events, batch.cut)),
      batch.files,
      paths,
    );
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
  // Row 018-38: a log folder removed, or made again, while the batches ran took their records.
  if (!ours()) return { report: logGoneReport(options.logDir) };
  const log = batches.map((b) => ({
    files: b.files.map((f) => f.path),
    command: [process.execPath, ...b.args],
    exit: b.exit,
    cut: b.cut,
  }));
  writeFileSync(join(options.logDir, "run.json"), runLogJson({ cwd, batches: log }, report));
  return { report };
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
