import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinsPlugin } from "../../src/harness/builtins.js";
import { bundleOptions } from "../../src/harness/claude-code/build.js";
import { bridgeBundleOptions } from "../../src/harness/opencode/build.js";
import { observeMetafile } from "../helpers/build-inputs.js";
import { tempDir } from "../store/helpers.js";

/*
 * Row 025-16 (`research/hook-bundles.md` sections 2 and 4): no Node bundle
 * imports a builtin through the ESM facade; each reads it with
 * `process.getBuiltinModule`.
 */

/** The full suite runs several esbuild builds at once. */
const BUILD = { timeout: 60_000 };

/** The static or dynamic `import`s of a builtin that `output` kept. */
function builtinImports(output: Metafile["outputs"][string]): string[] {
  return output.imports
    .filter((i) => i.kind === "import-statement" || i.kind === "dynamic-import")
    .filter((i) => isBuiltin(i.path))
    .map((i) => `${i.kind} ${i.path}`);
}

describe("the Claude Code bundles", () => {
  let outdir = "";
  let metafile: Metafile;
  beforeAll(async () => {
    outdir = mkdtempSync(join(tmpdir(), "squeal-builtins-bundle-"));
    metafile = (await build(bundleOptions(outdir))).metafile as Metafile;
    observeMetafile(metafile);
  }, BUILD.timeout);
  afterAll(() => rmSync(outdir, { recursive: true, force: true }));

  it("import no builtin: the hooks, the CLI and its workers", () => {
    const bundles = Object.entries(metafile.outputs).filter(([path]) => path.endsWith(".mjs"));
    expect(bundles.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/stop\.mjs$/),
        expect.stringMatching(/cli\/squeal\.mjs$/),
      ]),
    );
    for (const [path, output] of bundles) expect(builtinImports(output), path).toEqual([]);
  });

  it("start with the banner's require, read without the ESM facade", () => {
    expect(readFileSync(join(outdir, "stop.mjs"), "utf8")).toMatch(
      /^const require = process\.getBuiltinModule\("node:module"\)\.createRequire\(import\.meta\.url\);\n/,
    );
  });
});

describe("builtinsPlugin", () => {
  it(
    "keeps named, default, prefixless and digit-named imports working, with no static import",
    async () => {
      const dir = tempDir("squeal-builtins-");
      writeFileSync(
        join(dir, "entry.mjs"),
        [
          'import fs from "node:fs";',
          'import { readFileSync } from "fs";',
          'import { get } from "node:http";',
          'import { getHeapStatistics } from "node:v8";',
          'import { setTimeout as sleep } from "node:timers/promises";',
          'const os = await import("node:os");',
          "await sleep(1);",
          "console.log(JSON.stringify([fs.readFileSync === readFileSync, typeof get,",
          "  typeof getHeapStatistics().total_heap_size, typeof os.cpus]));",
        ].join("\n"),
      );
      const result = await build({
        entryPoints: [join(dir, "entry.mjs")],
        outfile: join(dir, "out.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        metafile: true,
        logLevel: "silent",
        plugins: [builtinsPlugin()],
      });
      const output = Object.values((result.metafile as Metafile).outputs)[0];
      expect(output && builtinImports(output)).toEqual([]);
      const out = readFileSync(join(dir, "out.mjs"), "utf8");
      // The other exports of node:fs drop: each is a pure read.
      expect(out).not.toContain('"writeFileSync"');
      const run = spawnSync(process.execPath, [join(dir, "out.mjs")], { encoding: "utf8" });
      expect(run.stderr).toBe("");
      expect(JSON.parse(run.stdout)).toEqual([true, "function", "number", "function"]);
    },
    BUILD.timeout,
  );

  it("is in the OpenCode bridge's options, which spread the shared ones", () => {
    const plugins = bridgeBundleOptions(tempDir("squeal-builtins-oc-")).plugins ?? [];
    expect(plugins.map((p) => p.name)).toContain("squeal-builtins");
  });
});
