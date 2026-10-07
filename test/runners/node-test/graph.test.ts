import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createNodeTestGraph } from "../../../src/runners/node-test/graph/index.js";

/**
 * Spec 003 D3 graph tests (a) to (c) and the `.js`/`.ts` pair note (open
 * question 1), on the fixtures of 003-11. Run on Node 22 and Node 24: the
 * observed closure comes from the Node running this suite.
 */

const fixtures = resolve(import.meta.dirname, "../../fixtures/node-test");
const edge = join(fixtures, "edge");
const reference = join(fixtures, "reference");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-"));
const SLOW = { timeout: 60_000 } as const;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A `module.registerHooks` resolve hook appending `(parent, url)` per process, as D5's recorder will. */
const RECORDER = `import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
const out = \`\${process.env.GRAPH_TEST_EDGES}/graph-\${process.pid}.ndjson\`;
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    appendFileSync(out, JSON.stringify([context.parentURL ?? null, result.url]) + "\\n");
    return result;
  },
});
`;

/**
 * Runs one test file under the recorder, first in the loader chain, and
 * returns the worktree paths reachable from it, `node_modules` excluded.
 */
function observedClosure(root: string, cwd: string, argv: readonly string[], file: string) {
  const dir = mkdtempSync(join(scratch, "observed-"));
  const recorder = join(dir, "recorder.mjs");
  writeFileSync(recorder, RECORDER);
  const run = spawnSync(process.execPath, ["--import", recorder, ...argv, "--test", file], {
    cwd,
    env: { ...process.env, GRAPH_TEST_EDGES: dir },
    encoding: "utf8",
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  const edges = new Map<string, Set<string>>();
  for (const name of readdirSync(dir).filter((f) => f.startsWith("graph-"))) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean)) {
      const [parent, url] = JSON.parse(line) as [string | null, string];
      if (parent === null || !url.startsWith("file:")) continue;
      const children = edges.get(parent) ?? new Set();
      children.add(url);
      edges.set(parent, children);
    }
  }
  const start = `file://${resolve(cwd, file)}`;
  const seen = new Set([start]);
  const stack = [start];
  for (let url = stack.pop(); url !== undefined; url = stack.pop()) {
    for (const child of edges.get(url) ?? []) {
      if (!seen.has(child)) seen.add(child) && stack.push(child);
    }
  }
  return [...seen]
    .map((url) => relative(root, fileURLToPath(url)))
    .filter((p) => !p.startsWith("..") && !p.split("/").includes("node_modules"))
    .sort();
}

const MANIFEST = /(^|\/)(package|tsconfig)\.json$/;

describe("node-test graph: closure of the edge-case file (a)", () => {
  it("holds every static specifier form, the manifests resolution read, and nothing type-only", async () => {
    const graph = await createNodeTestGraph({
      root: edge,
      cwd: edge,
      argv: ["--import", "tsx"],
      testFiles: ["test/forms.test.ts"],
    });
    const closure = graph.closure("test/forms.test.ts");
    expect(closure.paths).toEqual([
      "lib/package.json",
      "lib/src/index.ts",
      "lib/src/sub.ts",
      "package.json",
      "src/barrel.ts",
      "src/data.json",
      "src/dir/index.ts",
      "src/dynamic-literal.ts",
      "src/extensionless.ts",
      "src/hash/target.ts",
      "src/js-means-ts.ts",
      "src/legacy-dep.cjs",
      "src/legacy.cjs",
      "src/paths-target.ts",
      "src/plugins/alpha.ts",
      "src/plugins/beta.ts",
      "src/reexported.ts",
      "test/forms.test.ts",
      "tsconfig.json",
    ]);
    expect(graph.notes()).toEqual([]);
  });

  it(
    "equals the closure a recorder observes, but for the computed import(p) (c)",
    SLOW,
    async () => {
      const graph = await createNodeTestGraph({
        root: edge,
        cwd: edge,
        argv: ["--import", "tsx"],
        testFiles: ["test/forms.test.ts"],
      });
      const closure = graph.closure("test/forms.test.ts");
      const observed = observedClosure(edge, edge, ["--import", "tsx"], "test/forms.test.ts");
      const modules = closure.paths.filter((p) => !MANIFEST.test(p));
      expect(observed.filter((p) => !modules.includes(p))).toEqual(["src/computed-target.ts"]);
      expect(modules.filter((p) => !observed.includes(p))).toEqual([]);
      expect(closure.complete).toBe(false);
      expect(closure.incomplete).toEqual([
        expect.stringMatching(/computed specifier at test\/forms\.test\.ts:44:\d+/),
      ]);
    },
  );
});

