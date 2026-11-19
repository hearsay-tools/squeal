import { describe, expect, it } from "vitest";
import { importsOf } from "../../src/cli/proof-imports.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247, "A: explain
 * + --with"; then "A: stop when unsure" after `reviews/wave-14-rereview.md`
 * B1): an unchanged named test whose changed imports Squeal cannot show to
 * be product code (imported by a project file that is not test code)
 * runs nothing, exit 3, with a `--with` and a `--source` rerun. The
 * reviews' reproductions (a helper importing vitest, through a local
 * barrel, a data-only helper) stop; each `--with` control reads not red.
 */

const TEST = "test/a.test.ts";
const ROWS = "support/rows.ts";
const MORE = "support/more.ts";
const MAIN = { "src/main.ts": 'import { value } from "./value";\nexport const main = value;\n' };

const ON = {
  "squeal.config.json": "{}\n",
  [TEST]: 'import { runRows } from "../support/rows";\nrunRows();\n',
};

/** A helper that imports `it` and `expect` from `api` and `value`, with `rows` inside `runRows`. */
const helper = (api: string, ...rows: string[]) =>
  [
    `import { it, expect } from "${api}";`,
    'import { value } from "../src/value";',
    ...rows.filter((row) => row.startsWith("import")),
    "export function runRows() {",
    ...rows.filter((row) => !row.startsWith("import")).map((row) => `  ${row}`),
    "}",
    "",
  ].join("\n");

const EXISTING = "it('existing row', () => expect(value).toBeGreaterThanOrEqual(1));";
const short = (sha: string) => sha.slice(0, 9);

