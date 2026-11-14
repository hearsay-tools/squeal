import { describe, expect, it } from "vitest";
import { runTime, StoreWait } from "../../../src/core/code/gate/keep-wait.js";
import {
  InputCheck,
  type KeepWriter,
  type Kept,
  keepFile,
  type Tried,
} from "../../../src/core/code/gate/keep-write.js";
import type { AbsolutePath, EpochMs } from "../../../src/core/types/common.js";
import type { CheckKey, TestFileRef } from "../../../src/core/types/keys.js";

/*
 * Spec 020 D17.5 as amended by row 020-67 (#220): the keeper's last pass
 * waits for a busy store while writes land. The bound counts only time
 * with no landed write, and a ceiling, the time the queued files took to
 * run, stops the wait in all. A fake clock and a fake writer drive the
 * real `keepFile` and `StoreWait` the way `writeQueued` drives them, as
 * `research/probes/issue-220/bound.probe.ts` did: before this row, 340
 * files each refused once kept only 86.
 */

const DB = "/nonexistent/keep-stall/store.sqlite" as AbsolutePath;
const databases = { main: DB, code: DB };
const BOUND_MS = 30_000;

function fileAt(i: number): Kept {
  const ref = { project: "", path: `test/f${i}.test.ts` } as unknown as TestFileRef;
  return { ref, key: `key-${i}` as unknown as CheckKey, paths: [], record: {} as Kept["record"] };
}

const report = {
  end: "completed",
  durationMs: 0,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
} as never;
const store = { results: { newestForTestFile: () => [] } } as never;

/**
 * How each try of a write goes: `refusals` busy tries of each file's
 * coverage write before it lands (`Infinity`: never), each costing
 * `refusedMs` of the fake clock; a landed write costs `landedMs`.
 */
interface Contention {
  readonly files: number;
  readonly refusals: number;
  readonly refusedMs: number;
  readonly landedMs: number;
  /** The queued files' run time in this gate: the ceiling. */
  readonly runMs?: number;
}

async function lastPass(c: Contention) {
  let clock = 0;
  const now = () => clock as EpochMs;
  const lines: string[] = [];
  const all = Array.from({ length: c.files }, (_, i) => fileAt(i));
  const wait = new StoreWait({
    now,
    boundMs: BOUND_MS,
    tell: (t) => lines.push(t),
    ...(c.runMs === undefined ? {} : { runMs: () => c.runMs ?? 0 }),
  });
  const tries = new Map<string, number>();
  const writer: KeepWriter = {
    coverage: async (file): Promise<Tried> => {
      const n = (tries.get(file.ref.path) ?? 0) + 1;
      tries.set(file.ref.path, n);
      if (n <= c.refusals) {
        clock += c.refusedMs;
        return "busy";
      }
      clock += c.landedMs;
      return "kept";
    },
    results: async (): Promise<Tried> => {
      clock += c.landedMs;
      return "kept";
    },
  };
  const check = new InputCheck();
  let written = 0;
  for (const file of all) {
    const outcome = await keepFile(
      { store, keys: {} as never, writer },
      {
        file,
        report,
        provenance: {} as never,
        databases,
        giveUp: (db) => wait.giveUp(db, all.slice(written)),
        landed: () => wait.landed(),
        check,
        steady: async () => true,
        unheld: async () => true,
      },
    );
    if (outcome === "spent") {
      lines.push(wait.spent(c.files - written, 0));
      break;
    }
    written += 1;
  }
  return { written, clock, lines, stop: wait.stop };
}

