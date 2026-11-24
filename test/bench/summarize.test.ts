// Row 025-08: the benchmark's settle wait, log parsers, new metrics, scale-real cell and
// backward-compatible summaries of stored runs (bench/*.mjs are plain scripts, loaded here).
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

type Status = Record<string, unknown> | null;
type Settle = { ms: number; settled: boolean; polls: number };
type WriteWait = {
  seen: boolean;
  taken: number;
  p95MaxMs: number | null;
  maxMs: number | null;
  longWaitsMs: number[];
};
type Values = Record<string, number | null>;
interface Lib {
  baselineSettled(status: Status): boolean;
  waitForBaselines(
    roots: string[],
    read: (root: string) => Promise<Status>,
    opts: {
      timeoutMs: number;
      pollMs: number;
      now: () => number;
      wait: (ms: number) => Promise<void>;
    },
  ): Promise<Settle[]>;
  hookWriteWaitLog(text: string): WriteWait;
  longWriteCount(text: string): number;
}
interface Summarize {
  hookValues(rows: unknown[]): Values;
  resourceValues(cell: unknown): Values;
  writeWaitValues(cell: unknown, cellDir: string): Values;
  summarize(dir: string): { scorecard: string; overall: number; values: Record<string, Values> };
  METRICS: { id: string; healthy?: number; warn?: number; group: string }[];
}
interface RunAll {
  CELLS: { name: string; files: number; cases?: number; functions?: number }[];
  GROUPS: Record<string, string[]>;
  selectCells(spec: string | undefined): { name: string }[];
  templateKey(c: { files: number; cases?: number; functions?: number }): string;
}

const BENCH = join(import.meta.dirname, "../../bench");
// A variable path: TypeScript types these plain-JavaScript modules as `any`, cast to the shapes above.
const load = (name: string) => import(join(BENCH, name));
const lib: Lib = await load("lib.mjs");
const sum: Summarize = await load("summarize.mjs");
const runAll: RunAll = await load("run-all.mjs");

