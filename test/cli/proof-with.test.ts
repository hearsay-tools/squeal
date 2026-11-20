import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, link } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 (issue #247, "A: explain
 * + --with"; last, after `reviews/wave-14-fourth.md`, "A: stop guessing"):
 * Squeal does not tell test code from product code. When a named test is
 * unchanged, every changed file it loads that is not on the test side
 * stops the proof (exit 3, nothing run) unless `--with` (test code, copied
 * from the test version) or `--source` (product code, each side's code
 * version) names it. Every review's reproduction stops; each control with
 * the right flags reads not red.
 */

const TEST = "test/a.test.ts";
const ROWS = "support/rows.ts";
const DATA = "support/data.ts";
const VALUE = "src/value.ts";
const MAIN = { "src/main.ts": 'import { value } from "./value";\nexport const main = value;\n' };
const ON = { "squeal.config.json": "{}\n", ...MAIN };
const short = (sha: string) => sha.slice(0, 9);
const lines = (...l: string[]) => [...l, ""].join("\n");

/** An unchanged thin test over `support/rows.ts`, which imports `it` and `expect` from `api`. */
const THIN = { [TEST]: lines('import { runRows } from "../support/rows";', "runRows();") };
const rowsOver = (api: string, check: string) =>
  lines(
    `import { it, expect } from "${api}";`,
    'import { min } from "./data";',
    'import { value } from "../src/value";',
    "export function runRows() {",
    `  it("row", () => ${check});`,
    "}",
  );
/** The data-only case: `value` 1 to 2 and `min` 3 to 1; HEAD's data passes over the old value. */
const DATA_CHANGE = {
  base: { [VALUE]: "export const value = 1;\n", [DATA]: "export const min = 3;\n" },
  head: { [VALUE]: "export const value = 2;\n", [DATA]: "export const min = 1;\n" },
};
const OVER_MIN = "expect(value).toBeGreaterThanOrEqual(min)";

interface Case {
  readonly name: string;
  readonly files: Record<string, string>;
  readonly head: Record<string, string>;
  readonly unsettled: readonly string[];
  readonly control: { readonly with: string[]; readonly source: string[] };
  readonly install?: (tree: string) => void;
}

const CASES: readonly Case[] = [
  {
    name: "a helper that imports vitest (review B1)",
    files: {
      ...THIN,
      [VALUE]: "export const value = 1;\n",
      [DATA]: "export const min = 1;\n",
      [ROWS]: rowsOver("vitest", "expect(value).toBe(3)"),
    },
    head: { [VALUE]: "export const value = 2;\n", [ROWS]: rowsOver("vitest", OVER_MIN) },
    unsettled: [VALUE, ROWS],
    control: { with: [ROWS], source: [VALUE] },
  },
  {
    name: "a helper that takes vitest through a local barrel (re-review)",
    files: {
      ...THIN,
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      [VALUE]: "export const value = 1;\n",
      [DATA]: "export const min = 1;\n",
      [ROWS]: rowsOver("./api", "expect(value).toBe(3)"),
    },
    head: { [VALUE]: "export const value = 2;\n", [ROWS]: rowsOver("./api", OVER_MIN) },
    unsettled: [VALUE, ROWS],
    control: { with: [ROWS], source: [VALUE] },
  },
  {
    name: "a data-only helper the test imports (re-review)",
    files: {
      [TEST]: lines(
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        'import { min } from "../support/data";',
        `it("row", () => ${OVER_MIN});`,
      ),
      ...DATA_CHANGE.base,
    },
    head: DATA_CHANGE.head,
    unsettled: [VALUE, DATA],
    control: { with: [DATA], source: [VALUE] },
  },
  {
    name: "a commented-out import in product code (third look)",
    files: {
      [TEST]: lines(
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        'import { min } from "../support/data";',
        `it("row", () => ${OVER_MIN});`,
      ),
      "src/example.ts":
        '// import { min } from "../support/data";\nexport const label = "example";\n',
      ...DATA_CHANGE.base,
    },
    head: DATA_CHANGE.head,
    unsettled: [VALUE, DATA],
    control: { with: [DATA], source: [VALUE] },
  },
  {
    name: "a package #imports alias to a vitest barrel (third look)",
    files: {
      ...THIN,
      "package.json": `${JSON.stringify({ name: "fixture", type: "module", imports: { "#api": "./support/api.ts" } })}\n`,
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      [ROWS]: rowsOver("#api", OVER_MIN),
      ...DATA_CHANGE.base,
    },
    head: DATA_CHANGE.head,
    unsettled: [VALUE, DATA],
    control: { with: [DATA], source: [VALUE] },
  },
  {
    name: "a tsconfig paths alias to a vitest barrel (third look)",
    files: {
      ...THIN,
      "tsconfig.json": `${JSON.stringify({ compilerOptions: { paths: { "~/*": ["./support/*"] } } })}\n`,
      "vitest.config.mjs":
        'export default { resolve: { tsconfigPaths: true }, test: { include: ["test/*.test.ts"] } };\n',
      "support/api.ts": 'export { it, expect } from "vitest";\n',
      [ROWS]: rowsOver("~/api", OVER_MIN),
      ...DATA_CHANGE.base,
    },
    head: DATA_CHANGE.head,
    unsettled: [VALUE, DATA],
    control: { with: [DATA], source: [VALUE] },
  },
  {
    name: "a declared local package that re-exports vitest (fourth look)",
    files: {
      ...THIN,
      "package.json": `${JSON.stringify({ name: "fixture", type: "module", dependencies: { "review-api": "file:./packages/api" } })}\n`,
      "packages/api/package.json": `${JSON.stringify({ name: "review-api", type: "module", exports: "./index.js" })}\n`,
      "packages/api/index.js": 'export { it, expect } from "vitest";\n',
      [ROWS]: rowsOver("review-api", OVER_MIN),
      ...DATA_CHANGE.base,
    },
    head: DATA_CHANGE.head,
    unsettled: [VALUE, DATA],
    control: { with: [DATA], source: [VALUE] },
    install: (tree) =>
      symlinkSync(join(tree, "packages/api"), join(tree, "node_modules/review-api")),
  },
];

describe("squeal proof: an unchanged test's changed files (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it.each(CASES)("stops on $name; the control with the right flags reads not red", async (c) => {
    const f = fixture({ ...ON, ...c.files });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit(c.head);
    const test = TEST;
    const install = async (tree: string) => {
      link(tree);
      c.install?.(tree);
      return { ok: true as const, command: "link", ms: 0 };
    };
    const options = { cacheRoot: f.cacheRoot, install };
    const result = await prove(f, { files: [test], base }, options);
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `the test is unchanged since ${short(base)}; changed files not named: ${c.unsettled.join(", ")}`,
      changedImports: { unsettled: c.unsettled, sources: [], stopped: true },
    });
    const control = await prove(f, { files: [test], base, ...c.control }, options);
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    clean(f);
  });

  it("prints both reruns and that the flags may be mixed per file", async () => {
    const c = CASES[0] as Case;
    const f = fixture({ ...ON, ...c.files });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit(c.head);
    const result = await prove(f, { files: [TEST], base, json: false });
    expect(result.code, result.why).toBe(3);
    expect(result.out).toContain(
      `  changed files neither --with nor --source names: ${VALUE} (the test read it), ${ROWS} (the test read it)\n`,
    );
    expect(result.out).toContain(
      `Squeal does not tell test code from product code. If they are product code, rerun: squeal proof ${TEST} --base ${base} --source ${VALUE} --source ${ROWS}\n`,
    );
    expect(result.out).toContain(
      `If they are test code, rerun: squeal proof ${TEST} --base ${base} --with ${VALUE} --with ${ROWS}\n`,
    );
    expect(result.out).toContain(
      "Or name each file with --source (product code, taken from each side's code version) or --with (test code, copied from the test version).\n",
    );
    clean(f);
  });

  it("stops on a product fix behind an unchanged test, and proves it with --source", async () => {
    const f = fixture({
      ...ON,
      [VALUE]: "export const value = 1;\n",
      [TEST]: lines(
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        'it("value", () => expect(value).toBe(2));',
      ),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [VALUE]: "export const value = 2;\n" });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.report.sourceRerun).toBe(
      `squeal proof ${TEST} --base ${base} --source ${VALUE}`,
    );
    const proved = await prove(f, { files: [TEST], base, source: [VALUE], json: false });
    expect(proved.code, proved.why).toBe(0);
    expect(proved.out).toContain(`${TEST}: proven\n`);
    expect(proved.out).toContain(`  product code by --source, compared: ${VALUE}\n`);
    clean(f);
  });

  it("proves with --with on two helpers (one added, loaded through the other) and --source on the fix, then reuses the store", async () => {
    const more = "support/more.ts";
    const f = fixture({
      ...ON,
      ...THIN,
      [VALUE]: "export const value = 1;\n",
      [DATA]: "export const min = 1;\n",
      [ROWS]: rowsOver("vitest", OVER_MIN),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    const head = f.commit({
      [VALUE]: "export const value = 2;\n",
      [more]: lines(
        'import { it, expect } from "vitest";',
        'import { value } from "../src/value";',
        'export const moreRows = () => it("new row", () => expect(value).toBe(2));',
      ),
      [ROWS]: lines(
        'import { it, expect } from "vitest";',
        'import { moreRows } from "./more";',
        'import { value } from "../src/value";',
        'export function runRows() { it("row", () => expect(value).toBeGreaterThanOrEqual(1)); moreRows(); }',
      ),
    });
    const stopped = await prove(f, { files: [TEST], base });
    expect(stopped.files[0]).toMatchObject({ changedImports: { unsettled: [VALUE, more, ROWS] } });
    const args = { files: [TEST], base, with: [ROWS, more], source: [VALUE] };
    const first = await prove(f, args);
    expect(first.code, first.why).toBe(0);
    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true },
      changedImports: { unsettled: [], sources: [VALUE], stopped: false },
    });
    expect(first.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    expect(first.report.red).toMatchObject({
      tests: head,
      code: base,
      with: [ROWS, more],
      source: [VALUE],
    });
    const second = await prove(f, args);
    expect(second.code, second.why).toBe(0);
    expect(second.report.runs).toBe(0);
    clean(f);
  });

  it("refuses one path in --with and --source, and a --with path outside the worktree", async () => {
    const f = fixture({ ...ON, [VALUE]: "export const value = 1;\n" });
    const both = await prove(f, {
      files: [TEST],
      base: "HEAD",
      with: [VALUE],
      source: [`./${VALUE}`],
    });
    expect(both.code).toBe(2);
    expect(both.err).toContain(
      `${VALUE} is given with --with and --source: it is test code or product code, not both`,
    );
    const outside = await prove(f, { files: [TEST], base: "HEAD", with: ["../elsewhere.ts"] });
    expect(outside.code).toBe(2);
    expect(outside.err).toContain("--with ../elsewhere.ts names no file inside");
    clean(f);
  });

  it("gives each named file its verdict, and warns for --with and --source paths that change nothing", async () => {
    const c = CASES[0] as Case;
    const f = fixture({ ...ON, ...c.files, "support/unused.ts": "export const u = 1;\n" });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit(c.head);
    const direct = "test/direct.test.ts";
    const head = f.commit({
      [direct]: lines(
        'import { expect, it } from "vitest";',
        'import { value } from "../src/value";',
        'it("direct", () => expect(value).toBe(2));',
      ),
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
    // Row 023-30 (R5): a test added since the base is a changed test: its verdict line says so.
    expect(result.out).toContain(
      `${direct}: proven: the new test fails on the old code. This is not the file's result at ${short(base)}; that is \`squeal status --at ${short(base)} ${direct} --run\`\n`,
    );
    expect(result.out).toContain(
      `Warning: --with support/unused.ts: no named test imports it at ${short(head)}.\n`,
    );
    expect(result.out).toContain(
      `Warning: --source src/main.ts: not a changed file between ${short(base)} and HEAD; it settles nothing.\n`,
    );
    clean(f);
  });

  it("still refuses a source file the base lacks once --with and --source settle the imports", async () => {
    const f = fixture({
      ...ON,
      ...THIN,
      [VALUE]: "export const value = 1;\n",
      [DATA]: "export const min = 1;\n",
      [ROWS]: rowsOver("vitest", OVER_MIN),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/added.ts": "export const added = 2;\n",
      [ROWS]: lines(
        'import { it, expect } from "vitest";',
        'import { added } from "../src/added";',
        'export function runRows() { it("new", () => expect(added).toBe(2)); }',
      ),
    });
    const result = await prove(f, { files: [TEST], base, with: [ROWS], source: ["src/added.ts"] });
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `imports src/added.ts, absent at ${short(base)}`,
    });
    clean(f);
  });
});