/** The review's fixture: base's helper fails on both sources, HEAD's passes on both. */
function rowsFixture(api: string, more: Record<string, string> = {}) {
  const f = fixture({
    ...ON,
    ...MAIN,
    ...more,
    "src/value.ts": "export const value = 1;\n",
    [ROWS]: helper(api, "it('row', () => expect(value).toBe(3));"),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  const head = f.commit({
    "src/value.ts": "export const value = 2;\n",
    [ROWS]: helper(api, "it('row', () => expect(value).toBeGreaterThanOrEqual(1));"),
  });
  return { f, base, head };
}

describe("squeal proof: an unchanged test's changed imports (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it("B1: stops on a changed helper that imports vitest; its --with control reads not red", async () => {
    const { f, base, head } = rowsFixture("vitest");
    const result = await prove(f, { files: [TEST], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.report.checkoutMs.red).toBeNull();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: TEST,
      verdict: "not comparable",
      reason: `the test is unchanged since ${short(base)}; changed imports: ${ROWS}`,
      red: { end: "unknown", runs: 0 },
      changedImports: {
        unsettled: [{ path: ROWS, testCode: true, why: `imports vitest at ${short(head)}` }],
        sources: [{ path: "src/value.ts", why: "imported by src/main.ts" }],
        stopped: true,
      },
    });
    expect(result.report.withRerun).toBe(`squeal proof ${TEST} --base ${base} --with ${ROWS}`);
    expect(result.report.sourceRerun).toBeNull();
    const text = await prove(f, { files: [TEST], base, json: false });
    expect(text.out).toContain(
      `  not settled: ${ROWS} (test code: imports vitest at ${short(head)})\n`,
    );
    expect(text.out).toContain(
      "  product code the proof compares: src/value.ts (imported by src/main.ts)\n",
    );
    expect(text.out).toContain(
      `If the changed imports are test code, rerun: squeal proof ${TEST} --base ${base} --with ${ROWS}\n`,
    );
    const control = await prove(f, { files: [TEST], base, with: [ROWS] });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    clean(f);
  });

  it("re-review B1: stops on a helper that takes vitest through an unchanged local barrel", async () => {
    const api = { "support/api.ts": 'export { it, expect } from "vitest";\n' };
    const { f, base, head } = rowsFixture("./api", api);
    const result = await prove(f, { files: [TEST], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      changedImports: {
        unsettled: [
          {
            path: ROWS,
            testCode: true,
            why: `imports vitest through support/api.ts at ${short(head)}`,
          },
        ],
        stopped: true,
      },
    });
    const control = await prove(f, { files: [TEST], base, with: [ROWS] });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red" });
    clean(f);
  });

  it("re-review B1: stops on a changed data-only helper; --with reads not red, --source compares it", async () => {
    const f = fixture({
      ...ON,
      ...MAIN,
      [TEST]: [
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        'import { min } from "../support/data";',
        "it('row', () => expect(value).toBeGreaterThanOrEqual(min));",
        "",
      ].join("\n"),
      "src/value.ts": "export const value = 1;\n",
      "support/data.ts": "export const min = 3;\n",
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/value.ts": "export const value = 2;\n",
      "support/data.ts": "export const min = 1;\n",
    });
    const result = await prove(f, { files: [TEST], base, json: false });
    expect(result.code, result.why).toBe(3);
    expect(result.out).toContain(
      "  not settled: support/data.ts (could not tell whether it is test or product code: no project file that is not test code imports it)\n",
    );
    expect(result.out).toContain(
      `If the changed imports are test code, rerun: squeal proof ${TEST} --base ${base} --with support/data.ts\n`,
    );
    expect(result.out).toContain(
      `If the ones not shown to be test code are product code, rerun: squeal proof ${TEST} --base ${base} --source support/data.ts\n`,
    );
    const control = await prove(f, { files: [TEST], base, with: ["support/data.ts"] });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red" });
    clean(f);
  });

  it("proves an unchanged test over src/value.ts that src/main.ts imports, with no flag", async () => {
    const f = fixture({
      ...ON,
      ...MAIN,
      "src/value.ts": "export const value = 1;\n",
      [TEST]: [
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        "it('value', () => expect(value).toBe(2));",
        "",
      ].join("\n"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/value.ts": "export const value = 2;\n" });
    const result = await prove(f, { files: [TEST], base, json: false });
    expect(result.code, result.why).toBe(0);
    expect(result.out).toContain(`${TEST}: proven\n`);
    expect(result.out).toContain(
      `  the test is unchanged since ${short(base)}; product code the proof compares: src/value.ts (imported by src/main.ts)\n`,
    );
    expect(result.out).not.toContain("rerun:");
    clean(f);
  });

  it("stops over src/value.ts only tests import, and proves with --source src/value.ts", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 1;\n",
      [TEST]: [
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        "it('value', () => expect(value).toBe(2));",
        "",
      ].join("\n"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/value.ts": "export const value = 2;\n" });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]).toMatchObject({
      changedImports: { unsettled: [{ path: "src/value.ts", testCode: false }], stopped: true },
    });
    expect(stopped.report.sourceRerun).toBe(
      `squeal proof ${TEST} --base ${base} --source src/value.ts`,
    );
    const proved = await prove(f, { files: [TEST], base, source: ["src/value.ts"] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.files[0]).toMatchObject({
      verdict: "proven",
      changedImports: { sources: [{ path: "src/value.ts", why: "--source" }], stopped: false },
    });
    expect(proved.report.red).toMatchObject({ code: base, source: ["src/value.ts"], with: [] });
    expect(proved.report.green.source).toEqual(["src/value.ts"]);
    clean(f);
  });

  it("refuses one path in --with and --source, and a --with path outside the worktree", async () => {
    const f = fixture({ ...ON, "src/value.ts": "export const value = 1;\n" });
    const both = await prove(f, {
      files: [TEST],
      base: "HEAD",
      with: ["src/value.ts"],
      source: ["./src/value.ts"],
    });
    expect(both.code).toBe(2);
    expect(both.err).toContain(
      "src/value.ts is given with --with and --source: it is test code or product code, not both",
    );
    const outside = await prove(f, { files: [TEST], base: "HEAD", with: ["../elsewhere.ts"] });
    expect(outside.code).toBe(2);
    expect(outside.err).toContain("--with ../elsewhere.ts names no file inside");
    clean(f);
  });

  it("stops on a transitive, newly added helper, proves with --with on both, and reuses the store", async () => {
    const f = fixture({
      ...ON,
      ...MAIN,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: helper("vitest", EXISTING),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    const head = f.commit({
      "src/value.ts": "export const value = 2;\n",
      [MORE]: [
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        "export function moreRows() {",
        "  it('new row catches the bug', () => expect(value).toBe(2));",
        "}",
        "",
      ].join("\n"),
      [ROWS]: helper("vitest", 'import { moreRows } from "./more";', EXISTING, "moreRows();"),
    });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    const why = `imports vitest at ${short(head)}`;
    expect(stopped.files[0]).toMatchObject({
      changedImports: {
        unsettled: [
          { path: MORE, testCode: true, why },
          { path: ROWS, testCode: true, why },
        ],
      },
    });
    expect(stopped.report.withRerun).toBe(
      `squeal proof ${TEST} --base ${base} --with ${MORE} --with ${ROWS}`,
    );
    const args = { files: [TEST], base, with: [ROWS, MORE] };
    const first = await prove(f, args);
    expect(first.code, first.why).toBe(0);
    expect(first.report.case).toBe("source");
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true },
      green: { end: "pass" },
    });
    expect(first.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    expect(first.report.red).toMatchObject({ tests: head, code: base, with: [ROWS, MORE] });
    const second = await prove(f, args);
    expect(second.code, second.why).toBe(0);
    expect(second.report.runs).toBe(0);
    clean(f);
  });

  it("gives each named file its verdict, and warns for --with and --source paths that change nothing", async () => {
    const { f, base } = rowsFixture("vitest", { "support/unused.ts": "export const u = 1;\n" });
    const direct = "test/direct.test.ts";
    const head = f.commit({
      [direct]: [
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        "it('direct', () => expect(value).toBe(2));",
        "",
      ].join("\n"),
    });
    const result = await prove(f, {
      files: [TEST, direct],
      base,
      with: ["support/unused.ts"],
      source: ["src/main.ts"],
      json: false,
    });
    expect(result.code, result.why).toBe(3);
    expect(result.out).toContain(`${TEST}: not comparable`);
    expect(result.out).toContain(`${direct}: proven\n`);
    expect(result.out).toContain(
      `Warning: --with support/unused.ts: no named test imports it at ${short(head)}.\n`,
    );
    expect(result.out).toContain(
      "Warning: --source src/main.ts: not a changed import of an unchanged named test; it settles nothing.\n",
    );
    expect(result.out).toContain(
      `If the changed imports are test code, rerun: squeal proof ${TEST} ${direct} --base ${base} --with support/unused.ts --with ${ROWS} --source src/main.ts\n`,
    );
    clean(f);
  });

  it("still refuses a source file the base lacks once --with and --source settle the imports", async () => {
    const f = fixture({
      ...ON,
      ...MAIN,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: helper("vitest", EXISTING),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/added.ts": "export const added = 2;\n",
      [ROWS]: helper(
        "vitest",
        'import { added } from "../src/added";',
        "it('new', () => expect(added).toBe(2));",
      ),
    });
    const result = await prove(f, {
      files: [TEST],
      base,
      with: [ROWS],
      source: ["src/added.ts"],
    });
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `imports src/added.ts, absent at ${short(base)}`,
    });
    clean(f);
  });

  it("reads a pytest helper that imports pytest, and a conftest, as test code from git", async () => {
    const f = fixture({
      "tests/test_a.py": "from support.rows import ROWS\n",
      "support/rows.py": "ROWS = [1]\n",
      "pkg/conftest.py": "X = 1\n",
      "pkg/value.py": "VALUE = 1\n",
      "pkg/main.py": "from pkg.value import VALUE\n",
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    const head = f.commit({
      "support/rows.py": "import pytest\nROWS = [pytest.param(1), 2]\n",
      "pkg/conftest.py": "X = 2\n",
      "pkg/value.py": "VALUE = 2\n",
    });
    const ref = { project: "", path: "tests/test_a.py" };
    const { imports } = await importsOf({
      root: f.root as AbsolutePath,
      base,
      head,
      refs: [ref],
      loadsOf: () => ["tests/test_a.py", "support/rows.py", "pkg/conftest.py", "pkg/value.py"],
      changed: new Set(["support/rows.py", "pkg/conftest.py", "pkg/value.py"]),
      testSide: new Set([ref.path]),
      source: new Set(),
    });
    expect(imports.get(testFileId(ref))).toEqual({
      unsettled: [
        { path: "pkg/conftest.py", testCode: true, why: "pytest's conftest.py" },
        { path: "support/rows.py", testCode: true, why: `imports pytest at ${short(head)}` },
      ],
      sources: [{ path: "pkg/value.py", why: "imported by pkg/main.py" }],
      testSide: false,
    });
  });
});
