import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import type { RunReport, TestFileRef } from "../../../src/core/types/index.js";
import { VitestAdapter } from "../../../src/runners/vitest/adapter.js";
import { loadVitest, type VitestNode } from "../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { compareRefs } from "../../../src/runners/vitest/results.js";
import { type FixtureProject, openFixture, paths, ref, SLOW } from "./helpers.js";

/*
 * 013 V7 as amended 2026-10-21 (011-82 row B, row 011-95): the related walk
 * transforms only the test files Squeal lists. Policy `vitest.exclude`
 * leaves `e2e/**` out, as the fixture's `squeal.config.json` would, while
 * Vitest's include matches `e2e/x.test.ts`. On 0.1.245 each `affected`
 * loaded the excluded file into the instance, and its next write during a
 * run withheld every finished file (task 001-146's fallback).
 */

const EXCLUDED = "e2e/x.test.ts";
const MATH = ref("test/math.test.ts");
const STRINGS = ref("test/strings.test.ts");
const GREETING = ref("test/greeting.test.ts");
const HELD = ref("test/held.test.ts");

/** Vitest includes the excluded suite; Squeal lists none of it. */
const INCLUDE = 'export const include = ["test/**/*.test.ts", "e2e/**/*.test.ts"];\n';

const excludedTest = (n: number) =>
  [
    'import { expect, it } from "vitest";',
    `it("e2e ${n}", () => expect(${n}).toBe(${n}));`,
    "",
  ].join("\n");

const markerDirs: string[] = [];
// Before the fixture's own `afterEach` closes the adapter: removing the hold releases the worker.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Markers a held test file waits on: `started` once it runs, then until `hold` is gone. */
function markers(): { hold: string; started: string; release: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "squeal-011-95-"));
  markerDirs.push(dir);
  const hold = join(dir, "hold");
  writeFileSync(hold, "");
  return {
    hold,
    started: join(dir, "started"),
    release: () => rmSync(hold, { force: true }),
  };
}

/** Writes `started` after `before`, then waits while `hold` exists. */
function heldTest(hold: string, started: string, before: readonly string[] = []): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'it("waits for the hold", async () => {',
    ...before,
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "  expect(1).toBe(1);",
    "}, 120_000);",
    "",
  ].join("\n");
}

/** The adapter over `basic` with `files`, excluding `e2e/**`, and its Vitest instance. */
async function open(
  files: Readonly<Record<string, string>>,
): Promise<{ fx: FixtureProject; vitest: () => Vitest }> {
  let instance: Vitest | null = null;
  const fx = await openFixture("basic", { "vitest.shared.ts": INCLUDE, ...files }, async (root) => {
    const real = await loadVitest(realpathSync(root));
    const node = {
      ...real,
      createVitest: async (...args: Parameters<VitestNode["createVitest"]>) => {
        instance = await real.createVitest(...args);
        return instance;
      },
    } as VitestNode;
    const excludeFiles = () => ["e2e/**"];
    const adapter = new VitestAdapter(
      new WorktreePaths(realpathSync(root)),
      node,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      excludeFiles,
    );
    await adapter.open();
    return adapter;
  });
  return {
    fx,
    vitest: () => {
      if (instance === null) throw new Error("no Vitest instance");
      return instance;
    },
  };
}

/** Whether any environment of any project holds a module of `path`. */
function inGraph(vitest: Vitest, fx: FixtureProject, path: string): boolean {
  const file = join(realpathSync(fx.root), path);
  return vitest.projects.some((project) =>
    Object.values(project.vite.environments).some(
      (environment) => (environment.moduleGraph.getModulesByFile(file)?.size ?? 0) > 0,
    ),
  );
}

const sorted = (refs: readonly TestFileRef[] | undefined) =>
  [...(refs ?? [])].sort(compareRefs).map((r) => r.path);

/** A run of `files` whose held file is inside its test once this resolves. */
async function heldRun(
  fx: FixtureProject,
  files: readonly TestFileRef[],
  started: string,
): Promise<{ readonly report: Promise<RunReport> }> {
  const report = fx.adapter.run(files, fx.runOptions());
  await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
  return { report };
}

