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
 * and in one stderr line. Under it, the failure stands, as before. Neither
 * run of a retried file is kept (the coordinator, request 27108c13, "A"),
 * so the next gate on the same bytes runs it again.
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

/** The gate with the host's load read as `oneMinute` on 24 CPUs, `double` changed. */
async function gate(oneMinute: number) {
  ownHomeAndTmp();
  load.now = { oneMinute, cpus: 24 };
  const scratch = mkdtempSync(join(tmpdir(), "squeal-gate-retry-"));
  temps.push(scratch);
  const root = repo({ ...BASE, "test/flaky.test.ts": flaky(join(scratch, "ran-once")) });
  edit(root, {
    "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
  });
  return { root, ...(await again(root)) };
}

/** The gate once more in `root`, at the load set now. */
async function again(root: string) {
  const ran = await code(root, ["--base", "main", "--json"]);
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

  it(
    "keeps neither run of the retried file: the next gate on the same bytes runs it",
    SLOW,
    async () => {
      const { root, run } = await gate(24);
      expect(run?.retried?.["test/flaky.test.ts"]?.outcome).toBe("passed");

      load.now = { oneMinute: 3, cpus: 24 };
      const next = await again(root);
      // The other file was kept and is read; the retried one is in no store, so it runs here.
      expect(next.run?.from).toEqual({
        "test/flaky.test.ts": "run",
        "test/math.test.ts": "store",
      });
      expect(next.run?.retried).toBeUndefined();
      expect(next.ran.code).toBe(0);
    },
  );

  it("keeps the failure under the threshold, with no rerun and no line", SLOW, async () => {
    const { ran, report, lines, run } = await gate(23.99);

    expect(ran.code).toBe(3);
    expect(report.verdict).toBe("incomplete");
    expect(run?.failed).toEqual([{ path: "test/flaky.test.ts", tests: ["doubles once warm"] }]);
    expect(run?.retried).toBeUndefined();
    expect(lines).toEqual([]);
  });
});
