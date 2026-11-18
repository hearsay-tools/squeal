import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGateFiles } from "../../src/cli/code-gate-files.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { quiet } from "../code/gate/host-load.js";
import { fixture, git, link, ref, write } from "../commit/at-keys-fixture.js";
import { PNPM } from "../runner-host/remote/pnpm-project.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Review wave-8 re-review (row 023-08), on the reviewer's fixtures with
 * the real Vitest adapter. B1: two projects of one path that fail with the
 * same kind of error and different messages, stored by neither run, never
 * share one project's failure text; each reads not comparable, and the
 * runs still count. B2 (the human, 2026-11-18, "A: clean checkout"): the
 * green side is HEAD's in a checkout after a frozen install, so an
 * installed dependency that differs from the committed lockfile, with git
 * clean, gives no green pass.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };
const OFF = { "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false } })}\n` };

const PROJECTS = [
  "export default { test: { projects: [",
  '  { test: { name: "assert", include: ["test/*.test.ts"], env: { MODE: "assert" } } },',
  '  { test: { name: "import", include: ["test/*.test.ts"], env: { MODE: "import" } } },',
  "] } };",
  "",
].join("\n");

/** At the old code both projects fail an assertion, each with its own `MODE` in the message. */
const SAME_KIND = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("value", () => {',
  '  if (value === 1) expect(process.env.MODE).toBe("fixed");',
  "  expect(value).toBe(2);",
  "});",
  "",
].join("\n");

function sameKind(config: Readonly<Record<string, string>>) {
  const f = fixture({
    ...config,
    "vitest.config.mjs": PROJECTS,
    "src/a.ts": "export const value = 1;\n",
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: SAME_KIND });
  return { f, a };
}

const NOT_COMPARABLE = [
  ["assert", "not comparable"],
  ["import", "not comparable"],
];

describe("squeal proof review wave-8 re-review (row 023-08)", { timeout: 300_000 }, () => {
  it("B1: unstored projects with different messages of one kind are not given one text (coverage off)", async () => {
    const { f, a } = sameKind(OFF);
    for (const call of [1, 2]) {
      const result = await prove(f, { files: [TEST.path], base: a });
      expect(result.code, `${call}: ${result.err}`).toBe(3);
      expect(result.files.map((x) => [x.project, x.verdict])).toEqual(NOT_COMPARABLE);
      expect(result.files[0]?.reason).toContain("projects failed with different failures");
      expect(result.files[0]?.red).toMatchObject({ from: "run", stored: false, failures: [] });
      expect(result.report.runs).toBe(2);
      expect(result.out).not.toContain("expected 'assert' to be 'fixed'");
    }
    clean(f);
  });

  it("B1: the same when a changed checkout keeps the runs unstored", async () => {
    const { f, a } = sameKind(ON);
    const rewrites = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "vitest.config.mjs": `${PROJECTS}// rewritten by the install\n` });
      return { ok: true as const, command: "rewrites", ms: 0 };
    };
    const result = await prove(
      f,
      { files: [TEST.path], base: a },
      { cacheRoot: f.cacheRoot, install: rewrites },
    );
    expect(result.code, result.err).toBe(3);
    expect(result.files.map((x) => [x.project, x.verdict])).toEqual(NOT_COMPARABLE);
    expect(result.files[0]?.red).toMatchObject({
      from: "run",
      stored: false,
      notStored: "install changed the checkout: vitest.config.mjs",
    });
    expect(result.out).not.toContain("expected 'assert' to be 'fixed'");
    clean(f);
  });

  it.skipIf(PNPM === null)(
    "B2: an installed dependency the committed lockfile does not hold gives no green pass, git clean",
    async () => {
      const pnpm = PNPM as string;
      const vendor = (version: string, value: number) => ({
        [`vendor/${version === "1.0.0" ? "one" : "two"}/package.json`]: `${JSON.stringify({ name: "proof-dep", version, main: "index.js" })}\n`,
        [`vendor/${version === "1.0.0" ? "one" : "two"}/index.js`]: `exports.dependency = ${value};\n`,
      });
      const f = fixture({ ...ON, ...vendor("1.0.0", 9), ...vendor("2.0.0", 2) });
      const data = join(f.dir, "pnpm");
      write(f.root, {
        "package.json": `${JSON.stringify({ name: "fixture", type: "module", dependencies: { "proof-dep": "file:vendor/one" } })}\n`,
        "pnpm-workspace.yaml": ["store", "cache", "state"]
          .map((d) => `${d}Dir: ${join(data, d)}\n`)
          .join(""),
        "src/a.ts": "export const value = 1;\n",
      });
      const pnpmIn = (tree: string, ...args: string[]) =>
        execFileSync(pnpm, [...args, "--offline", "--ignore-scripts"], {
          cwd: tree,
          stdio: "ignore",
        });
      const frozen = async (tree: AbsolutePath) => {
        pnpmIn(tree, "install", "--frozen-lockfile");
        link(tree);
        return { ok: true as const, command: "pnpm install --frozen-lockfile", ms: 0 };
      };
      pnpmIn(f.root, "install");
      link(f.root);
      const a = f.commit({});
      const test = [
        'import { expect, it } from "vitest";',
        'import { dependency } from "proof-dep";',
        'import { value } from "../src/a";',
        'it("value", () => {',
        "  expect(value).toBe(2);",
        "  expect(dependency).toBe(2);",
        "});",
        "",
      ].join("\n");
      f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: test });
      // The installed package is vendor/two; the manifest and lockfile git holds are vendor/one's.
      pnpmIn(f.root, "add", "proof-dep@file:vendor/two");
      git(f.root, "checkout", "--", ".");
      link(f.root);
      expect(git(f.root, "status", "--porcelain")).toBe("");
      const seeded = await runGateFiles({
        root: f.root,
        files: [TEST.path],
        budgetSeconds: 120,
        hostLoad: quiet,
      });
      expect(seeded.runs.map((r) => r.outcome)).toEqual(["passed"]);

      const options = { cacheRoot: f.cacheRoot, install: frozen };
      const drifted = await prove(f, { files: [TEST.path], base: a }, options);
      expect(drifted.code, drifted.err).toBe(1);
      expect(drifted.report.dirty).toEqual([]);
      expect(drifted.files[0]).toMatchObject({
        verdict: "not green",
        green: { end: "fail", from: "run" },
      });

      // The committed install in the working tree too: the same answer, read from HEAD's key.
      await frozen(f.root);
      const installed = await prove(f, { files: [TEST.path], base: a }, options);
      expect(installed.code, installed.err).toBe(1);
      expect(installed.files[0]).toMatchObject({
        verdict: "not green",
        green: { end: "fail", from: "store" },
      });
      clean(f);
    },
  );

  it("reads every file not comparable, with the reason, when the green checkout's install fails", async () => {
    const { f, a } = sameKind(ON);
    const broken = async () => ({
      ok: false as const,
      command: "install",
      ms: 0,
      reason: "exit 1",
      log: "",
    });
    const result = await prove(
      f,
      { files: [TEST.path], base: a },
      { cacheRoot: f.cacheRoot, install: broken },
    );
    expect(result.code, result.err).toBe(3);
    expect(result.report).toMatchObject({ case: null, red: null, runs: 0 });
    expect(result.files).toEqual([
      expect.objectContaining({
        path: TEST.path,
        verdict: "not comparable",
        reason: "install: exit 1",
      }),
    ]);
    clean(f);
  });
});
