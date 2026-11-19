import { describe, expect, it } from "vitest";
import { importsOf } from "../../src/cli/proof-imports.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247, "A: explain
 * + --with"), repaired after `reviews/wave-14.md` B1: a test that only
 * calls a helper with an ordinary name outside the test folder,
 * `support/rows.ts`. The helper imports vitest, so it is test code: with
 * the test unchanged and the helper changed, nothing runs, exit 3, the
 * helper and the rerun named. With `--with` the helper is copied as test
 * code and gets no verdict; the source change is still compared. A source
 * file only tests import still proves.
 */

const TEST = "test/a.test.ts";
const ROWS = "support/rows.ts";
const MORE = "support/more.ts";

const ON = {
  "squeal.config.json": "{}\n",
  [TEST]: 'import { runRows } from "../support/rows";\nrunRows();\n',
};

/** A helper that imports vitest and `value`, with `rows` inside `runRows`. */
const helper = (...rows: string[]) =>
  [
    'import { it, expect } from "vitest";',
    'import { value } from "../src/value";',
    ...rows.filter((row) => row.startsWith("import")),
    "export function runRows() {",
    ...rows.filter((row) => !row.startsWith("import")).map((row) => `  ${row}`),
    "}",
    "",
  ].join("\n");

const EXISTING = "it('existing row', () => expect(value).toBeGreaterThanOrEqual(1));";

