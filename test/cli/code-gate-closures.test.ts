import { describe, expect, it } from "vitest";
import type { GateReport } from "../../src/core/code/gate/report.js";
import { code, edit, ownHomeAndTmp, repo, SLOW } from "./code-gate-fixture.js";

/*
 * Row 020-31 (#193; spec 020 D7, D14.4): `squeal code --base` tells each
 * node:test project's files with an incomplete static closure once, after
 * its selection, scoped to it, and lists every one in the report; the
 * module-hook note names the top-level `inputs` key. Two projects share a
 * preload whose helper imports `node:module`.
 */

const PRELOAD = ["--import", "./scripts/preload.mjs"];
const HEAD = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';
/** A test file that loads `src/extra.mjs` through a computed `import()`, and `src/math.mjs` when `math`. */
const gapTest = (math: boolean) =>
  `${HEAD}${math ? 'import { double } from "../../src/math.mjs";\n' : ""}const name = ["..", "..", "src", "extra.mjs"].join("/");\n\ntest("loads extra", async () => {\n  const { one } = await import(name);\n  assert.equal(${math ? "double(one)" : "one + one"}, 2);\n});\n`;

/**
 * `unit`: four gap files load `src/math.mjs`, one does not, and a plain
 * file loads it statically; `api`: one gap file.
 */
const FILES: Readonly<Record<string, string>> = {
  "package.json": `${JSON.stringify({ name: "gate-closures", private: true, type: "module" })}\n`,
  "squeal.config.json": `${JSON.stringify({
    nodeTest: [
      { name: "unit", argv: PRELOAD, include: ["test/unit/*.test.mjs"] },
      { name: "api", argv: PRELOAD, include: ["test/api/*.test.mjs"] },
    ],
  })}\n`,
  "scripts/preload.mjs": 'import "./hooks-helper.mjs";\n',
  "scripts/hooks-helper.mjs":
    'import { createRequire } from "node:module";\n\nexport const req = createRequire(import.meta.url);\n',
  "scripts/ci.mjs": "export const step = 1;\n",
  "src/math.mjs": "export function double(n) {\n  return n * 2;\n}\n",
  "src/extra.mjs": "export const one = 1;\n\nexport function pick(n) {\n  return n;\n}\n",
  "test/unit/a.test.mjs": gapTest(true),
  "test/unit/b.test.mjs": gapTest(true),
  "test/unit/c.test.mjs": gapTest(true),
  "test/unit/d.test.mjs": gapTest(true),
  "test/unit/e.test.mjs": gapTest(false),
  "test/api/z.test.mjs": gapTest(false),
  "test/unit/plain.test.mjs": `${HEAD}import { double } from "../../src/math.mjs";\n\ntest("doubles", () => assert.equal(double(2), 4));\n`,
};

const MATH = { "src/math.mjs": "export function double(n) {\n  return n + n;\n}\n" };
/** A change no test file loads, with no function: nothing is selected. */
const CI = { "scripts/ci.mjs": "export const step = 2;\n" };

const hooksNote = (project: string) =>
  `squeal code: node-test project "${project}": preload "scripts/preload.mjs" imports node:module through "scripts/hooks-helper.mjs" and may register module hooks; Squeal does not record in Node's loader thread, so what the hooks load enters no key; declare it in the top-level "inputs" of squeal.config.json (a list of globs for every test file, or a map from a test-file glob to globs); resolving with Node's own rules`;

const OTHERS = (n: number) =>
  `The gate selects test files by their static imports, so ${n === 1 ? "the other one does" : `the other ${n} do`} not run for a changed path ${n === 1 ? "it loads" : "they load"} only through a computed import() or require().`;
const API_LINE = `squeal code: node-test project "api": 0 of 1 test file with an incomplete static closure are in this check. ${OTHERS(1)} The --json report lists it in incompleteClosures.`;

const unitFile = (name: string, selected: boolean, line = selected ? 7 : 6) => ({
  path: `test/unit/${name}.test.mjs`,
  reasons: [`import() with a computed specifier at test/unit/${name}.test.mjs:${line}:25`],
  selected,
});
const API_GAPS = {
  runner: "node-test",
  project: "api",
  files: [
    {
      path: "test/api/z.test.mjs",
      reasons: ["import() with a computed specifier at test/api/z.test.mjs:6:25"],
      selected: false,
    },
  ],
};

