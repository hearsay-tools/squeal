import { describe, expect, it } from "vitest";
import { openFixture, paths, SLOW } from "./helpers.js";

const MODULES = 1000;
const TESTS = 200;
const ROUNDS = 5;

/** A binary tree of source modules, `m0` at the root, and one test file per top module. */
function largeGraph(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < MODULES; i++) {
    const children = [2 * i + 1, 2 * i + 2].filter((c) => c < MODULES);
    files[`src/gen/m${i}.ts`] = [
      ...children.map((c) => `import { v${c} } from "./m${c}";`),
      `export const v${i} = ${children.map((c) => `v${c}`).join(" + ") || "1"};`,
      "",
    ].join("\n");
  }
  for (let j = 0; j < TESTS; j++) files[`test/gen/t${j}.test.ts`] = testImporting(j);
  return files;
}

function testImporting(module: number): string {
  return [
    'import { expect, it } from "vitest";',
    `import { v${module} } from "../../src/gen/m${module}";`,
    `it("reads m${module}", () => expect(v${module}).toBeGreaterThan(0));`,
    "",
  ].join("\n");
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = performance.now();
  const result = await fn();
  return [result, performance.now() - started];
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/*
 * Lessons, defect 11: after an add, `affected` re-transformed the whole graph
 * (5.3 s against 0.5 s warm on 516 test files). Task 001-53: an add
 * re-transforms only the importers it can re-resolve, so `affected` after it
 * costs about what it costs after a plain edit. The graph is large enough that
 * the walk, not one transform, dominates. The add's `invalidate` is reported
 * apart: its first call scans the source of every module once (001-56, D4).
 */
describe("vitest adapter: affected() after an add on a large graph", SLOW, () => {
  it("stays under a quarter of the cold walk", async () => {
    const fx = await openFixture("basic", largeGraph());
    const [, cold] = await timed(() => fx.adapter.affected(["src/gen/m100.ts"]));

    const warm: number[] = [];
    const afterAdd: number[] = [];
    const invalidateAdd: number[] = [];
    const afterEdit: number[] = [];
    const sourceWarm: number[] = [];
    const sourceAfterAdd: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      // A new test file: its own transform and a fresh test glob are part of the cost.
      const added = `test/gen/new${i}.test.ts`;
      fx.write(added, testImporting(i));
      invalidateAdd.push(
        (await timed(() => fx.adapter.invalidate([{ path: added, kind: "add" }])))[1],
      );
      const [result, ms] = await timed(() => fx.adapter.affected([added]));
      expect(paths(result)).toEqual([added]);
      afterAdd.push(ms);
      warm.push((await timed(() => fx.adapter.affected([added])))[1]);
      fx.write(added, `${testImporting(i)}// edited\n`);
      await fx.adapter.invalidate([{ path: added, kind: "change" }]);
      afterEdit.push((await timed(() => fx.adapter.affected([added])))[1]);

      // A new source file that an existing module imported before it existed.
      const missing = `src/gen/later${i}.ts`;
      fx.write(
        `src/gen/m${150 + i}.ts`,
        `import "./later${i}";\n${fx.read(`src/gen/m${150 + i}.ts`)}`,
      );
      await fx.adapter.invalidate([{ path: `src/gen/m${150 + i}.ts`, kind: "change" }]);
      await fx.adapter.affected([`src/gen/m${150 + i}.ts`]);
      fx.write(missing, "export {};\n");
      await fx.adapter.invalidate([{ path: missing, kind: "add" }]);
      const [importers, sourceMs] = await timed(() => fx.adapter.affected([missing]));
      expect(paths(importers)).toContain(`test/gen/t${150 + i}.test.ts`);
      sourceAfterAdd.push(sourceMs);
      sourceWarm.push((await timed(() => fx.adapter.affected([missing])))[1]);
    }

    const measured = {
      cold,
      warm: median(warm),
      firstInvalidateAdd: invalidateAdd[0] ?? 0,
      invalidateAdd: median(invalidateAdd),
      afterAdd: median(afterAdd),
      afterEdit: median(afterEdit),
      sourceWarm: median(sourceWarm),
      sourceAfterAdd: median(sourceAfterAdd),
    };
    console.log(
      `structural cost, ${MODULES} modules + ${TESTS + ROUNDS} test files, median of ${ROUNDS}:`,
      Object.fromEntries(Object.entries(measured).map(([k, ms]) => [k, `${ms.toFixed(1)} ms`])),
    );
    // The ratios to the warm walk are reported, not asserted: an add carries a
    // fixed cost (re-globbing test files, transforming the new one) of about
    // 20 ms on CI against a 13 ms warm walk (reviews/wave-7.md B2). The guard
    // against a return of whole-graph invalidation is the deliberately loose
    // bound below, about 15 times on CI. `cold` is one sample on purpose: at
    // that margin its noise does not matter, so do not tighten it.
    expect(measured.afterAdd).toBeLessThan(measured.cold / 4);
    expect(measured.sourceAfterAdd).toBeLessThan(measured.cold / 4);
  });
});
