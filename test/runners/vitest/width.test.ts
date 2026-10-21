import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { type FixtureProject, openFixture, ref, SLOW } from "./helpers.js";

/*
 * Spec 001 D11 Capacity, task 001-378: a backlog or checkpoint tier's
 * Vitest workers are its grant (`RunOptions.workers`), at least 2 for a
 * project with `isolate: false` unless it set 1 (011 C10 as amended
 * 2026-10-21, row 011-97), never above the project's own `maxWorkers`. A run without a
 * grant (an edit's tier) runs as the project's config says. Probe P1: the
 * warm instance is resized, not recreated. Each file records its
 * `VITEST_POOL_ID`, which runs from 1 to the run's `maxWorkers`.
 */

const FILES = 8;

const config = (test: string) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/w/*.test.ts"]${test} } });\n`;

const recorder = (name: string) => `import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
it("records its worker", () => {
  const dir = new URL("../../ids/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("${name}", dir), process.env.VITEST_POOL_ID ?? "");
});
`;

function fixture(test = "", create?: (root: string) => ReturnType<typeof createVitestAdapter>) {
  const files: Record<string, string> = { "vitest.config.ts": config(test) };
  for (let i = 0; i < FILES; i++) files[`test/w/f${i}.test.ts`] = recorder(`f${i}`);
  return openFixture("basic", files, create);
}

const refs = Array.from({ length: FILES }, (_, i) => ref(`test/w/f${i}.test.ts`));

/** Each file's worker id in one run of `files`, granted `workers` when given. */
async function workerIds(
  fx: FixtureProject,
  files: readonly TestFileRef[],
  workers?: number,
): Promise<Map<string, number>> {
  const ids = join(fx.root, "ids");
  rmSync(ids, { recursive: true, force: true });
  const report = await fx.adapter.run(
    files,
    fx.runOptions(workers === undefined ? {} : { workers }),
  );
  expect(report.failure).toBeNull();
  expect(report.results.filter((r) => r.outcome === "pass")).toHaveLength(files.length);
  const seen = new Map(
    readdirSync(ids).map((f) => [f, Number(readFileSync(join(ids, f), "utf8"))]),
  );
  expect(seen.size).toBe(files.length);
  return seen;
}

/** The widest worker id of one run of every file, granted `workers` when given. */
async function widest(fx: FixtureProject, workers?: number): Promise<number> {
  return Math.max(...(await workerIds(fx, refs, workers)).values());
}

describe("vitest adapter: workers from the grant (001-378)", SLOW, () => {
  it("runs each granted tier at its grant on one warm instance", async () => {
    const fx = await fixture(", maxWorkers: 6");
    expect(await widest(fx, 3)).toBe(3);
    expect(await widest(fx, 5)).toBe(5);
    expect(await widest(fx, 2)).toBe(2);
    // An edit's tier has no grant: the project's own width again.
    expect(await widest(fx)).toBe(6);
  });

  it("never runs wider than the project's own maxWorkers", async () => {
    const fx = await fixture(", maxWorkers: 2");
    expect(await widest(fx, 7)).toBe(2);
    expect(await widest(fx)).toBe(2);
  });

  it("holds a project's ceiling of 1, runs an isolated project at a grant of 1, and floors isolate: false at 2", async () => {
    const one = await fixture(", maxWorkers: 1");
    expect(await widest(one, 4)).toBe(1);
    const unset = await fixture();
    expect(await widest(unset, 1)).toBe(1);
    // One worker would take every file of a project that does not isolate them (row 011-97).
    const shared = await fixture(", isolate: false");
    expect(await widest(shared, 1)).toBe(2);
    const sharedOne = await fixture(", isolate: false, maxWorkers: 1");
    expect(await widest(sharedOne, 4)).toBe(1);
  });

  /*
   * Row 011-97's risk: Vitest's `groupSpecs` puts an isolated project of
   * group 0 whose config says 1 into a last group of its own, and throws when
   * two projects of one group resolve to different widths. A project with
   * neither its own `maxWorkers` nor the root's reads the root's written
   * width, so at a grant of 1 it would run at 1 beside an `isolate: false`
   * project at 2. Its tier never runs so: the `isolate: false` file makes
   * the tier's floor 2, which it waits for.
   */
  it("runs an isolated project's files alone at 1 beside an isolate: false project of one group, and both at 2", async () => {
    const projects = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { projects: [
  { extends: true, test: { name: "a", include: ["test/w/*.test.ts"] } },
  { extends: true, test: { name: "b", include: ["test/v/*.test.ts"], isolate: false, maxWorkers: 3 } },
] } });
`;
    const files: Record<string, string> = { "vitest.config.ts": projects };
    const a: TestFileRef[] = [];
    const b: TestFileRef[] = [];
    for (let i = 0; i < 4; i++) {
      files[`test/w/a${i}.test.ts`] = recorder(`a${i}`);
      files[`test/v/b${i}.test.ts`] = recorder(`b${i}`);
      a.push(ref(`test/w/a${i}.test.ts`, "a"));
      b.push(ref(`test/v/b${i}.test.ts`, "b"));
    }
    const fx = await openFixture("basic", files);
    expect(Math.max(...(await workerIds(fx, a, 1)).values())).toBe(1);
    expect(fx.adapter.tierWidth?.(a[0] ?? ref("x"), 1)).toBe(1);
    expect(fx.adapter.tierWidth?.(b[0] ?? ref("x"), 1)).toBe(2);
    const both = await workerIds(fx, [...a, ...b], 2);
    expect(Math.max(...both.values())).toBeLessThanOrEqual(2);
  });

  it("holds each project's own ceiling, inherited from the root or its own", async () => {
    const projects = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { maxWorkers: 3, projects: [
  { extends: true, test: { name: "a", include: ["test/w/*.test.ts"] } },
  { extends: true, test: { name: "b", include: ["test/v/*.test.ts"], maxWorkers: 2, sequence: { groupOrder: 1 } } },
] } });
`;
    const files: Record<string, string> = { "vitest.config.ts": projects };
    const both: TestFileRef[] = [];
    for (let i = 0; i < 6; i++) {
      files[`test/w/a${i}.test.ts`] = recorder(`a${i}`);
      files[`test/v/b${i}.test.ts`] = recorder(`b${i}`);
      both.push(ref(`test/w/a${i}.test.ts`, "a"), ref(`test/v/b${i}.test.ts`, "b"));
    }
    const fx = await openFixture("basic", files);
    const widestOf = (ids: Map<string, number>, project: string) =>
      Math.max(...[...ids].filter(([name]) => name.startsWith(project)).map(([, id]) => id));
    const granted = await workerIds(fx, both, 6);
    expect([widestOf(granted, "a"), widestOf(granted, "b")]).toEqual([3, 2]);
    const narrow = await workerIds(fx, both, 2);
    expect([widestOf(narrow, "a"), widestOf(narrow, "b")]).toEqual([2, 2]);
  });

  it("holds the ceiling for an instance created with a width of its own (the slow tier's)", async () => {
    const fx = await fixture(", maxWorkers: 2", (root) =>
      createVitestAdapter({ root, maxWorkers: 4 }),
    );
    expect(await widest(fx)).toBe(2);
    const open = await fixture(", maxWorkers: 6", (root) =>
      createVitestAdapter({ root, maxWorkers: 4 }),
    );
    expect(await widest(open)).toBe(4);
    expect(await widest(open, 5)).toBe(5);
  });

  it("keys no width: the environment is the same at every grant", async () => {
    const fx = await fixture(", maxWorkers: 6");
    const environment = async () => (await fx.adapter.environment())[0]?.resolvedConfig;
    const before = await environment();
    expect(before).toBeDefined();
    expect(JSON.parse(before ?? "{}")).not.toHaveProperty("maxWorkers");
    await widest(fx, 3);
    expect(await environment()).toBe(before);
  });
});

