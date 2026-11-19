import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, link, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";

/*
 * Row 023-08, spec 023 D5.2 and the brief's storing rule: a test-side
 * helper copied at the test version, a dirty working tree, an install
 * that changes the checkout (shown, not stored), and the default case
 * that neither the diff nor the closure gives.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** A test that checks `value` of `src/a` against the helper's `wanted`. */
const helperTest = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'import { wanted } from "./helpers/wanted";',
  'it("value", () => expect(value).toBe(wanted));',
  "",
].join("\n");

describe("squeal proof copies and storing (row 023-08, D5.2)", { timeout: 240_000 }, () => {
  it("copies a test-side helper at the test version: a helper-only fix is a test case, proven", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      "test/helpers/wanted.ts": "export const wanted = 3;\n",
      [TEST.path]: helperTest,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "test/helpers/wanted.ts": "export const wanted = 2;\n" });
    // Row 023-21 (D5.2, "A: stop guessing"): the unchanged test stops until a flag names the helper.
    const stopped = await prove(f, { files: [TEST.path], base: a });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]).toMatchObject({
      changedImports: { unsettled: ["test/helpers/wanted.ts"] },
    });
    const result = await prove(f, {
      files: [TEST.path],
      base: a,
      with: ["test/helpers/wanted.ts"],
    });
    expect(result.code, result.why).toBe(0);
    expect(result.report.case).toBe("test");
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", stored: true },
    });
    expect(result.files[0]?.red.failures[0]?.text).toContain("expected 2 to be 3");
    clean(f);
  });

  it("says the proof is of HEAD when the working tree changes a loaded file, and runs green at HEAD", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
    writeFileSync(join(f.root, "src/a.ts"), "export const value = 5;\n");
    const result = await prove(f, { files: [TEST.path], base: a, json: false });
    expect(result.code, result.why).toBe(0);
    expect(result.out).toContain("not the uncommitted change to src/a.ts");
    expect(result.out).toMatch(/green: pass, run by this command, stored/);
    clean(f);
  });

  it("shows a run in a checkout its install changed, stores nothing, and still gives the verdict", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
    const install = async (tree: string) => {
      link(tree);
      writeFileSync(join(tree, "squeal.config.json"), '{ "coverage": { "enabled": true } }\n');
      return { ok: true as const, command: "rewrites", ms: 0 };
    };
    const options = { cacheRoot: f.cacheRoot, install };
    const first = await prove(f, { files: [TEST.path], base: a }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.files[0]).toMatchObject({
      verdict: "proven",
      red: {
        end: "fail",
        from: "run",
        stored: false,
        notStored: "install changed the checkout: squeal.config.json",
      },
    });
    const second = await prove(f, { files: [TEST.path], base: a }, options);
    expect(second.files[0]?.red).toMatchObject({ from: "run", stored: false });
    clean(f);
  });

  it("stops on an unrelated change (exit 3), and asks for --case only over an empty diff (exit 2)", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      [TEST.path]: testOf("a", 2),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "README.md": "notes\n" });
    // Row 023-21 (D5.2, seventh look B2): the unnamed README stops the unchanged test first.
    const stopped = await prove(f, { files: [TEST.path], base: a });
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.files[0]).toMatchObject({ changedImports: { unsettled: ["README.md"] } });
    const result = await prove(f, { files: [TEST.path], base: "HEAD" });
    expect(result.code, result.why).toBe(2);
    expect(result.err).toContain("give --case source or --case test");
    clean(f);
  });
});
