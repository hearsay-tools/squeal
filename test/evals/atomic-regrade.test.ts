import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicConfig, type Json, regradeAtomic } from "../../evals/lib/index.mjs";

// 006-35: the two committed atomic runs, regraded by evals/bin/atomic-regrade.mjs under D10's
// measures from what each cell kept. a1-break is as it was; a2-slow's `slow-through-squeal`
// matches the coordinator's hand count from the retained records (status, 2026-10-12).
const RESULTS = join(import.meta.dirname, "../../evals/results");
const PILOT = "2026-10-12-0.1.127.20261012T070705Z-6eec71.atomic.json";
const SECOND = "2026-10-12-0.1.127.20261012T082442Z-257eaf.atomic.json";

interface Cell {
  id: string;
  task: string;
  model: string;
  atomic: { measures: Record<string, boolean | null> };
}
interface Results {
  cells: Cell[];
  scenarios: Record<string, { measures: string[] }>;
  regraded: { by: string; changed: string[] }[];
}
const read = (f: string): Results => JSON.parse(readFileSync(join(RESULTS, f), "utf8"));

/** Per model, the cells of `task` meeting `measure`. */
function met(data: Results, task: string, measure: string) {
  const out: Record<string, number> = {};
  for (const c of data.cells.filter((c) => c.task === task))
    out[c.model] = (out[c.model] ?? 0) + (c.atomic.measures[measure] === true ? 1 : 0);
  return out;
}

describe("the committed atomic runs, regraded", () => {
  const config = atomicConfig();

  it("are graded under today's declarations: regrading again changes nothing", () => {
    for (const f of [PILOT, SECOND]) {
      const data = read(f);
      const again = regradeAtomic(data as unknown as Json, config, "2099-01-01");
      expect(again.changed, f).toEqual([]);
      expect(again.data, f).toEqual(data);
      expect(data.scenarios["a2-slow"]?.measures).toEqual(config.scenarios["a2-slow"]?.measures);
    }
  });

  it("left every a1-break cell as it was and changed every a2-slow cell's measures", () => {
    for (const f of [PILOT, SECOND]) {
      const data = read(f);
      const note = data.regraded.find((n) => n.by === "006-35");
      const a2 = data.cells.filter((c) => c.task === "a2-slow").map((c) => c.id);
      expect(note?.changed, f).toEqual(a2);
      for (const c of data.cells.filter((c) => c.task === "a1-break"))
        expect(Object.keys(c.atomic.measures)).toEqual([
          "claim-true",
          "no-false-pass",
          "no-rerun-answered-turn2",
        ]);
    }
  });

  it("a2-slow through Squeal matches the coordinator's hand count", () => {
    expect(met(read(PILOT), "a2-slow", "slow-through-squeal")).toEqual({
      "claude-haiku-5-5": 8,
      "gpt-6-luna": 9,
      "claude-sonnet-5-5": 20,
      "gpt-6.1-sol": 20,
    });
    expect(met(read(SECOND), "a2-slow", "slow-through-squeal")).toEqual({
      "claude-haiku-5-5": 5,
      "gpt-6-luna": 4,
      "claude-sonnet-5-5": 10,
      "gpt-6.1-sol": 10,
    });
  });

  it("recomputes a cell graded under the pilot's measures, and only that cell", () => {
    const data = read(SECOND);
    const i = data.cells.findIndex((c) => c.task === "a2-slow");
    const cells = data.cells.map((c, j) =>
      j === i ? { ...c, atomic: { ...c.atomic, measures: { "slow-before-claim": true } } } : c,
    );
    const stale = { ...data, cells, regraded: data.regraded.filter((n) => n.by !== "006-35") };
    const r = regradeAtomic(stale as unknown as Json, config, "2026-10-12");
    expect(r.changed).toEqual([data.cells[i]?.id]);
    expect((r.data as unknown as Results).cells).toEqual(data.cells);
  });
});
