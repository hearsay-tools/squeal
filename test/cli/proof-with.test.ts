import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247, "A: explain
 * + --with"), on `research/issue-247.md`'s fixture: a thin test that only
 * calls an imported kit, `src/*.testkit.ts`, which Squeal takes for code.
 * Unchanged thin test with a changed kit: nothing runs, exit 3, the
 * changed helpers and the rerun named. With `--with` the kit is copied as
 * test code and gets no verdict; the source change is still compared.
 */

const THIN = "src/thin.test.ts";
const ROWS = "src/rows.testkit.ts";
const MORE = "src/more.testkit.ts";

const ON = {
  "squeal.config.json": "{}\n",
  "vitest.config.mjs": 'export default { test: { include: ["src/*.test.ts"] } };\n',
  [THIN]: 'import { runKit } from "./rows.testkit";\nrunKit();\n',
};

const kit = (...rows: string[]) =>
  [
    'import { it, expect } from "vitest";',
    'import { value } from "./value";',
    ...rows.filter((row) => row.startsWith("import")),
    "export function runKit() {",
    "  it('existing row', () => expect(value).toBeGreaterThanOrEqual(1));",
    ...rows.filter((row) => !row.startsWith("import")).map((row) => `  ${row}`),
    "}",
    "",
  ].join("\n");

/** HEAD fixes `value` and adds a row in a new kit the old kit now imports (a transitive, added helper). */
function issueFixture() {
  const f = fixture({ ...ON, "src/value.ts": "export const value = 1;\n", [ROWS]: kit() });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({
    "src/value.ts": "export const value = 2;\n",
    [MORE]: [
      'import { it, expect } from "vitest";',
      'import { value } from "./value";',
      "export function moreRows() {",
      "  it('new row catches the bug', () => expect(value).toBe(2));",
      "}",
      "",
    ].join("\n"),
    [ROWS]: kit('import { moreRows } from "./more.testkit";', "moreRows();"),
  });
  return { f, base };
}

describe("squeal proof: an unchanged test's changed imports (row 023-21, D5.2)", {
  timeout: 240_000,
}, () => {
  it("stops an unchanged test with changed helpers: exit 3, nothing run, the rerun with --with named", async () => {
    const { f, base } = issueFixture();
    const result = await prove(f, { files: [THIN], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.report.checkoutMs.red).toBeNull();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: THIN,
      verdict: "not comparable",
      reason: `the test is unchanged since ${base.slice(0, 9)}; changed imports: ${MORE}, ${ROWS}`,
      red: { end: "unknown", runs: 0 },
      changedImports: { helpers: [MORE, ROWS], sources: ["src/value.ts"], stopped: true },
    });
    expect(result.report.withRerun).toBe(
      `squeal proof ${THIN} --base ${base} --with ${MORE} --with ${ROWS}`,
    );
    const text = await prove(f, { files: [THIN], base, json: false });
    expect(text.code, text.why).toBe(3);
    expect(text.out).toContain(
      `${THIN}: not comparable (the test is unchanged since ${base.slice(0, 9)}; changed imports: ${MORE}, ${ROWS})`,
    );
    expect(text.out).toContain("  source changes the proof compares: src/value.ts\n");
    expect(text.out).toContain(
      `Rerun with the changed helpers as test code: squeal proof ${THIN} --base ${base} --with ${MORE} --with ${ROWS}\n`,
    );
    clean(f);
  });

  it("proves with --with: the helpers copied as test code, no verdict of their own, the source compared", async () => {
    const { f, base } = issueFixture();
    const args = { files: [THIN], base, with: [ROWS, MORE] };
    const first = await prove(f, args);
    expect(first.code, first.why).toBe(0);
    expect(first.report.case).toBe("source");
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({
      path: THIN,
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true },
      green: { end: "pass" },
      // The kit is test code now: only the source is a changed code-side import, and nothing stops.
      changedImports: { helpers: [], sources: ["src/value.ts"], stopped: false },
    });
    expect(first.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    expect(first.report.red).toEqual({ tests: first.report.head, code: base, with: [ROWS, MORE] });
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

  it("warns once for a --with path no named test imports, and it changes no exit", async () => {
    const { f, base } = issueFixture();
    f.commit({ "src/unused.testkit.ts": "export const unused = 1;\n" });
    const result = await prove(f, {
      files: [THIN],
      base,
      with: [ROWS, MORE, "src/unused.testkit.ts"],
      json: false,
    });
    expect(result.code, result.why).toBe(0);
    const head = git(f.root, "rev-parse", "HEAD").trim().slice(0, 9);
    expect(result.out).toContain(
      `Warning: --with src/unused.testkit.ts: no named test imports it at ${head}.\n`,
    );
    expect(result.out.match(/Warning:/g)).toHaveLength(1);
    expect(result.out).toContain(`with ${ROWS}, ${MORE}, src/unused.testkit.ts at`);
    clean(f);
  });

  it("proves a helper-only fix as a test case once --with names the helper", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 2;\n",
      [ROWS]: kit("it('pinned', () => expect(value).toBe(3));"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [ROWS]: kit("it('pinned', () => expect(value).toBe(2));") });
    const stopped = await prove(f, { files: [THIN], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]?.reason).toContain(`changed imports: ${ROWS}`);
    expect(stopped.report.withRerun).toBe(`squeal proof ${THIN} --base ${base} --with ${ROWS}`);
    const proved = await prove(f, { files: [THIN], base, with: [ROWS] });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.report.case).toBe("test");
    expect(proved.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    expect(proved.files[0]?.red.failures[0]?.text).toContain("expected 2 to be 3");
    clean(f);
  });

  it("still proves an unchanged test over a source-only change, and says what it compared as source", async () => {
    const f = fixture({
      ...ON,
      "src/value.ts": "export const value = 1;\n",
      [ROWS]: kit("it('new row', () => expect(value).toBe(2));"),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/value.ts": "export const value = 2;\n" });
    const result = await prove(f, { files: [THIN], base, json: false });
    expect(result.code, result.why).toBe(0);
    expect(result.out).toContain(`${THIN}: proven\n`);
    expect(result.out).toContain(
      `  the test is unchanged since ${base.slice(0, 9)}; source changes the proof compares: src/value.ts (if one is test code, rerun with --with <path>)\n`,
    );
    expect(result.out).not.toContain("Rerun with the changed helpers");
    clean(f);
  });

  it("refuses a --with path outside the worktree before any checkout", async () => {
    const { f, base } = issueFixture();
    const result = await prove(f, { files: [THIN], base, with: ["../elsewhere.ts"] });
    expect(result.code).toBe(2);
    expect(result.err).toContain("--with ../elsewhere.ts names no file inside");
    clean(f);
  });
});