describe("row 020-67: the keeper waits while writes land", () => {
  it("keeps 340 files each refused once, though the wait passes 30 s in all", async () => {
    // #220's shape: a 250 ms refusal per file, then two 50 ms writes. 340 files take 119 s.
    const r = await lastPass({
      files: 340,
      refusals: 1,
      refusedMs: 250,
      landedMs: 50,
      runMs: 340_000,
    });
    expect(r.written).toBe(340);
    expect(r.clock).toBeGreaterThan(BOUND_MS);
    expect(r.stop).toBeNull();
    expect(r.lines).toEqual([
      "the store is busy (the holder is not known); waiting to keep 340 completed test files until no write lands for 30 s, at most 340 s in all: test/f0.test.ts, test/f1.test.ts, test/f10.test.ts, test/f100.test.ts, test/f101.test.ts and 335 more",
    ]);
  });

  it("stops when no write landed for 30 s, and says so", async () => {
    // Every try refused, 10 s each. The wait starts at the first refusal's end (10 s), so the
    // fourth refusal reaches 30 s with no write.
    const r = await lastPass({
      files: 3,
      refusals: Number.POSITIVE_INFINITY,
      refusedMs: 10_000,
      landedMs: 50,
      runMs: 600_000,
    });
    expect(r.written).toBe(0);
    expect(r.stop).toBe("quiet");
    expect(r.clock).toBe(40_000);
    expect(r.lines.at(-1)).toBe(
      "3 completed test files were not kept in the stores: no write landed for 30 s (the holder is not known); the next run will run them again",
    );
  });

  it("stops after a long run of landed writes when no write lands for 30 s after them", async () => {
    // The first 20 files land after one refusal each (7 s); the store then stays held.
    let clock = 0;
    const now = () => clock as EpochMs;
    const wait = new StoreWait({ now, boundMs: BOUND_MS, tell: () => {}, runMs: () => 600_000 });
    for (let i = 0; i < 20; i++) {
      clock += 250;
      expect(wait.giveUp(DB, [])).toBe(false);
      clock += 100;
      wait.landed();
    }
    const lastLanded = clock;
    while (!wait.giveUp(DB, [])) clock += 250;
    expect(wait.stop).toBe("quiet");
    expect(clock - lastLanded).toBe(BOUND_MS);
  });

  it("stops at the ceiling, the queued files' run time, and says waiting longer costs more", async () => {
    // Writes keep landing, but 340 files take 119 s and they took 60 s to run.
    const r = await lastPass({
      files: 340,
      refusals: 1,
      refusedMs: 250,
      landedMs: 50,
      runMs: 60_000,
    });
    expect(r.stop).toBe("ceiling");
    expect(r.written).toBeGreaterThan(0);
    expect(r.written).toBeLessThan(340);
    // The wait starts at the first refusal's end (250 ms); the refusal that reaches the ceiling stops it.
    expect(r.clock - 250).toBeGreaterThanOrEqual(60_000);
    expect(r.clock - 250).toBeLessThan(60_000 + 350);
    expect(r.lines.at(-1)).toBe(
      `${340 - r.written} completed test files were not kept in the stores: the store was still busy after 60 s (the holder is not known), and waiting longer would cost more than running them again; the next run will run them again`,
    );
  });

  it("never sets the ceiling under the bound", async () => {
    // A run time of 2 s still waits 30 s.
    const r = await lastPass({
      files: 340,
      refusals: 1,
      refusedMs: 250,
      landedMs: 50,
      runMs: 2_000,
    });
    expect(r.stop).toBe("ceiling");
    expect(r.clock - 250).toBeGreaterThanOrEqual(BOUND_MS);
    expect(r.clock - 250).toBeLessThan(BOUND_MS + 350);
    expect(r.lines[0]).toContain("until no write lands for 30 s, at most 30 s in all");
  });
});

describe("row 020-67: the ceiling is the queued files' run time", () => {
  const ref = (i: number) => fileAt(i).ref;
  const run = (files: Kept[], durationMs: number, own: readonly (readonly [number, number])[]) => ({
    files,
    report: {
      durationMs,
      fileDurations: own.map(([i, ms]) => ({ testFile: ref(i), durationMs: ms })),
    },
  });

  it("sums the files' own durations per run, at most the run's, over the runs", () => {
    const [a, b, c, d] = [0, 1, 2, 3].map(fileAt) as [Kept, Kept, Kept, Kept];
    const one = run([a, b], 10_000, [
      [0, 4_000],
      [1, 3_000],
    ]);
    const two = run([c, d], 5_000, [
      [2, 4_000],
      [3, 3_000],
    ]);
    const time = runTime([one, two]);
    expect(time([a, b, c, d])).toBe(7_000 + 5_000);
    expect(time([b, c])).toBe(3_000 + 4_000);
    expect(time([])).toBe(0);
  });

  it("takes the run's whole duration when a file has none of its own", () => {
    const [a, b] = [0, 1].map(fileAt) as [Kept, Kept];
    const time = runTime([run([a, b], 9_000, [[0, 1_000]])]);
    expect(time([a])).toBe(1_000);
    expect(time([a, b])).toBe(9_000);
  });
});
