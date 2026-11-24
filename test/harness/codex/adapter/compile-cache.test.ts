import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import { tempDir } from "../../../store/helpers.js";
import { buildAdapter, fixedPlugin, runAdapter, write, writeManifest } from "./fixture.js";

/*
 * Spec 025 D7.2: Codex runs `node <adapter>` straight from hooks.json, which
 * stays as it is, so the adapter turns Node's compile cache on itself before
 * it loads the runtime, in Squeal's own directory, when the user set none.
 * The runtime reads the cache directory as its module loads.
 */

const A = "0.1.900";
const ENTRY = `import { getCompileCacheDir } from "node:module";
const atLoad = getCompileCacheDir() ?? null;
export async function runRuntimeHook(name, stdin, env) {
  process.stdout.write(JSON.stringify({ atLoad, cache: env.NODE_COMPILE_CACHE ?? null, own: env.SQUEAL_OWN_COMPILE_CACHE ?? null }));
}
`;

let scratch = "";
let adapter = "";
beforeAll(async () => {
  scratch = mkdtempSync("/tmp/sq-adapter-cache-");
  adapter = await buildAdapter(scratch);
}, 60_000);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function hook(env: Record<string, string>) {
  const dir = tempDir("sq-adapter-cache-");
  const plugin = fixedPlugin(join(dir, "plugin"), A);
  write(join(plugin, "seed", "dist", "runtime.mjs"), ENTRY);
  writeManifest(join(plugin, "seed"), A);
  write(join(dir, "repo", "squeal.config.json"), "{}\n");
  const out = await runAdapter(
    adapter,
    "stop",
    { session_id: "s", cwd: join(dir, "repo") },
    { PLUGIN_ROOT: plugin, PLUGIN_DATA: join(dir, "data"), ...env },
  );
  expect(out).toMatchObject({ code: 0, stderr: "" });
  return JSON.parse(out.stdout) as {
    atLoad: string | null;
    cache: string | null;
    own: string | null;
  };
}

describe("the Codex adapter's compile cache (spec 025 D7.2)", () => {
  it("turns Squeal's own on before it loads the runtime, and marks it for what the runtime spawns", async () => {
    const home = tempDir("sq-adapter-home-");
    const seen = await hook({ HOME: home });
    const dir = join(home, ".cache", "squeal", "compile-cache");
    expect(seen).toMatchObject({ cache: dir, own: "1" });
    expect(seen.atLoad?.startsWith(`${dir}/`)).toBe(true);
  });

  it("uses XDG_CACHE_HOME first", async () => {
    const xdg = tempDir("sq-adapter-xdg-");
    const seen = await hook({ HOME: tempDir("sq-adapter-home-"), XDG_CACHE_HOME: xdg });
    expect(seen).toMatchObject({ cache: join(xdg, "squeal", "compile-cache"), own: "1" });
  });

  it("leaves a user's cache, an empty one included, unmarked", async () => {
    const mine = tempDir("sq-adapter-mine-");
    const seen = await hook({ HOME: tempDir("sq-adapter-home-"), NODE_COMPILE_CACHE: mine });
    expect(seen).toMatchObject({ cache: mine, own: null });
    expect(seen.atLoad?.startsWith(`${mine}/`)).toBe(true);
    const off = await hook({ HOME: tempDir("sq-adapter-home-"), NODE_COMPILE_CACHE: "" });
    expect(off).toEqual({ atLoad: null, cache: "", own: null });
  });

  it("turns nothing on without an absolute home", async () => {
    expect(await hook({ HOME: "" })).toEqual({ atLoad: null, cache: null, own: null });
    expect(await hook({ HOME: "relative" })).toEqual({ atLoad: null, cache: null, own: null });
  });

  it("leaves hooks.json's commands as Codex users trusted them", () => {
    const hooks = readFileSync(join(REPO_ROOT, "plugins/codex/hooks/hooks.json"), "utf8");
    expect(hooks).not.toMatch(/COMPILE_CACHE|--import/);
  });
});
