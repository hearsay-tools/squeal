import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { BASE, code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Spec 020 D14 (row 020-15a): `squeal code --base` runs only the test files
 * of the check groups in scope, read at the merge base. A browser spec
 * loads the changed source through a helper, as in #172.
 */

const DOUBLED = "export function double(x: number): number {\n  return x + x;\n}\n";

/** BASE with a `browser` Vitest project, and `checks` with `browser` at `at` when given. */
function files(at: "edit" | "manual" | null): Record<string, string> {
  return {
    ...BASE,
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\n\nexport default defineConfig({\n  test: {\n    projects: [\n      { test: { name: "server", include: ["test/**/*.test.ts"] } },\n      { test: { name: "browser", include: ["e2e/**/*.test.ts"] } },\n    ],\n  },\n});\n`,
    "e2e/helper.ts": `import { double } from "../src/math";\n\nexport const four = () => double(2);\n`,
    "e2e/page.test.ts": `import { expect, it } from "vitest";\nimport { four } from "./helper";\n\nit("shows four", () => expect(four()).toBe(4));\n`,
    ...(at === null ? {} : { "squeal.config.json": policy(at) }),
  };
}

function policy(at: "edit" | "manual"): string {
  return `${JSON.stringify({ checks: [{ name: "browser", runner: "vitest", project: "browser", at }] })}\n`;
}

const completed = (report: GateReport) => report.runs.flatMap((r) => r.completed);

describe("squeal code --base: the scope by check group (spec 020 D14)", () => {
  it("runs a group a branch marks manual only at its head", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(files("edit"));
    edit(root, { "src/math.ts": DOUBLED, "squeal.config.json": policy("manual") });

    const ran = await code(root, ["--base", "main", "--json"]);

    expect(ran.code).toBe(0);
    const report = JSON.parse(ran.stdout) as GateReport;
    expect(completed(report)).toEqual(["e2e/page.test.ts", "test/math.test.ts"]);
    expect(report.scope).toEqual({
      groups: [
        { name: "browser", at: "edit", from: "default" },
        { name: "tests", at: "edit", from: "default" },
        { name: "slow", at: "edit", from: "default" },
      ],
      leftOut: [],
    });
    expect(report.functions[0]?.loaders).toEqual({
      expected: ["e2e/page.test.ts", "test/math.test.ts"],
      measured: ["e2e/page.test.ts", "test/math.test.ts"],
    });
  });

  it("leaves out a group manual at the base, says so, and --group runs it", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(files("manual"));
    edit(root, { "src/math.ts": DOUBLED });

    const text = await code(root, ["--base", "main"]);

    expect(text.code).toBe(0);
    expect(text.stdout.split("\n")[0]).toMatch(
      /: 1 pass\. browser \(manual\) did not run: 1 test file loads changed code; add --group browser to run it\.$/,
    );
    const left = JSON.parse((await code(root, ["--base", "main", "--json"])).stdout) as GateReport;
    expect(completed(left)).toEqual(["test/math.test.ts"]);
    expect(left.functions[0]).toMatchObject({
      state: "pass",
      loaders: { measured: ["test/math.test.ts"], leftOut: ["e2e/page.test.ts"] },
    });
    expect(left.scope?.leftOut).toEqual([
      { name: "browser", at: "manual", files: 1, selected: 1, add: "--group browser" },
    ]);

    const added = await code(root, ["--base", "main", "--group", "browser", "--json"]);

    expect(added.code).toBe(0);
    const report = JSON.parse(added.stdout) as GateReport;
    expect(completed(report)).toEqual(["e2e/page.test.ts", "test/math.test.ts"]);
    expect(report.scope?.groups[0]).toEqual({ name: "browser", at: "manual", from: "--group" });
  });

  it("refuses a --group no test group has at the base, before any run (exit 2)", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(files("manual"));
    edit(root, { "src/math.ts": DOUBLED });

    const ran = await code(root, ["--base", "main", "--group", "browserr"]);

    expect(ran.code).toBe(2);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toMatch(
      /^squeal code: --group browserr: no test group of that name at the merge base; its test groups are browser, tests, slow\n\nUsage: /,
    );
  });

  it("keeps a repository with no checks as before, apart from the new fields", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo();
    edit(root, { "src/math.ts": DOUBLED });

    const report = JSON.parse(
      (await code(root, ["--base", "main", "--json"])).stdout,
    ) as GateReport;

    expect(report.base.policy.gateGroups).toBeNull();
    expect(report.scope).toEqual({
      groups: [
        { name: "tests", at: "edit", from: "default" },
        { name: "slow", at: "edit", from: "default" },
      ],
      leftOut: [],
    });
    expect(report.functions.map((f) => [f.state, f.loaders])).toEqual([
      ["pass", { expected: ["test/math.test.ts"], measured: ["test/math.test.ts"] }],
    ]);
  });
});
