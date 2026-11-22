import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-21, spec 023 D5.2, `reviews/wave-14-seventh.md`. B1: a `--with`
 * path (or any test-side path) that the test version lacks is removed from
 * the side's checkout, so the side holds the test version's test code; the
 * whole-checkout check requires the absence, and the result is reused. B2:
 * an unchanged named test with unnamed changed files stops with exit 3 and
 * both reruns before any case is chosen, even when no changed file is in
 * its closure.
 */

const TEST = "test/a.test.ts";
const VALUE = "src/value.ts";
const ON = { "squeal.config.json": "{}\n" };
const lines = (...l: string[]) => [...l, ""].join("\n");
const short = (sha: string) => sha.slice(0, 9);

/** The review's B1 fixture: the marker exists at base and is deleted at HEAD with the fix. */
function markerFixture() {
  const f = fixture({
    ...ON,
    [VALUE]: "export const value = 1;\n",
    "support/marker.txt": "marker\n",
    [TEST]: lines(
      'import { it, expect } from "vitest";',
      'import { existsSync } from "node:fs";',
      'import { value } from "../src/value";',
      'it("value", () => {',
      '  const min = existsSync("support/marker.txt") ? 3 : 1;',
      "  expect(value).toBeGreaterThanOrEqual(min);",
      "});",
    ),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [VALUE]: "export const value = 2;\n", "support/marker.txt": null });
  return { f, base };
}

/** An unchanged test over unchanged code; `more` changes at HEAD. */
function unrelatedFixture(more: Record<string, string | null>, tests = [TEST]) {
  const f = fixture({
    ...ON,
    [VALUE]: "export const value = 2;\n",
    "docs/note.md": "old\n",
    ...Object.fromEntries(
      tests.map((t) => [
        t,
        lines(
          'import { it, expect } from "vitest";',
          'import { value } from "../src/value";',
          'it("value", () => expect(value).toBe(2));',
        ),
      ]),
    ),
  });
  const base = git(f.root, "rev-parse", "HEAD").trim();
  f.commit(more);
  return { f, base };
}

describe("squeal proof: test-side removals and stops before the case (row 023-21, D5.2)", {
  timeout: 300_000,
}, () => {
  it("B1: removes a --with path the test version deleted; red passes (not red), and reuse keeps it", async () => {
    const { f, base } = markerFixture();
    const stopped = await prove(f, { files: [TEST], base, source: [VALUE] });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.report.runs).toBe(0);
    expect(stopped.files[0]).toMatchObject({
      changedImports: { unsettled: ["support/marker.txt"] },
    });
    const args = { files: [TEST], base, source: [VALUE], with: ["support/marker.txt"] };
    const first = await prove(f, args);
    expect(first.code, first.why).toBe(1);
    expect(first.files[0]).toMatchObject({
      verdict: "not red",
      red: { end: "pass", from: "run", stored: true },
    });
    const again = await prove(f, args);
    expect(again.code, again.why).toBe(1);
    expect(again.report.runs).toBe(0);
    expect(again.files[0]).toMatchObject({ verdict: "not red", red: { from: "store" } });
    // The review's control: hiding the marker by condition reads the same.
    const control = await prove(f, {
      files: [TEST],
      base,
      source: [VALUE],
      with: ["support/marker.txt"],
      without: ["support/marker.txt"],
    });
    expect(control.code, control.why).toBe(1);
    expect(control.files[0]).toMatchObject({ verdict: "not red" });
    clean(f);
  });

  it("B1: removes a deleted test-side fixture with --with, and keeps it under --source", async () => {
    const f = fixture({
      ...ON,
      [VALUE]: "export const value = 1;\n",
      "test/fixtures/a.json": "{}\n",
      "test/fixtures/b.json": "{}\n",
      [TEST]: lines(
        'import { it, expect } from "vitest";',
        'import { readdirSync } from "node:fs";',
        'import { value } from "../src/value";',
        // Row 023-42: relative to the test file; a commit daemon in this test process keeps its cwd.
        'it("value", () => expect(value).toBeGreaterThanOrEqual(readdirSync(new URL("./fixtures", import.meta.url)).length));',
      ),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [VALUE]: "export const value = 2;\n", "test/fixtures/b.json": null });
    const stopped = await prove(f, { files: [TEST], base, source: [VALUE] });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]).toMatchObject({
      changedImports: { unsettled: ["test/fixtures/b.json"] },
    });
    // Test code: the red side lists one fixture, as HEAD's test does; 1 >= 1 passes.
    const asTest = await prove(f, {
      files: [TEST],
      base,
      source: [VALUE],
      with: ["test/fixtures/b.json"],
    });
    expect(asTest.code, asTest.why).toBe(1);
    expect(asTest.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass" } });
    // Product code: the red side keeps base's two fixtures; 1 >= 2 fails, and HEAD passes.
    const asSource = await prove(f, {
      files: [TEST],
      base,
      source: [VALUE, "test/fixtures/b.json"],
    });
    expect(asSource.code, asSource.why).toBe(0);
    expect(asSource.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    clean(f);
  });

  it.each([
    ["an unrelated docs change", { "docs/note.md": "new\n" }, ["docs/note.md"]],
    ["a deletion only", { "docs/note.md": null }, ["docs/note.md"]],
  ])(
    "B2: stops on %s with no flag and no case: exit 3, both reruns, nothing run",
    async (_, more, unsettled) => {
      const { f, base } = unrelatedFixture(more);
      const result = await prove(f, { files: [TEST], base });
      expect(result.code, result.why).toBe(3);
      expect(result.report.runs).toBe(0);
      expect(result.report.case).toBeNull();
      expect(result.files[0]).toMatchObject({
        verdict: "not comparable",
        reason: `the test is unchanged since ${short(base)}; changed files not named: ${unsettled.join(", ")}`,
        changedImports: { unsettled, stopped: true },
      });
      expect(result.report.withRerun).toBe(
        `squeal proof ${TEST} --base ${base} --with docs/note.md`,
      );
      expect(result.report.sourceRerun).toBe(
        `squeal proof ${TEST} --base ${base} --source docs/note.md`,
      );
      // The review's control: --case source gives the same stop.
      const control = await prove(f, { files: [TEST], base, case: "source" });
      expect(control.code, control.why).toBe(3);
      expect(control.report.runs).toBe(0);
      expect(control.report.sourceRerun).toBe(
        `squeal proof ${TEST} --base ${base} --case source --source docs/note.md`,
      );
      clean(f);
    },
  );

  it("B2: stops several unchanged tests at once, each listing the files", async () => {
    const other = "test/b.test.ts";
    const { f, base } = unrelatedFixture({ "docs/note.md": "new\n" }, [TEST, other]);
    const result = await prove(f, { files: [TEST, other], base });
    expect(result.code, result.why).toBe(3);
    expect(result.report.runs).toBe(0);
    expect(result.files.map((file) => [file.path, file.verdict])).toEqual([
      [TEST, "not comparable"],
      [other, "not comparable"],
    ]);
    expect(result.report.withRerun).toBe(
      `squeal proof ${TEST} ${other} --base ${base} --with docs/note.md`,
    );
    clean(f);
  });
});
