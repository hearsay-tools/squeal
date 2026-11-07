import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { configImports, scanImports } from "../../src/core/store/config-imports.js";
import { tempDir } from "./helpers.js";

/* Review 0.1.415 B3: the config walk's edges, from the config files a runner bundled. */

function tree(files: Record<string, string>): string {
  const root = tempDir("squeal-config-imports-");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("scanImports", () => {
  it("reads static and dynamic specifiers, without type-only ones or comments", () => {
    const source = [
      '// import { gone } from "./commented.js";',
      "/* export * from './block.js'; */",
      'import { defineConfig } from "vitest/config";',
      'import type { Shape } from "./types.js";',
      "import Reporter, { type Options } from './reporter.js';",
      'import "./side-effect.js";',
      'export * from "./shared.js";',
      'export type { T } from "./types-again.js";',
      'export { a as b } from "./named.js";',
      'const url = "https://example.com/x";',
      'export const later = () => import("./lazy.js");',
      "",
    ].join("\n");
    expect(scanImports(source)).toEqual({
      static: ["vitest/config", "./reporter.js", "./side-effect.js", "./shared.js", "./named.js"],
      dynamic: ["./lazy.js"],
    });
  });
});

describe("configImports", () => {
  it("names a listed file a relative import reaches, and leaves packages, types and meta out", () => {
    const root = tree({
      "vitest.config.ts": [
        'import { defineConfig } from "vitest/config";',
        'import type { Shape } from "./src/types.js";',
        'import Reporter from "./src/reporter.js";',
        'import { include } from "./config";',
        "const here = import.meta.url;",
        'export const later = () => import("./src/lazy.mjs");',
        "export default defineConfig({ test: { include, reporters: [new Reporter()] } });",
        "",
      ].join("\n"),
      "src/reporter.ts": "export default class Reporter {}\n",
      "src/types.ts": "export interface Shape { readonly n: number }\n",
      "src/lazy.mts": "export const lazy = 1;\n",
      "config/index.ts": 'export const include = ["test/**/*.test.ts"];\n',
      "data.json": "{}\n",
    });
    const listed = [
      "vitest.config.ts",
      "src/reporter.ts",
      "src/types.ts",
      "src/lazy.mts",
      "config/index.ts",
      "data.json",
    ];

    const edges = Object.fromEntries(
      configImports(root, listed).map((f) => [f.path, [f.static, f.dynamic]]),
    );
    expect(edges["vitest.config.ts"]).toEqual([
      ["config/index.ts", "src/reporter.ts"],
      ["src/lazy.mts"],
    ]);
    expect(edges["src/reporter.ts"]).toEqual([[], []]);
    // JSON is no module the lexer reads.
    expect(edges["data.json"]).toBeUndefined();
  });

  it("leaves out a file it cannot read, and an import of a file the runner did not list", () => {
    const root = tree({ "vitest.config.ts": 'import "./unlisted.js";\nexport default {};\n' });
    expect(configImports(root, ["vitest.config.ts", "gone.ts"])).toEqual([
      expect.objectContaining({ path: "vitest.config.ts", static: [], dynamic: [] }),
    ]);
  });
});
