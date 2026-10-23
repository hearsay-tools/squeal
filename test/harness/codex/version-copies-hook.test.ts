import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import type { CodexHookName } from "../../../src/harness/codex/index.js";
import { ping, waitFor } from "../../daemon/helpers.js";
import { open } from "../../store/helpers.js";
import { liveSocket, runBundle, runtimeDir } from "../bundle-helpers.js";
import { A, type Built, buildVersions, type CodexMachine, codexMachine } from "./cache-fixture.js";
import { codexRecorded, sessionOf } from "./helpers.js";

/*
 * Row 005-81 (spec 005 D3 as amended 2026-10-21; gh-70, gh-72): a Codex hook
 * other than SessionStart that runs before any SessionStart of its version
 * kept a copy, and finds no daemon, keeps the copy and spawns the daemon from
 * it, as SessionStart (005-73) and `squeal start` (005-77) do. Codex's install
 * of another version then deletes the cache directory, not the daemon's
 * runtime. A hook whose daemon answers copies nothing.
 */

const SLOW = { timeout: 240_000 } as const;
const SESSION = sessionOf("exec", "session-start");

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A]);
}, 120_000);
afterAll(() => built.cleanup());

let m: CodexMachine;
let socket = "";
/** Stops the daemon the hook spawned, found through its socket, whatever the test reached. */
afterEach(async () => {
  const pid = (await ping(socket, 1_000))?.pid;
  if (pid !== undefined) process.kill(pid, "SIGKILL");
  socket = "";
  m.cleanup();
});

/** A repository with one commit and a store, which no daemon has served yet. */
function repository(): string {
  const root = join(m.dir, "repo");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "kept\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  open(join(root, ".git"));
  return realpathSync(root);
}

/** Runs the bundled hook `name` of A from Codex's cache, as Codex runs a plugin's hook. */
async function hook(name: CodexHookName, root: string, runtime: string) {
  const plugin = m.rootOf(A);
  const input = codexRecorded("exec", name, root, SESSION);
  const env = {
    XDG_RUNTIME_DIR: runtime,
    PLUGIN_ROOT: plugin,
    PLUGIN_DATA: m.data,
    HOME: m.home,
    PATH: m.path,
  };
  const out = await runBundle(name, input, env, join(plugin, "dist"));
  expect(out, name).toMatchObject({ stderr: "", code: 0 });
}

describe("a Codex hook before any SessionStart of its version (005-81)", () => {
  for (const name of ["post-tool-use", "stop"] as const) {
    it(`${name} spawns its daemon from the kept copy of its version`, SLOW, async () => {
      m = codexMachine(built);
      m.install(A);
      const root = repository();
      const runtime = runtimeDir();
      socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
      expect(existsSync(m.data)).toBe(false);

      await hook(name, root, runtime);
      const answer = await waitFor(() => ping(socket, 500), 30_000, "the spawned daemon");
      expect(answer.squealVersion).toBe(A);
      const copy = join(m.data, "versions", A, "dist", "cli", "squeal.mjs");
      const args = execFileSync("ps", ["-o", "args=", "-p", String(answer.pid)], {
        encoding: "utf8",
      });
      expect(args).toContain(` ${copy} daemon ${root}`);
      expect(existsSync(join(m.data, "bin", "squeal"))).toBe(true);

      // Codex's install of another version: the daemon still runs from its copy.
      m.remove(A);
      await waitFor(async () => (await ping(socket, 500))?.phase === "ready", 60_000, "ready");
      expect((await ping(socket, 1_000))?.pid).toBe(answer.pid);
    });
  }

  it("copies nothing at a PostToolUse or Stop whose daemon answers", SLOW, async () => {
    m = codexMachine(built);
    m.install(A);
    const root = repository();
    const runtime = runtimeDir();
    await liveSocket(join(runtime, `squeal-${worktreeIdFor(root)}.sock`));
    await hook("post-tool-use", root, runtime);
    await hook("stop", root, runtime);
    expect(existsSync(m.data)).toBe(false);
  });
});
