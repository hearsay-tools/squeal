import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { shellWord } from "../../../src/core/text.js";
import { ping, waitFor } from "../../daemon/helpers.js";
import { runtimeDir } from "../bundle-helpers.js";
import { A, type Built, buildVersions, type CodexMachine, codexMachine } from "./cache-fixture.js";

/*
 * Row 005-77 (spec 005 D3 as amended 2026-10-21; gh-70, gh-72): a terminal's
 * `squeal start`, which the launcher runs from Codex's plugin cache before
 * any session of that version kept a copy, keeps the copy and spawns its
 * daemon from it, as a SessionStart does since 005-73. Codex's install of
 * another version then deletes the cache directory, not the daemon's runtime.
 */

const SLOW = { timeout: 240_000 } as const;

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A]);
}, 120_000);
afterAll(() => built.cleanup());

let m: CodexMachine;
let socket = "";
/** Stops the daemon `start` spawned, found through its socket, whatever the test reached. */
afterEach(async () => {
  const pid = (await ping(socket, 1_000))?.pid;
  if (pid !== undefined) process.kill(pid, "SIGKILL");
  m.cleanup();
});

/** A repository with one commit. */
function repository(): string {
  const root = join(m.dir, "repo");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "kept\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(root);
}

describe("squeal start from Codex's plugin cache (005-77)", () => {
  it("spawns its daemon from the kept copy of its version", SLOW, async () => {
    m = codexMachine(built);
    const root = repository();
    const runtime = runtimeDir();
    socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
    const plugin = m.install(A);
    // The launcher as `install.sh` puts it on the PATH: it runs the cache's CLI.
    const local = join(m.dir, "local", "bin");
    mkdirSync(local, { recursive: true });
    execFileSync("cp", [join(plugin, "bin", "squeal-launcher"), join(local, "squeal")]);
    const start = m.shell(`${shellWord(join(local, "squeal"))} start`, root, {
      XDG_RUNTIME_DIR: runtime,
    });
    expect(start.status, `${start.stdout}${start.stderr}`).toBe(0);
    const answer = await ping(socket, 1_000);
    expect(answer?.squealVersion).toBe(A);
    const daemon = answer?.pid;
    const copy = join(m.data, "versions", A, "dist", "cli", "squeal.mjs");
    const args = execFileSync("ps", ["-o", "args=", "-p", String(daemon)], { encoding: "utf8" });
    expect(args).toContain(` ${copy} daemon ${root}`);
    expect(existsSync(join(m.data, "bin", "squeal"))).toBe(true);

    // Codex's install of another version: the daemon still runs from its copy.
    m.remove(A);
    await waitFor(async () => (await ping(socket, 500))?.phase === "ready", 60_000, "ready");
    expect((await ping(socket, 1_000))?.pid).toBe(daemon);
  });
});
