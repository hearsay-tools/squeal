import { describe, expect, it } from "vitest";
import type { GateRunReport } from "../../../src/core/code/gate/report.js";
import { retriedText } from "../../../src/core/code/gate/retry.js";
import type { FileRetry } from "../../../src/core/code/gate/types.js";
import type { RelativePath } from "../../../src/core/types/common.js";

/*
 * Row 020-54 (#210): the one stderr line after the verdict when files ran
 * once more under load: the count, the load per CPU at its highest, and
 * each outcome's count with at most three names.
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
