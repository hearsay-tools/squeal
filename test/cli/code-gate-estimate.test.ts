import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { result } from "../store/helpers.js";
import {
  BASE,
  edit,
  ownHomeAndTmp,
  repo,
  SLOW,
  toldBefore,
  VITEST_WIDTH,
} from "./code-gate-fixture.js";

/*
 * Spec 020 D17.1 (row 020-17a): `squeal code --base` tells each runner's
 * estimate on stderr after the stored lookup and before the first run. A
 * store seeded with the test file's duration, as a daemon of another
 * commit stored it, gives the time. The test file writes a marker when it
 * loads, so a line told while the marker is absent came before any test ran.
 */

const MARKER = "ran.txt";

/** BASE, its test file writing the marker when it loads. */
const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  "test/math.test.ts": `import { writeFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { double } from "../src/math";\n\nwriteFileSync(new URL("../${MARKER}", import.meta.url), "ran\\n");\n\nit("doubles", () => expect(double(2)).toBe(4));\n`,
};

const DOUBLED = "export function double(x: number): number {\n  return x + x;\n}\n";

/** The repository's main store, with `test/math.test.ts`'s file check at `seconds`, at a key of its own. */
function seed(root: string, seconds: number): void {
  const store = openStore(join(root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    const check = { kind: "file", project: "", testPath: "test/math.test.ts" } as const;
    store.results.putMany([{ ...result(check, "an-older-key"), durationMs: seconds * 1000 }]);
  } finally {
    store.close();
  }
}

/** `squeal code <args>` in `root`: each stderr line, and whether the marker was there when it came. */
const gate = (root: string, args: readonly string[]) => toldBefore(root, args, MARKER);

const LINE = `squeal code: Vitest: 1 test file to run here, up to ${VITEST_WIDTH} at once: about 42 s from its stored duration`;

describe("squeal code --base: the estimate before the first run (spec 020 D17.1)", () => {
  it("gives the time from the stored duration, before any test runs", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(FILES);
    seed(root, 41.2);
    edit(root, { "src/math.ts": DOUBLED });

    const ran = await gate(root, ["--base", "main", "--json"]);

    expect(ran.code).toBe(0);
    expect(ran.before).toEqual(["squeal code: Vitest: 1 test file to run (tests 1)", LINE]);
    expect(ran.lines).toEqual(ran.before);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.runs.map((r) => r.estimate)).toEqual([
      { seconds: 42, files: 1, known: 1, width: VITEST_WIDTH },
    ]);
    expect(report.runs[0]?.completed).toEqual(["test/math.test.ts"]);
  });

  it(
    "gives the ways out and one rerun command whose --timeout fits, when the estimate is over what is left, and runs anyway",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES);
      seed(root, 41.2);
      edit(root, { "src/math.ts": DOUBLED });

      const ran = await gate(root, ["--base", "main", "--timeout", "40"]);

      expect(ran.code).toBe(0);
      expect(ran.before).toHaveLength(3);
      expect(ran.before[1]).toMatch(
        new RegExp(
          `^${LINE}, over the \\d+ s left of the budget\\. To fit it: a longer --timeout, paths that narrow the changed files, fewer check groups \\(gate\\.groups at the base, --group\\), or CI's results with --parts\\. The run starts anyway\\.$`,
        ),
      );
      // Rows 020-45: the call's own arguments with the seconds before the run plus twice the 42 s, up to a minute.
      const told =
        /^squeal code: about 42 s in all, over the (\d+) s left of the budget\. A rerun that fits: (\S+) code --base main --timeout (\d+)$/.exec(
          ran.before[2] ?? "",
        );
      expect(told).not.toBeNull();
      const [left, timeout] = [Number(told?.[1]), Number(told?.[3])];
      expect(timeout % 60).toBe(0);
      expect(timeout).toBeGreaterThanOrEqual(40 - left + 2 * 42);
      expect(timeout).toBeLessThan(40 - left + 2 * 42 + 60);
      expect(ran.stdout).toMatch(/^Code gate: pass\./);
      // The report names the same command.
      expect(ran.stdout).toContain(
        `A rerun that fits the estimate: ${told?.[2]} code --base main --timeout ${timeout}\n`,
      );
    },
  );

  it("gives the rerun in the JSON report's budget", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(FILES);
    seed(root, 41.2);
    edit(root, { "src/math.ts": DOUBLED });

    const ran = await gate(root, ["--base", "main", "--timeout", "40", "--json"]);

    expect(ran.code).toBe(0);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.budget.rerun?.command).toMatch(/ code --base main --timeout \d+ --json$/);
    expect(ran.before[2]).toContain(`A rerun that fits: ${report.budget.rerun?.command}`);
    expect(report.verdict).toBe("pass");
  });
});
