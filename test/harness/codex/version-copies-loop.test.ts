import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readShortHandoff } from "../../../src/core/delivery/handoff.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { readDaemonNotes } from "../../../src/core/notes.js";
import { storePaths } from "../../../src/core/store/index.js";
import { ping, waitFor } from "../../daemon/helpers.js";
import { open } from "../../store/helpers.js";
import { runBundle, runtimeDir } from "../bundle-helpers.js";
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
 * Row 011-140 (`research/issue-75-77.md` Q2, `probes/issue-75/three-versions.mjs`):
 * three versions in one worktree. The copies are as this host held them on
 * 2026-10-23, made by releases before the row: the one named C holds B's
 * code, the one named B holds A's. A daemon of A serves, as a SessionStart
 * of B spawned it from its copy. Codex hooks of C run while a writer holds
 * the store. Before the row each successor ran B's code from the copy named
 * C and was stepped down again (39 incarnations in 180 s); now one handover
 * gives one daemon of C, from a copy of C made again from C's root.
 */

const C = "0.1.902";
const SLOW = { timeout: 300_000 } as const;
const SESSION = sessionOf("exec", "session-start");
/** How long the hooks run, one every `EVERY_MS`, and when the writer holds the store. */
const HOOKS_MS = 12_000;
const EVERY_MS = 300;
const WRITER_AT_MS = 3_000;
const WRITER_HOLDS_MS = 2_000;

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A, B, C]);
}, 180_000);
afterAll(() => built.cleanup());

let m: CodexMachine;
let socket = "";
const pids: number[] = [];
afterEach(async () => {
  const pid = (await ping(socket, 1_000))?.pid;
  for (const p of [...pids.splice(0), ...(pid === undefined ? [] : [pid])]) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      // Gone already.
    }
  }
  m.cleanup();
});

/** A repository with one commit and a store. */
function repository(): string {
  const root = join(m.dir, "repo");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "three versions\n");
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  open(join(root, ".git"));
  return realpathSync(root);
}

/** The copy named `name` holding `code`'s `dist/` and `skills/`, as a release before row 011-140 made it. */
function copyOfOther(name: string, code: string): string {
  const dir = join(m.data, "versions", name);
  for (const part of ["dist", "skills"]) {
    cpSync(join(built.dir, code, part), join(dir, part), { recursive: true });
  }
  return dir;
}

/** The arguments of every running daemon process of `root`. */
function daemonsOf(root: string): string[] {
  const ps = execFileSync("ps", ["-A", "-o", "args="], { encoding: "utf8" });
  return ps.split("\n").filter((args) => args.includes(` daemon ${root}`));
}

describe("three versions in one worktree with a store writer (row 011-140)", () => {
  it("gives one handover, then one daemon of the hooks' version", SLOW, async () => {
    m = codexMachine(built);
    const plugin = m.install(C);
    const root = repository();
    const runtime = runtimeDir();
    socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
    const env = { XDG_RUNTIME_DIR: runtime, HOME: m.home, PATH: m.path };
    copyOfOther(C, B);
    const ofB = copyOfOther(B, A);

    const old = spawn(process.execPath, [join(ofB, "dist", "cli", "squeal.mjs"), "daemon", root], {
      env,
      detached: true,
      stdio: "ignore",
    });
    old.unref();
    if (old.pid !== undefined) pids.push(old.pid);
    const first = await waitFor(
      async () => {
        const answer = await ping(socket, 500);
        return answer?.phase === "ready" ? answer : null;
      },
      60_000,
      "the daemon of A",
    );
    expect(first.squealVersion).toBe(A);

    const hookEnv = { ...env, PLUGIN_ROOT: plugin, PLUGIN_DATA: m.data };
    const db = new DatabaseSync(storePaths(join(root, ".git")).database);
    const started = performance.now();
    let held = false;
    while (performance.now() - started < HOOKS_MS) {
      if (!held && performance.now() - started >= WRITER_AT_MS) {
        held = true;
        db.exec("BEGIN IMMEDIATE");
        setTimeout(() => db.exec("COMMIT"), WRITER_HOLDS_MS);
      }
      const input = codexRecorded("exec", "post-tool-use", root, SESSION);
      const out = await runBundle("post-tool-use", input, hookEnv, join(plugin, "dist"));
      expect(out.code, out.stderr).toBe(0);
      await sleep(EVERY_MS);
    }
    await sleep(WRITER_HOLDS_MS);
    db.close();

    const served = await waitFor(
      async () => {
        const answer = await ping(socket, 500);
        return answer?.phase === "ready" && answer.squealVersion === C ? answer : null;
      },
      60_000,
      "a daemon of C",
    );
    const copy = join(m.data, "versions", C);
    expect(daemonsOf(root)).toEqual([expect.stringContaining(` ${copy}/dist/cli/squeal.mjs `)]);
    const manifest = JSON.parse(readFileSync(join(copy, ".codex-plugin", "plugin.json"), "utf8"));
    expect(manifest.version).toBe(C);

    const store = open(join(root, ".git"));
    const exits = readDaemonNotes(store, worktreeIdFor(root))
      .map((note) => note.text)
      .filter((text) => text.includes("are newer than this daemon"));
    expect(exits).toEqual([
      expect.stringContaining(`hooks at Squeal ${C} are newer than this daemon (${A})`),
    ]);
    expect(readShortHandoff(store, worktreeIdFor(root))).toBeNull();
    // Later hooks leave it serving.
    for (let i = 0; i < 3; i++) {
      const input = codexRecorded("exec", "post-tool-use", root, SESSION);
      await runBundle("post-tool-use", input, hookEnv, join(plugin, "dist"));
    }
    expect((await ping(socket, 1_000))?.pid).toBe(served.pid);
  });
});
