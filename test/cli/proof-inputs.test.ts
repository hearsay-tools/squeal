import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 ("A: every changed
 * file"), `reviews/wave-14-fifth.md` and `wave-14-sixth.md`: when the named
 * test is unchanged, every other file changed between the commits must be
 * named with `--with` or `--source`, however the test reaches it (a
 * computed import, a file read, a folder listing, a config or a file it
 * imports, a declared input read in a child, with coverage off). Each case
 * stops before any run; each control with the file under `--with` reads
 * not red. The stop marks the files Squeal saw the test read, as help.
 */

const TEST = "test/a.test.ts";
const VALUE = "src/value.ts";
const lines = (...l: string[]) => [...l, ""].join("\n");
const short = (sha: string) => sha.slice(0, 9);

/** An unchanged test comparing `value` with `min`, got by `read`; `min` 3 at base, 1 at HEAD. */
function minFixture(c: Case) {
  const f = fixture({
    "squeal.config.json": "{}\n",
    [VALUE]: "export const value = 1;\n",
    ...c.files,
    [TEST]: lines(
      'import { it, expect } from "vitest";',
      'import { readFileSync, readdirSync } from "node:fs";',
      'import { execFileSync } from "node:child_process";',
      'import { value } from "../src/value";',
      'it("row", async () => {',
      ...c.read.map((line) => `  ${line}`),
      "  expect(value).toBeGreaterThanOrEqual(min);",
      "});",
    ),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [VALUE]: "export const value = 2;\n", ...c.head });
  return { f, base };
}

interface Case {
  readonly name: string;
  readonly input: string;
  readonly read: string[];
  readonly files: Record<string, string>;
  readonly head: Record<string, string>;
}

const config = (env: string) =>
  `export default { test: { include: ["test/*.test.ts"], env: { MIN: "${env}" } } };\n`;

const CASES: readonly Case[] = [
  {
    name: "a computed import (fifth look)",
    input: "support/data.ts",
    read: ['const name = "data";', 'const { min } = await import("../support/" + name + ".ts");'],
    files: { "support/data.ts": "export const min = 3;\n" },
    head: { "support/data.ts": "export const min = 1;\n" },
  },
  {
    name: "a file read (fifth look)",
    input: "support/min.txt",
    read: ['const min = Number(readFileSync("support/min.txt", "utf8"));'],
    files: { "support/min.txt": "3\n" },
    head: { "support/min.txt": "1\n" },
  },
  {
    name: "a Vitest config's test.env (fifth look)",
    input: "vitest.config.mjs",
    read: ["const min = Number(process.env.MIN);"],
    files: { "vitest.config.mjs": config("3") },
    head: { "vitest.config.mjs": config("1") },
  },
  {
    name: "a folder listing that gains a marker (sixth look 1)",
    input: "support/marker.txt",
    read: ['const min = readdirSync("support").includes("marker.txt") ? 1 : 3;'],
    files: { "support/keep.txt": "keep\n" },
    head: { "support/marker.txt": "marker\n" },
  },
  {
    name: "settings a config imports (sixth look 2)",
    input: "runner-settings.mjs",
    read: ["const min = Number(process.env.MIN);"],
    files: {
      "vitest.config.mjs":
        'import env from "./runner-settings.mjs";\nexport default { test: { include: ["test/*.test.ts"], env } };\n',
      "runner-settings.mjs": 'export default { MIN: "3" };\n',
    },
    head: { "runner-settings.mjs": 'export default { MIN: "1" };\n' },
  },
  {
    name: "a declared input read in a Python child (sixth look 2)",
    input: "support/min.txt",
    read: [
      "const code = 'from pathlib import Path; print(Path(\"support/min.txt\").read_text())';",
      'const min = Number(execFileSync("python3", ["-c", code], { encoding: "utf8" }));',
    ],
    files: {
      "squeal.config.json": `${JSON.stringify({ inputs: ["support/min.txt"] })}\n`,
      "support/min.txt": "3\n",
    },
    head: { "support/min.txt": "1\n" },
  },
];

describe("squeal proof: every changed file of an unchanged test (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it.each(CASES)(
    "stops before any run on $name; the control with --with reads not red",
    async (c) => {
      const { f, base } = minFixture(c);
      const result = await prove(f, { files: [TEST], base, source: [VALUE] });
      expect(result.code, result.why).toBe(3);
      expect(result.report.runs).toBe(0);
      expect(result.files[0]).toMatchObject({
        verdict: "not comparable",
        reason: `the test is unchanged since ${short(base)}; changed files not named: ${c.input}`,
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

  it("stops before any run with coverage off after a stored seed (sixth look 3); the control reads not red", async () => {
    const c = CASES[1] as Case;
    const f = fixture({
      "squeal.config.json": "{}\n",
      [VALUE]: "export const value = 1;\n",
      "support/min.txt": "3\n",
      "test/seed.test.ts": lines('import { it } from "vitest";', 'it("seed", () => {});'),
    });
    const seed = await prove(f, { files: ["test/seed.test.ts"], base: "HEAD", case: "source" });
    expect(seed.files[0]?.verdict, seed.why).toBe("not red");
    const base = f.commit({
      "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false } })}\n`,
      [TEST]: minFixtureTest(c.read),
    });
    f.commit({ [VALUE]: "export const value = 2;\n", ...c.head });
    const result = await prove(f, { files: [TEST], base, source: [VALUE] });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.files[0]).toMatchObject({
      changedImports: { unsettled: [c.input], stopped: true },
    });
    const control = await prove(f, { files: [TEST], base, with: [c.input], source: [VALUE] });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red" });
    clean(f);
  });

  it("needs an unrelated docs change named too, marks only the file the test reads, then proves", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
      [VALUE]: "export const value = 1;\n",
      "docs/notes.md": "old\n",
      [TEST]: lines(
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        'it("value", () => expect(value).toBe(2));',
      ),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [VALUE]: "export const value = 2;\n", "docs/notes.md": "new\n" });
    const stopped = await prove(f, { files: [TEST], base, json: false });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.out).toContain(
      `  changed files neither --with nor --source names: docs/notes.md, ${VALUE} (the test read it)\n`,
    );
    const half = await prove(f, { files: [TEST], base, source: [VALUE] });
    expect(half.code, half.why).toBe(3);
    expect(half.files[0]).toMatchObject({
      changedImports: { unsettled: ["docs/notes.md"], read: [] },
    });
    const proved = await prove(f, { files: [TEST], base, source: [VALUE, "docs/notes.md"] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    clean(f);
  });

  it("stops on a changed helper under test/ that no flag names; --with decides it", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
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
    expect(stopped.files[0]).toMatchObject({ changedImports: { unsettled: ["test/rows.ts"] } });
    const decided = await prove(f, { files: [TEST], base, with: ["test/rows.ts"] });
    expect(decided.code, decided.why).toBe(0);
    expect(decided.report.case).toBe("test");
    clean(f);
  });

  it("takes test/value.ts from each side's code version under --source, overriding the test-side copy", async () => {
    const f = fixture({
      "squeal.config.json": "{}\n",
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
    const proved = await prove(f, { files: [TEST], base, source: ["test/value.ts"] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.report.case).toBe("source");
    expect(proved.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    clean(f);
  });
});

/** The unchanged test of `minFixture`, alone. */
function minFixtureTest(read: readonly string[]): string {
  return lines(
    'import { it, expect } from "vitest";',
    'import { readFileSync } from "node:fs";',
    'import { value } from "../src/value";',
    'it("row", async () => {',
    ...read.map((line) => `  ${line}`),
    "  expect(value).toBeGreaterThanOrEqual(min);",
    "});",
  );
}
