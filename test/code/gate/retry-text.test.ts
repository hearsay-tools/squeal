import { describe, expect, it } from "vitest";
import type { GateRunReport } from "../../../src/core/code/gate/report.js";
import {
  retriedText,
  storedFailuresText,
  storedRerunText,
} from "../../../src/core/code/gate/retry.js";
import type { FileRetry, StoredRerun } from "../../../src/core/code/gate/types.js";
import type { RelativePath } from "../../../src/core/types/common.js";

/*
 * Row 020-54 (#210): the one stderr line after the verdict when files ran
 * once more under load: the count, the load per CPU at its highest, and
 * each outcome's count with at most three names. Row 020-60: the lines
 * naming failures read from the stores, and their rerun's outcomes.
 */

const run = (
  runner: GateRunReport["runner"],
  retried: Readonly<Record<string, FileRetry>> | undefined,
): GateRunReport => ({
  runner,
  selected: [],
  completed: [],
  notFinished: [],
  failed: [],
  ...(retried === undefined ? {} : { retried: retried as Record<RelativePath, FileRetry> }),
  durationMs: null,
});

const at = (load: number, outcome: FileRetry["outcome"], cpus = 24): FileRetry => ({
  load,
  cpus,
  outcome,
});

describe("retriedText (row 020-54)", () => {
  it("says nothing when no file ran again", () => {
    expect(retriedText([run("vitest", undefined), run("node-test", {})])).toBe("");
  });

  it("gives one line over every runner, with the highest load per CPU", () => {
    const text = retriedText([
      run("vitest", { "t/a.test.ts": at(30, "passed") }),
      run("node-test", {
        "n/c.test.ts": at(11, "failed", 8),
        "n/b.test.ts": at(26, "not-finished"),
      }),
    ]);
    expect(text).toBe(
      "squeal code: 3 test files failed while the host load was at or over its CPU count (11 on 8 CPUs) and ran once more: 1 passed (t/a.test.ts), 1 failed again (n/c.test.ts), 1 did not finish, so the first failure stands (n/b.test.ts).\n",
    );
    expect(text.split("\n")).toHaveLength(2);
  });

  it("names at most three files per outcome, in path order", () => {
    const retried = Object.fromEntries(
      ["e", "d", "c", "b", "a"].map((name) => [`t/${name}.test.ts`, at(24, "passed")]),
    );
    expect(retriedText([run("vitest", retried)])).toBe(
      "squeal code: 5 test files failed while the host load was at or over its CPU count (24 on 24 CPUs) and ran once more: 5 passed (t/a.test.ts, t/b.test.ts, t/c.test.ts and 2 more).\n",
    );
  });
});

/** A run whose `from` and `failed` hold `files`, each `[path, from, failed, storedRerun?]`. */
const fromRun = (
  runner: GateRunReport["runner"],
  files: readonly (readonly [string, "run" | "store" | "parts", boolean, StoredRerun?])[],
): GateRunReport => {
  const reran = files.flatMap(([path, , , r]) => (r === undefined ? [] : [[path, r] as const]));
  return {
    ...run(runner, undefined),
    failed: files.filter(([, , f]) => f).map(([path]) => ({ path, tests: ["x"] })),
    from: Object.fromEntries(files.map(([path, from]) => [path, from])),
    ...(reran.length === 0 ? {} : { storedRerun: Object.fromEntries(reran) }),
  } as GateRunReport;
};

const COMMAND = "squeal code --base main --rerun-stored-failures";

describe("storedFailuresText (row 020-60)", () => {
  it("names only failures from the stores, over every runner, with the command", () => {
    const text = storedFailuresText(
      [
        fromRun("vitest", [
          ["t/b.test.ts", "store", true],
          ["t/pass.test.ts", "store", false],
          ["t/ran.test.ts", "run", true],
        ]),
        fromRun("node-test", [
          ["n/a.test.ts", "store", true],
          ["n/p.test.ts", "parts", true],
        ]),
      ],
      COMMAND,
    );
    expect(text).toBe(
      `squeal code: 2 failed test files were read from the stores and did not run here (n/a.test.ts, t/b.test.ts). To run them once more: ${COMMAND}\n`,
    );
  });

  it("names at most three, and none that ran once more", () => {
    const files = ["e", "d", "c", "b", "a"].map((n) => [`t/${n}.test.ts`, "store", true] as const);
    const reran = [["t/z.test.ts", "store", true, { outcome: "not-finished" }]] as const;
    expect(storedFailuresText([fromRun("vitest", [...files, ...reran])], COMMAND)).toBe(
      `squeal code: 5 failed test files were read from the stores and did not run here (t/a.test.ts, t/b.test.ts, t/c.test.ts and 2 more). To run them once more: ${COMMAND}\n`,
    );
  });

  it("says nothing without a stored failure", () => {
    expect(
      storedFailuresText([fromRun("vitest", [["t/a.test.ts", "store", false]])], COMMAND),
    ).toBe("");
    expect(storedFailuresText([run("vitest", undefined)], COMMAND)).toBe("");
  });
});

describe("storedRerunText (row 020-60)", () => {
  it("counts each outcome over every runner, in one line", () => {
    const text = storedRerunText([
      fromRun("vitest", [
        ["t/a.test.ts", "run", false, { outcome: "passed" }],
        ["t/b.test.ts", "store", true, { outcome: "not-finished" }],
      ]),
      fromRun("node-test", [["n/c.test.ts", "run", true, { outcome: "failed" }]]),
    ]);
    expect(text).toBe(
      "squeal code: 3 failed test files read from the stores ran once more (--rerun-stored-failures): 1 passed (t/a.test.ts), 1 failed again (n/c.test.ts), 1 did not finish, so the stored failure stands (t/b.test.ts).\n",
    );
  });

  it("says nothing when none ran once more", () => {
    expect(storedRerunText([run("vitest", undefined)])).toBe("");
  });
});
