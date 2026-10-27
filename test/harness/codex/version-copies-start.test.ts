import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { shellWord } from "../../../src/core/text.js";
import {
  createRuntimeManifest,
  serializeRuntimeManifest,
} from "../../../src/harness/codex/runtime-release/index.js";
import { writeFixedPlugin } from "../../cli/codex-runtime-fixture.js";
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
  it(
    "002-36: starts from a retained seed with concrete argv and survives adapter cache removal",
    SLOW,
    async () => {
      m = codexMachine(built);
      const root = repository();
      const runtime = runtimeDir();
      socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
      const legacy = m.install(A);
      const adapter = m.rootOf("1.0.0");
      writeFixedPlugin(adapter, "1.0.0", A, "#!/bin/sh\n# squeal-launcher format 8\n");
      const seed = join(adapter, "seed");
      // The fixture's real CLI, recorder/reporters and skills, built only under scratch.
      cpSync(legacy, seed, { recursive: true });
      writeFileSync(
        join(seed, "runtime.json"),
        serializeRuntimeManifest(
          createRuntimeManifest({ root: seed, version: A, nodeFloor: "22.19.0" }),
        ),
      );
      m.remove(A);
      const start = m.shell(`node ${shellWord(join(seed, "dist/cli/squeal.mjs"))} start`, root, {
        XDG_RUNTIME_DIR: runtime,
      });
      expect(start.status, `${start.stdout}${start.stderr}`).toBe(0);
      const answer = await ping(socket, 1_000);
      expect(answer?.squealVersion).toBe(A);
      const copy = join(m.data, "versions", A);
      const args = execFileSync("ps", ["-o", "args=", "-p", String(answer?.pid)], {
        encoding: "utf8",
      });
      expect(args).toContain(` ${join(copy, "dist/cli/squeal.mjs")} daemon ${root}`);
      expect(readFileSync(join(copy, "runtime.json"))).toEqual(
        readFileSync(join(seed, "runtime.json")),
      );
      rmSync(adapter, { recursive: true });
      await waitFor(
        async () => (await ping(socket, 500))?.phase === "ready",
        60_000,
        "ready after cache removal",
      );
      expect((await ping(socket, 1_000))?.pid).toBe(answer?.pid);
      expect(existsSync(join(copy, "dist/observe/recorder.cjs"))).toBe(true);
      expect(existsSync(join(copy, "skills/squeal/SKILL.md"))).toBe(true);
    },
  );

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