const tmp = mkdtempSync(join(tmpdir(), "bench-summarize-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const settledStatus = {
  testFilesListed: true,
  counts: { current: 10, pending: 0, stale: 0, unknown: 0 },
  testFilesWithoutChecks: { pending: 0, unknown: 0 },
  code: { pending: 0 },
};

describe("idle settle (wt-3 / wt-6 idle window)", () => {
  it("holds while listing, checks, test files or code counts are pending", () => {
    expect(lib.baselineSettled(settledStatus)).toBe(true);
    expect(lib.baselineSettled({ ...settledStatus, testFilesListed: false })).toBe(false);
    expect(lib.baselineSettled({ ...settledStatus, counts: { pending: 3 } })).toBe(false);
    expect(lib.baselineSettled({ ...settledStatus, testFilesWithoutChecks: { pending: 1 } })).toBe(
      false,
    );
    expect(lib.baselineSettled({ ...settledStatus, code: { pending: 42 } })).toBe(false);
    expect(lib.baselineSettled(null)).toBe(false);
  });

  it("does not hold on a field an older Squeal version does not print", () => {
    expect(
      lib.baselineSettled({ counts: { pending: 0 }, testFilesWithoutChecks: { pending: 0 } }),
    ).toBe(true);
  });

  it("polls each worktree until settled and stops at the shared deadline", async () => {
    let t = 0;
    const left = new Map([
      ["wt1", 3],
      ["wt2", 1],
    ]);
    const read = async (root: string): Promise<Status> => {
      const n = left.get(root) ?? 0;
      left.set(root, n - 1);
      return n > 1 ? { ...settledStatus, code: { pending: n } } : settledStatus;
    };
    const opts = {
      timeoutMs: 60_000,
      pollMs: 1000,
      now: () => t,
      wait: async (ms: number) => {
        t += ms;
      },
    };
    const settles = await lib.waitForBaselines(["wt1", "wt2"], read, opts);
    expect(settles).toEqual([
      { ms: 2000, settled: true, polls: 3 },
      { ms: 0, settled: true, polls: 1 },
    ]);

    t = 0;
    const never = await lib.waitForBaselines(["wt1", "wt2"], async () => null, {
      ...opts,
      timeoutMs: 5000,
    });
    expect(never.map((s) => s.settled)).toEqual([false, false]);
    expect(never[0]?.ms).toBe(5000);
    expect(never[1]?.polls).toBe(1);
  });
});

describe("hook write-wait log (spec 025 D9 lines)", () => {
  const log = [
    "2026-11-24T10:00:00.000Z long write wait: hook write waited 312 ms for the daemon main thread",
    "2026-11-24T10:00:30.000Z long write: store.sqlite write lock held 400 ms by record; 3 rows",
    "2026-11-24T10:01:00.000Z hook writes: 40 taken, queue wait p95 120 ms max 312 ms",
    "2026-11-24T10:01:10.000Z long write wait: hook write waited 905 ms for the daemon main thread",
    "2026-11-24T10:02:00.000Z hook writes: 12 taken, queue wait p95 300 ms max 905 ms",
  ].join("\n");

  it("parses both line kinds", () => {
    expect(lib.hookWriteWaitLog(log)).toEqual({
      seen: true,
      taken: 52,
      p95MaxMs: 300,
      maxMs: 905,
      longWaitsMs: [312, 905],
    });
  });

  it("is unseen for a log from before D9", () => {
    const w = lib.hookWriteWaitLog("long write: store.sqlite write lock held 400 ms by record");
    expect(w.seen).toBe(false);
    expect(sum.writeWaitValues({ hookWriteWait: w }, tmp)).toEqual({
      "hook.writeWait.p95": null,
      "hook.writeWait.max": null,
      "hook.longWriteWaits": null,
    });
  });

  it("does not count D9's waits as store long writes", () => {
    expect(lib.longWriteCount(log)).toBe(1);
  });

  it("reads a cell's copied daemon logs when cell.json has no hookWriteWait, not the store's", () => {
    const cellDir = join(tmp, "old-cell");
    mkdirSync(join(cellDir, "logs"), { recursive: true });
    writeFileSync(join(cellDir, "logs/daemon-1.log"), log);
    writeFileSync(
      join(cellDir, "logs/store-code.log"),
      "long write wait: hook write waited 9999 ms for the daemon main thread\n",
    );
    expect(sum.writeWaitValues({}, cellDir)).toEqual({
      "hook.writeWait.p95": 300,
      "hook.writeWait.max": 905,
      "hook.longWriteWaits": 2,
    });
  });
});

describe("hook tails and whole-tree memory", () => {
  it("reports p99 and max of each hook", () => {
    const rows = Array.from({ length: 100 }, (_, i) => [
      { kind: "hook", hook: "pre-tool-use", ms: i + 1 },
      { kind: "hook", hook: "post-tool-batch", ms: 10 * (i + 1) },
    ]).flat();
    const v = sum.hookValues(rows);
    expect(v["hook.preToolUse.max"]).toBe(100);
    expect(v["hook.postToolBatch.max"]).toBe(1000);
    expect(v["hook.preToolUse.p99"]).toBeCloseTo(99.01, 2);
    expect(v["hook.postToolBatch.p99"]).toBeCloseTo(990.1, 1);
    expect(sum.hookValues([])["hook.preToolUse.max"]).toBeNull();
  });

  it("scores tree RSS per worktree", () => {
    const cell = (worktrees: number) => ({
      worktrees,
      phases: {},
      daemonRss: { maxDaemonBytes: 400 * 2 ** 20, maxTreeBytes: 2100 * 2 ** 20 },
    });
    expect(sum.resourceValues(cell(1))["res.treeRss.max"]).toBe(2100);
    expect(sum.resourceValues(cell(3))["res.treeRss.max"]).toBe(700);
    const m = sum.METRICS.find((x) => x.id === "res.treeRss.max");
    expect(m).toMatchObject({ group: "Resources", healthy: 1200, warn: 2400 });
  });
});

describe("scale-real cell", () => {
  it("generates the chosen cases per file and helper functions", () => {
    const dir = join(tmp, "scale");
    const out = execFileSync(process.execPath, [
      join(BENCH, "gen-project.mjs"),
      dir,
      "3",
      "--cases",
      "10",
      "--functions",
      "30",
    ]).toString();
    expect(JSON.parse(out)).toMatchObject({ testFiles: 3, checks: 30, functions: 94 });
    const test = readFileSync(join(dir, "test/m2.test.ts"), "utf8");
    expect(test.match(/it\("case \d+"/g)).toHaveLength(10);
    expect(test).toContain('import { h2_0 } from "../src/h2.js";');
    expect(
      readFileSync(join(dir, "src/h2.ts"), "utf8").match(/export function h2_\d+/g),
    ).toHaveLength(30);
  });

  it("keeps the default project as it was", () => {
    const dir = join(tmp, "default");
    execFileSync(process.execPath, [join(BENCH, "gen-project.mjs"), dir, "2"]);
    const test = readFileSync(join(dir, "test/m1.test.ts"), "utf8");
    expect(test.match(/it\("case \d+"/g)).toHaveLength(6);
    expect(test).toContain('from "../src/m1.js";\n\nfunction spin');
    expect(existsSync(join(dir, "src/h1.ts"))).toBe(false);
  });

  it("runs only when named, on its own template", () => {
    const scale = runAll.CELLS.find((c) => c.name === "scale-real");
    expect(scale).toMatchObject({ files: 2000, cases: 10, functions: 30 });
    const names = (spec?: string) => runAll.selectCells(spec).map((c) => c.name);
    expect(names()).not.toContain("scale-real");
    expect(names("@all")).not.toContain("scale-real");
    expect(names("@scale")).toEqual(["size-l", "scale-real"]);
    expect(names("scale-real")).toEqual(["scale-real"]);
    expect(runAll.templateKey({ files: 2000 })).toBe("p2000");
    expect(runAll.templateKey(scale ?? { files: 0 })).toBe("p2000-c10-f30");
  });
});

describe("stored runs still summarize", () => {
  const RUN = "2026-11-24-0.1.615-vs-0.1.616-default-AMD-Ryzen-7-9700X-8-Core-Processor";

  it(`gives ${RUN} its stored values, with the new metrics added`, () => {
    const dir = join(tmp, RUN);
    cpSync(join(BENCH, "results", RUN), dir, { recursive: true });
    const stored = JSON.parse(readFileSync(join(dir, "scores.json"), "utf8")) as {
      values: Record<string, Values>;
    };
    const r = sum.summarize(dir);
    // JSON turns Infinity ("late") into null, as scores.json stores it.
    const now = JSON.parse(JSON.stringify(r.values)) as Record<string, Values>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(stored.values).sort());
    for (const [cell, old] of Object.entries(stored.values)) {
      for (const [id, x] of Object.entries(old))
        expect(now[cell]?.[id], `${cell} ${id}`).toEqual(x);
      expect(now[cell]?.["hook.writeWait.max"]).toBeNull();
      expect(now[cell]?.["hook.preToolUse.p99"]).toEqual(expect.any(Number));
      expect(now[cell]?.["res.treeRss.max"]).toBeGreaterThan(0);
    }
    expect(r.overall).toBeGreaterThan(0);
    expect(r.scorecard).toContain("`res.treeRss.max`");
    expect(r.scorecard).toContain("`hook.writeWait.p95`");
  });
});
