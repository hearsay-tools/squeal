import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  atomicConfig,
  cellRecord,
  declarations,
  expectationsOf,
  gradeOut,
  type Json,
  parserOf,
  pilotRecord,
  regradeFromOut,
} from "../../evals/lib/index.mjs";
import { CLAIM, claudeEvents, REGISTERED, RESULT, type Step } from "./reference-sessions.js";
import { HELD_OPENING } from "./slow-sessions.js";
import { settled } from "./status-snapshot.js";

// Row 006-82: a results file's cells graded again from their kept raw `out/`, with the parser at
// this revision. A long cell keeps its judge verdicts; a cell without `out/` stays as committed;
// only a file where a cell changed is written, its note naming the row and the note given.

type Cell = Record<string, unknown> & { id: string; judge?: Json; transcript?: Json };
interface Results {
  kind: string;
  date?: string;
  run: string;
  conditions: Json;
  cells: Cell[];
  regraded?: Record<string, unknown>[];
}

const declared = declarations();
const config = atomicConfig();
const root = mkdtempSync(join(tmpdir(), "squeal-evals-regrade-cells-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const STEPS: Step[] = [
  { squeal: REGISTERED(0) },
  { edit: "src/format.ts" },
  { squeal: RESULT(1) },
  CLAIM("pass"),
];

/** A kept cell's `out/` under `root`, as run-baseline keeps one: `<root>/<hash>/<run>/<id>/out`. */
function keep(run: string, id: string, task: string, steps = STEPS) {
  const out = join(root, "hash", run, id, "out");
  mkdirSync(out, { recursive: true });
  const meta = {
    id,
    run,
    task,
    variant: "p0",
    harness: "claude",
    model: "haiku",
    effort: "medium",
    rep: 1,
  };
  writeFileSync(join(out, "meta.json"), JSON.stringify(meta));
  writeFileSync(join(out, "t0"), "0");
  writeFileSync(
    join(out, "events.jsonl"),
    claudeEvents(steps)
      .map((e) => JSON.stringify(e))
      .join("\n"),
  );
  writeFileSync(join(out, "status-end.json"), JSON.stringify(settled));
  const done = { exit: 0, signal: null, timedOut: false, spawnError: null };
  writeFileSync(
    join(out, "truth.json"),
    JSON.stringify({ vitest: done, nodeTest: { ...done, files: 1 } }),
  );
  const report = {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "/tmp/cell/work/test/format.test.ts",
        status: "passed",
        assertionResults: [{ fullName: "a", status: "passed" }],
      },
    ],
  };
  writeFileSync(join(out, "truth.vitest.json"), JSON.stringify(report));
  return out;
}

/** The judge's cached verdict: `missed` where the parser says met, so its grade shows as kept. */
const JUDGE = {
  identity: { model: "claude-sonnet-5-5", effort: "medium", claudeCode: "2.1.300", rubric: "r" },
  transcriptHash: "h",
  verdicts: {
    "current-before-claim": { verdict: "missed", steps: [3], reason: "kept", grade: "missed" },
  },
};
const CONDITIONS = { tasks: { "t1-thousands": { knobs: {} } } } as unknown as Json;

/** A long results file of run `run` whose cells were graded from `out/` as committed. */
function longRun(run: string, ids: string[]): Results {
  const cells = ids.map((id) => {
    const cell = cellRecord({ ...gradeOut(keep(run, id, "t1-thousands")), id }) as unknown as Cell;
    cell.transcript = ["the redacted transcript the judge read"];
    cell.judge = JUDGE as unknown as Json;
    cell.parser = parserOf(cell as never, CONDITIONS as never, declared) as unknown as Json;
    cell.expectations = expectationsOf(
      cell as never,
      CONDITIONS as never,
      declared,
    ) as unknown as Json;
    return cell;
  });
  return { kind: "baseline", date: "2026-10-15", run, conditions: CONDITIONS, cells };
}

const byOut = (run: string) => (cell: Record<string, unknown>) => {
  const g = gradeOut(join(root, "hash", run, String(cell.id), "out"));
  return g;
};
const STAMP = { by: "006-82", note: "graded again from out/", date: "2026-10-15" };

