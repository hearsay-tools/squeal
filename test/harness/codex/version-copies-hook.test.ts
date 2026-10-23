import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import type { CodexHookName } from "../../../src/harness/codex/index.js";
import { ping, waitFor } from "../../daemon/helpers.js";
import { open } from "../../store/helpers.js";
import { liveSocket, runBundle, runtimeDir } from "../bundle-helpers.js";
import {
  A,
  B,
  type Built,
  buildVersions,
  type CodexMachine,
  codexMachine,
} from "./cache-fixture.js";
import { codexRecorded, sessionOf } from "./helpers.js";

/*
 * Row 005-81 (spec 005 D3 as amended 2026-10-21; gh-70, gh-72): a Codex hook
 * other than SessionStart that runs before any SessionStart of its version
 * kept a copy, and finds no daemon, keeps the copy and spawns the daemon from
 * it, as SessionStart (005-73) and `squeal start` (005-77) do. Codex's install
 * of another version then deletes the cache directory, not the daemon's
 * runtime. A hook whose daemon answers copies nothing.
 *
 * Row 011-140: a hook spawns no daemon from a copy whose code is another
 * version, and keeps no copy from a \`PLUGIN_ROOT\` of another version.
 */

const SLOW = { timeout: 240_000 } as const;
const SESSION = sessionOf("exec", "session-start");

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A, B]);
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

/**
 * Runs the bundled hook `name` of A from Codex's cache, as Codex runs a
 * plugin's hook; `from` the directory of another bundle, `plugin` another root.
 */
async function hook(
  name: CodexHookName,
  root: string,
  runtime: string,
  { plugin = m.rootOf(A), from = join(plugin, "dist") } = {},
) {
  const input = codexRecorded("exec", name, root, SESSION);
  const env = {
    XDG_RUNTIME_DIR: runtime,
    PLUGIN_ROOT: plugin,
    PLUGIN_DATA: m.data,
    HOME: m.home,
    PATH: m.path,
  };
  const out = await runBundle(name, input, env, from);
  expect(out, name).toMatchObject({ stderr: "", code: 0 });
}

/** The daemon answering on `socket`, and its command line. */
async function spawned(socket: string) {
  const answer = await waitFor(() => ping(socket, 500), 30_000, "the spawned daemon");
  const args = execFileSync("ps", ["-o", "args=", "-p", String(answer.pid)], { encoding: "utf8" });
  return { answer, args };
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
      const { answer, args } = await spawned(socket);
      expect(answer.squealVersion).toBe(A);
      const copy = join(m.data, "versions", A, "dist", "cli", "squeal.mjs");
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

describe("a Codex hook and a copy of other code (row 011-140)", () => {
  it(
    "a PostToolUse of B with PLUGIN_ROOT of A keeps no copy and spawns B from its own bundle",
    SLOW,
    async () => {
      m = codexMachine(built);
      m.install(A);
      const root = repository();
      const runtime = runtimeDir();
      socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);

      // A test run of B's code under a Codex hook's environment, as on 2026-10-23.
      const own = join(built.dir, B, "dist");
      await hook("post-tool-use", root, runtime, { from: own });
      const { answer, args } = await spawned(socket);
      expect(answer.squealVersion).toBe(B);
      expect(args).toContain(` ${join(own, "cli", "squeal.mjs")} daemon ${root}`);
      expect(existsSync(join(m.data, "versions"))).toBe(false);
      expect(existsSync(join(m.data, "bin"))).toBe(false);
    },
  );

  it(
    "a PostToolUse of B that finds the copy named B holding A makes it again and spawns B from it",
    SLOW,
    async () => {
      m = codexMachine(built);
      const plugin = m.install(B);
      const root = repository();
      const runtime = runtimeDir();
      socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
      // The copy as a release before row 011-140 made it from A's root: no manifest.
      const wrong = join(m.data, "versions", B);
      for (const dir of ["dist", "skills"]) {
        cpSync(join(built.dir, A, dir), join(wrong, dir), { recursive: true });
      }

      await hook("post-tool-use", root, runtime, { plugin });
      const { answer, args } = await spawned(socket);
      expect(answer.squealVersion).toBe(B);
      expect(args).toContain(` ${join(wrong, "dist", "cli", "squeal.mjs")} daemon ${root}`);
      const manifest = JSON.parse(
        readFileSync(join(wrong, ".codex-plugin", "plugin.json"), "utf8"),
      );
      expect(manifest.version).toBe(B);
    },
  );
});
