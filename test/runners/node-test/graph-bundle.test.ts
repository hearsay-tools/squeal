import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import { bundleOptions } from "../../../src/harness/claude-code/build.js";

/**
 * The plugin is an esbuild bundle installed with no `node_modules` (001 D9,
 * 003 D3 as amended): the graph, bundled with the CLI's options, must inline
 * enhanced-resolve and es-module-lexer and run from a directory that has
 * neither.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-bundle-"));
const edge = resolve(import.meta.dirname, "../../fixtures/node-test/edge");

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("node-test graph: bundle", () => {
  it("inlines both dependencies and builds a closure with no node_modules", {
    timeout: 60_000,
  }, async () => {
    // The shipped options carry the createRequire banner enhanced-resolve needs (002-12, request 006ae93b).
    const options = bundleOptions(scratch);
    expect(options.banner?.js).toContain("createRequire");
    const result = await build({
      ...options,
      entryPoints: [{ in: "src/runners/node-test/graph/index.ts", out: "graph" }],
    });
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    expect(inputs.some((p) => p.startsWith("node_modules/enhanced-resolve/"))).toBe(true);
    expect(inputs.some((p) => p.startsWith("node_modules/es-module-lexer/"))).toBe(true);

    const script = `
      const { createNodeTestGraph } = await import(${JSON.stringify(join(scratch, "graph.mjs"))});
      const graph = await createNodeTestGraph({
        root: ${JSON.stringify(edge)}, cwd: ${JSON.stringify(edge)},
        argv: ["--import", "tsx"], testFiles: ["test/pass.test.ts"],
      });
      console.log(JSON.stringify(graph.closure("test/pass.test.ts").paths));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: scratch,
      encoding: "utf8",
    });
    expect(JSON.parse(out)).toEqual([
      "lib/package.json",
      "lib/src/index.ts",
      "package.json",
      "test/pass.test.ts",
      "tsconfig.json",
    ]);
  });
});
