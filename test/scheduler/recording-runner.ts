import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../src/core/types/runner.js";
import type { Phase, PhaseTrace } from "./phase-trace.js";

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

/** `inner` behind a recorder; `environmentRoot` is reported as every project's environment root. */
export function recordingRunner(
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