describe("node-test graph: preloads and type-only imports (b)", () => {
  const argv = ["--import", "../../scripts/preload.mjs", "--import", "tsx"];
  const testFiles = [
    "packages/demo/test/e2e/package.test.ts",
    "packages/demo/test/unit/math.test.ts",
    "packages/demo/test/unit/title.test.ts",
  ];

  it("keeps the preload's closure apart from every test file's", async () => {
    const graph = await createNodeTestGraph({
      root: reference,
      cwd: join(reference, "packages/demo"),
      argv,
      testFiles,
    });
    expect(graph.preloads()).toEqual({
      // The cwd's package scope is read resolving the preload from it.
      paths: [
        "package.json",
        "packages/demo/package.json",
        "scripts/lib/marker.mjs",
        "scripts/preload.mjs",
      ],
      complete: true,
      incomplete: [],
    });
    expect(graph.closure("packages/demo/test/unit/title.test.ts")).toEqual({
      testFile: "packages/demo/test/unit/title.test.ts",
      paths: [
        "package.json",
        "packages/demo/package.json",
        "packages/demo/src/title.ts",
        "packages/demo/test/unit/title.test.ts",
        "packages/util/package.json",
        "packages/util/src/index.ts",
      ],
      complete: true,
      incomplete: [],
    });
    for (const file of testFiles) {
      expect(graph.closure(file).paths.filter((p) => p.startsWith("scripts/"))).toEqual([]);
    }
  });

  it("matches the observed closure with the preload first in the chain", SLOW, async () => {
    const cwd = join(reference, "packages/demo");
    const graph = await createNodeTestGraph({ root: reference, cwd, argv, testFiles });
    const file = "packages/demo/test/unit/title.test.ts";
    const observed = observedClosure(reference, cwd, argv, relative(cwd, join(reference, file)));
    expect(graph.closure(file).paths.filter((p) => !MANIFEST.test(p))).toEqual(observed);
  });

  it("drops import type targets", async () => {
    const graph = await createNodeTestGraph({
      root: edge,
      cwd: edge,
      argv: ["--import", "tsx"],
      testFiles: ["test/forms.test.ts"],
    });
    expect(graph.closure("test/forms.test.ts").paths).not.toContain("src/types.ts");
  });
});

describe("node-test graph: loader chain", () => {
  it("names a .js/.ts pair under tsx in one note", async () => {
    const root = join(scratch, "pair");
    cpSync(edge, root, { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(root, "src/js-means-ts.js"), 'export const jsMeansTs = () => "js";\n');
    writeFileSync(
      join(root, "src/barrel.ts"),
      'export { reexported } from "./reexported.js";\nexport { jsMeansTs } from "./js-means-ts.js";\n',
    );
    const graph = await createNodeTestGraph({
      root,
      cwd: root,
      argv: ["--import", "tsx"],
      testFiles: ["test/forms.test.ts"],
    });
    expect(graph.notes()).toEqual([
      expect.stringContaining('"src/js-means-ts.js" and "src/js-means-ts.ts"'),
    ]);
  });

  it("resolves with Node's own rules without tsx: explicit extensions only", async () => {
    const graph = await createNodeTestGraph({
      root: edge,
      cwd: edge,
      argv: [],
      testFiles: ["test/forms.test.ts"],
    });
    const closure = graph.closure("test/forms.test.ts");
    // `.ts` named explicitly resolves; `.js` meaning `.ts`, extensionless and paths do not.
    expect(closure.paths).toContain("src/barrel.ts");
    expect(closure.paths).not.toContain("src/js-means-ts.ts");
    expect(closure.paths).not.toContain("src/extensionless.ts");
    expect(closure.paths).not.toContain("src/paths-target.ts");
    // The unresolved specifiers' candidates stand in for them.
    expect(closure.paths).toContain("src/js-means-ts.js");
    expect(closure.paths).toContain("src/extensionless");
    expect(graph.notes()).toEqual([]);
  });

  it("notes an unrecognized loader once and falls back to Node's rules", async () => {
    const graph = await createNodeTestGraph({
      root: edge,
      cwd: edge,
      argv: ["--import", "@swc-node/register/esm-register"],
      testFiles: ["test/forms.test.ts"],
    });
    expect(graph.notes()).toEqual([
      expect.stringContaining('unrecognized loader "@swc-node/register/esm-register"'),
    ]);
    expect(graph.closure("test/forms.test.ts").paths).not.toContain("src/extensionless.ts");
  });
});
