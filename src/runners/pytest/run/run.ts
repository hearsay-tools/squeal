import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { toAbsolute } from "../../../core/fs/index.js";
import { WorktreePaths } from "../../../core/fs/worktree-paths.js";
import type {
  AbsolutePath,
  PytestProject,
  RelativePath,
  RunReport,
  TestFileRef,
} from "../../../core/types/index.js";
import { startGroup } from "../../node-test/run/process.js";
import type { PytestEnvironment } from "../environment/index.js";
import { runBasetemp } from "./basetemp.js";
import { type Batch, ending, names, readOr, realOr, split, writeRunLog } from "./batches.js";
import { keptDirs, runBytecode } from "./bytecode.js";
import { inheritedArgs, pytestArgs, refusalNote, refusedFlags } from "./command.js";
import { parsePytestEvents } from "./events.js";
import { observeBatch, type PytestObservedClosure } from "./observed.js";
import { type PytestFileReport, readBatch } from "./report.js";

type ReadyEnvironment = Extract<PytestEnvironment, { state: "ready" }>;

export interface PytestRunOptions {
  /** The worktree root, a real path. */
  readonly root: AbsolutePath;
  readonly project: PytestProject;
  readonly environment: Pick<ReadyEnvironment, "discovery" | "config" | "plugins" | "runEnv">;
  readonly files: readonly TestFileRef[];
  readonly logDir: AbsolutePath;
  /** Squeal's deadline for the whole tier (`runner.timeoutMs`); `null` for none. */
  readonly timeoutMs: number | null;
  /** Batches running at once (the tier size); default every batch. */
  readonly concurrency?: number;
  /** Files per batch, a policy value (D6); default 5. */
  readonly batchSize?: number;
  /** A slow file (004) runs in a batch of its own. */
  readonly alone?: (testFile: TestFileRef) => boolean;
  /** Squeal's temp directory for pytest's cache and the bytecode (`runBytecode`); default one per worktree and project under the OS's. */
  readonly cacheDir?: AbsolutePath;
  /** What the processes add to their environment (`RunOptions.childEnv`). */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** The directory holding `squeal_pytest.py`; default located from this module. */
  readonly runtimeDir?: AbsolutePath;
  /** A `squeal stop`'s cancel (`RunOptions.signal`): the running processes are stopped, no other starts, and only completed files report. */
  readonly signal?: AbortSignal;
}

/** A tier's report, each completed file's observed closure, and the run's notes. */
export interface PytestRun {
  readonly report: RunReport;
  readonly observed: readonly PytestObservedClosure[];
  /** What the batches imported at start-up: plugins, and what `pytest_plugins` named. */
  readonly session: readonly RelativePath[];
  /** Completed files whose module skipped itself: the adapter skips their known checks (D6). */
  readonly skippedFiles: readonly { readonly testFile: TestFileRef; readonly reason: string }[];
  /** D3 and D6's notes: refused flags, exit 5, node ids holding a memory address, every test skipped. */
  readonly notes: readonly string[];
}

export const DEFAULT_BATCH_SIZE = 5;

/** SIGKILL follows SIGTERM after this long (D6). */
export const KILL_GRACE_MS = 2_000;

/**
 * Runs a tier of pytest files (spec 007 D6): batches of `batchSize` files,
 * up to `concurrency` at once, each a fresh `<env>/bin/python -m pytest` in
 * its own process group from the project's `cwd`, `squeal_pytest` on
 * `PYTHONPATH` behind the project's entries and writing
 * `<logDir>/events-<i>.jsonl`, and a `--basetemp` of its own removed after
 * the run (`runBasetemp`). On the deadline every running group gets
 * SIGTERM, then SIGKILL, and batches not yet started stay unrun. A refused
 * flag in the config's `addopts`, `PYTEST_ADDOPTS` or `args` runs nothing.
 */
