import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { toAbsolute } from "../../../core/fs/index.js";
import { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type {
  AbsolutePath,
  NodeTestProject,
  RunEnd,
  RunReport,
  TestFileRef,
} from "../../../core/types/index.js";
import { projectEnv } from "../recorders.js";
import { type NodeTestRuntime, nodeTestRuntime } from "../runtime.js";
import { parseEvents } from "./events.js";
import {
  holdsRequire,
  preloadSpecifiers,
  quoteNodeOption,
  tokenizeNodeOptions,
} from "./node-options.js";
import { type ObservedClosure, observedClosure } from "./observed.js";
import { type ProcessExit, startGroup } from "./process.js";
import { type FileReport, readFileStream } from "./report.js";

export interface NodeTestRunOptions {
  /** The worktree root, a real path. */
  readonly root: AbsolutePath;
  readonly project: NodeTestProject;
  /** Test files of `project`, one `node --test` process each. */
  readonly files: readonly TestFileRef[];
  readonly logDir: AbsolutePath;
  /** Squeal's deadline for the whole tier (`runner.timeoutMs`); `null` for none. */
  readonly timeoutMs: number | null;
  /** Processes running at once; default every file of the tier. */
  readonly concurrency?: number;
  /** What the project's `env` is merged over; default the daemon's environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Default: located from this module (`runtime.ts`). */
  readonly runtime?: NodeTestRuntime;
}

/** A tier's report and, for each completed file, what its process loaded. */
export interface NodeTestRun {
  readonly report: RunReport;
  readonly observed: readonly ObservedClosure[];
}

/** SIGKILL follows SIGTERM after this long (001 D12). */
export const KILL_GRACE_MS = 2_000;

interface FileRun {
  readonly index: number;
  readonly testFile: TestFileRef;
  readonly absolute: AbsolutePath;
  readonly arg: string;
  readonly args: readonly string[];
  exit: ProcessExit | null;
  stream: FileReport | null;
}

/**
 * Runs a tier of node:test files under the project's own Node (spec 003 D5,
 * amended 2026-10-07: one process per file). Each file runs as
 * `<node> --enable-source-maps --require <recorder> <argv...> --test
 * --test-reporter=<reporter> --test-reporter-destination=<logDir>/events-<i>.ndjson
 * <file>` from the project's `cwd`, in its own process group, up to
 * `concurrency` at once. On the deadline every running group gets SIGTERM,
 * then SIGKILL, and files not yet started stay unrun. A file is completed
 * when its process exited with a whole stream (`report.ts`); only completed
 * files report results. The recorder is the first `--require` because Node
 * runs every `--require` preload, then every `--import`, whatever their order
 * in argv (task 003-28); `childEnv` puts it first in `NODE_OPTIONS` too.
 */
export async function runNodeTest(options: NodeTestRunOptions): Promise<NodeTestRun> {
  const started = performance.now();
  const runtime = options.runtime ?? nodeTestRuntime();
  const paths = new WorktreePaths(options.root);
  const cwd = options.project.cwd ? toAbsolute(options.root, options.project.cwd) : options.root;
  const env = childEnv(options, runtime);
  const preloads = new Set(
    preloadSpecifiers([
      ...(tokenizeNodeOptions(env.NODE_OPTIONS ?? "") ?? []),
      ...options.project.argv,
    ]),
  );
  mkdirSync(options.logDir, { recursive: true });

  const runs: FileRun[] = options.files.map((testFile, index) => {
    const absolute = toAbsolute(options.root, testFile.path);
    const arg = relative(cwd, absolute).split(sep).join("/");
    const args = [
      "--enable-source-maps",
      "--require",
      runtime.recorder,
      ...options.project.argv,
      "--test",
      `--test-reporter=${runtime.reporter}`,
      `--test-reporter-destination=${join(options.logDir, `events-${index}.ndjson`)}`,
      arg,
    ];
    return { index, testFile, absolute, arg, args, exit: null, stream: null };
  });

  const node = options.project.node ?? "node";
  const running = new Set<{ kill(signal: NodeJS.Signals): void }>();
  let expired = false;
  const timers: NodeJS.Timeout[] = [];
  if (options.timeoutMs !== null) {
    timers.push(
      setTimeout(() => {
        expired = true;
        for (const group of running) group.kill("SIGTERM");
        timers.push(
          setTimeout(() => {
            for (const group of running) group.kill("SIGKILL");
          }, KILL_GRACE_MS),
        );
      }, options.timeoutMs),
    );
  }

  const queue = [...runs];
  const worker = async () => {
    for (let run = queue.shift(); run !== undefined && !expired; run = queue.shift()) {
      const group = startGroup({
        command: node,
        args: run.args,
        cwd,
        env: { ...env, SQUEAL_NODE_TEST_GRAPH: join(options.logDir, `graph-${run.index}`) },
        stdout: join(options.logDir, `stdout-${run.index}.log`),
        stderr: join(options.logDir, `stderr-${run.index}.log`),
      });
      running.add(group);
      run.exit = await group.exited;
      running.delete(group);
      run.stream = readFileStream(
        { testFile: run.testFile, arg: run.arg, events: readEvents(options.logDir, run.index) },
        paths,
      );
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? runs.length, runs.length));
  await Promise.all(Array.from({ length: width }, worker));
  for (const timer of timers) clearTimeout(timer);

  const completed = runs.filter((r) => r.stream?.completed === true);
  const { end, failure } = ending(runs, completed.length, expired, options.timeoutMs, node);
  const report: RunReport = {
    end,
    durationMs: Math.round(performance.now() - started),
    completedFiles: completed.map((r) => r.testFile),
    results: completed.flatMap((r) => r.stream?.results ?? []),
    fileErrors: completed.flatMap((r) => (r.stream?.fileError ? [r.stream.fileError] : [])),
    failure,
    fileDurations: completed.flatMap((r) =>
      r.stream?.durationMs == null
        ? []
        : [{ testFile: r.testFile, durationMs: r.stream.durationMs }],
    ),
  };
  const observed = completed.flatMap((r) => {
    const files = graphs(options.logDir, r.index);
    const closure = observedClosure(r.testFile, r.absolute, files, preloads, paths);
    return closure === null ? [] : [closure];
  });
  writeRunLog(options.logDir, { node, cwd, runs, report });
  return { report, observed };
}

/**
 * The daemon's environment with the project's merged over it (D1), as
 * `projectEnv` cleans it. Node runs a `--require` in `NODE_OPTIONS` before
 * those of argv, so when `NODE_OPTIONS` holds one, however quoted
 * (`holdsRequire`, review wave 2.6 B1), the recorder goes first there as
 * well; Node loads it once. For a slow project it goes there always, so a
 * process the test spawns, which inherits no argv, records too (004 D5).
 */
function childEnv(options: NodeTestRunOptions, runtime: NodeTestRuntime): NodeJS.ProcessEnv {
  const env = projectEnv(options.project, options.env ?? process.env);
  const nodeOptions = env.NODE_OPTIONS;
  const recorder = `--require ${quoteNodeOption(runtime.recorder)}`;
  if (options.project.slow === true || (nodeOptions !== undefined && holdsRequire(nodeOptions))) {
    env.NODE_OPTIONS = nodeOptions === undefined ? recorder : `${recorder} ${nodeOptions}`;
  }
  return env;
}

/**
 * `timed-out` when the deadline passed; `completed` when no process died
 * without a whole stream; `crashed` when none completed and one died. A
 * file whose process died beside completed ones is left out of
 * `completedFiles`, its checks `unknown`, and `failure` says why.
 */
function ending(
  runs: readonly FileRun[],
  completed: number,
  expired: boolean,
  timeoutMs: number | null,
  node: string,
): { end: RunEnd; failure: string | null } {
  const unfinished = runs.length - completed;
  if (expired) {
    return {
      end: "timed-out",
      failure: `deadline of ${timeoutMs} ms passed with ${unfinished} of ${runs.length} test files unfinished`,
    };
  }
  const died = runs.filter((r) => r.stream?.completed !== true);
  if (died.length === 0) return { end: "completed", failure: null };
  const what = died.map((r) => `${r.testFile.path} (${describeExit(r.exit, node)})`).join(", ");
  const failure = `node --test ended without a complete report for ${what}`;
  return { end: completed === 0 ? "crashed" : "completed", failure };
}

function describeExit(exit: ProcessExit | null, node: string): string {
  if (exit === null) return "not started";
  if (exit.error !== null) return `cannot run ${node}: ${exit.error}`;
  return exit.signal === null ? `exit code ${exit.code}` : `signal ${exit.signal}`;
}

function readEvents(logDir: AbsolutePath, index: number) {
  try {
    return parseEvents(readFileSync(join(logDir, `events-${index}.ndjson`), "utf8"));
  } catch {
    return [];
  }
}

/** The recorder's files of one file's run: `graph-<index>-<pid>.ndjson`, one per process. */
function graphs(logDir: AbsolutePath, index: number): string[] {
  const prefix = `graph-${index}-`;
  return readdirSync(logDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".ndjson"))
    .map((name) => readFileSync(join(logDir, name), "utf8"));
}

/** `run.json`: each file's command line and exit, which nothing else trusts, and the report. */
function writeRunLog(
  logDir: AbsolutePath,
  log: { node: string; cwd: string; runs: readonly FileRun[]; report: RunReport },
): void {
  const files = log.runs.map((r) => ({
    testFile: r.testFile.path,
    command: [log.node, ...r.args],
    exit: r.exit,
    completed: r.stream?.completed ?? false,
  }));
  const text = JSON.stringify({ cwd: log.cwd, files, report: log.report }, null, 2);
  writeFileSync(join(logDir, "run.json"), `${text}\n`);
}
