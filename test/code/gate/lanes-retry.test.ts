import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectOptions, GateRun } from "../../../src/core/code/gate/collect.js";
import { type LaneContext, runLanes } from "../../../src/core/code/gate/lanes.js";
import type { PlannedRun } from "../../../src/core/code/gate/plan.js";
import type { Picked } from "../../../src/core/code/gate/prerun.js";
import { FileProgress } from "../../../src/core/code/gate/progress.js";
import type { Runner } from "../../../src/core/code/gate/runners.js";
import { runsOf } from "../../../src/core/code/gate/runs.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import { type HostLoad, loadAllows } from "../../../src/core/retry/load.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../../src/core/types/runner.js";

/*
 * Row 020-54 (#210; the human, 2026-11-13: "Retry once"): a file that
 * fails here while the host's load is at or over its CPU count, the
 * daemon's threshold (`loadAllows`), runs once more after every other
 * file, inside the budget, through the same runner. The rerun's result is
 * the file's; a failure that fails again stays failed. No rerun below the
 * threshold, with no budget left, or for evidence from the stores or the
 * parts. The adapters here are fakes: each file's outcome is scripted per
 * run, so no test depends on the host's real load.
 */

/** A file's end in one run: `hang` runs past the deadline, so it does not complete. */
type End = "pass" | "fail" | "hang";

const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });

const OVERLOADED: HostLoad = { oneMinute: 30.456, cpus: 24 };
const IDLE: HostLoad = { oneMinute: 3, cpus: 24 };

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One run the fake adapter was given. */
interface Given {
  readonly files: readonly string[];
  readonly runId: string;
}

/**
 * A runner of `kind` whose run gives each file its next scripted end, in
 * order; past the script, `pass`. `waitMs` delays each run's end.
 */