export async function runPytest(options: PytestRunOptions): Promise<PytestRun> {
  const started = performance.now();
  const { project, environment } = options;
  const paths = new WorktreePaths(options.root);
  const cwd = project.cwd ? toAbsolute(options.root, project.cwd) : options.root;
  const inherited = inheritedArgs(environment.config, environment.runEnv);
  const refused = refusedFlags(inherited, project);
  if (refused.length > 0) return refusal(refusalNote(project, refused), started);

  const cacheDir = options.cacheDir ?? defaultCacheDir(options.root, project);
  mkdirSync(options.logDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  const runtimeDir = options.runtimeDir ?? pytestRuntimeDir();
  const env: NodeJS.ProcessEnv = {
    ...environment.runEnv,
    ...options.childEnv,
    PYTHONPATH: [environment.runEnv.PYTHONPATH, runtimeDir]
      .filter((p) => p !== undefined && p !== "")
      .join(delimiter),
    SQUEAL_PYTEST_ROOT: options.root,
    // The plugin names the file in progress for the processes a test starts (task 007-55);
    // one inherited from a run around this daemon's would record pytest's own imports.
    SQUEAL_PYTEST_FILE: undefined,
  };
  const args = pytestArgs(
    {
      project,
      config: environment.config,
      plugins: environment.plugins,
      env,
      inherited,
      cacheDir: join(cacheDir, "pytest-cache") as AbsolutePath,
      emptyConfig: ownEmptyConfig(cacheDir),
    },
    cwd,
  );
  const rootdir = realOr(environment.config?.rootdir ?? cwd);

  const basetemp = runBasetemp(cacheDir);
  const batches: Batch[] = split(
    options.files,
    options.batchSize ?? DEFAULT_BATCH_SIZE,
    options.alone,
  ).map((files, index) => ({
    index,
    files: files.map((testFile) => ({
      testFile,
      real: realOr(toAbsolute(options.root, testFile.path)),
    })),
    // After `args`, so it wins over the project's own `--basetemp` (task 007-37).
    args: [
      ...args,
      `--basetemp=${basetemp.dir(index)}`,
      ...files.map((f) => relative(cwd, toAbsolute(options.root, f.path)).split(sep).join("/")),
    ],
    exit: null,
    read: null,
    edges: [],
  }));

  const python = environment.discovery.python;
  const running = new Set<{ kill(signal: NodeJS.Signals): void }>();
  let expired = false;
  let cancelled = false;
  const timers: NodeJS.Timeout[] = [];
  const stopAll = () => {
    for (const group of running) group.kill("SIGTERM");
    timers.push(
      setTimeout(() => {
        for (const group of running) group.kill("SIGKILL");
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
  // A `squeal stop` (001 D10, task 001-367): what runs is stopped, nothing more starts.
  const onAbort = () => {
    cancelled = true;
    stopAll();
  };
  if (options.signal?.aborted === true) cancelled = true;
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const queue = [...batches];
  const bytecode = runBytecode(cacheDir, options.root, [
    ...keptDirs(environment.discovery.env, environment.discovery.python),
    runtimeDir,
  ]);
  const worker = async () => {
    for (
      let batch = queue.shift();
      batch !== undefined && !expired && !cancelled;
      batch = queue.shift()
    ) {
      const events = join(options.logDir, `events-${batch.index}.jsonl`);
      const group = startGroup({
        command: python,
        args: batch.args,
        cwd,
        env: { ...env, PYTHONPYCACHEPREFIX: bytecode.prefix, SQUEAL_PYTEST_EVENTS: events },
        stdout: join(options.logDir, `stdout-${batch.index}.log`),
        stderr: join(options.logDir, `stderr-${batch.index}.log`),
      });
      running.add(group);
      batch.exit = await group.exited;
      running.delete(group);
      const parsed = parsePytestEvents(readOr(events));
      batch.read = readBatch(parsed, batch.files, rootdir, paths, basetemp.dir(batch.index));
      batch.edges = parsed.flatMap((e) => (e.type === "import" || e.type === "spawned" ? [e] : []));
    }
  };
  const width = Math.max(1, Math.min(options.concurrency ?? batches.length, batches.length));
  try {
    await Promise.all(Array.from({ length: width }, worker));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    bytecode.remove();
    basetemp.remove();
  }

  const notes: string[] = [];
  let refusedAtRun: string | null = null;
  const trusted = batches.filter((b) => {
    const code = b.exit?.code;
    if (b.read !== null && b.read.refused.length > 0) {
      const flags = b.read.refused.map((flag) => ({ flag, source: "pytest" as const }));
      refusedAtRun ??= refusalNote(project, flags);
      return false;
    }
    if (code === 5)
      notes.push(`pytest project "${project.name}" collected nothing in ${names(b)}.`);
    // D6: "3 (internal error) and 4 (usage error) are runner failures".
    return code !== 3 && code !== 4;
  });
  const done = trusted.flatMap((b) => b.read?.files.filter((f) => f.completed) ?? []);
  if (refusedAtRun !== null) notes.push(refusedAtRun);
  const addresses = [...new Set(trusted.flatMap((b) => b.read?.addressIds ?? []))];
  if (addresses.length > 0) {
    notes.push(
      `pytest project "${project.name}": these test ids hold a memory address, so they change every run: ${addresses.join(", ")}.`,
    );
  }
  const { end, failure } = cancelled
    ? { end: "completed" as const, failure: null }
    : ending(batches, new Set(done.map((f) => f.testFile)), expired, {
        total: options.files.length,
        timeoutMs: options.timeoutMs,
        python,
        logDir: options.logDir,
      });
  // Only for a tier every file of which completed: a skip before a file that ended the
  // process says nothing of the tests that did not report (review 007-21 S1).
  const whole =
    end === "completed" &&
    failure === null &&
    refusedAtRun === null &&
    done.length === options.files.length;
  const skippedAll = whole ? allSkippedNote(project, done) : null;
  if (skippedAll !== null) notes.push(skippedAll);
  const report: RunReport = {
    end,
    durationMs: Math.round(performance.now() - started),
    completedFiles: done.map((f) => f.testFile),
    results: done.flatMap((f) => f.results),
    fileErrors: done.flatMap((f) => (f.fileError === null ? [] : [f.fileError])),
    failure: refusedAtRun ?? failure,
    fileDurations: done.map((f) => ({ testFile: f.testFile, durationMs: f.durationMs })),
  };
  const observed = trusted.map((b) => observeBatch(b.edges, b.files, paths));
  const completed = new Set(report.completedFiles);
  writeRunLog(options.logDir, { python, cwd, batches, report, notes });
  return {
    report,
    observed: observed.flatMap((o) => o.closures).filter((c) => completed.has(c.testFile)),
    session: [...new Set(observed.flatMap((o) => o.session))].sort(),
    skippedFiles: done.flatMap((f) =>
      f.skipped === null ? [] : [{ testFile: f.testFile, reason: f.skipped }],
    ),
    notes,
  };
}

/**
 * D3: "A project whose run skipped every collected test gets one note, since
 * pytest exits 0 then." Skips, xfails and module-level skips count; a run
 * that collected nothing (exit 5's note) or failed to collect a file does not.
 */
export function allSkippedNote(
  project: PytestProject,
  files: readonly PytestFileReport[],
): string | null {
  const results = files.flatMap((f) => f.results);
  const skipped = results.length + files.filter((f) => f.skipped !== null).length;
  if (skipped === 0 || files.some((f) => f.fileError !== null)) return null;
  if (results.some((r) => r.outcome !== "skip")) return null;
  return `pytest project "${project.name}" skipped every collected test (${skipped} skipped) in ${files.length === 1 ? "its one file" : `${files.length} files`}; pytest exits 0 then, so check what skips them (a missing setting or service often does).`;
}

/** `<cacheDir>/no-config/pytest.ini`, which pytest reads as a config even empty (D1). */
function ownEmptyConfig(cacheDir: AbsolutePath): AbsolutePath {
  const dir = join(cacheDir, "no-config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "pytest.ini") as AbsolutePath;
  writeFileSync(path, "[pytest]\n");
  return path;
}

function refusal(note: string, started: number): PytestRun {
  return {
    report: {
      end: "crashed",
      durationMs: Math.round(performance.now() - started),
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: note,
    },
    observed: [],
    session: [],
    skippedFiles: [],
    notes: [note],
  };
}

/** Where the bytecode and pytest's cache go: outside the worktree, one directory per worktree and project. */
function defaultCacheDir(root: AbsolutePath, project: PytestProject): AbsolutePath {
  const id = createHash("sha256").update(`${root}\0${project.name}`).digest("hex").slice(0, 16);
  return join(tmpdir(), "squeal-pytest", id) as AbsolutePath;
}

/**
 * Where `squeal_pytest.py` sits relative to `module`, the running code's own
 * file: from a bundled CLI at `<plugin>/dist/cli/`, the plugin's
 * `dist/pytest/`; from the TypeScript sources, `runtime/` beside `run/`.
 */
export function pytestRuntimeDir(module: URL = new URL(import.meta.url)): AbsolutePath {
  const tried: string[] = [];
  for (const candidate of ["../pytest/", "../runtime/"]) {
    const dir = fileURLToPath(new URL(candidate, module));
    if (existsSync(join(dir, "squeal_pytest.py"))) return dir.replace(/\/$/, "") as AbsolutePath;
    tried.push(dir);
  }
  throw new Error(
    `pytest runtime files not found beside ${module.href}: tried ${tried.join(", ")}`,
  );
}
