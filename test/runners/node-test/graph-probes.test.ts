import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";
import { MANIFEST, observedClosure } from "./graph-observed.js";

/**
 * The three closure misses of `reviews/wave-1.md` (S1 to S3) and nits N3 and
 * N6, on `test/fixtures/node-test/monorepo/`: each static closure equals what
 * a run under tsx loads, and an edit to the file the review saw missed makes
 * its test file affected before any run. Run on Node 22 and Node 24.
 */

const root = resolve(import.meta.dirname, "../../fixtures/node-test/monorepo");
const SLOW = { timeout: 60_000 } as const;
const TSX = ["--import", "tsx"];

const modules = (paths: readonly string[]) => paths.filter((p) => !MANIFEST.test(p));

describe("node-test graph: tsconfig paths inherited through extends (S1)", () => {
  const cwd = join(root, "packages/app");
  const file = "packages/app/test/extends.test.ts";

  it("rebases the base's paths onto the base's directory", SLOW, async () => {
    const graph = await createNodeTestGraph({ root, cwd, argv: TSX, testFiles: [file] });
    const closure = graph.closure(file);
    expect(closure).toEqual({
      testFile: file,
      paths: [
        "packages/app/package.json",
        "packages/app/src/x.ts",
        "packages/app/test/extends.test.ts",
        "packages/app/tsconfig.json",
        "tsconfig.base.json",
      ],
      complete: true,
      incomplete: [],
    });
    expect(modules(closure.paths)).toEqual(observedClosure(root, cwd, TSX, "test/extends.test.ts"));
    expect(graph.affected(["packages/app/src/x.ts"])).toEqual({ direct: [file], transitive: [] });
  });

  it("takes an absent node_modules directory for no candidate (N3)", async () => {
    const graph = await createNodeTestGraph({ root, cwd, argv: TSX, testFiles: [file] });
    expect(graph.closure(file).paths.filter((p) => /(^|\/)node_modules$/.test(p))).toEqual([]);
  });
});

describe("node-test graph: conditions follow the module format tsx gives the importer (S2)", () => {
  const cwd = join(root, "packages/legacy");
  const file = "packages/legacy/test/dual.test.ts";

  it("resolves an import in a CommonJS-typed package with require", SLOW, async () => {
    const graph = await createNodeTestGraph({ root, cwd, argv: TSX, testFiles: [file] });
    const closure = graph.closure(file);
    expect(modules(closure.paths)).toEqual(["packages/dual/src/cjs.cjs", file]);
    expect(closure.complete).toBe(true);
    expect(modules(closure.paths)).toEqual(observedClosure(root, cwd, TSX, "test/dual.test.ts"));
    expect(graph.affected(["packages/dual/src/cjs.cjs"])).toEqual({
      direct: [file],
      transitive: [],
    });
    expect(graph.affected(["packages/dual/src/esm.mjs"])).toEqual({ direct: [], transitive: [] });
  });
});

describe("node-test graph: a computed require (N6)", () => {
  const cwd = join(root, "packages/legacy");
  const file = "packages/legacy/test/computed.test.ts";

  it("marks the closure incomplete where the run loads a file the scan missed", SLOW, async () => {
    const graph = await createNodeTestGraph({ root, cwd, argv: TSX, testFiles: [file] });
    const closure = graph.closure(file);
    expect(closure.complete).toBe(false);
    expect(closure.incomplete).toEqual([
      "require() with a computed specifier at packages/legacy/test/computed.test.ts:7:16",
    ]);
    const observed = observedClosure(root, cwd, TSX, "test/computed.test.ts");
    expect(observed.filter((p) => !closure.paths.includes(p))).toEqual([
      "packages/legacy/src/target.cjs",
    ]);
  });
});

describe("node-test graph: a bare-specifier preload (S3)", () => {
  const cwd = join(root, "packages/app");
  const argv = ["--import", "@mono/setup", ...TSX];
  const testFiles = ["packages/app/test/extends.test.ts"];

  it("roots the preload closure at a workspace package", async () => {
    const graph = await createNodeTestGraph({ root, cwd, argv, testFiles });
    const preloads = graph.preloads();
    expect(modules(preloads.paths)).toEqual([
      "packages/setup/helper.mjs",
      "packages/setup/index.mjs",
    ]);
    expect(preloads.complete).toBe(true);
    expect(graph.notes()).toEqual([]);
    expect(graph.affected(["packages/setup/helper.mjs"])).toEqual({
      direct: [],
      transitive: testFiles,
    });
    // The preload stays out of the test's closure, as relative preloads do.
    expect(graph.closure(testFiles[0] ?? "").paths).not.toContain("packages/setup/index.mjs");
  });

  it("leaves a preload under node_modules to the dependency fingerprint, with a note", async () => {
    // `acorn` resolves to the repository's node_modules, as an installed loader would.
    const graph = await createNodeTestGraph({
      root,
      cwd,
      argv: ["--import", "acorn", ...TSX],
      testFiles,
    });
    // Resolving it reads the cwd's manifests; no module of it enters the preload closure.
    expect(modules(graph.preloads().paths)).toEqual([]);
    expect(graph.notes()).toEqual([expect.stringContaining('unrecognized loader "acorn"')]);
  });
});
