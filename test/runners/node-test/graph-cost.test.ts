import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createNodeTestGraph,
  type NodeTestGraph,
} from "../../../src/runners/node-test/graph/index.js";

/**
 * Spec 003 goal 6 and graph test (f) on the 1,000-module fixture: a full
 * re-resolve (add, delete, manifest) costs no more than the cold build, and a
 * plain edit under five percent of it.
 *
 * Task 001-237: a re-resolve is the cold build minus the parse, about 0.8 of
 * it on CI and here, so comparing minima of five unpaired samples flipped
 * whenever the host's noise landed on the re-resolves (CI ratios of 1.00,
 * 1.04 and 1.19 in 66 runs, and under local load). The claim is now held two
 * ways. The work is counted, which no load moves: a re-resolve parses nothing
 * and looks up no more specifiers than the cold build, an edit parses one
 * module and looks up under five percent of them. The time is
 * compared per round, each re-resolve and edit against the cold build just
 * before it, and the median of those ratios is asserted, so a preempted
 * sample or a load that drifts between rounds moves one ratio, not the verdict.
 */

const work = vi.hoisted(() => ({ parses: 0, lookups: 0 }));

vi.mock("../../../src/runners/node-test/graph/parse.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/runners/node-test/graph/parse.js")>();
  return {
    ...actual,
    parseModule: (source: string, name: string) => {
      work.parses++;
      return actual.parseModule(source, name);
    },
  };
});

vi.mock("../../../src/runners/node-test/graph/resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/runners/node-test/graph/resolver.js")>();
  return {
    ...actual,
    createResolver: (...args: Parameters<typeof actual.createResolver>) => {
      const resolver = actual.createResolver(...args);
      return {
        ...resolver,
        resolve: (...lookup: Parameters<typeof resolver.resolve>) => {
          work.lookups++;
          return resolver.resolve(...lookup);
        },
      };
    },
  };
});

const generator = resolve(import.meta.dirname, "../../fixtures/node-test/gen-big.mjs");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-cost-"));
const root = join(scratch, "big");
const testFiles = Array.from(
  { length: 200 },
  (_, t) => `packages/core/test/unit/t${String(t).padStart(3, "0")}.test.ts`,
);
const ROUNDS = 9;

beforeAll(() => {
  execFileSync(process.execPath, [generator, root]);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Cost {
  ms: number;
  parses: number;
  lookups: number;
}

/** The time and the counted work of `fn`. */
async function measured<T>(fn: () => T | Promise<T>): Promise<[T, Cost]> {
  const before = { ...work };
  const started = performance.now();
  const result = await fn();
  const ms = performance.now() - started;
  return [
    result,
    { ms, parses: work.parses - before.parses, lookups: work.lookups - before.lookups },
  ];
}

/** A cold build ends when every closure and the reverse index exist. */
const cold = () =>
  measured(async (): Promise<NodeTestGraph> => {
    const graph = await createNodeTestGraph({
      root,
      cwd: join(root, "packages/core"),
      argv: ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
      testFiles,
    });
    graph.affected([]);
    return graph;
  });

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe("node-test graph: cost at 1,000 modules (f)", () => {
  it("re-resolves no slower than a cold build and re-parses an edit in under 5 % of it", {
    timeout: 60_000,
  }, async () => {
    await cold(); // compiles the lexer and warms the JIT
    const rounds: { cold: Cost; reresolve: Cost; edit: Cost }[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const [graph, built] = await cold();

      const added = `packages/core/src/added${i}.ts`;
      writeFileSync(join(root, added), "export const added = 1;\n");
      const [, reresolve] = await measured(() => {
        graph.invalidate([{ path: added, kind: "add" }]);
        graph.affected([added]);
      });

      const edited = "packages/core/src/m350.ts";
      appendFileSync(join(root, edited), `// edit ${i}\n`);
      const [, edit] = await measured(() => {
        graph.invalidate([{ path: edited, kind: "change" }]);
        graph.affected([edited]);
      });
      rounds.push({ cold: built, reresolve, edit });
    }
    const ratio = (part: "reresolve" | "edit") => median(rounds.map((r) => r[part].ms / r.cold.ms));
    const ms = (part: "cold" | "reresolve" | "edit") => median(rounds.map((r) => r[part].ms));
    const [first] = rounds;
    if (first === undefined) throw new Error("no rounds");
    console.log(
      `node-test graph cost, 1,000 modules, 200 test files, ${ROUNDS} rounds (medians):`,
      {
        cold: `${ms("cold").toFixed(2)} ms, ${first.cold.parses} parses, ${first.cold.lookups} lookups`,
        reresolve: `${ms("reresolve").toFixed(2)} ms (${ratio("reresolve").toFixed(2)} of cold)`,
        edit: `${ms("edit").toFixed(2)} ms (${ratio("edit").toFixed(4)} of cold)`,
      },
    );

    for (const { cold: built, reresolve, edit } of rounds) {
      expect(built.parses).toBeGreaterThan(800); // every module the closures reach, 882
      expect(reresolve.parses).toBe(0); // D4: from cached parses; no closure reaches the added module
      expect(reresolve.lookups).toBeLessThanOrEqual(built.lookups);
      expect(edit.parses).toBe(1);
      expect(edit.lookups).toBeLessThan(built.lookups * 0.05);
    }
    expect(ratio("reresolve")).toBeLessThan(1);
    expect(ratio("edit")).toBeLessThan(0.05);
  });
});
