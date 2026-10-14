import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createPytestGraph, type PytestGraph } from "../../../../src/runners/pytest/graph/index.js";
import { findPython, pythonEnv } from "../../../helpers/pytest-env.js";
import { FIXTURES, testFilesOf } from "./helpers.js";

/**
 * Spec 007 goal 6 and the graph tests' cost line, on `gen-big.py`'s 1,000
 * modules and 200 test files without an environment: a full re-resolve
 * after an add costs no more than the cold build, an edit under five
 * percent of it. As 003's cost test (task 001-237), the claim is held two
 * ways: the counted work, which no load moves (a re-resolve parses nothing,
 * an edit parses one module and resolves under five percent of the cold
 * build's names), and the median of per-round time ratios.
 */

const work = vi.hoisted(() => ({ parses: 0, lookups: 0 }));

vi.mock("../../../../src/runners/pytest/graph/parse.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/runners/pytest/graph/parse.js")>();
  return {
    ...actual,
    parsePython: (source: string) => {
      work.parses++;
      return actual.parsePython(source);
    },
  };
});

vi.mock("../../../../src/runners/pytest/graph/resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/runners/pytest/graph/resolver.js")>();
  class Counted extends actual.Resolver {
    override resolve(name: string) {
      work.lookups++;
      return super.resolve(name);
    }
    override member(name: string) {
      work.lookups++;
      return super.member(name);
    }
  }
  return { ...actual, Resolver: Counted };
});

const scratch = mkdtempSync(join(tmpdir(), "squeal-pytest-graph-cost-"));
const root = join(scratch, "big");
const ROUNDS = 9;
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Cost {
  ms: number;
  parses: number;
  lookups: number;
}

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

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe("pytest graph: cost at 1,000 modules", () => {
  it("re-resolves no slower than a cold build and re-parses an edit in under 5 % of it", {
    timeout: 120_000,
  }, async (ctx) => {
    const python = findPython("3.13");
    if (!python.ok) {
      if (process.env.CI) throw new Error(python.reason);
      return ctx.skip(python.reason);
    }
    execFileSync(python.python, ["-I", join(FIXTURES, "gen-big.py"), root], {
      env: pythonEnv(),
      stdio: "ignore",
    });
    const testFiles = testFilesOf(root);
    expect(testFiles).toHaveLength(200);
    /** A cold build ends when every closure and the reverse index exist. */
    const cold = () =>
      measured(async (): Promise<PytestGraph> => {
        const graph = await createPytestGraph({ root, cwd: root, env: null, testFiles });
        graph.affected([]);
        return graph;
      });

    await cold(); // compiles the grammar and warms the JIT
    const rounds: { cold: Cost; reresolve: Cost; edit: Cost }[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const [graph, built] = await cold();

      const added = `src/big/added${i}.py`;
      writeFileSync(join(root, added), "X = 1\n");
      const [, reresolve] = await measured(() => {
        graph.invalidate([{ path: added, kind: "add" }]);
        graph.affected([added]);
      });

      const edited = "src/big/a3/b30/m617.py";
      appendFileSync(join(root, edited), `# edit ${i}\n`);
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
    console.log(`pytest graph cost, 1,000 modules, 200 test files, ${ROUNDS} rounds (medians):`, {
      cold: `${ms("cold").toFixed(2)} ms, ${first.cold.parses} parses, ${first.cold.lookups} lookups`,
      reresolve: `${ms("reresolve").toFixed(2)} ms (${ratio("reresolve").toFixed(2)} of cold)`,
      edit: `${ms("edit").toFixed(2)} ms (${ratio("edit").toFixed(4)} of cold)`,
    });

    for (const { cold: built, reresolve, edit } of rounds) {
      expect(built.parses).toBeGreaterThan(1000); // every module the closures reach
      expect(reresolve.parses).toBe(0); // D5: from cached parses; no closure reaches the added module
      expect(reresolve.lookups).toBeLessThanOrEqual(built.lookups);
      expect(edit.parses).toBe(1);
      expect(edit.lookups).toBeLessThan(built.lookups * 0.05);
    }
    expect(ratio("reresolve")).toBeLessThan(1);
    expect(ratio("edit")).toBeLessThan(0.05);
  });
});