describe("regradeFromOut", () => {
  const data = longRun("R1", ["a", "b", "c", "d"]);
  const [a, b, c, d] = data.cells as [Cell, Cell, Cell, Cell];
  // a: a stale parser grade; b: stale evidence alone; c: its out/ gone; d: as graded.
  const stale: Results = {
    ...data,
    cells: [
      { ...a, parser: { ...(a.parser as object), "current-before-claim": "missed" } },
      { ...b, timeline: (b.timeline as Json[]).slice(0, 1), squealWaits: 9 },
      c,
      d,
    ],
  };
  rmSync(join(root, "hash", "R1", "c"), { recursive: true });
  const r = regradeFromOut(stale as unknown as Json, {
    gradeOf: byOut("R1"),
    declared,
    config,
    ...STAMP,
  });
  const cells = (r.data as unknown as Results).cells;

  it("names a grade change in `changed` and an evidence change alone in `evidence`", () => {
    expect(r.changed).toEqual(["a"]);
    expect(r.evidence).toEqual(["b"]);
    expect(r.diffs).toEqual([
      { id: "a", grades: [["parser current-before-claim", "missed", "met"]], evidence: [] },
      { id: "b", grades: [], evidence: ["squealWaits", "timeline"] },
    ]);
    expect((r.data as unknown as Results).regraded).toEqual([
      {
        by: "006-82",
        date: "2026-10-15",
        changed: ["a"],
        evidence: ["b"],
        note: "graded again from out/",
      },
    ]);
  });

  it("keeps the judge's transcript and verdicts, which stay the grade of record", () => {
    expect(cells[0]).toEqual(a);
    expect(cells[0]?.judge).toEqual(JUDGE);
    expect(cells[0]?.transcript).toEqual(a.transcript);
    expect(cells[0]).toMatchObject({
      parser: { "current-before-claim": "met" },
      expectations: { "current-before-claim": "missed" },
    });
    expect(cells[1]).toEqual(b);
  });

  it("leaves a cell without out/ and an unchanged cell exactly as committed, and counts the first", () => {
    expect(r.missing).toEqual(["c"]);
    expect(cells[2]).toBe(c);
    expect(cells[3]).toBe(d);
  });

  it("returns a file with no changed cell as it was, with no note", () => {
    const again = regradeFromOut(r.data, { gradeOf: byOut("R1"), declared, config, ...STAMP });
    expect(again.data).toBe(r.data);
    expect([again.changed, again.evidence]).toEqual([[], []]);
  });

  it("replaces its own row's earlier note, keeping the cells it named", () => {
    const once = r.data as unknown as Results;
    const restale = {
      ...once,
      cells: once.cells.map((x) => (x.id === "d" ? { ...x, claimTrue: false } : x)),
    };
    const again = regradeFromOut(restale as unknown as Json, {
      gradeOf: byOut("R1"),
      declared,
      config,
      ...STAMP,
      date: "2026-10-16",
    });
    expect((again.data as unknown as Results).regraded).toEqual([
      { ...STAMP, date: "2026-10-16", changed: ["a", "d"], evidence: ["b"] },
    ]);
  });

  it("refuses without a row or a note", () => {
    for (const s of [
      { by: "", note: "n" },
      { by: "006-82", note: "" },
    ])
      expect(() =>
        regradeFromOut(data as unknown as Json, {
          gradeOf: byOut("R1"),
          declared,
          config,
          date: "d",
          ...s,
        }),
      ).toThrow(/names its row/);
  });

  it("recomputes an atomic cell's measures from out/, keeping its turns and settle", () => {
    const out = keep("R2", "x", "a1-break");
    const grade = gradeOut(out) as Record<string, unknown>;
    const scenario = config.scenarios["a1-break"] ?? null;
    const settle = { settled: true, why: "quiet", waitedMs: 10 };
    const atomic = pilotRecord(grade, { turns: 2, turnStarts: [5], settle, scenario });
    const cell = {
      ...cellRecord({ ...grade, id: "x" }),
      atomic: { ...atomic, measures: { "claim-true": false } },
    };
    const run = { kind: "atomic", run: "R2", conditions: {}, cells: [cell] } as unknown as Json;
    const r2 = regradeFromOut(run, { gradeOf: byOut("R2"), declared, config, ...STAMP });
    expect(r2.changed).toEqual(["x"]);
    const next = (r2.data as unknown as Results).cells[0]?.atomic;
    expect(next).toEqual(atomic);
    expect(r2.diffs[0]?.grades).toContainEqual(["atomic claim-true", false, true]);
  });

  // 006-94: a8's policy is the one its run recorded; an earlier a8 run stays policy off.
  it("grades an a8-load-hold cell under the knobs its run recorded", () => {
    const steps = [...HELD_OPENING, CLAIM("pass")];
    const out = keep("R5", "y", "a8-load-hold", steps);
    const grade = gradeOut(out) as Record<string, unknown>;
    const scenario = config.scenarios["a8-load-hold"] ?? null;
    const atomic = pilotRecord(grade, { scenario });
    const cell = { ...cellRecord({ ...grade, id: "y" }), atomic };
    const { requireSlowSuite: _, ...before } = scenario?.knobs ?? {};
    const slowThrough = (knobs: object) => {
      const conditions = { tasks: { "a8-load-hold": { prompt: "p", knobs } } };
      const run = { kind: "atomic", run: "R5", conditions, cells: [cell] } as unknown as Json;
      const r = regradeFromOut(run, { gradeOf: byOut("R5"), declared, config, ...STAMP });
      const { cells } = r.data as unknown as { cells: { atomic: { measures: Json } }[] };
      return (cells[0]?.atomic.measures as Record<string, Json> | undefined)?.[
        "slow-through-squeal"
      ];
    };
    expect(slowThrough(scenario?.knobs ?? {})).toBe(false);
    expect(slowThrough(before)).toBeNull();
  });
});

