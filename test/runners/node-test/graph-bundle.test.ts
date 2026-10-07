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

/**
 * enhanced-resolve is CommonJS and `require`s Node builtins, which esbuild's
 * ESM output cannot serve without a `require` in scope. Agreed with the
 * coordinator (request 006ae93b): 002-12 adds this banner to `bundleOptions`;
 * until it lands the test falls back to it, and only when the shipped options
 * carry none.
 */
const REQUIRE_BANNER = {
  js: 'import { createRequire as __squealCreateRequire } from "node:module";\nconst require = __squealCreateRequire(import.meta.url);',
};

const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-graph-bundle-"));
const edge = resolve(import.meta.dirname, "../../fixtures/node-test/edge");

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("node-test graph: bundle", () => {
  it("inlines both dependencies and builds a closure with no node_modules", {
    timeout: 60_000,
  }, async () => {
    const options = bundleOptions(scratch);
    const result = await build({
      ...options,
      banner: options.banner ?? REQUIRE_BANNER,
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
