import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAdapterHook } from "../../../../src/harness/codex/adapter/index.js";
import { pinFile } from "../../../../src/harness/codex/adapter/layout.js";
import { usesSquealAt } from "../../../../src/harness/codex/adapter/repository.js";
import { tempDir } from "../../../store/helpers.js";
import { outsideGit } from "../../bundle-helpers.js";
import { fixedPlugin, write, writeManifest } from "./fixture.js";

/*
 * Row 002-29: the adapter's dispatch and repository test in the test's own
 * thread, beside the real-child tests in `dispatch.test.ts`. The fixture
 * runtime reports through `box.__squealRan` instead of stdout.
 */

const A = "0.1.900";
const RECORDING = `export async function runRuntimeHook(name, stdin, env) {
  globalThis.__squealRan = { version: ${JSON.stringify(A)}, name, stdin, root: env.PLUGIN_ROOT, adapter: env.SQUEAL_ADAPTER_ROOT };
}
`;

/** What the recording runtime left on `globalThis`. */
const box = globalThis as {
  __squealRan?: { version: string; name: string; root: string } | undefined;
};

afterEach(() => {
  box.__squealRan = undefined;
  vi.restoreAllMocks();
});

function machine() {
  const dir = tempDir("sq-adapter-inproc-");
  const plugin = fixedPlugin(join(dir, "plugin"), A);
  write(join(plugin, "seed", "dist", "runtime.mjs"), RECORDING);
  // The seed's manifest covers the recording entry.
  writeManifest(join(plugin, "seed"), A);
  const repo = join(dir, "repo");
  write(join(repo, "squeal.config.json"), "{}\n");
  return { dir, plugin, data: join(dir, "data"), repo };
}

describe("runAdapterHook in-process (002-29)", () => {
  it("runs the selected runtime with its root, the adapter root and the input, and pins", async () => {
    const m = machine();
    const env: NodeJS.ProcessEnv = { PLUGIN_ROOT: m.plugin, PLUGIN_DATA: m.data };
    const stdin = JSON.stringify({ session_id: "s", cwd: m.repo });
    await runAdapterHook("stop", { env, stdin, write: () => undefined });
    expect(box.__squealRan).toEqual({
      version: A,
      name: "stop",
      stdin,
      root: join(m.data, "versions", A),
      adapter: m.plugin,
    });
    expect(env.PLUGIN_ROOT).toBe(join(m.data, "versions", A));
    expect(existsSync(pinFile(m.data, "s"))).toBe(true);
    await runAdapterHook("session-end", { env: { ...env, PLUGIN_ROOT: m.plugin }, stdin });
    expect(existsSync(pinFile(m.data, "s"))).toBe(false);
  });

  it("writes a diagnostic only at a context hook in a Squeal repository, and reports it under debug", async () => {
    const m = machine();
    rmSync(join(m.plugin, "seed", "runtime.json"));
    const out: string[] = [];
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const env = { PLUGIN_ROOT: m.plugin, PLUGIN_DATA: m.data, SQUEAL_HOOK_DEBUG: "1" };
    const run = (name: string, cwd: string) =>
      runAdapterHook(name, {
        env: { ...env },
        stdin: JSON.stringify({ session_id: "s", cwd }),
        write: (t) => out.push(t),
      });
    await run("post-tool-use", m.repo);
    await run("session-start", outsideGit());
    expect(out).toEqual([]);
    await run("user-prompt-submit", m.repo);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? "")).toMatchObject({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
    });
    expect(String(err.mock.calls[0]?.[0])).toContain("squeal codex adapter post-tool-use");
    expect(box.__squealRan).toBeUndefined();
  });

  it("ignores an unknown name, missing PLUGIN_DATA and input that is no JSON object", async () => {
    const m = machine();
    const env = { PLUGIN_ROOT: m.plugin, PLUGIN_DATA: m.data };
    await runAdapterHook("nope", { env, stdin: "{}" });
    await runAdapterHook("stop", { env: { PLUGIN_ROOT: m.plugin }, stdin: "{}" });
    expect(box.__squealRan).toBeUndefined();
    // Not JSON, or no session: the current runtime runs once, with no pin.
    await runAdapterHook("stop", { env: { ...env }, stdin: "not json" });
    expect(box.__squealRan?.name).toBe("stop");
    await runAdapterHook("stop", { env: { ...env }, stdin: "[1]" });
    expect(existsSync(join(m.data, "runtime", "sessions"))).toBe(false);
  });
});

describe("usesSquealAt (002-29), the fast path's test", () => {
  it("finds a config, a store in a main checkout, and a linked worktree's common store", () => {
    const dir = outsideGit();
    expect(usesSquealAt(join(dir, "nowhere"))).toBe(false);
    const main = join(dir, "main");
    mkdirSync(join(main, ".git", "worktrees", "w"), { recursive: true });
    mkdirSync(join(main, "src"), { recursive: true });
    expect(usesSquealAt(join(main, "src"))).toBe(false);
    mkdirSync(join(main, ".git", "squeal"));
    expect(usesSquealAt(join(main, "src"))).toBe(true);
    const linked = join(dir, "linked");
    write(join(linked, ".git"), `gitdir: ${join(main, ".git", "worktrees", "w")}\n`);
    write(join(main, ".git", "worktrees", "w", "commondir"), "../..\n");
    expect(usesSquealAt(linked)).toBe(true);
    rmSync(join(main, ".git", "squeal"), { recursive: true });
    expect(usesSquealAt(linked)).toBe(false);
    write(join(linked, "squeal.config.json"), "{}\n");
    expect(usesSquealAt(linked)).toBe(true);
  });
});
