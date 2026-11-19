import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 ("A: stop guessing"),
 * `reviews/wave-14-fifth.md`: 1, a changed file under `test/` stops an
 * unchanged named test like any other, and `--source` overrides the
 * test-side copy; 2, inputs the keyed closure misses (a computed import, a
 * file read, a runner config) are checked after the runs: a changed one
 * the call did not name makes the file not comparable, never `proven`.
 */

const TEST = "test/a.test.ts";
const VALUE = "src/value.ts";
const ON = { "squeal.config.json": "{}\n" };
const lines = (...l: string[]) => [...l, ""].join("\n");
const short = (sha: string) => sha.slice(0, 9);

/** An unchanged test comparing `value` with `min`, read by `read`; `min` 3 at base, 1 at HEAD. */
function minFixture(read: string[], files: Record<string, string>, head: Record<string, string>) {
  const f = fixture({
    ...ON,
    [VALUE]: "export const value = 1;\n",
    ...files,
    [TEST]: lines(
      'import { it, expect } from "vitest";',
      'import { readFileSync } from "node:fs";',
      'import { value } from "../src/value";',
      'it("row", async () => {',
      ...read.map((line) => `  ${line}`),
      "  expect(value).toBeGreaterThanOrEqual(min);",
      "});",
    ),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [VALUE]: "export const value = 2;\n", ...head });
  return { f, base };
}

const CASES = [
  {
    name: "a computed import of support/data.ts",
    input: "support/data.ts",
    read: ['const name = "data";', 'const { min } = await import("../support/" + name + ".ts");'],
    files: { "support/data.ts": "export const min = 3;\n" },
    head: { "support/data.ts": "export const min = 1;\n" },
  },
  {
    name: "a file read of support/min.txt",
    input: "support/min.txt",
    read: ['const min = Number(readFileSync("support/min.txt", "utf8"));'],
    files: { "support/min.txt": "3\n" },
    head: { "support/min.txt": "1\n" },
  },
  {
    name: "a Vitest config's test.env",
    input: "vitest.config.mjs",
    read: ["const min = Number(process.env.MIN);"],
    files: {
      "vitest.config.mjs":
        'export default { test: { include: ["test/*.test.ts"], env: { MIN: "3" } } };\n',
    },
    head: {
      "vitest.config.mjs":
        'export default { test: { include: ["test/*.test.ts"], env: { MIN: "1" } } };\n',
    },
  },
];

describe("squeal proof: changed inputs of an unchanged test (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it.each(CASES)(
    "reads not comparable after the runs over $name the call did not name; the control reads not red",
    async (c) => {
      const { f, base } = minFixture(c.read, c.files, c.head);
      const result = await prove(f, { files: [TEST], base, source: [VALUE] });
      expect(result.code, result.why).toBe(3);
      expect(result.files[0]).toMatchObject({
        verdict: "not comparable",
        reason: `changed input ${c.input} was not named`,
        changedImports: { unsettled: [c.input], sources: [VALUE], stopped: true },
      });
      expect(result.report.withRerun).toBe(
        `squeal proof ${TEST} --base ${base} --with ${c.input} --source ${VALUE}`,
      );
      expect(result.report.sourceRerun).toBe(
        `squeal proof ${TEST} --base ${base} --source ${VALUE} --source ${c.input}`,
      );
      const control = await prove(f, { files: [TEST], base, with: [c.input], source: [VALUE] });
      expect(control.code, control.why).toBe(1);
      expect(control.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
      clean(f);
    },
  );

  it("stops on a changed helper under test/ that no flag names; --with decides it", async () => {
    const f = fixture({
      ...ON,
      [TEST]: lines('import { runRows } from "./rows";', "runRows();"),
      "test/rows.ts": lines(
        'import { it, expect } from "vitest";',
        'export const runRows = () => it("row", () => expect(1).toBe(3));',
      ),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "test/rows.ts": lines(
        'import { it, expect } from "vitest";',
        'export const runRows = () => it("row", () => expect(1).toBe(1));',
      ),
    });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.report.runs).toBe(0);
    expect(stopped.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `the test is unchanged since ${short(base)}; changed imports: test/rows.ts`,
    });
    // With --with, only test code changed: the test case, base's helper over HEAD's code.
    const decided = await prove(f, { files: [TEST], base, with: ["test/rows.ts"] });
    expect(decided.code, decided.why).toBe(0);
    expect(decided.report.case).toBe("test");
    clean(f);
  });

  it("takes test/value.ts from each side's code version under --source, overriding the test-side copy", async () => {
    const f = fixture({
      ...ON,
      [TEST]: lines(
        'import { it, expect } from "vitest";',
        'import { value } from "./value";',
        'it("value", () => expect(value).toBe(2));',
      ),
      "test/value.ts": "export const value = 1;\n",
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "test/value.ts": "export const value = 2;\n" });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]).toMatchObject({ changedImports: { unsettled: ["test/value.ts"] } });
    const proved = await prove(f, { files: [TEST], base, source: ["test/value.ts"] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.report.case).toBe("source");
    expect(proved.report.sourceUnused).toEqual([]);
    expect(proved.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    expect(proved.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    clean(f);
  });
});