/*
 * Review 001-394 B2: the files a slow run starts at once, which the slow tier
 * takes (spec 004 D2): every file of a tier starts at once, none after an
 * edit or a close, so a tier is never wider than the project's own width.
 */
describe("vitest adapter: the slow width it reports (review 001-394 B2)", SLOW, () => {
  const four = refs.slice(0, 4);

  it("is the project's own maxWorkers, 1 included, and every file without one", async () => {
    expect((await fixture(", maxWorkers: 2")).adapter.slowWidth?.(four)).toBe(2);
    expect((await fixture(", maxWorkers: 1")).adapter.slowWidth?.(four)).toBe(1);
    expect((await fixture()).adapter.slowWidth?.(four)).toBe(4);
    expect((await fixture(", maxWorkers: 6")).adapter.slowWidth?.(four)).toBe(4);
  });

  it("starts that many at once on the slow tier's instance", async () => {
    const make = (root: string) => createVitestAdapter({ root, maxWorkers: 4 });
    for (const [test, width] of [
      [", maxWorkers: 2", 2],
      ["", 4],
    ] as const) {
      const fx = await fixture(test, make);
      const files = four.slice(0, fx.adapter.slowWidth?.(four));
      expect(files).toHaveLength(width);
      // One worker each: none waits for another's end.
      expect(new Set((await workerIds(fx, files)).values()).size).toBe(width);
    }
  });

  it("stops at a project of another group, and holds each project's own ceiling", async () => {
    const projects = `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { maxWorkers: 3, projects: [
  { extends: true, test: { name: "a", include: ["test/w/*.test.ts"] } },
  { extends: true, test: { name: "b", include: ["test/v/*.test.ts"], maxWorkers: 2, sequence: { groupOrder: 1 } } },
] } });
`;
    const fx = await openFixture("basic", { "vitest.config.ts": projects });
    const a = (i: number) => ref(`test/w/a${i}.test.ts`, "a");
    const b = (i: number) => ref(`test/v/b${i}.test.ts`, "b");
    expect(fx.adapter.slowWidth?.([a(0), a(1), a(2), a(3)])).toBe(3);
    expect(fx.adapter.slowWidth?.([b(0), b(1), b(2), b(3)])).toBe(2);
    expect(fx.adapter.slowWidth?.([a(0), b(0), a(1)])).toBe(1);
  });
});

/*
 * Spec 011 C4 step 5 (task 001-366): a backlog tier is budgeted by its wall
 * time over the workers it runs with, which the adapter reports at the
 * pool's offer: `tierWidth` under the project's own `maxWorkers`.
 */
describe("vitest adapter: the backlog tier's width it reports (001-366)", SLOW, () => {
  it("is the offer under the project's ceiling, at least 2 for isolate: false, and a ceiling of 1 kept", async () => {
    const four = await fixture(", maxWorkers: 4");
    expect(four.adapter.tierWidth?.(refs[0] ?? ref("x"), 23)).toBe(4);
    expect(four.adapter.tierWidth?.(refs[0] ?? ref("x"), 1)).toBe(1);
    const shared = await fixture(", isolate: false, maxWorkers: 4");
    expect(shared.adapter.tierWidth?.(refs[0] ?? ref("x"), 1)).toBe(2);
    const unset = await fixture();
    expect(unset.adapter.tierWidth?.(refs[0] ?? ref("x"), 23)).toBe(23);
    const one = await fixture(", maxWorkers: 1");
    expect(one.adapter.tierWidth?.(refs[0] ?? ref("x"), 23)).toBe(1);
  });
});
