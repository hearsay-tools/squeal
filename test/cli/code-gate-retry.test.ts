import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import type { HostLoad } from "../../src/core/retry/load.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Row 020-54 (#210): the gate, as the CLI runs it, reruns once a selected
 * Vitest file that failed while the host's load was at or over its CPU
 * count. Only the daemon's reading of the load (`hostLoad`) is replaced
 * here; its threshold (`loadAllows`) is the real one. Over it, a test that
 * fails its first run only reads passed, exit 0, named in `runs[].retried`
 * and in one stderr line. Under it, the failure stands, as before. Row
 * 020-55: the rerun's result is kept at the file's key, so the next gate on
 * the same bytes reads it from the store; an input written during the rerun
 * bars that keep. The first failure is never kept
 * (`test/code/gate/keep-rerun.test.ts`).
 */

const load = vi.hoisted(() => ({ now: { oneMinute: 0, cpus: 24 } as HostLoad }));
vi.mock("../../src/core/retry/load.js", async (original) => ({
  ...(await original<typeof import("../../src/core/retry/load.js")>()),
  hostLoad: () => load.now,
}));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A test of `double` that fails until `marker` exists, which its first run writes. */
const flaky = (marker: string) => `import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { double } from "../src/math";

it("doubles once warm", () => {
  if (!existsSync(${JSON.stringify(marker)})) {
    writeFileSync(${JSON.stringify(marker)}, "");
    throw new Error("the first run fails");
  }
  expect(double(3)).toBe(6);
});
`;

/** As `flaky`, and its second run writes `src/math.ts` again with the bytes it holds, once. */
const flakyWrites = (
  marker: string,
) => `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { double } from "../src/math";

it("doubles once warm", () => {
  if (!existsSync(${JSON.stringify(marker)})) {
    writeFileSync(${JSON.stringify(marker)}, "");
    throw new Error("the first run fails");
  }
  if (!existsSync(${JSON.stringify(`${marker}-wrote`)})) {
    writeFileSync(${JSON.stringify(`${marker}-wrote`)}, "");
    const math = new URL("../src/math.ts", import.meta.url);
    writeFileSync(math, readFileSync(math));
  }
  expect(double(3)).toBe(6);
});
`;

/** The gate with the host's load read as `oneMinute` on 24 CPUs, `double` changed. */
async function gate(oneMinute: number, test = flaky) {
  ownHomeAndTmp();
  load.now = { oneMinute, cpus: 24 };
  const scratch = mkdtempSync(join(tmpdir(), "squeal-gate-retry-"));
  temps.push(scratch);
  const root = repo({ ...BASE, "test/flaky.test.ts": test(join(scratch, "ran-once")) });
  edit(root, {
    "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
  });
  return { root, ...(await again(root)) };
}

/** The gate once more in `root`, at the load set now. */
async function again(root: string) {
  // `null`: no pin, so the gate reads the daemon's own `hostLoad`, mocked above.
  const ran = await code(root, ["--base", "main", "--json"], { hostLoad: null });
  const report = JSON.parse(ran.stdout) as GateReport;
  const lines = ran.stderr.split("\n").filter((line) => line.includes("ran once more"));
  return { ran, report, lines, run: report.runs.find((r) => r.runner === "vitest") };
}

describe("squeal code --base: a failure under load runs once more (row 020-54)", () => {
  it("reads the rerun's pass at the threshold, and says so in one line", SLOW, async () => {
    const { ran, report, lines, run } = await gate(24);

    expect(ran.code).toBe(0);
    expect(report.verdict).toBe("pass");
    expect(run?.failed).toEqual([]);
    expect(run?.retried).toEqual({
      "test/flaky.test.ts": { load: 24, cpus: 24, outcome: "passed" },
    });
    expect(lines).toEqual([
      "squeal code: 1 test file failed while the host load was at or over its CPU count (24 on 24 CPUs) and ran once more: 1 passed (test/flaky.test.ts).",
    ]);
  });

  it("keeps the rerun's result: the next gate on the same bytes reads it", SLOW, async () => {
    const { root, run, ran } = await gate(24);
    expect(run?.retried?.["test/flaky.test.ts"]?.outcome).toBe("passed");
    expect(ran.stderr).not.toContain("not kept");

    load.now = { oneMinute: 3, cpus: 24 };
    const next = await again(root);
    // Row 020-55: the rerun's pass is at the file's key, so neither file runs here.
    expect(next.run?.from).toEqual({
      "test/flaky.test.ts": "store",
      "test/math.test.ts": "store",
    });
    expect(next.run?.failed).toEqual([]);
    expect(next.run?.retried).toBeUndefined();
    expect(next.report.verdict).toBe("pass");
    expect(next.ran.code).toBe(0);
  });

  it("does not keep the rerun's result when an input was written during it", SLOW, async () => {
    const { root, run, ran } = await gate(24, flakyWrites);
    expect(run?.retried?.["test/flaky.test.ts"]?.outcome).toBe("passed");
    expect(ran.stderr).toMatch(
      /^squeal code: 1 completed test file was not kept in the stores, because .+ \(src\/math\.ts\): test\/flaky\.test\.ts; the next run will run it again$/m,
    );

    load.now = { oneMinute: 3, cpus: 24 };
    const next = await again(root);
    expect(next.run?.from?.["test/flaky.test.ts"]).toBe("run");
    expect(next.ran.code).toBe(0);
  });

  it("keeps the failure under the threshold, with no rerun and no line", SLOW, async () => {
    const { ran, report, lines, run } = await gate(23.99);

    expect(ran.code).toBe(3);
    expect(report.verdict).toBe("incomplete");
    expect(run?.failed).toEqual([{ path: "test/flaky.test.ts", tests: ["doubles once warm"] }]);
    expect(run?.retried).toBeUndefined();
    expect(lines).toEqual([]);
  });
});
