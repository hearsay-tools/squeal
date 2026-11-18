import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { fixture, git, link, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
import { type ProofFileJson, prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Review wave-8 (row 023-08) B1, B2, B3, each on the reviewer's fixture
 * with the real Vitest adapter: a project's outcome and failure kind are
 * its own, not the first failed run of its path (B1); any uncommitted
 * difference keeps a stored current pass from standing for HEAD (B2); a
 * copied link is in the side's expected tree, so an install that replaces
 * it stores nothing (B3).
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };
const OFF = { "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false } })}\n` };

/** Two projects list one test; `MODE` tells them apart (B1). */
const PROJECTS = [
  "export default { test: { projects: [",
  '  { test: { name: "assert", include: ["test/*.test.ts"], env: { MODE: "assert" } } },',
  '  { test: { name: "import", include: ["test/*.test.ts"], env: { MODE: "import" } } },',
  "] } };",
  "",
].join("\n");

/** At the old code, project `import` fails a dynamic import before the assertion. */
const MODE_TEST = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("value", async () => {',
  '  if (value === 1 && process.env.MODE === "import") await import("./absent-module");',
  "  expect(value).toBe(2);",
  "});",
  "",
].join("\n");

const byProject = (files: readonly ProofFileJson[]) =>
  Object.fromEntries(files.map((f) => [f.project, [f.verdict, f.red.failures.map((x) => x.kind)]]));

function twoProjects(config: Readonly<Record<string, string>>) {
  const f = fixture({
    ...config,
    "vitest.config.mjs": PROJECTS,
    "src/a.ts": "export const value = 1;\n",
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: MODE_TEST });
  return { f, a };
}

describe("squeal proof review wave-8 (row 023-08)", { timeout: 300_000 }, () => {
  it("B1: each project's red side is its own: first call and reuse agree", async () => {
    const { f, a } = twoProjects(ON);
    const first = await prove(f, { files: [TEST.path], base: a });
    expect(first.code, first.err).toBe(3);
    const verdicts = {
      assert: ["proven", ["assertion"]],
      import: ["red for another reason", ["error"]],
    };
    expect(byProject(first.files)).toEqual(verdicts);
    const imported = first.files.find((x) => x.project === "import");
    expect(imported?.red.failures[0]?.text).not.toContain("AssertionError");
    const second = await prove(f, { files: [TEST.path], base: a });
    expect(second.code, second.err).toBe(3);
    expect(second.report.runs).toBe(0);
    expect(byProject(second.files)).toEqual(verdicts);
    clean(f);
  });

  it("B1, coverage off: nothing stored tells the projects apart, so neither is classified", async () => {
    const { f, a } = twoProjects(OFF);
    const first = await prove(f, { files: [TEST.path], base: a });
    const second = await prove(f, { files: [TEST.path], base: a });
    for (const call of [first, second]) {
      expect(call.code, call.err).toBe(3);
      expect(call.files.map((x) => [x.project, x.verdict])).toEqual([
        ["assert", "not comparable"],
        ["import", "not comparable"],
      ]);
      expect(call.files[0]?.reason).toContain("projects failed with different failures");
      expect(call.report.runs).toBe(2);
    }
    clean(f);
  });

  it("B2: an uncommitted runner config keeps the current pass from standing for HEAD", async () => {
    const config = (wanted: string) =>
      `export default { test: { include: ["test/*.test.ts"], env: { WANTED: "${wanted}" } } };\n`;
    const test = [
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'it("value", () => {',
      "  expect(value).toBe(2);",
      '  expect(process.env.WANTED).toBe("2");',
      "});",
      "",
    ].join("\n");
    const f = fixture({
      ...ON,
      "vitest.config.mjs": config("9"),
      "src/a.ts": "export const value = 1;\n",
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: test });
    write(f.root, { "vitest.config.mjs": config("2") });
    // A real pass at the working tree's key, under the uncommitted config.
    const seeded = await runGateFiles({
      root: f.root,
      files: [TEST.path],
      budgetSeconds: 120,
      hostLoad: quiet,
    });
    expect(seeded.runs.map((r) => r.outcome)).toEqual(["passed"]);

    const result = await prove(f, { files: [TEST.path], base: a, case: "source" });
    expect(result.code, result.err).toBe(1);
    expect(result.report.dirty).toEqual(["vitest.config.mjs"]);
    expect(result.files[0]).toMatchObject({
      verdict: "not green",
      red: { end: "fail" },
      green: { end: "fail", from: "run" },
    });
    clean(f);
  });

  it("B3: a copied link an install replaces is not the side's: shown, not stored, run again", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    write(f.root, { "test/helpers/2.json": "2\n" });
    symlinkSync("2.json", join(f.root, "test/helpers/wanted.json"));
    const test = [
      'import { expect, it } from "vitest";',
      'import { value } from "../src/a";',
      'import wanted from "./helpers/wanted.json";',
      'it("value", () => expect(value).toBe(wanted));',
      "",
    ].join("\n");
    f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: test });
    /** Replaces the copied link with a plain file holding 3, in the red side's checkout only. */
    const rewrites = async (tree: AbsolutePath) => {
      link(tree);
      if (readFileSync(join(tree, "src/a.ts"), "utf8").includes("= 1;")) {
        rmSync(join(tree, "test/helpers/wanted.json"));
        writeFileSync(join(tree, "test/helpers/wanted.json"), "3\n");
      }
      return { ok: true as const, command: "rewrites", ms: 0 };
    };
    const altered = { cacheRoot: f.cacheRoot, install: rewrites };
    for (const call of [1, 2]) {
      const result = await prove(f, { files: [TEST.path], base: a }, altered);
      expect(result.code, `${call}: ${result.err}`).toBe(0);
      expect(result.files[0]?.red).toMatchObject({
        end: "fail",
        from: "run",
        stored: false,
        notStored: "install changed the checkout: test/helpers/wanted.json",
      });
      expect(result.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 3");
    }
    // An honest install runs the side as committed, a link to 2, and stores it.
    const honest = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const result = await prove(f, { files: [TEST.path], base: a }, honest);
    expect(result.code, result.err).toBe(0);
    expect(result.files[0]?.red).toMatchObject({ end: "fail", from: "run", stored: true });
    expect(result.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    clean(f);
  });
});
