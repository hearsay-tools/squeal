import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CollectOptions, GateRun } from "../../../src/core/code/gate/collect.js";
import { type LaneContext, runLanes } from "../../../src/core/code/gate/lanes.js";
import type { PlannedRun } from "../../../src/core/code/gate/plan.js";
import type { Picked } from "../../../src/core/code/gate/prerun.js";
import { FileProgress } from "../../../src/core/code/gate/progress.js";
import type { Runner } from "../../../src/core/code/gate/runners.js";
import { runsOf } from "../../../src/core/code/gate/runs.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import type { HostLoad } from "../../../src/core/retry/load.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../../../src/core/types/runner.js";
import { OVER, QUIET } from "./host-load.js";

/*
 * Row 020-60 (#200, #214): with `--rerun-stored-failures`, `stored.ts`
 * marks each failure the stores gave (`storedRerun`), and the lanes run
 * those files once more after every other run and rerun, inside the
 * budget. A completed rerun's result is the file's; otherwise the stored
 * failure stands. A stored rerun is never rerun under load. The adapters
 * are fakes, each file's end scripted per run.
 */

type End = "pass" | "fail" | "hang";

const ref = (path: string): TestFileRef => ({ project: "", path: path as RelativePath });

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A runner whose run gives each file its next scripted end; `order` gets every run's id. */
function fake(
  kind: Runner["kind"],
  script: Readonly<Record<string, readonly End[]>>,
  order: string[],
): Runner {
  const seen = new Map<string, number>();
  const run = async (files: readonly TestFileRef[], options: RunOptions): Promise<RunReport> => {
    order.push(`${options.runId}: ${files.map((f) => f.path).join(" ")}`);
    const ends = files.map((f) => {
      const i = seen.get(f.path) ?? 0;
      seen.set(f.path, i + 1);
      return [f, script[f.path]?.[i] ?? "pass"] as const;
    });
    const hangs = ends.some(([, end]) => end === "hang");
    await new Promise((resolve) => setTimeout(resolve, hangs ? (options.timeoutMs ?? 0) : 20));
    const done = ends.filter(([, end]) => end !== "hang");
    return {
      end: hangs ? "timed-out" : "completed",
      durationMs: 1,
      completedFiles: done.map(([f]) => f),
      results: done.map(([f, end]) => ({
        check: { kind: "test", project: "", testPath: f.path, fullName: `${f.path} works` },
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
  return { kind, adapter: { run, closure } as unknown as RunnerAdapter, covered: [] };
}

/** Evidence the stores gave `path`: failed, marked to rerun when `marked`. */
function storedEvidence(path: string, failed: boolean, marked = failed): TestFileEvidence {
  return {
    runner: "vitest",
    path: path as RelativePath,
    completed: true,
    failed: failed ? ["stored failure"] : [],
    skipped: false,
    loads: [path as RelativePath],
    record: null,
    from: "store",
    ...(marked ? { storedRerun: { outcome: "not-finished" as const } } : {}),
  };
}

type Planned = PlannedRun<Picked & { readonly runner: Runner }>;

/** `runner`'s planned run of `files`, its selection those and `stored`'s, with their evidence. */
function planned(runner: Runner, index: number, files: string[], stored: TestFileEvidence[]) {
  const run = [...files, ...stored.map((s) => s.path)].map(ref);
  const pick = {
    runner,
    kind: runner.kind,
    adapter: runner.adapter,
    listed: run,
    run,
    leftOut: [],
  };
  const known = new Map(stored.map((s, i) => [run[files.length + i] as TestFileRef, s]));
  return { planned: { pick, index, files: run.slice(0, files.length) } satisfies Planned, known };
}

async function lanes(
  runs: readonly ReturnType<typeof planned>[],
  { budgetMs = 60_000, load = QUIET }: { budgetMs?: number; load?: HostLoad } = {},
) {
  const temp = mkdtempSync(join(tmpdir(), "squeal-lanes-stored-"));
  temps.push(temp);
  const told: GateRun[] = [];
  const options: CollectOptions = {
    tests: [],
    budgetSeconds: budgetMs / 1000,
    adapters: {} as CollectOptions["adapters"],
    hostLoad: () => load,
    ran: async (run) => {
      told.push(run);
    },
  };
  const note = () => {};
  const since = performance.now();
  const known = new Map(runs.flatMap((r) => [...r.known]));
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
  const result = await runLanes(
    runs.map((r) => r.planned),
    context,
  );
  const byPath = (path: string) => result.testFiles.find((f) => f.path === path);
  return { ...result, told, byPath };
}

describe("runLanes: stored failures run once more with the flag (row 020-60)", () => {
  it("reruns only marked failures, after every other run; a pass reads passed", async () => {
    const order: string[] = [];
    const vitest = fake("vitest", { "t/flaky.test.ts": ["pass"] }, order);
    const node = fake("node-test", {}, order);
    const out = await lanes([
      planned(
        vitest,
        0,
        [],
        [
          storedEvidence("t/flaky.test.ts", true),
          storedEvidence("t/pass.test.ts", false),
          storedEvidence("t/kept.test.ts", true, false),
        ],
      ),
      planned(node, 1, ["n/fresh.test.ts"], []),
    ]);
    expect(order).toEqual(["gate-1: n/fresh.test.ts", "gate-0-stored: t/flaky.test.ts"]);
    expect(out.byPath("t/flaky.test.ts")).toMatchObject({
      completed: true,
      failed: [],
      storedRerun: { outcome: "passed" },
    });
    expect(out.byPath("t/flaky.test.ts")?.from).toBeUndefined();
    expect(out.byPath("t/pass.test.ts")).toMatchObject({ from: "store", failed: [] });
    expect(out.byPath("t/kept.test.ts")).toMatchObject({
      from: "store",
      failed: ["stored failure"],
    });
    expect(out.byPath("t/kept.test.ts")?.storedRerun).toBeUndefined();
    // The keeper hears the rerun as a run of its own, deciding the file there.
    expect(out.told.map((r) => [r.runner, r.files.map((f) => f.path), r.retrying])).toEqual([
      ["node-test", ["n/fresh.test.ts"], undefined],
      ["vitest", ["t/flaky.test.ts"], undefined],
    ]);
    const runs = runsOf(
      { testFiles: out.testFiles, timedOut: out.timedOut, budgetSeconds: 60 },
      {},
    );
    expect(runs.find((r) => r.runner === "vitest")?.storedRerun).toEqual({
      "t/flaky.test.ts": { outcome: "passed" },
    });
    expect(runs.find((r) => r.runner === "vitest")?.from).toEqual({
      "t/flaky.test.ts": "run",
      "t/kept.test.ts": "store",
      "t/pass.test.ts": "store",
    });
  });

  it("keeps a second failure failed, and never reruns it under load", async () => {
    const order: string[] = [];
    const vitest = fake("vitest", { "t/broken.test.ts": ["fail", "pass"] }, order);
    const out = await lanes([planned(vitest, 0, [], [storedEvidence("t/broken.test.ts", true)])], {
      load: OVER,
    });
    expect(order).toEqual(["gate-0-stored: t/broken.test.ts"]);
    expect(out.byPath("t/broken.test.ts")).toMatchObject({
      failed: ["t/broken.test.ts works"],
      storedRerun: { outcome: "failed" },
    });
    expect(out.byPath("t/broken.test.ts")?.retried).toBeUndefined();
  });

  it("keeps the stored failure when the rerun does not finish in the budget", async () => {
    const order: string[] = [];
    const vitest = fake("vitest", { "t/broken.test.ts": ["hang"] }, order);
    const stored = storedEvidence("t/broken.test.ts", true);
    const out = await lanes([planned(vitest, 0, [], [stored])], { budgetMs: 200 });
    expect(order).toHaveLength(1);
    expect(out.byPath("t/broken.test.ts")).toBe(stored);
    expect(out.timedOut).toBe(true);
  });

  it("keeps the stored failure when no budget is left for the rerun", async () => {
    const order: string[] = [];
    const node = fake("node-test", { "n/slow.test.ts": ["hang"] }, order);
    const vitest = fake("vitest", {}, order);
    const stored = storedEvidence("t/broken.test.ts", true);
    const out = await lanes(
      [planned(node, 1, ["n/slow.test.ts"], []), planned(vitest, 0, [], [stored])],
      { budgetMs: 150 },
    );
    expect(order).toEqual(["gate-1: n/slow.test.ts"]);
    expect(out.byPath("t/broken.test.ts")).toBe(stored);
    expect(out.ended.map((r) => r.runner)).toEqual(["node-test"]);
  });
});
