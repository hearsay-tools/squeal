import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CollectOptions, GateRun } from "../../../src/core/code/gate/collect.js";
import { type LaneContext, runLanes } from "../../../src/core/code/gate/lanes.js";
import type { PlannedRun } from "../../../src/core/code/gate/plan.js";
import type { Picked } from "../../../src/core/code/gate/prerun.js";
import { FileProgress } from "../../../src/core/code/gate/progress.js";
import type { Runner } from "../../../src/core/code/gate/runners.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { HostLoad } from "../../../src/core/retry/load.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../../src/core/types/runner.js";

/*
 * The gate's lanes over fake runners (rows 020-54, 020-59): each file's
 * outcome is scripted per run, so no test depends on the host's real load.
 */

/** A file's end in one run: `hang` runs past the deadline, so it does not complete. */
export type End = "pass" | "fail" | "hang";

export const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });

export const OVERLOADED: HostLoad = { oneMinute: 30.456, cpus: 24 };
export const IDLE: HostLoad = { oneMinute: 3, cpus: 24 };

const temps: string[] = [];

/** Removes the lanes' folders; for `afterEach`. */
export function removeTemps(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** One run the fake adapter was given. */
export interface Given {
  readonly files: readonly string[];
  readonly runId: string;
}

/**
 * A runner of `kind` whose run gives each file its next scripted end, in
 * order; past the script, `pass`. `waitMs` delays each run's end.
 */
export function fake(
  kind: Runner["kind"],
  script: Readonly<Record<string, readonly End[]>>,
  waitMs = 0,
): { runner: Runner; given: Given[]; started: number[] } {
  const given: Given[] = [];
  /** When each run of `given` started, by `performance.now()`. */
  const started: number[] = [];
  const seen = new Map<string, number>();
  const run = async (files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> => {
    given.push({ files: files.map((f) => f.path), runId: options.runId });
    started.push(performance.now());
    // Row 020-59: a log, as a runner writes one per run (`vitest.log`).
    mkdirSync(options.logDir, { recursive: true });
    writeFileSync(join(options.logDir, "vitest.log"), `${options.runId}\n`);
    const ends = files.map((f) => {
      const i = seen.get(f.path) ?? 0;
      seen.set(f.path, i + 1);
      return [f, script[f.path]?.[i] ?? "pass"] as const;
    });
    const hangs = ends.some(([, end]) => end === "hang");
    await new Promise((resolve) => setTimeout(resolve, hangs ? (options.timeoutMs ?? 0) : waitMs));
    const done = ends.filter(([, end]) => end !== "hang");
    return {
      end: hangs ? "timed-out" : "completed",
      durationMs: 1,
      completedFiles: done.map(([f]) => f),
      results: done.map(([f, end]) => ({
        check: { kind: "test", project: f.project, testPath: f.path, fullName: `${f.path} works` },
        outcome: end === "fail" ? "fail" : "pass",
        durationMs: 1,
        location: null,
        errors: [],
      })),
      fileErrors: [],
      failure: hangs ? "the run timed out" : null,
    };
  };
  const closure = async (r: TestFileRef) => ({ paths: [r.path] });
  // Each file runs as wide as the grant (row 020-59's `chunksFor` reads it).
  const traits = { tierWidth: (_ref: TestFileRef, grant: number) => grant };
  const adapter = { run, closure, traits } as unknown as RunnerAdapter;
  return { runner: { kind, adapter, covered: [] }, given, started };
}

export type Planned = PlannedRun<Picked & { readonly runner: Runner }>;

/**
 * `runner`'s planned run of `files`, its selection `files` and `known`'s,
 * and (row 020-46) `overBudget`'s, which the early stop left out.
 */
export function planned(
  runner: Runner,
  index: number,
  files: readonly string[],
  known: string[] = [],
  overBudget: string[] = [],
) {
  const run = [...files, ...known, ...overBudget].map(ref);
  const over = run.slice(files.length + known.length);
  const pick = {
    runner,
    kind: runner.kind,
    adapter: runner.adapter,
    listed: run,
    run,
    leftOut: [],
  };
  const early = over.length === 0 ? {} : { overBudget: over };
  return { pick, index, files: run.slice(0, files.length), ...early } satisfies Planned;
}

export interface Lanes {
  readonly runs: readonly Planned[];
  readonly load?: HostLoad | null;
  readonly budgetMs?: number;
  readonly known?: ReadonlyMap<TestFileRef, TestFileEvidence>;
  /** Row 020-59: the most files one run takes. */
  readonly chunkFiles?: number;
  /** Row 020-59: each file's stored seconds, which split a long run into chunks. */
  readonly durations?: (ref: TestFileRef) => number | null;
}

/** `runLanes` over `runs`, with the load `load` reads; the keeper's tells and the load reads kept. */
export async function lanes(at: Lanes) {
  const { runs, load = OVERLOADED, budgetMs = 60_000, known = new Map(), chunkFiles } = at;
  const { durations } = at;
  const temp = mkdtempSync(join(tmpdir(), "squeal-lanes-retry-"));
  temps.push(temp);
  const told: GateRun[] = [];
  let reads = 0;
  const hostLoad = () => {
    reads += 1;
    return load ?? { oneMinute: null, cpus: 24 };
  };
  const options: CollectOptions = {
    tests: [],
    budgetSeconds: budgetMs / 1000,
    adapters: {} as CollectOptions["adapters"],
    hostLoad,
    ...(chunkFiles === undefined ? {} : { chunkFiles }),
    ...(durations === undefined ? {} : { durations }),
    ran: async (run) => {
      told.push(run);
    },
  };
  const note = () => {};
  const since = performance.now();
  const context: LaneContext = {
    root: temp as AbsolutePath,
    deadline: since + budgetMs,
    note,
    options,
    children: false,
    temp: temp as AbsolutePath,
    tierSize: 4,
    known,
    mapping: {
      format: "sha1",
      blobs: new Map(),
      provider: temp as AbsolutePath,
      children: false,
      note,
    },
    progress: new FileProgress({ budgetSeconds: budgetMs / 1000, since }),
  };
  const result = await runLanes(runs, context);
  const byPath = (path: string) => result.testFiles.find((f) => f.path === path);
  return { ...result, told, reads: () => reads, byPath };
}
