import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNodeTestGraph,
  type NodeTestGraph,
} from "../../../src/runners/node-test/graph/index.js";

/**
 * Spec 003 goal 6 and graph test (f) on the 1,000-module fixture: a full
 * re-resolve (add, delete, manifest) costs no more than the cold build, and a
 * plain edit under five percent of it. Asserted as ratios of numbers taken
 * side by side, as `structural-cost.test.ts` does, since the host's load
 * moves every absolute number; the cold build itself is logged. Cold build
 * and re-resolve compare minima: a re-resolve is the cold build minus the
 * parse, about a tenth of it, and the host's noise only ever adds time, so
 * medians of five flipped at a load of 67 on 24 cores.
 */

const generator = resolve(import.meta.dirname, "../../fixtures/node-test/gen-big.mjs");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-cost-"));
const root = join(scratch, "big");
const testFiles = Array.from(
  { length: 200 },
  (_, t) => `packages/core/test/unit/t${String(t).padStart(3, "0")}.test.ts`,
);
const ROUNDS = 5;

beforeAll(() => {
  execFileSync(process.execPath, [generator, root]);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A cold build ends when every closure and the reverse index exist. */
async function cold(): Promise<[NodeTestGraph, number]> {
  const started = performance.now();
  const graph = await createNodeTestGraph({
    root,
    cwd: join(root, "packages/core"),
    argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
    testFiles,
  });
  graph.affected([]);
  return [graph, performance.now() - started];
}

function timed(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe("node-test graph: cost at 1,000 modules (f)", () => {
  it("re-resolves no slower than a cold build and re-parses an edit in under 5 % of it", {
    timeout: 60_000,
  }, async () => {
    await cold(); // compiles the lexer and warms the JIT
    const colds: number[] = [];
    const reresolves: number[] = [];
    const edits: number[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const [graph, ms] = await cold();
      colds.push(ms);

      const added = `packages/core/src/added${i}.ts`;
      writeFileSync(join(root, added), "export const added = 1;\n");
      reresolves.push(
        timed(() => {
          graph.invalidate([{ path: added, kind: "add" }]);
          graph.affected([added]);
        }),
      );

      const edited = "packages/core/src/m350.ts";
      appendFileSync(join(root, edited), `// edit ${i}\n`);
      edits.push(
        timed(() => {
          graph.invalidate([{ path: edited, kind: "change" }]);
          graph.affected([edited]);
        }),
      );
    }
    const measured = {
      cold: Math.min(...colds),
      reresolve: Math.min(...reresolves),
      coldMedian: median(colds),
      edit: median(edits),
    };
    console.log(
      `node-test graph cost, 1,000 modules, 200 test files, ${ROUNDS} rounds:`,
      Object.fromEntries(Object.entries(measured).map(([k, ms]) => [k, `${ms.toFixed(2)} ms`])),
    );
    expect(measured.reresolve).toBeLessThan(measured.cold);
    expect(measured.edit).toBeLessThan(measured.coldMedian * 0.05);
  });
});