/** `unit`'s gap files when `src/math.mjs` changes: the four that import it are selected. */
const UNIT_GAPS = {
  runner: "node-test",
  project: "unit",
  files: [
    unitFile("a", true),
    unitFile("b", true),
    unitFile("c", true),
    unitFile("d", true),
    unitFile("e", false),
  ],
};
const UNIT_LINE = `squeal code: node-test project "unit": 4 of 5 test files with an incomplete static closure are in this check: test/unit/a.test.mjs, test/unit/b.test.mjs, test/unit/c.test.mjs and 1 more. ${OTHERS(1)} The --json report lists all 5 in incompleteClosures.`;
const SELECTED = [
  "test/unit/a.test.mjs",
  "test/unit/b.test.mjs",
  "test/unit/c.test.mjs",
  "test/unit/d.test.mjs",
  "test/unit/plain.test.mjs",
];

const lines = (stderr: string) => stderr.split("\n").filter((line) => line !== "");
/** How many stderr lines hold `text`. */
const count = (stderr: string, text: string) =>
  lines(stderr).filter((line) => line.includes(text)).length;

/** The module-hook note of each project, once each, and one closure line per project. */
function onceEach(stderr: string): void {
  const told = lines(stderr);
  expect(told).toContain(hooksNote("unit"));
  expect(told).toContain(hooksNote("api"));
  expect(count(stderr, "may register module hooks")).toBe(2);
  // The adapter's own closure note, written at open, is not among them.
  expect(count(stderr, "incomplete static closure")).toBe(2);
}

describe("squeal code --base: incomplete closures, scoped to the check (#193, row 020-31)", () => {
  it(
    "tells each project once after its selection and lists every file in --json",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = repo(FILES);
      edit(root, MATH);

      const ran = await code(root, ["--base", "main", "--json"]);

      // stdout holds the report alone; the verdict is the change's own.
      const report = JSON.parse(ran.stdout) as GateReport;
      expect([ran.code, report.verdict]).toEqual([0, "pass"]);
      expect(report.runs).toEqual([
        expect.objectContaining({ runner: "node-test", selected: SELECTED }),
      ]);
      expect(report.incompleteClosures).toEqual([API_GAPS, UNIT_GAPS]);
      onceEach(ran.stderr);
      // Right after the selection line, by project.
      const told = lines(ran.stderr);
      const selection = told.indexOf("squeal code: node:test: 5 test files to run (tests 5)");
      expect(selection).toBeGreaterThanOrEqual(0);
      expect(told.slice(selection + 1, selection + 3)).toEqual([API_LINE, UNIT_LINE]);
    },
  );

  it("says 0 of 5 for a change no test loads, and the verdict reads as before", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(FILES);
    edit(root, CI);

    const plain = await code(root, ["--base", "main"]);

    expect(plain.code).toBe(0);
    expect(plain.stdout).toMatch(/^Code gate: pass\./m);
    const none = `squeal code: node-test project "unit": 0 of 5 test files with an incomplete static closure are in this check. ${OTHERS(5)} The --json report lists all 5 in incompleteClosures.`;
    expect(lines(plain.stderr)).toEqual(expect.arrayContaining([API_LINE, none]));
    onceEach(plain.stderr);

    // Research Q5: a changed function only a computed import loads selects nothing: incomplete.
    const picked = "export const one = 1;\n\nexport function pick(n) {\n  return n + 0;\n}\n";
    edit(root, { "src/extra.mjs": picked });
    const json = await code(root, ["--base", "main", "--json"]);

    const report = JSON.parse(json.stdout) as GateReport;
    expect([json.code, report.verdict]).toEqual([3, "incomplete"]);
    expect(report.incompleteClosures?.flatMap((g) => g.files.filter((f) => f.selected))).toEqual(
      [],
    );
    expect(lines(json.stderr)).toEqual(expect.arrayContaining([API_LINE, none]));
    onceEach(json.stderr);
  });

  it("tells the same once on a second run, which reads a file from the stores", SLOW, async () => {
    ownHomeAndTmp();
    const root = repo(FILES);
    edit(root, MATH);
    await code(root, ["--base", "main", "--json"]);

    const again = await code(root, ["--base", "main", "--json"]);

    const report = JSON.parse(again.stdout) as GateReport;
    expect([again.code, report.verdict]).toEqual([0, "pass"]);
    // A file whose run loads what its key lacks runs again; the plain one is kept.
    expect(report.runs[0]?.from?.["test/unit/plain.test.mjs"]).toBe("store");
    expect(report.incompleteClosures).toEqual([API_GAPS, UNIT_GAPS]);
    expect(lines(again.stderr)).toEqual(expect.arrayContaining([API_LINE, UNIT_LINE]));
    onceEach(again.stderr);
  });
});
