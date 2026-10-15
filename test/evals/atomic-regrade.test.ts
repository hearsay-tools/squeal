import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicConfig, atomicMarkdown, type Json, regradeAtomic } from "../../evals/lib/index.mjs";

// 006-35: the committed atomic runs, regraded by evals/bin/atomic-regrade.mjs under D10's
// measures from what each cell kept. a2-slow's `slow-through-squeal` matches the coordinator's
// hand count from the retained records (status, 2026-10-12). 006-50: a1-break scores D4's
// `no-rerun-answered` in place of the prototype's `no-rerun-answered-turn2`.
const RESULTS = join(import.meta.dirname, "../../evals/results");
const PILOT = "2026-10-12-0.1.127.20261012T070705Z-6eec71.atomic.json";
const SECOND = "2026-10-12-0.1.127.20261012T082442Z-257eaf.atomic.json";
// The four runs 006-50 regraded. A run graded since then carries no 006-50 note and no prototype
// count to compare against.
const REGRADED_006_50 = [
  PILOT,
  SECOND,
  "2026-10-12-0.1.127.20261012T203134Z-4ed2a0.atomic.json",
  "2026-10-12-0.1.131.20261012T134945Z-3f2edd.atomic.json",
];

interface Cell {
  id: string;
  task: string;
  model: string;
  atomic: {
    measures: Record<string, boolean | null>;
    turns: number;
    settle: { settled: boolean } | null;
    /** The prototype's count, kept in the records graded before 006-50. */
    ownRunsAfterAnsweredTurn2?: number | null;
  };
}
interface Results {
  cells: Cell[];
  scenarios: Record<string, { measures: string[] }>;
  regraded: { by: string; changed: string[] }[];
}
const read = (f: string): Results => JSON.parse(readFileSync(join(RESULTS, f), "utf8"));
/** 006-80: the row regrading and its note, given by the caller. */
const STAMP = { by: "006-80", note: "measures recomputed for the test" };

/** Per model, the cells of `task` meeting `measure`. */
function met(data: Results, task: string, measure: string) {
  const out: Record<string, number> = {};
  for (const c of data.cells.filter((c) => c.task === task))
    out[c.model] = (out[c.model] ?? 0) + (c.atomic.measures[measure] === true ? 1 : 0);
  return out;
}

