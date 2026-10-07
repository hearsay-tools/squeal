import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvalidatedPath } from "../../../src/core/types/index.js";
import {
  createNodeTestGraph,
  type NodeTestGraph,
} from "../../../src/runners/node-test/graph/index.js";

/**
 * Spec 003 graph tests (d) and (e) on the 1,000-module fixture of 003-11:
 * after each structural edit, every closure equals a fresh build's (D4's one
 * re-resolve rule), and `affected()` splits direct and transitive as the
 * imports say.
 */

const generator = resolve(import.meta.dirname, "../../fixtures/node-test/gen-big.mjs");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-structural-"));
const root = join(scratch, "big");
const core = join(root, "packages/core");
const argv = ["--import", "../../scripts/preload.mjs", "--import", "tsx"];
const testFiles = Array.from(
  { length: 200 },
  (_, t) => `packages/core/test/unit/t${String(t).padStart(3, "0")}.test.ts`,
);
const SLOW = { timeout: 60_000 } as const;

beforeAll(() => {
  execFileSync(process.execPath, [generator, root]);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const open = () => createNodeTestGraph({ root, cwd: core, argv, testFiles });
const closures = (graph: NodeTestGraph) => testFiles.map((f) => graph.closure(f));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const write = (path: string, text: string) => {
  mkdirSync(resolve(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

/** Applies an edit, invalidates the live graph, and compares it to a fresh build. */
async function expectFreshAfter(graph: NodeTestGraph, edit: () => readonly InvalidatedPath[]) {
  const before = closures(graph);
  graph.invalidate(edit());
  const after = closures(graph);
  expect(after).toEqual(closures(await open()));
  expect(after).not.toEqual(before);
}

describe("node-test graph: structural edits re-resolve to a fresh build's closures (d)", () => {
  it(
    "after a delete, a directory index, a workspace exports edit and a tsconfig paths entry",
    SLOW,
    async () => {
      const graph = await open();

      await expectFreshAfter(graph, () => {
        rmSync(join(root, "packages/core/src/m010.ts"));
        return [{ path: "packages/core/src/m010.ts", kind: "delete" }];
      });

      await expectFreshAfter(graph, () => {
        mkdirSync(join(root, "packages/core/src/m005"));
        renameSync(
          join(root, "packages/core/src/m005.ts"),
          join(root, "packages/core/src/m005/index.ts"),
        );
        return [
          { path: "packages/core/src/m005.ts", kind: "delete" },
          { path: "packages/core/src/m005/index.ts", kind: "add" },
        ];
      });

      await expectFreshAfter(graph, () => {
        const manifest = "packages/util/package.json";
        const json = JSON.parse(read(manifest)) as { exports: Record<string, string> };
        write(
          manifest,
          JSON.stringify({ ...json, exports: { ...json.exports, ".": "./src/u299.ts" } }),
        );
        return [{ path: manifest, kind: "change" }];
      });

      await expectFreshAfter(graph, () => {
        const tsconfig = "packages/core/tsconfig.json";
        const json = JSON.parse(read(tsconfig)) as { compilerOptions: { paths: object } };
        const paths = { "~/m001": ["./src/m699.ts"], ...json.compilerOptions.paths };
        write(tsconfig, JSON.stringify({ compilerOptions: { ...json.compilerOptions, paths } }));
        return [{ path: tsconfig, kind: "change" }];
      });

      // A content edit that drops imports re-parses one module only.
      await expectFreshAfter(graph, () => {
        write("packages/core/src/m699.ts", "export const m699 = (): number => 1;\n");
        return [{ path: "packages/core/src/m699.ts", kind: "change" }];
      });
    },
  );
});

describe("node-test graph: affected (e)", () => {
  /** Test files whose own source imports `module` (the generator's `../../src/mNNN.js` form). */
  const importers = (module: string) =>
    testFiles.filter((f) => read(f).includes(`"../../src/${module}.js"`));

  it(
    "splits a leaf's test files into one-hop importers and the other closure holders",
    SLOW,
    async () => {
      const graph = await open();
      for (const module of ["m001", "m150", "m699"]) {
        const path = `packages/core/src/${module}.ts`;
        const direct = importers(module);
        const holders = testFiles.filter((f) => graph.closure(f).paths.includes(path));
        expect(graph.affected([path])).toEqual({
          direct,
          transitive: holders.filter((f) => !direct.includes(f)),
        });
        expect(direct.length + holders.length).toBeGreaterThan(0);
      }
    },
  );

  it("puts a changed test file in direct and a preload change everywhere", SLOW, async () => {
    const graph = await open();
    expect(graph.affected([testFiles[3] ?? ""])).toEqual({
      direct: [testFiles[3]],
      transitive: [],
    });
    const preload = graph.affected(["scripts/lib/marker.mjs"]);
    expect(preload.direct).toEqual([]);
    expect(preload.transitive).toEqual(testFiles);
  });

  it("keeps a deleted module's importers direct through its candidates", SLOW, async () => {
    const graph = await open();
    const module = /"\.\.\/\.\.\/src\/(m\d+)\.js"/.exec(read(testFiles[0] ?? ""))?.[1] ?? "";
    const path = `packages/core/src/${module}.ts`;
    const source = read(path);
    const direct = importers(module);
    expect(direct).toContain(testFiles[0]);
    rmSync(join(root, path));
    graph.invalidate([{ path, kind: "delete" }]);
    expect(graph.affected([path]).direct).toEqual(expect.arrayContaining(direct));
    write(path, source);
    graph.invalidate([{ path, kind: "add" }]);
  });

  it("makes a test file affected by a path its last run loaded outside the static closure", async () => {
    const graph = await open();
    const outside = "packages/core/fixtures/data.txt";
    expect(graph.affected([outside])).toEqual({ direct: [], transitive: [] });
    graph.recordObserved(testFiles[7] ?? "", [outside]);
    expect(graph.affected([outside])).toEqual({ direct: [], transitive: [testFiles[7]] });
    expect(graph.closure(testFiles[7] ?? "").paths).not.toContain(outside);
  });
});
