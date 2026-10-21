import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { init, parse } from "es-module-lexer";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, rootVersion } from "../../../src/harness/build.js";
import {
  OPENCODE_PLUGIN_DIR,
  OPENCODE_PLUGIN_DIST,
  PLUGIN_IMPORTS,
  pluginBundleOptions,
} from "../../../src/harness/opencode/build.js";
import { expectSameFiles } from "../bundle-helpers.js";
import { buildOpencodeBundles } from "./helpers.js";

/*
 * Spec 008 D1 and D4: `plugins/opencode/` is an OpenCode plugin package whose
 * `exports["./server"]` is the plugin bundle, carrying the root version, with
 * `dist/` committed as built. The plugin bundle runs in OpenCode's Bun, which
 * has no `node:sqlite`: it imports `node:fs`, `node:path` and
 * `node:child_process` and nothing else.
 */

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildOpencodeBundles();
}, 60_000);
afterAll(() => built.cleanup());

/** Every static and dynamic import specifier of an ES module's source. */
async function importsOf(path: string): Promise<string[]> {
  await init;
  const [records] = parse(readFileSync(path, "utf8"));
  return records.flatMap((record) => {
    if (record.type === "import-meta") return [];
    return [record.specifier ?? "<a computed import()>"];
  });
}

describe("the OpenCode package", () => {
  it("names the plugin bundle as its server export, OpenCode's engine, and the root version", () => {
    const manifest = JSON.parse(readFileSync(join(OPENCODE_PLUGIN_DIR, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      name: "squeal-opencode",
      version: rootVersion(),
      type: "module",
      exports: { "./server": "./dist/plugin.mjs" },
      engines: { opencode: ">=1.18.35" },
    });
  });

  it("has the bundles exactly as `npm run build:plugin` produces them", () => {
    expectSameFiles(OPENCODE_PLUGIN_DIST, built.dir, ".mjs");
  });

  it("ships bin/squeal for the agent's shell and the launcher every plugin ships, executable", () => {
    for (const file of ["squeal", "squeal-launcher"]) {
      expect(statSync(join(OPENCODE_PLUGIN_DIR, "bin", file)).mode & 0o111).toBe(0o111);
    }
    expect(readFileSync(join(OPENCODE_PLUGIN_DIR, "bin", "squeal-launcher"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "plugins/pi/bin/squeal-launcher"), "utf8"),
    );
    // Which bundle it runs for each command: test/harness/ps-bundle.test.ts.
    expect(readFileSync(join(OPENCODE_PLUGIN_DIR, "bin", "squeal"), "utf8")).toContain(
      '"$(dirname "$0")/../dist/cli/$cli.mjs"',
    );
  });
});

describe("dist/plugin.mjs", () => {
  it("imports only node:fs, node:path and node:child_process, by the bundler's own account", async () => {
    const result = await build({ ...pluginBundleOptions(built.dir), write: false });
    const inputs = Object.values(result.metafile?.outputs ?? {}).flatMap((o) =>
      o.imports.map((i) => i.path),
    );
    expect(new Set(inputs)).toEqual(new Set(PLUGIN_IMPORTS));
    // Nothing of the shared code, the core or the store is bundled in.
    const sources = Object.keys(result.metafile?.inputs ?? {});
    expect(sources.filter((s) => !s.startsWith("src/harness/opencode/"))).toEqual([]);
  });

  it("as built and as committed, has no import but those, static or dynamic, and no node:sqlite", async () => {
    for (const dir of [built.dir, OPENCODE_PLUGIN_DIST]) {
      const path = join(dir, "plugin.mjs");
      expect(new Set(await importsOf(path))).toEqual(new Set(PLUGIN_IMPORTS));
      expect(readFileSync(path, "utf8")).not.toContain("sqlite");
    }
  });
});
