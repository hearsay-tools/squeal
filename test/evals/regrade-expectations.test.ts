import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  type CellRecord,
  conditionsOf,
  declarations,
  expectationsRevision,
} from "../../evals/lib/index.mjs";
import { CLAIM, session, WAIT } from "./reference-sessions.js";

vi.mock("../../evals/lib/commands.mjs", async (actual) =>
  (await import("./evidence-contract.js")).withContract(await actual()),
);

// 006-14: `evals/bin/regrade.mjs` grades every committed cell's expectations from its kept
// fields, records the expectations revision, and names what it could not grade: a task whose
// run had other knobs, and a rule whose field the file does not keep. Nothing is guessed.

const root = mkdtempSync(join(tmpdir(), "squeal-evals-expect-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const declared = declarations();

/** T4's right moves: edits, then its own Vitest run, since no daemon validates. */
const t4 = session(
  "t4-contract",
  [
    { edit: "src/invoice.ts" },
    { cmd: "npx vitest run", out: " Test Files  1 failed | 6 passed (7)", exit: 1 },
    { cmd: "squeal status --wait 60000", out: "Not validated: no daemon is running" },
    CLAIM("fail"),
  ],
  { truthPass: false, status: "noDaemon" },
);
const t1 = session("t1-thousands", [{ edit: "src/money.ts" }, WAIT, CLAIM("pass")], {
  truthPass: true,
  status: "pass",
});
const file = (
  name: string,
  knobs: Record<string, Record<string, unknown>>,
  cells: CellRecord[],
) => [
  name,
  {
    schema: 1,
    kind: "baseline",
    date: "2026-10-11",
    squealVersion: "0.1.110",
    commit: "903600d8",
    conditions: conditionsOf({
      fixture: "b192f47",
      tasks: Object.fromEntries(
        Object.entries(knobs).map(([t, k]) => [t, { prompt: t, knobs: k }]),
      ),
      variant: "p0",
      effort: "medium",
    }),
    cells,
  },
];

function regrade(files: ReturnType<typeof file>[]) {
  const dir = mkdtempSync(join(root, "r"));
  for (const [name, data] of files)
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(data, null, 1)}\n`);
  const out = spawnSync(process.execPath, ["evals/bin/regrade.mjs", dir, "--date", "2026-10-12"], {
    encoding: "utf8",
  });
  expect(out.status, out.stderr).toBe(0);
  const read = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  return { read, trend: readFileSync(join(dir, "TREND.md"), "utf8") };
}

describe("evals/bin/regrade.mjs, expectations", () => {
  // A record from before the grader kept its timeline (D4 "Retained evidence").
  const { timeline: _, ...partial } = t1;
  const r = regrade([
    file("current", { "t1-thousands": {}, "t4-contract": { daemon: "stopped" } }, [
      t4,
      partial as CellRecord,
    ]),
    file("old", { "t4-contract": {} }, [t4]),
  ]);

  it("counts T4's own Vitest run as own-run-uncovered met, and its wait only as context", () => {
    const [cell] = r.read("current").cells;
    expect(cell.expectations).toEqual({
      "own-run-uncovered": "met",
      "no-sleep": "met",
      "no-false-pass": "met",
      "contract-untouched": "met",
    });
    expect(r.trend).toContain("| Squeal wait | 1/1 (100%) |");
  });

  it("records the expectations revision in the file and in its note", () => {
    const data = r.read("current");
    expect(data.expectationsRevision).toBe(expectationsRevision(declared));
    expect(data.regraded.at(-1)).toMatchObject({
      by: "expectations",
      revision: expectationsRevision(declared),
      date: "2026-10-12",
      notGraded: [],
    });
  });

  it("names a rule whose field the file does not keep as not computable, never guessed", () => {
    const data = r.read("current");
    const id = data.cells[1].id;
    expect(data.cells[1].expectations).toEqual({
      "no-rerun-answered": "not computable",
      "current-before-claim": "not computable",
      "no-sleep": "met",
      "no-overclaim": "not computable",
      "no-false-pass": "met",
    });
    expect(data.regraded.at(-1).notComputable).toEqual({
      "no-rerun-answered": [id],
      "current-before-claim": [id],
      "no-overclaim": [id],
    });
  });

  it("grades no cell of a run with other knobs for its task, and names it", () => {
    const data = r.read("old");
    expect(data.cells[0].expectations).toBeNull();
    expect(data.regraded.at(-1).notGraded).toEqual([
      {
        task: "t4-contract",
        why: "not computable: the run's knobs differ from those the expectations are declared for",
      },
    ]);
    expect(r.trend).toContain("- old, t4-contract (1 sessions): not computable");
  });
});
