import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/core/code/gate/evaluate.js";
import type { PartRefusal } from "../../../src/core/code/gate/parts-refused.js";
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
 * A report with no refusal is as before.
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
