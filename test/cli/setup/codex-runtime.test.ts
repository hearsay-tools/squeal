import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodexRuntimeDeps } from "../../../src/cli/codex/runtime.js";
import { setupCommand } from "../../../src/cli/setup/command.js";
import { readCurrent, sessionsDir } from "../../../src/harness/codex/adapter/layout.js";
import { fixedPlugin, write } from "../../harness/codex/adapter/fixture.js";
import { answer, NEXT, release, SEED, server } from "../../harness/codex/runtime-update/fixture.js";
import { capture, cleanupFixtures, harnessEnv, squealShaped } from "./fixture.js";

/*
 * Row 002-34 (spec 002 D7, `wave-5-contract.md`): setup checks the fixed
 * Codex plugin's runtime beside the plugin and its trust, and setting Codex
 * up prepares that runtime: a local one first, a download only when none is
 * complete. A plugin from before the adapter has no runtime to check.
 */

afterEach(cleanupFixtures);

/** A home with `codex` on the PATH and the fixed plugin in its cache. */
function codexHome() {
  const env = harnessEnv(["codex"]);
  const home = env.HOME as string;
  const plugin = fixedPlugin(
    join(home, ".codex", "plugins", "cache", "hearsay", "squeal", "1.0.0"),
    SEED,
  );
  write(join(plugin, "hooks", "hooks.json"), "{}\n");
  return { env, plugin, data: join(home, ".codex", "plugins", "data", "squeal-hearsay") };
}

async function setup(
  root: string,
  args: readonly string[],
  env: Record<string, string>,
  codexRuntime?: CodexRuntimeDeps,
) {
  const { io, out } = capture(root, env);
  const code = await setupCommand(args, io, codexRuntime === undefined ? {} : { codexRuntime });
  return { code, ...out };
}

const APPLY = ["--yes", "--harness", "codex", "--block", "none", "--no-trust", "--no-warmup"];

describe("squeal setup and the fixed Codex plugin's runtime (002-34)", () => {
  it("plans a ready runtime from the seed, with the adapter's version apart", async () => {
    const root = squealShaped();
    const c = codexHome();
    const plan = await setup(root, ["--plan", "--json"], c.env);
    expect(JSON.parse(plan.stdout).codexRuntime).toEqual({
      state: "ready",
      adapter: { root: c.plugin, version: "1.0.0" },
      runtime: SEED,
      problems: [],
      lastCheck: null,
      command: `squeal codex-runtime ensure --plugin-root ${c.plugin}`,
    });
    const text = await setup(root, ["--plan"], c.env);
    expect(text.stdout).toContain(`\nCodex runtime: ${SEED} ready (adapter 1.0.0)\n`);
    expect(text.stdout).not.toContain("Codex runtime: not ready");
  });

  it("reports a runtime that is not ready as outdated, so --check exits 1", async () => {
    const root = squealShaped();
    const c = codexHome();
    rmSync(join(c.plugin, "seed", "dist", "runtime.mjs"));
    const plan = JSON.parse((await setup(root, ["--plan", "--json"], c.env)).stdout);
    expect(plan.codexRuntime).toMatchObject({
      state: "not-ready",
      runtime: null,
      command: `squeal codex-runtime update --plugin-root ${c.plugin}`,
    });
    expect(plan.codexRuntime.problems).toEqual([
      "current runtime: no runtime is selected",
      expect.stringContaining("dist/runtime.mjs is missing"),
    ]);
    const check = await setup(root, ["--check"], c.env);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain(
      "  Codex runtime: not ready (current runtime: no runtime is selected; seed:",
    );
  });

  it("has no runtime to check without the fixed plugin", async () => {
    const root = squealShaped();
    const env = harnessEnv(["codex"]);
    write(
      join(env.HOME as string, ".codex/plugins/cache/hearsay/squeal/0.1.366/hooks/hooks.json"),
      "{}\n",
    );
    const plan = await setup(root, ["--plan", "--json"], env);
    expect(JSON.parse(plan.stdout).codexRuntime).toEqual({ state: "no-adapter" });
    expect((await setup(root, ["--plan"], env)).stdout).not.toContain("Codex runtime");
  });

  it("prepares the seed locally when Codex is set up, with no pin and no download", async () => {
    const root = squealShaped();
    const c = codexHome();
    const s = server(release(NEXT));
    const r = await setup(root, APPLY, c.env, { transport: s.transport });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `Codex runtime ${SEED} ready (seed) in ${join(c.data, "versions", SEED)}\n`,
    );
    expect(readCurrent(c.data)).toEqual({ schema: 1, version: SEED });
    expect(existsSync(sessionsDir(c.data))).toBe(false);
    expect(s.requests).toEqual([]);
  });

  it("downloads a runtime only when none is complete, and exits 1 when that fails", async () => {
    const root = squealShaped();
    const c = codexHome();
    rmSync(join(c.plugin, "seed", "dist", "runtime.mjs"));
    const failing = await setup(root, APPLY, c.env, { transport: async () => answer(503, null) });
    expect(failing.code).toBe(1);
    expect(failing.stdout).toContain("squeal setup: no complete Codex runtime here (");
    expect(failing.stderr).toContain("(http, transient); Codex runtime none stays selected\n");
    const s = server(release(NEXT));
    const r = await setup(root, APPLY, c.env, { transport: s.transport });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Codex runtime ${NEXT} ready (current)`);
    expect(readCurrent(c.data)).toEqual({ schema: 1, version: NEXT });
  });

  it("prepares nothing when Codex is not set up", async () => {
    const root = squealShaped();
    const c = codexHome();
    const r = await setup(
      root,
      ["--yes", "--harness", "none", "--block", "none", "--no-trust", "--no-warmup"],
      c.env,
    );
    expect(r.code).toBe(0);
    expect(existsSync(c.data)).toBe(false);
  });
});
