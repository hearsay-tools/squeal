import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2 as amended 2026-11-19 ("A: stop guessing";
 * `reviews/wave-14-fourth.md` 2): a node:test helper that loads node:test
 * through `require /* comment *\/ ("node:test")`, unchanged, over changed
 * data. The proof stops (exit 3) and lists both changed files; with
 * `--with` on the data and `--source` on the fix, red passes: not red.
 * Runs node:test, so `test/version-sensitive.txt` lists it.
 */

const TEST = "test/a.test.cjs";
const lines = (...l: string[]) => [...l, ""].join("\n");

describe("squeal proof: a node:test helper over changed data (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it("stops on require /* comment */ ('node:test'); the control with --with and --source reads not red", async () => {
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ nodeTest: [{ name: "node", include: ["test/*.test.cjs"] }] })}\n`,
      [TEST]: lines('const { runRows } = require("../support/rows.cjs");', "runRows();"),
      "support/rows.cjs": lines(
        'const { test } = require /* valid comment */ ("node:test");',
        'const assert = require("node:assert/strict");',
        'const { value } = require("../src/value.cjs");',
        'const { min } = require("./data.cjs");',
        'exports.runRows = () => test("row", () => assert.ok(value >= min));',
      ),
      "src/main.cjs": lines('const { value } = require("./value.cjs");', "exports.main = value;"),
      "src/value.cjs": "exports.value = 1;\n",
      "support/data.cjs": "exports.min = 3;\n",
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/value.cjs": "exports.value = 2;\n", "support/data.cjs": "exports.min = 1;\n" });
    const result = await prove(f, { files: [TEST], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      changedImports: { unsettled: ["src/value.cjs", "support/data.cjs"], stopped: true },
    });
    const control = await prove(f, {
      files: [TEST],
      base,
      with: ["support/data.cjs"],
      source: ["src/value.cjs"],
    });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    clean(f);
  });
});
