import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D1 (row 020-05): `squeal code --base <ref>` end to end, in a
 * temporary git repository with no daemon: the changed functions against
 * the merge base, measured by a one-shot Vitest run, and one verdict as the
 * exit code: 0 pass, 1 violations, 3 incomplete, 2 usage or setup error.
 */

describe("squeal code --base: pass (spec 020 D1, exit 0)", () => {
  it("exits 0 when the one changed function passes, and --json is the report", SLOW, async () => {
    const leftInTmp = ownHomeAndTmp();
    const root = repo();
    edit(root, {
      "src/math.ts": "export function double(x: number): number {\n  return x + x;\n}\n",
    });

    const ran = await code(root, ["--base", "main", "--json"]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(report.format).toBe("squeal-code-gate/1");
    expect(report.verdict).toBe("pass");
    expect(report.base.ref).toBe("main");
    expect(report.head.dirty).toBe(true);
    expect(report.functions.map((f) => [f.path, f.qualifiedName, f.state, f.crap])).toEqual([
      ["src/math.ts", "double", "pass", 1],
    ]);
    expect(report.functions[0]?.loaders.measured).toEqual(["test/math.test.ts"]);
    expect(report.runs.map((r) => [r.runner, r.completed])).toEqual([
      ["vitest", ["test/math.test.ts"]],
    ]);
    expect(report.runs[0]?.durationMs).toBeGreaterThan(0);
    expect(leftInTmp()).toEqual([]);
  });
});