describe("vitest adapter: the related walk loads only listed test files (011-95)", SLOW, () => {
  it("withholds nothing when an excluded test file changes during a run", async () => {
    const hold = markers();
    const { fx } = await open({
      [HELD.path]: heldTest(hold.hold, hold.started),
    });
    const tier = [GREETING, HELD, MATH, STRINGS];
    const { report: run } = await heldRun(fx, tier, hold.started);

    // Revisions that write only the excluded file, each with its runner part.
    fx.write(EXCLUDED, excludedTest(1));
    await fx.adapter.invalidate([{ path: EXCLUDED, kind: "add" }]);
    expect(await fx.adapter.testFiles()).not.toContainEqual(ref(EXCLUDED));
    expect(paths(await fx.adapter.affected([EXCLUDED]))).toEqual([]);
    for (const n of [2, 3]) {
      fx.write(EXCLUDED, excludedTest(n));
      await fx.adapter.invalidate([{ path: EXCLUDED, kind: "change" }]);
      expect(paths(await fx.adapter.affected([EXCLUDED]))).toEqual([]);
    }

    hold.release();
    const report = await run;
    expect(report.failure).toBeNull();
    expect(report.withheld ?? []).toEqual([]);
    expect(sorted(report.completedFiles)).toEqual(sorted(tier));
  });

  it("leaves an excluded test file out of the module graph after a walk", async () => {
    const { fx, vitest } = await open({ [EXCLUDED]: excludedTest(1) });
    expect(paths(await fx.adapter.affected(["src/math.ts"]))).toEqual([
      "test/each.test.ts",
      MATH.path,
    ]);
    expect(inGraph(vitest(), fx, MATH.path)).toBe(true);
    expect(inGraph(vitest(), fx, EXCLUDED)).toBe(false);
  });

  it("finds every listed importer, through an excluded file too", async () => {
    const { fx, vitest } = await open({
      "src/leaf.ts": 'export const leaf = "leaf";\n',
      "src/middle.ts": 'export { leaf } from "./leaf.ts";\n',
      "test/direct.test.ts": [
        'import { expect, it } from "vitest";',
        'import { leaf } from "../src/leaf.ts";',
        'it("reads leaf", () => expect(leaf).toBe("leaf"));',
        "",
      ].join("\n"),
      "test/indirect.test.ts": [
        'import { expect, it } from "vitest";',
        'import { leaf } from "../src/middle.ts";',
        'it("reads leaf", () => expect(leaf).toBe("leaf"));',
        "",
      ].join("\n"),
      // An excluded test file that only exports: a listed file imports it.
      [EXCLUDED]: 'export { leaf as shared } from "../src/leaf.ts";\n',
      "test/through.test.ts": [
        'import { expect, it } from "vitest";',
        'import { shared } from "../e2e/x.test.ts";',
        'it("reads shared", () => expect(shared).toBe("leaf"));',
        "",
      ].join("\n"),
    });
    const leaf = await fx.adapter.affected(["src/leaf.ts"]);
    expect(paths(leaf)).toEqual([
      "test/direct.test.ts",
      "test/indirect.test.ts",
      "test/through.test.ts",
    ]);
    expect(paths(leaf.direct)).toEqual(["test/direct.test.ts"]);
    expect(paths(await fx.adapter.affected([EXCLUDED]))).toEqual(["test/through.test.ts"]);
    expect(inGraph(vitest(), fx, EXCLUDED)).toBe(true);
  });

  it("still withholds every file when a computed import() target moves during the run (001-146)", async () => {
    const hold = markers();
    const computed = ref("test/computed.test.ts");
    const { fx } = await open({
      "src/dyn.ts": 'export const dyn = "old";\n',
      [computed.path]: heldTest(hold.hold, hold.started, [
        '  const target = "../src/dyn" + ".ts";',
        "  const { dyn } = await import(/* @vite-ignore */ target);",
        '  expect(dyn).toBe("old");',
      ]),
    });
    const tier = [computed, MATH, STRINGS];
    const { report: run } = await heldRun(fx, tier, hold.started);

    fx.write("src/dyn.ts", 'export const dyn = "new";\n');
    await fx.adapter.invalidate([{ path: "src/dyn.ts", kind: "change" }]);
    await fx.adapter.affected(["src/dyn.ts"]);

    hold.release();
    const report = await run;
    expect(report.completedFiles).toEqual([]);
    expect(sorted(report.withheld)).toEqual(sorted(tier));
    expect(report.failure).toContain("src/dyn.ts changed on disk after this run loaded it");
  });
});
