import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import {
  buildCodexRuntime,
  CODEX_PLUGIN_DIR,
  CODEX_RUNTIME,
  CODEX_RUNTIME_DIR,
} from "../../../../src/harness/codex/build.js";
import { validateRuntimeTree } from "../../../../src/harness/codex/runtime-release/index.js";
import { A, adapterAt, B, runtimeAt, scratch, snapshotTree } from "./fixture.js";

/*
 * Row 002-31, first regression (spec 002 D7): a routine runtime build never
 * rewrites the fixed plugin. Seed A is frozen in the plugin; building
 * runtime B, in its own tree, leaves every byte and mode of the plugin as it
 * was, and a runtime build pointed at the fixed plugin refuses before
 * writing.
 */

const SLOW = { timeout: 180_000 } as const;

let tmp: ReturnType<typeof scratch>;
let runtime = "";
let plugin = "";
let before: Record<string, string> = {};
beforeAll(async () => {
  tmp = scratch("sq-fixed-");
  runtime = join(tmp.dir, "runtime");
  plugin = join(tmp.dir, "plugin");
  await runtimeAt(runtime, A);
  await adapterAt(plugin, runtime);
  before = snapshotTree(plugin);
  await runtimeAt(runtime, B);
}, 180_000);
afterAll(() => tmp.cleanup());

describe("building runtime B after the fixed plugin froze seed A", () => {
  it("leaves every file and mode of the fixed plugin, seed included, unchanged", () => {
    expect(Object.keys(before).some((path) => path.startsWith("seed/dist/"))).toBe(true);
    expect(before["bin/squeal-launcher"]).toMatch(/^755 /);
    expect(snapshotTree(plugin)).toEqual(before);
  });

  it("built B in the runtime tree, and the seed still validates as A", () => {
    expect(validateRuntimeTree(runtime, { expectedVersion: B }).version).toBe(B);
    expect(validateRuntimeTree(join(plugin, "seed"), { expectedVersion: A }).version).toBe(A);
  });

  it("refuses a runtime build into the fixed plugin, writing nothing", SLOW, async () => {
    await expect(buildCodexRuntime({ ...CODEX_RUNTIME, pluginDir: plugin }, B)).rejects.toThrow(
      /holds seed\/, a fixed plugin/,
    );
    expect(snapshotTree(plugin)).toEqual(before);
  });
});

describe("the routine build's targets", () => {
  it("builds the runtime tree, never the fixed plugin, under `pnpm run build`", () => {
    expect(CODEX_RUNTIME.pluginDir).toBe(CODEX_RUNTIME_DIR);
    expect(CODEX_RUNTIME_DIR).not.toBe(CODEX_PLUGIN_DIR);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:plugin"]).toContain("tsx src/harness/codex/build.ts");
    expect(pkg.scripts["build:plugin"]).not.toContain("build-adapter");
    expect(pkg.scripts.build).not.toContain("build-adapter");
    expect(pkg.scripts["build:codex-adapter"]).toBe("tsx src/harness/codex/build-adapter.ts");
  });

  it("keeps the adapter build's own entry out of the runtime's sources", () => {
    expect(existsSync(join(REPO_ROOT, "src/harness/codex/entries/build-adapter.ts"))).toBe(false);
  });
});