function fake(
  kind: Runner["kind"],
  script: Readonly<Record<string, readonly End[]>>,
  waitMs = 0,
): { runner: Runner; given: Given[] } {
  const given: Given[] = [];
  const seen = new Map<string, number>();
  const run = async (files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> => {
    given.push({ files: files.map((f) => f.path), runId: options.runId });
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
  const adapter = { run, closure } as unknown as RunnerAdapter;
  return { runner: { kind, adapter, covered: [] }, given };
}

type Planned = PlannedRun<Picked & { readonly runner: Runner }>;

/** `runner`'s planned run of `files`, its selection `files` and `known`'s. */
function planned(runner: Runner, index: number, files: readonly string[], known: string[] = []) {
  const run = [...files, ...known].map(ref);
  const pick = {
    runner,
    kind: runner.kind,
    adapter: runner.adapter,
    listed: run,
    run,
    leftOut: [],
  };
  return { pick, index, files: run.slice(0, files.length) } satisfies Planned;
}

interface Lanes {
  readonly runs: readonly Planned[];
  readonly load?: HostLoad | null;
  readonly budgetMs?: number;
  readonly known?: ReadonlyMap<TestFileRef, TestFileEvidence>;
}

/** `runLanes` over `runs`, with the load `load` reads; the keeper's tells and the load reads kept. */
async function lanes({ runs, load = OVERLOADED, budgetMs = 60_000, known = new Map() }: Lanes) {
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

describe("runLanes: a failure under load runs once more (row 020-54)", () => {
  it("reads passed and retried when the rerun passes, after every other file", async () => {
    const node = fake("node-test", { "n/flaky.test.ts": ["fail", "pass"] });
    const vitest = fake("vitest", {}, 50);
    const out = await lanes({
      runs: [
        planned(node.runner, 1, ["n/flaky.test.ts", "n/fine.test.ts"]),
        planned(vitest.runner, 0, ["t/slow.test.ts"]),
      ],
    });
    expect(node.given).toEqual([
      { files: ["n/flaky.test.ts", "n/fine.test.ts"], runId: "gate-1" },
      { files: ["n/flaky.test.ts"], runId: "gate-1-rerun" },
    ]);
    expect(out.byPath("n/flaky.test.ts")).toMatchObject({
      completed: true,
      failed: [],
      retried: { load: 30.46, cpus: 24, outcome: "passed" },
    });
    expect(out.byPath("n/fine.test.ts")?.retried).toBeUndefined();
    // Row 020-55: the keeper hears each run, the rerun last; the first names the file it reruns.
    const paths = (refs?: readonly TestFileRef[]) => refs?.map((f) => f.path);
    expect(out.told.map((r) => [r.runner, paths(r.files), paths(r.retrying)])).toEqual([
      ["node-test", ["n/flaky.test.ts", "n/fine.test.ts"], ["n/flaky.test.ts"]],
      ["vitest", ["t/slow.test.ts"], undefined],
      ["node-test", ["n/flaky.test.ts"], undefined],
    ]);
    expect(out.told[2]?.report.completedFiles.map((f) => f.path)).toEqual(["n/flaky.test.ts"]);
    expect(out.ended.map((r) => basename(r.logDir))).toEqual(["1", "1-rerun", "0"]);
    const runs = runsOf(
      { testFiles: out.testFiles, timedOut: out.timedOut, budgetSeconds: 60 },
      {},
    );
    expect(runs.map((r) => [r.runner, r.failed, r.retried])).toEqual([
      ["vitest", [], undefined],
      ["node-test", [], { "n/flaky.test.ts": { load: 30.46, cpus: 24, outcome: "passed" } }],
    ]);
    expect(out.timedOut).toBe(false);
  });

  it("keeps a failure that fails again failed, and reruns it once only", async () => {
    const node = fake("node-test", { "n/broken.test.ts": ["fail", "fail", "pass"] });
    const out = await lanes({ runs: [planned(node.runner, 1, ["n/broken.test.ts"])] });
    expect(node.given.map((g) => g.runId)).toEqual(["gate-1", "gate-1-rerun"]);
    expect(out.byPath("n/broken.test.ts")).toMatchObject({
      completed: true,
      failed: ["n/broken.test.ts works"],
      retried: { outcome: "failed" },
    });
  });

  it("keeps the first failure when the rerun does not finish in the budget", async () => {
    const node = fake("node-test", { "n/broken.test.ts": ["fail", "hang"] });
    const out = await lanes({
      runs: [planned(node.runner, 1, ["n/broken.test.ts"])],
      budgetMs: 300,
    });
    expect(out.byPath("n/broken.test.ts")).toMatchObject({
      completed: true,
      failed: ["n/broken.test.ts works"],
      retried: { outcome: "not-finished" },
    });
    expect(out.timedOut).toBe(true);
  });

  it("uses the daemon's threshold: a rerun exactly when `loadAllows` refuses", async () => {
    const samples: (HostLoad | null)[] = [
      { oneMinute: 24, cpus: 24 },
      { oneMinute: 23.99, cpus: 24 },
      IDLE,
      null,
    ];
    for (const load of samples) {
      const node = fake("node-test", { "n/broken.test.ts": ["fail", "pass"] });
      const out = await lanes({ runs: [planned(node.runner, 1, ["n/broken.test.ts"])], load });
      const daemonWouldHold = load !== null && !loadAllows(load);
      expect(node.given.length, JSON.stringify(load)).toBe(daemonWouldHold ? 2 : 1);
      const file = out.byPath("n/broken.test.ts");
      expect(file?.retried !== undefined).toBe(daemonWouldHold);
      expect(file?.failed.length).toBe(daemonWouldHold ? 0 : 1);
    }
  });

  it("reads no load when nothing failed", async () => {
    const node = fake("node-test", {});
    const out = await lanes({ runs: [planned(node.runner, 1, ["n/fine.test.ts"])] });
    expect(out.reads()).toBe(0);
    expect(node.given).toHaveLength(1);
  });

  it("does not rerun when the budget ended with the run", async () => {
    const node = fake("node-test", { "n/broken.test.ts": ["fail", "pass"] }, 200);
    const out = await lanes({
      runs: [planned(node.runner, 1, ["n/broken.test.ts"])],
      budgetMs: 100,
    });
    expect(node.given).toHaveLength(1);
    expect(out.byPath("n/broken.test.ts")).toMatchObject({ failed: ["n/broken.test.ts works"] });
    expect(out.byPath("n/broken.test.ts")?.retried).toBeUndefined();
  });

  it("does not rerun when another run spent the budget first", async () => {
    const node = fake("node-test", { "n/broken.test.ts": ["fail", "pass"] });
    const vitest = fake("vitest", {}, 400);
    const out = await lanes({
      runs: [
        planned(node.runner, 1, ["n/broken.test.ts"]),
        planned(vitest.runner, 0, ["t/slow.test.ts"]),
      ],
      budgetMs: 200,
    });
    expect(node.given).toHaveLength(1);
    expect(out.byPath("n/broken.test.ts")?.failed).toEqual(["n/broken.test.ts works"]);
    expect(out.byPath("n/broken.test.ts")?.retried).toBeUndefined();
    // Row 020-55: its first run still names it, so the keeper never keeps that failure.
    const node1 = out.told.filter((r) => r.runner === "node-test");
    expect(node1.map((r) => r.retrying?.map((f) => f.path))).toEqual([["n/broken.test.ts"]]);
  });

  it("never reruns a failure the stores or the parts gave", async () => {
    const node = fake("node-test", { "n/broken.test.ts": ["pass"] });
    const failed = (path: string, from: "store" | "parts"): TestFileEvidence => ({
      runner: "node-test",
      path: path as RelativePath,
      completed: true,
      failed: ["stored failure"],
      skipped: false,
      loads: [path as RelativePath],
      record: null,
      from,
    });
    const run = planned(node.runner, 1, ["n/broken.test.ts"], ["n/s.test.ts", "n/p.test.ts"]);
    const [stored, parts] = run.pick.run.slice(1);
    if (stored === undefined || parts === undefined) throw new Error("no known refs");
    const known = new Map([
      [stored, failed("n/s.test.ts", "store")],
      [parts, failed("n/p.test.ts", "parts")],
    ]);
    const out = await lanes({ runs: [run], known });
    expect(node.given.map((g) => g.files)).toEqual([["n/broken.test.ts"]]);
    expect(out.reads()).toBe(0);
    expect(out.byPath("n/s.test.ts")).toMatchObject({ from: "store", failed: ["stored failure"] });
    expect(out.byPath("n/p.test.ts")).toMatchObject({ from: "parts", failed: ["stored failure"] });
    expect(out.testFiles.every((f) => f.retried === undefined)).toBe(true);
  });
});