describe("the committed atomic runs, regraded", () => {
  const config = atomicConfig();

  it("are graded under today's declarations: regrading again changes nothing and stamps nothing", () => {
    for (const f of [PILOT, SECOND]) {
      const data = read(f) as unknown as Json;
      const again = regradeAtomic(data, config, "2099-01-01", STAMP);
      expect(again.changed, f).toEqual([]);
      expect(again.data, f).toBe(data);
    }
    for (const f of [PILOT, SECOND]) {
      const data = read(f);
      expect(data.scenarios["a2-slow"]?.measures).toEqual(config.scenarios["a2-slow"]?.measures);
    }
  });

  it("include the variant arms atomic-compare.mjs reads, graded under today's declarations too (006-86)", () => {
    const variants = readdirSync(RESULTS).filter((f) => f.endsWith(".atomic-variant.json"));
    expect(variants.length).toBeGreaterThanOrEqual(4);
    for (const f of variants) {
      const data = read(f) as unknown as Json;
      expect(regradeAtomic(data, config, "2099-01-01", STAMP).changed, f).toEqual([]);
    }
  });

  it("changed every a2-slow cell's measures under 006-35", () => {
    for (const f of [PILOT, SECOND]) {
      const data = read(f);
      const note = data.regraded.find((n) => n.by === "006-35");
      const a2 = data.cells.filter((c) => c.task === "a2-slow").map((c) => c.id);
      expect(note?.changed, f).toEqual(a2);
    }
  });

  it("a1-break keeps every value the prototype's rule could compute, and the two timed-out settles are met", () => {
    const newly: string[] = [];
    for (const f of REGRADED_006_50) {
      const data = read(f);
      const a1 = data.cells.filter((c) => c.task === "a1-break");
      expect(data.regraded.find((n) => n.by === "006-50")?.changed, f).toEqual(a1.map((c) => c.id));
      for (const c of a1) {
        const p = c.atomic;
        expect(Object.keys(p.measures)).toEqual([
          "claim-true",
          "no-false-pass",
          "no-rerun-answered",
        ]);
        const before =
          p.turns < 2 || p.settle?.settled !== true ? null : p.ownRunsAfterAnsweredTurn2 === 0;
        if (before === null) newly.push(`${f.split(".")[3]} ${p.measures["no-rerun-answered"]}`);
        else expect(p.measures["no-rerun-answered"], c.id).toBe(before);
      }
    }
    expect(newly.sort()).toEqual(["20261012T070705Z-6eec71 true", "20261012T134945Z-3f2edd true"]);
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

  it("recomputes a cell graded under the pilot's measures, and only that cell, under the row given", () => {
    const data = read(SECOND);
    const i = data.cells.findIndex((c) => c.task === "a2-slow");
    const cells = data.cells.map((c, j) =>
      j === i ? { ...c, atomic: { ...c.atomic, measures: { "slow-before-claim": true } } } : c,
    );
    const r = regradeAtomic({ ...data, cells } as unknown as Json, config, "2026-10-15", STAMP);
    expect(r.changed).toEqual([data.cells[i]?.id]);
    const out = r.data as unknown as Results;
    expect(out.cells).toEqual(data.cells);
    expect(out.regraded).toEqual([
      ...data.regraded,
      { ...STAMP, date: "2026-10-15", changed: [data.cells[i]?.id] },
    ]);
    expect(out.regraded.filter((n) => n.by === "006-50")).toEqual(
      data.regraded.filter((n) => n.by === "006-50"),
    );
  });

  it("refuses without a row or a note", () => {
    const data = read(SECOND) as unknown as Json;
    for (const s of [
      { by: "", note: "n" },
      { by: "006-80", note: "" },
    ])
      expect(() => regradeAtomic(data, config, "2026-10-15", s)).toThrow(/names its row/);
  });
});

describe("evals/bin/atomic-regrade.mjs", () => {
  const name = "2026-10-12-0.1.127.20261012T203134Z-4ed2a0.atomic";
  const same = "2026-10-12-0.1.127.20261012T070705Z-6eec71.atomic";
  const regrade = (dir: string, ...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        "evals/bin/atomic-regrade.mjs",
        join(dir, `${name}.json`),
        join(dir, `${same}.json`),
        ...args,
      ],
      { encoding: "utf8" },
    );

  it("writes only a changed file, with the row and note given, and regenerates ATOMIC.md beside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-evals-atomic-regrade-"));
    try {
      const data = JSON.parse(readFileSync(join(RESULTS, `${name}.json`), "utf8")) as Results;
      const stale = data.cells.findIndex((c) => c.task === "a1-break");
      const cells = data.cells.map((c, j) =>
        j === stale ? { ...c, atomic: { ...c.atomic, measures: {} } } : c,
      );
      writeFileSync(join(dir, `${name}.json`), `${JSON.stringify({ ...data, cells }, null, 1)}\n`);
      copyFileSync(join(RESULTS, `${same}.json`), join(dir, `${same}.json`));
      const before = statSync(join(dir, `${same}.json`)).mtimeMs;
      const out = regrade(
        dir,
        "--by",
        "006-80",
        "--note",
        "the note given",
        "--date",
        "2026-10-15",
      );
      expect(out.status, out.stderr).toBe(0);
      const written = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
      expect(written.cells).toEqual(data.cells);
      expect(written.regraded.at(-1)).toEqual({
        by: "006-80",
        date: "2026-10-15",
        changed: [data.cells[stale]?.id],
        note: "the note given",
      });
      expect(readFileSync(join(dir, `${same}.json`), "utf8")).toBe(
        readFileSync(join(RESULTS, `${same}.json`), "utf8"),
      );
      expect(statSync(join(dir, `${same}.json`)).mtimeMs).toBe(before);
      expect(out.stdout).toContain(`${join(dir, `${same}.json`)}: unchanged, not written`);
      const all = [name, same].map((n) => ({
        name: n,
        data: JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8")),
      }));
      expect(readFileSync(join(dir, "ATOMIC.md"), "utf8")).toBe(atomicMarkdown(all));
      expect(out.stdout).toContain(`${join(dir, "ATOMIC.md")} from 2 atomic results file(s)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing, not even ATOMIC.md, where no cell changed, and refuses without a row or a note", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-evals-atomic-regrade-"));
    try {
      for (const n of [name, same])
        copyFileSync(join(RESULTS, `${n}.json`), join(dir, `${n}.json`));
      expect(regrade(dir, "--by", "006-80").status).toBe(2);
      const out = regrade(dir, "--by", "006-80", "--note", "n");
      expect(out.status, out.stderr).toBe(0);
      for (const n of [name, same])
        expect(readFileSync(join(dir, `${n}.json`), "utf8")).toBe(
          readFileSync(join(RESULTS, `${n}.json`), "utf8"),
        );
      expect(existsSync(join(dir, "ATOMIC.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
