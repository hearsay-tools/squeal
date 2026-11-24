import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { shellWord } from "../../../src/core/text.js";
import { serializeRuntimeManifest } from "../../../src/harness/codex/runtime-release/manifest.js";
import { createRuntimeManifest } from "../../../src/harness/codex/runtime-release/tree.js";
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
  await m.end(pid === undefined ? [] : [pid]);
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

// Row 025-13: on Node 22 CI the store process, writing its compile cache under HOME, outlived the
// daemon's SIGKILL and made the directory's removal fail ENOTEMPTY.
describe("the machine's end (row 025-13)", () => {
  it("ends a process still writing under its HOME, which no pid names, and removes it", async () => {
    m = codexMachine(built);
    const writer = spawn(
      "sh",
      ["-c", 'i=0; while :; do mkdir -p "$HOME/.cache/w/$i"; i=$((i+1)); sleep 0.01; done'],
      { env: { PATH: m.path, HOME: m.home }, stdio: "ignore", detached: true },
    );
    writer.unref();
    const exited = new Promise((resolve) =>
      writer.once("exit", (_code, signal) => resolve(signal)),
    );
    await waitFor(() => existsSync(join(m.home, ".cache", "w", "3")), 5_000);
    await m.end();
    expect(existsSync(m.dir)).toBe(false);
    expect(await exited).toBe("SIGKILL");
  });
});

/** Resolves with the signal that ended `child`, or its exit code. */
function exitOf(child: ChildProcess): Promise<string | number | null> {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve(signal ?? code)));
}

/** Whether `pid` is alive and not a zombie. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
  return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
}

// Review 0.1.631 B1: only the machine's HOME, named pids and their descendants are its processes.
describe("the machine's end keeps a process that only names its paths (review 0.1.631 B1)", () => {
  it.runIf(process.platform === "linux")(
    "ends the writer, the named daemon and its store child; a foreign observer survives",
    async () => {
      m = codexMachine(built);
      const foreign = mkdtempSync("/tmp/sq-vc-foreign-");
      const log = join(m.dir, "logs", "daemon.log");
      mkdirSync(join(m.dir, "logs"), { recursive: true });
      writeFileSync(log, "");
      const hold = "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);";
      // An independent diagnostic process: foreign HOME and cwd, a fixture path in its argv.
      const observer = spawn(process.execPath, ["-e", hold, log], {
        cwd: "/tmp",
        env: { PATH: m.path, HOME: foreign },
        stdio: ["ignore", "pipe", "ignore"],
      });
      try {
        const observerExit = exitOf(observer);
        const writer = spawn(
          "sh",
          ["-c", 'i=0; while :; do mkdir -p "$HOME/.cache/w/$i"; i=$((i+1)); sleep 0.01; done'],
          { env: { PATH: m.path, HOME: m.home }, stdio: "ignore", detached: true },
        );
        const writerExit = exitOf(writer);
        // A stand-in daemon with a foreign HOME, named by pid, and its store child.
        const daemon = spawn(
          "sh",
          ["-c", `${shellWord(process.execPath)} -e "$1" & echo $!; wait`, "sh", hold],
          {
            env: { PATH: m.path, HOME: foreign },
            stdio: ["ignore", "pipe", "ignore"],
            detached: true,
          },
        );
        const daemonExit = exitOf(daemon);
        const store = await new Promise<number>((resolve) =>
          daemon.stdout?.once("data", (d: Buffer) => resolve(Number(String(d).split("\n")[0]))),
        );
        await new Promise((resolve) => observer.stdout?.once("data", resolve));
        await waitFor(() => existsSync(join(m.home, ".cache", "w", "3")), 5_000);
        expect(alive(store)).toBe(true);

        await m.end(daemon.pid === undefined ? [] : [daemon.pid]);

        expect(existsSync(m.dir)).toBe(false);
        expect(await writerExit).toBe("SIGKILL");
        expect(await daemonExit).toBe("SIGKILL");
        await waitFor(() => !alive(store), 5_000, "store child ended");
        expect(observer.exitCode).toBeNull();
        expect(observer.signalCode).toBeNull();
        expect(alive(observer.pid ?? -1)).toBe(true);
        observer.kill("SIGTERM");
        expect(await observerExit).toBe("SIGTERM");
      } finally {
        if (observer.exitCode === null && observer.signalCode === null) observer.kill("SIGKILL");
        rmSync(foreign, { recursive: true, force: true });
      }
    },
  );
});

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
