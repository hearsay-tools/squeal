import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Row 020-60 (#200, #214; the human, 2026-11-14: "Stored fail: Explain +
 * flag"): a failure the gate reads from the stores is reused, never rerun.
 * Stderr names it after the verdict, with the command that reruns it.
 * With `--rerun-stored-failures` it runs once more inside the budget: the
 * rerun's result is the file's and is kept at its key, a pass reads passed
 * and a second failure stays failed. A stored pass never reruns. The
 * fixtures pin the host's load quiet, so no rerun under load mixes in.
 */

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A test of `double` that counts its runs in `counter` and fails the first `failures` of them. */
const counted = (
  counter: string,
  failures: number,
) => `import { appendFileSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { double } from "../src/math";

it("doubles once warm", () => {
  appendFileSync(${JSON.stringify(counter)}, "ran\\n");
  const runs = readFileSync(${JSON.stringify(counter)}, "utf8").split("\\n").length - 1;
  if (runs <= ${failures}) throw new Error(\`run \${runs} fails\`);
  expect(double(3)).toBe(6);
});
`;

/** A repository whose `double` changed, `test/flaky.test.ts` failing its first `failures` runs; the first gate run. */
async function stored(failures: number) {
  ownHomeAndTmp();
  const scratch = mkdtempSync(join(tmpdir(), "squeal-gate-stored-rerun-"));
  temps.push(scratch);
  const counter = join(scratch, "runs");
  const root = repo({ ...BASE, "test/flaky.test.ts": counted(counter, failures) });
  edit(root, {
    "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
  });
  const first = await gate(root);
  expect(first.run?.from).toBeUndefined();
  expect(first.run?.failed.map((f) => f.path)).toEqual(["test/flaky.test.ts"]);
  const runs = () => readFileSync(counter, "utf8").split("\n").length - 1;
  return { root, runs };
}

/** The gate in `root` with `more` arguments, its JSON report and its Vitest run. */
async function gate(root: string, more: readonly string[] = []) {
  const ran = await code(root, ["--base", "main", "--json", ...more]);
  const report = JSON.parse(ran.stdout) as GateReport;
  const run = report.runs.find((r) => r.runner === "vitest");
  const lines = ran.stderr.split("\n").filter((line) => line.includes("failed test file"));
  return { ran, report, run, lines };
}

const STORED_LINE =
  "squeal code: 1 failed test file was read from the stores and did not run here (test/flaky.test.ts). To run it once more: squeal code --base main --json --rerun-stored-failures";

describe("squeal code --base: failures read from the stores (row 020-60)", () => {
  it(
    "names a stored failure and the command that reruns it, and reruns nothing",
    SLOW,
    async () => {
      const { root, runs } = await stored(1);
      const second = await gate(root);
      expect(runs()).toBe(1);
      expect(second.ran.code).toBe(3);
      expect(second.run?.from).toEqual({
        "test/flaky.test.ts": "store",
        "test/math.test.ts": "store",
      });
      expect(second.run?.failed.map((f) => f.path)).toEqual(["test/flaky.test.ts"]);
      expect(second.run).not.toHaveProperty("storedRerun");
      expect(second.lines).toEqual([STORED_LINE]);
      // The line comes after the verdict, so it follows the store's count line.
      expect(second.ran.stderr.indexOf(STORED_LINE)).toBeGreaterThan(
        second.ran.stderr.indexOf("2 of 2 selected test files read from the stores"),
      );
    },
  );

  it("with the flag, reruns it once: a pass reads passed and is kept", SLOW, async () => {
    const { root, runs } = await stored(1);
    const rerun = await gate(root, ["--rerun-stored-failures"]);
    expect(runs()).toBe(2);
    expect(rerun.ran.code).toBe(0);
    expect(rerun.report.verdict).toBe("pass");
    expect(rerun.run?.failed).toEqual([]);
    // A stored pass never reruns: math stays from the store.
    expect(rerun.run?.from).toEqual({ "test/flaky.test.ts": "run", "test/math.test.ts": "store" });
    expect(rerun.run?.storedRerun).toEqual({ "test/flaky.test.ts": { outcome: "passed" } });
    expect(rerun.lines).toEqual([
      "squeal code: 1 failed test file read from the stores ran once more (--rerun-stored-failures): 1 passed (test/flaky.test.ts).",
    ]);
    expect(rerun.ran.stderr).not.toContain("not kept");

    const next = await gate(root);
    expect(runs()).toBe(2);
    expect(next.run?.from).toEqual({ "test/flaky.test.ts": "store", "test/math.test.ts": "store" });
    expect(next.run?.failed).toEqual([]);
    expect(next.ran.code).toBe(0);
    expect(next.lines).toEqual([]);
  });

  it("with the flag, a second failure stays failed, and is kept", SLOW, async () => {
    const { root, runs } = await stored(9);
    const rerun = await gate(root, ["--rerun-stored-failures"]);
    expect(runs()).toBe(2);
    expect(rerun.ran.code).toBe(3);
    expect(rerun.report.verdict).toBe("incomplete");
    expect(rerun.run?.failed.map((f) => f.path)).toEqual(["test/flaky.test.ts"]);
    expect(rerun.run?.from?.["test/flaky.test.ts"]).toBe("run");
    expect(rerun.run?.storedRerun).toEqual({ "test/flaky.test.ts": { outcome: "failed" } });
    expect(rerun.lines).toEqual([
      "squeal code: 1 failed test file read from the stores ran once more (--rerun-stored-failures): 1 failed again (test/flaky.test.ts).",
    ]);

    const next = await gate(root);
    expect(runs()).toBe(2);
    expect(next.run?.from?.["test/flaky.test.ts"]).toBe("store");
    expect(next.lines).toEqual([STORED_LINE]);
  });
});
