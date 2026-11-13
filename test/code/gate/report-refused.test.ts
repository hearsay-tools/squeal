import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import {
  type GatePartRefusal,
  type PartRefusal,
  refusedText,
} from "../../../src/core/code/gate/parts-refused.js";
import type { GateEvidenceSource, GateRunReport } from "../../../src/core/code/gate/report.js";
import type { TestFileEvidence } from "../../../src/core/code/gate/types.js";
import {
  changedSet,
  evidence,
  fn,
  POLICY,
  source,
  TIMES,
  testFile,
  VERSIONS,
} from "./evaluate-fixture.js";

/*
 * Spec 020 D7 and D13.2 as amended by row 020-49 (#205): the report gives
 * each selected file a part holds and did not give, and why, in
 * `runs[].refused`; `from` says whether the stores gave it or it ran here.
 * A report with no refusal is as before. Stderr gives one bounded line per
 * reason.
 */

const add = fn("add", [1, 3], 1);
const PATHS = [{ path: "src/a.ts", functions: [add], changed: ["add"] }];
const loaded = (path: string, runner: TestFileEvidence["runner"] = "vitest") =>
  testFile(path, ["src/a.ts"], [source("src/a.ts", [add])], { runner });

const refusal = (path: string, more: Partial<PartRefusal> = {}): PartRefusal => ({
  runner: "vitest",
  path,
  part: "squeal-part-0.json",
  reason: "input",
  input: "src/a.ts",
  detail: "its part read other content",
  ...more,
});

const report = (files: readonly TestFileEvidence[], refused?: readonly PartRefusal[]) =>
  evaluate(
    changedSet(PATHS),
    { ...evidence(files), ...(refused === undefined ? {} : { refused }) },
    POLICY,
    VERSIONS,
    TIMES,
  );

describe("the gate report's refused files (020 D7, D13.2; row 020-49)", () => {
  it("gives each refusal by path, beside where the file's evidence came from", () => {
    const out = report(
      [
        { ...loaded("test/taken.test.ts"), from: "parts" },
        { ...loaded("test/stored.test.ts"), from: "store" },
        loaded("test/ran.test.ts"),
        loaded("test/n.test.mjs", "node-test"),
      ],
      [
        refusal("test/ran.test.ts"),
        refusal("test/stored.test.ts", { reason: "duplicate", detail: "also in p-1.json" }),
      ],
    );

    const [vitest, other] = out.runs;
    expect(vitest?.from).toEqual({
      "test/ran.test.ts": "run",
      "test/stored.test.ts": "store",
      "test/taken.test.ts": "parts",
    });
    expect(vitest?.refused).toEqual({
      "test/ran.test.ts": {
        part: "squeal-part-0.json",
        reason: "input",
        input: "src/a.ts",
        detail: "its part read other content",
      },
      "test/stored.test.ts": {
        part: "squeal-part-0.json",
        reason: "duplicate",
        input: "src/a.ts",
        detail: "also in p-1.json",
      },
    });
    expect(Object.keys(vitest?.refused ?? {})).toEqual(["test/ran.test.ts", "test/stored.test.ts"]);
    expect(other?.refused).toBeUndefined();
    expect(out.verdict).toBe("pass");
  });

  it("gives a refusal of a file every run ran, though no file read elsewhere gives `from`", () => {
    const out = report([loaded("test/ran.test.ts")], [refusal("test/ran.test.ts")]);
    expect(out.runs[0]?.from).toBeUndefined();
    expect(out.runs[0]?.refused).toMatchObject({ "test/ran.test.ts": { reason: "input" } });
  });

  it("leaves out a refusal of a file not selected, and the key when none is left", () => {
    const out = report([loaded("test/ran.test.ts")], [refusal("test/gone.test.ts")]);
    expect(Object.keys(out.runs[0] ?? {})).toEqual([
      "runner",
      "selected",
      "completed",
      "notFinished",
      "failed",
      "durationMs",
    ]);
  });

  it("is the same report as before when the parts refused nothing", () => {
    const files = [{ ...loaded("test/taken.test.ts"), from: "parts" as const }];
    expect(report(files, [])).toEqual(report(files));
  });
});

describe("the stderr summary of refused files (row 020-49)", () => {
  const run = (
    refused: Readonly<Record<string, GatePartRefusal>>,
    from: Readonly<Record<string, GateEvidenceSource>> = {},
  ): GateRunReport => ({
    runner: "vitest",
    selected: Object.keys(refused).sort(),
    completed: Object.keys(refused).sort(),
    notFinished: [],
    failed: [],
    from,
    refused,
    durationMs: 1,
  });
  const input = (path: string): GatePartRefusal => ({
    part: "p-0.json",
    reason: "input",
    input: path,
    detail: "its part read other content",
  });

  it("gives one line per reason, the stores apart from a run here, at most three names", () => {
    const names = ["a", "b", "c", "d", "e"].map((n) => `test/${n}.test.ts`);
    const refused = {
      ...Object.fromEntries(names.map((n) => [n, input(`src/${n.slice(5, 6)}.ts`)])),
      "test/twice.test.ts": { part: "p-0.json", reason: "duplicate", detail: "also in p-1.json" },
      "test/env.test.ts": { part: "p-1.json", reason: "environment", detail: "differs" },
      "test/old.test.ts": { part: "p-2.json", reason: "unusable", detail: "old" },
    } as const;

    const text = refusedText([run(refused, { "test/b.test.ts": "store" })]);

    expect(text.split("\n")).toEqual([
      "squeal code: Vitest: 1 test file not taken from the parts, 1 run here: more than one part holds it (test/twice.test.ts)",
      "squeal code: Vitest: 5 test files not taken from the parts, 4 run here, 1 read from the stores: its part does not certify an input as it is here (test/a.test.ts: src/a.ts, test/b.test.ts: src/b.ts, test/c.test.ts: src/c.ts, and 2 more)",
      "",
    ]);
  });

  it("gives a file the stores gave alone as read from the stores", () => {
    const text = refusedText([
      run({ "test/a.test.ts": input("src/a.ts") }, { "test/a.test.ts": "store" }),
    ]);
    expect(text).toBe(
      "squeal code: Vitest: 1 test file not taken from the parts, 1 read from the stores: its part does not certify an input as it is here (test/a.test.ts: src/a.ts)\n",
    );
  });

  it("is empty when the parts refused nothing, or only part-wide", () => {
    const { refused: _refused, ...none } = run({});
    const env: GatePartRefusal = { part: "p.json", reason: "environment", detail: "x" };
    expect(refusedText([none, run({}), run({ "test/a.test.ts": env })])).toBe("");
  });
});