describe("evals/bin/regrade-cells.mjs", () => {
  const dir = mkdtempSync(join(tmpdir(), "squeal-evals-regrade-cells-results-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const changed = longRun("R3", ["e"]);
  const [e] = changed.cells as [Cell];
  changed.cells = [{ ...e, parser: { ...(e.parser as object), "current-before-claim": "missed" } }];
  const same = longRun("R4", ["f"]);
  const files = { changed: join(dir, "changed.json"), same: join(dir, "same.json") };
  const text = {
    changed: `${JSON.stringify(changed, null, 1)}\n`,
    same: `${JSON.stringify(same, null, 1)}\n`,
  };
  writeFileSync(files.changed, text.changed);
  writeFileSync(files.same, text.same);
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["evals/bin/regrade-cells.mjs", "--from-cells", root, ...args, files.changed, files.same],
      { encoding: "utf8" },
    );

  it("a dry run prints what would change and writes nothing", () => {
    const out = run("--dry-run");
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain(
      `${files.changed}: of 1 kept cell(s), 1 changed in a grade, 0 in evidence alone; 0 without out/`,
    );
    expect(out.stdout).toContain(`  e parser current-before-claim: "missed" -> "met"`);
    expect(out.stdout).toContain(`${files.same}: of 1 kept cell(s), 0 changed in a grade`);
    expect(readFileSync(files.changed, "utf8")).toBe(text.changed);
    expect(readFileSync(files.same, "utf8")).toBe(text.same);
    expect(() => statSync(join(dir, "TREND.md"))).toThrow();
  });

  it("refuses to write without the row and the note", () => {
    const out = run("--by", "006-82");
    expect(out.status).toBe(2);
    expect(readFileSync(files.changed, "utf8")).toBe(text.changed);
  });

  it("writes only the changed file, with the note given, and leaves the other untouched", () => {
    const before = statSync(files.same).mtimeMs;
    const out = run("--by", "006-82", "--note", "graded again from out/", "--date", "2026-10-15");
    expect(out.status, out.stderr).toBe(0);
    const data = JSON.parse(readFileSync(files.changed, "utf8")) as Results;
    expect(data.regraded).toEqual([
      {
        by: "006-82",
        date: "2026-10-15",
        changed: ["e"],
        evidence: [],
        note: "graded again from out/",
      },
    ]);
    expect(data.cells[0]?.judge).toEqual(JUDGE);
    expect(readFileSync(files.same, "utf8")).toBe(text.same);
    expect(statSync(files.same).mtimeMs).toBe(before);
    expect(out.stdout).toContain("wrote 1 results file(s)");
    expect(readFileSync(join(dir, "TREND.md"), "utf8")).toContain("# Model evals: trend");
  });
});