/** HEAD fixes `value` and adds a row in a new helper the old one now imports (transitive, added). */
function addedHelperFixture() {
  const f = fixture({
    ...ON,
    "src/value.ts": "export const value = 1;\n",
    [ROWS]: helper(EXISTING),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({
    "src/value.ts": "export const value = 2;\n",
    [MORE]: [
      'import { it, expect } from "vitest";',
      'import { value } from "../src/value";',
      "export function moreRows() {",
      "  it('new row catches the bug', () => expect(value).toBe(2));",
      "}",
      "",
    ].join("\n"),
    [ROWS]: helper('import { moreRows } from "./more";', EXISTING, "moreRows();"),
  });
  return { f, base, head: git(f.root, "rev-parse", "HEAD").trim() };
}

describe("squeal proof: an unchanged test's changed imports (row 023-21, D5.2)", {
  timeout: 240_000,
}, () => {
  it("B1: stops on a changed helper with an ordinary name that imports vitest, never a false proven", async () => {
    // The review's fixture: HEAD's helper passes on both sources, base's fails on both.
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: helper("it('row', () => expect(value).toBe(3));"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    const head = f.commit({
      "src/value.ts": "export const value = 2;\n",
      [ROWS]: helper("it('row', () => expect(value).toBeGreaterThanOrEqual(1));"),
    });
    const result = await prove(f, { files: [TEST], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.report.checkoutMs.red).toBeNull();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: TEST,
      verdict: "not comparable",
      reason: `the test is unchanged since ${base.slice(0, 9)}; changed imports: ${ROWS}`,
      red: { end: "unknown", runs: 0 },
      changedImports: {
        testCode: [{ path: ROWS, why: `imports vitest at ${head.slice(0, 9)}` }],
        sources: ["src/value.ts"],
        stopped: true,
      },
    });
    expect(result.report.withRerun).toBe(`squeal proof ${TEST} --base ${base} --with ${ROWS}`);
    const text = await prove(f, { files: [TEST], base, json: false });
    expect(text.code, text.why).toBe(3);
    expect(text.out).toContain(
      `  test code it imports: ${ROWS} (imports vitest at ${head.slice(0, 9)})\n`,
    );
    expect(text.out).toContain("  source changes the proof compares: src/value.ts\n");
    expect(text.out).toContain(
      `Rerun with the changed test code copied from the test version: squeal proof ${TEST} --base ${base} --with ${ROWS}\n`,
    );
    // The control: HEAD's helper passes over the old source, so red does not fail.
    const control = await prove(f, { files: [TEST], base, with: [ROWS] });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    clean(f);
  });

  it("stops on a transitive, newly added helper too, and proves once --with copies both", async () => {
    const { f, base, head } = addedHelperFixture();
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    const why = `imports vitest at ${head.slice(0, 9)}`;
    expect(stopped.files[0]).toMatchObject({
      changedImports: {
        testCode: [
          { path: MORE, why },
          { path: ROWS, why },
        ],
        sources: ["src/value.ts"],
        stopped: true,
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
      path: TEST,
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true },
      green: { end: "pass" },
      changedImports: { testCode: [], sources: ["src/value.ts"], stopped: false },
    });
    expect(first.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    expect(first.report.red).toMatchObject({ tests: head, code: base, with: [ROWS, MORE] });
    expect(first.report.green.with).toEqual([ROWS, MORE]);
    expect(first.report.withUnused).toEqual([]);
    expect(first.report.withRerun).toBeNull();
    // Store keys hold the copied helpers: the second call reads both sides.
    const second = await prove(f, args);
    expect(second.code, second.why).toBe(0);
    expect(second.report.runs).toBe(0);
    expect(second.files[0]).toMatchObject({ red: { from: "store" }, green: { from: "store" } });
    clean(f);
  });

  it("still proves an unchanged test over a changed source file only tests import, and names it", async () => {
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
    const result = await prove(f, { files: [TEST], base, json: false });
    expect(result.code, result.why).toBe(0);
    expect(result.out).toContain(`${TEST}: proven\n`);
    expect(result.out).toContain(
      `  the test is unchanged since ${base.slice(0, 9)}; source changes the proof compares: src/value.ts (if one is test code, rerun with --with <path>)\n`,
    );
    expect(result.out).not.toContain("Rerun with the changed test code");
    clean(f);
  });

  it("proves a helper-only fix as a test case once --with names the helper", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 2;\n",
      [ROWS]: helper("it('pinned', () => expect(value).toBe(3));"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [ROWS]: helper("it('pinned', () => expect(value).toBe(2));") });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]?.reason).toContain(`changed imports: ${ROWS}`);
    const proved = await prove(f, { files: [TEST], base, with: [ROWS] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.report.case).toBe("test");
    expect(proved.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    expect(proved.files[0]?.red.failures[0]?.text).toContain("expected 2 to be 3");
    clean(f);
  });

  it("gives each named file its own verdict and warns once for a --with path no test imports", async () => {
    const { f, base } = addedHelperFixture();
    const direct = "test/direct.test.ts";
    const head = f.commit({
      "support/unused.ts": "export const unused = 1;\n",
      [direct]: [
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        "it('direct', () => expect(value).toBe(2));",
        "",
      ].join("\n"),
    });
    const result = await prove(f, { files: [TEST, direct], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.case).toBe("source");
    const byPath = new Map(result.files.map((file) => [file.path, file]));
    expect(byPath.get(TEST)).toMatchObject({ verdict: "not comparable", red: { runs: 0 } });
    expect(byPath.get(direct)).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    const warned = await prove(f, {
      files: [TEST],
      base,
      with: [ROWS, MORE, "support/unused.ts"],
      json: false,
    });
    expect(warned.code, warned.why).toBe(0);
    expect(warned.out).toContain(
      `Warning: --with support/unused.ts: no named test imports it at ${head.slice(0, 9)}.\n`,
    );
    expect(warned.out.match(/Warning:/g)).toHaveLength(1);
    clean(f);
  });

  it("still refuses a source file the base lacks when --with copies the helper that imports it", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: helper(EXISTING),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/added.ts": "export const added = 2;\n",
      [ROWS]: helper(
        'import { added } from "../src/added";',
        "it('new', () => expect(added).toBe(2));",
      ),
    });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.files[0]).toMatchObject({
      changedImports: { testCode: [{ path: ROWS }], sources: ["src/added.ts"], stopped: true },
    });
    const result = await prove(f, { files: [TEST], base, with: [ROWS] });
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `imports src/added.ts, absent at ${base.slice(0, 9)}`,
    });
    clean(f);
  });

  it("refuses a --with path outside the worktree before any checkout", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: helper(EXISTING),
    });
    const result = await prove(f, { files: [TEST], base: "HEAD", with: ["../elsewhere.ts"] });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--with ../elsewhere.ts names no file inside");
    clean(f);
  });

  it("reads a pytest helper module that imports pytest, and a conftest, as test code from git", async () => {
    const f = fixture({
      "tests/test_a.py": "from support.rows import ROWS\n",
      "support/rows.py": "ROWS = [1]\n",
      "pkg/conftest.py": "X = 1\n",
      "pkg/value.py": "VALUE = 1\n",
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    const head = f.commit({
      "support/rows.py": "import pytest\nROWS = [pytest.param(1), 2]\n",
      "pkg/conftest.py": "X = 2\n",
      "pkg/value.py": "VALUE = 2\n",
    });
    const ref = { project: "", path: "tests/test_a.py" };
    const loads = ["tests/test_a.py", "support/rows.py", "pkg/conftest.py", "pkg/value.py"];
    const changed = new Set(["support/rows.py", "pkg/conftest.py", "pkg/value.py"]);
    const imports = await importsOf(
      f.root as AbsolutePath,
      { base, head },
      [ref],
      () => loads,
      changed,
      new Set([ref.path]),
    );
    expect(imports.get(testFileId(ref))).toEqual({
      testCode: [
        { path: "pkg/conftest.py", why: "pytest's conftest.py" },
        { path: "support/rows.py", why: `imports pytest at ${head.slice(0, 9)}` },
      ],
      sources: ["pkg/value.py"],
      testSide: false,
    });
  });
});
