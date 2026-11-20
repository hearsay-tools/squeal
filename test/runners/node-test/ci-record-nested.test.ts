import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, readPart } from "../../../src/core/ci/parts.js";
import { ci, cloneOf, committed, scratch, VITEST } from "../../ci/fixture.js";
import { reporterPair } from "./ci-record-kit.js";

/*
 * Spec 018 D24, D26, row 018-54 (cezar merge-group run 44805319389): a run
 * that a test starts is a test's own, not the project's, as row 018-27 has
 * it for Vitest inside Vitest. One recorded command runs the project's
 * Vitest, then its `node --test`. A node:test test starts `vitest run`
 * without `CI`, so with snapshot update "new", as cezar's script tests do.
 * A Vitest test starts `node --test` twice, with Squeal's reporter pair and
 * without it. Only the project's two runs write a part, no "names no Squeal
 * reporter" line is said, and the export keeps both runners' files.
 */

const SLOW = { timeout: 300_000 } as const;

function fixture(): string {
  const [reporter, destination] = reporterPair();
  const withoutCi = `const { CI: _ci, GITHUB_ACTIONS: _gh, ...env } = process.env;`;
  return committed(scratch("ci-node-test-nested"), {
    "package.json": JSON.stringify({ name: "ci-nested-node-test", private: true, type: "module" }),
    "squeal.config.json": '{"nodeTest":[{"name":"unit","include":["node/*.test.mjs"]}]}\n',
    "vitest.config.ts": `export default { test: { include: ["vt/**/*.test.ts"] } };\n`,
    "lib/a.mjs": "export const a = 1;\n",
    "vt/plain.test.ts": `import { expect, it } from "vitest";\nimport { a } from "../lib/a.mjs";\nit("a", () => expect(a).toBe(1));\n`,
    "vt/starts-node-test.test.ts": `import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const run = (args) => spawnSync(process.execPath, ["--test", ...args, "inner/inner.test.mjs"], { encoding: "utf8" });
it("starts node --test with Squeal's reporter", () => {
  const { status, stderr } = run([${JSON.stringify(reporter)}, ${JSON.stringify(destination)}]);
  expect(status, stderr).toBe(0);
});
it("starts node --test without it", () => {
  const { status, stderr } = run([]);
  expect(status, stderr).toBe(0);
});
`,
    "inner/inner.test.mjs": `import { test } from "node:test";\ntest("inner", () => {});\n`,
    "node/plain.test.mjs": `import { test } from "node:test";\nimport { a } from "../lib/a.mjs";\ntest("a", () => { if (a !== 1) throw new Error("a"); });\n`,
    "node/starts-vitest.test.mjs": `import { spawnSync } from "node:child_process";
import { test } from "node:test";
${withoutCi}
test("starts vitest run with snapshot update new", () => {
  const { status, stdout } = spawnSync(process.execPath, [${JSON.stringify(VITEST)}, "run", "vt/plain.test.ts"], { env, encoding: "utf8" });
  if (status !== 0) throw new Error(stdout);
});
`,
  });
}

function partsIn(out: string): Part[] {
  return readdirSync(out)
    .sort()
    .map((name) => {
      const part = readPart(join(out, name));
      if (typeof part === "string") throw new Error(part);
      return part;
    });
}

describe("squeal ci record beside runs that tests start across runners (row 018-54)", () => {
  it("writes the project's two parts only, and exports both runners' files", SLOW, async () => {
    const origin = fixture();
    const out = join(dirname(origin), "parts");
    const { NODE_OPTIONS: _, ...rest } = process.env;
    const env = { ...rest, CI: "true" };
    const command = [
      "sh",
      "-c",
      `"$0" ${JSON.stringify(VITEST)} run && "$0" --test ${reporterPair()
        .map((arg) => `'${arg}'`)
        .join(" ")} node/plain.test.mjs node/starts-vitest.test.mjs`,
      process.execPath,
    ];
    const recorded = await ci(["record", "--out", out, "--", ...command], origin, env);
    expect(recorded.code, recorded.said).toBe(0);
    expect(recorded.said).not.toContain("names no Squeal reporter");

    const parts = partsIn(out);
    expect(
      parts.map((p) => [p.header.runner, p.testFiles.map((f) => f.path)]),
      recorded.said,
    ).toEqual(
      expect.arrayContaining([
        ["vitest", ["vt/plain.test.ts", "vt/starts-node-test.test.ts"]],
        ["node-test", ["node/plain.test.mjs", "node/starts-vitest.test.mjs"]],
      ]),
    );
    expect(parts).toHaveLength(2);

    const root = cloneOf(origin, "export");
    const file = join(dirname(origin), "results.json.gz");
    const exported = await ci(["export", "--parts", out, "--out", file], root, env);
    expect(exported.code, exported.said).toBe(0);
    expect(exported.said).not.toContain("left out");
    // Both runners' files, the tests that started the nested runs too.
    expect(exported.said).toContain("Exported 4 test files, 9 results");
  });
});
