import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { leftoverProcesses } from "../../evals/lib/index.mjs";
import { cellProcesses, killCellProcess, startOf } from "./cell-processes.js";
import { alive, type FakeRoot, fakeRoot, pids, removeRoot, runCell } from "./fake-cell.js";

// 014-32 (014 lessons, P10): two fake daemons of evals cells ran for over an hour after their
// root was removed. A fake daemon leads its own session and carries no mark of Squeal's, so only
// its runner's teardown stopped it, and a runner killed or crashed first left it running. Each
// case ends a cell on such a path and finds no process of its fake daemon.

const roots: FakeRoot[] = [];
const root = () => {
  const f = fakeRoot();
  roots.push(f);
  return f;
};
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});
const CELL = ["t1-thousands", "p0", "claude", "claude-haiku-5-5", "1"];
/**
 * The processes of the cell's fake daemons, found by their command line, not by a logged pid or
 * the cell's ownership: a wider net than `removeRoot` kills with, to observe only.
 */
const daemons = (f: FakeRoot) => leftoverProcesses(f.dir).filter((p) => / daemon /.test(p.line));
const until = async (ok: () => boolean, ms = 10_000) => {
  for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms; ) await sleep(100);
  return ok();
};

/**
 * A cell whose runner gets SIGKILL once its fake daemon is up, so no teardown runs (a killed
 * test run, P10), and whose hung session is then killed: only the fake daemon is left.
 */
async function abandoned(env: Record<string, string> = {}): Promise<FakeRoot> {
  const f = root();
  await runCell(f, CELL, { FAKE_HARNESS: "hang", ...env }, (child) => {
    const poll = setInterval(() => {
      if (pids(f, "daemons").length > 0 && pids(f, "harness").length >= 2) {
        clearInterval(poll);
        child.kill("SIGKILL");
      }
    }, 50);
  });
  for (const p of cellProcesses(f)) if (p.args[2] !== "daemon") killCellProcess(p);
  return f;
}

describe("a fake daemon whose runner was killed (014-32)", { timeout: 30_000 }, () => {
  it("ends once its root is removed", async () => {
    const f = await abandoned();
    expect(daemons(f)).toHaveLength(1);
    rmSync(f.dir, { recursive: true, force: true });
    expect(await until(() => daemons(f).length === 0)).toBe(true);
  });

  it("ends once the test process that made its cell ends, its root kept", async () => {
    const owner = spawn("sleep", ["60"]);
    const f = await abandoned({ FAKE_OWNER: `${owner.pid}:${startOf(owner.pid as number)}` });
    expect(daemons(f)).toHaveLength(1);
    owner.kill("SIGKILL");
    expect(await until(() => daemons(f).length === 0)).toBe(true);
    expect(existsSync(f.root)).toBe(true);
  });
});

describe("a fake root torn down while its runner still runs (014-32)", { timeout: 30_000 }, () => {
  it("leaves no process of its fake daemon, as after a test's timeout", async () => {
    const f = root();
    let left = -1;
    let owned: string[] = [];
    await runCell(f, [...CELL, "--timeout-s", "5"], { FAKE_HARNESS: "hang" }, (child) => {
      const poll = setInterval(() => {
        if (pids(f, "daemons").length > 0 && pids(f, "harness").length >= 2) {
          clearInterval(poll);
          left = daemons(f).length;
          owned = cellProcesses(f).map((p) => p.args.slice(1, 3).join(" "));
          removeRoot(f);
        }
      }, 50);
      child.on("exit", () => clearInterval(poll));
    });
    expect(left).toBe(1);
    // The cell owns its runner, its session's harness and its fake daemon; all of them go.
    expect(owned).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/evals\/bin\/run-cell\.mjs t1-thousands$/),
        expect.stringMatching(/\/bin\/claude -p$/),
        expect.stringMatching(/\/squeal\.mjs daemon$/),
      ]),
    );
    expect(existsSync(f.dir)).toBe(false);
    expect(await until(() => cellProcesses(f).length === 0 && daemons(f).length === 0)).toBe(true);
  });
});

describe("a fake root's teardown (014-32, review B3)", { timeout: 30_000 }, () => {
  it("spares a process the cell does not own, whatever its arguments name", async () => {
    const f = root();
    // A sibling the cell's name is a prefix of, a path inside the cell, and an argument holding it.
    const outside = [`${f.dir}-outside`, join(f.dir, "root"), `note=${f.dir}`].map((arg) =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", arg], { stdio: "ignore" }),
    );
    try {
      removeRoot(f);
      await sleep(300);
      for (const p of outside) expect(alive(p.pid as number)).toBe(true);
    } finally {
      for (const p of outside) p.kill("SIGKILL");
    }
  });
});

/** The fake Squeal of the cell's pinned plugin. */
const cliOf = (f: FakeRoot) =>
  join(f.root, "pin-base", f.commit, "plugins/claude-code/dist/cli/squeal.mjs");
/** The cell's fake daemon, started detached as `squeal start` starts it, its root kept. */
function startDaemon(f: FakeRoot, owner: string): number {
  const repo = join(f.dir, "repo");
  mkdirSync(repo, { recursive: true });
  const d = spawn(process.execPath, [cliOf(f), "daemon", repo], {
    cwd: repo,
    env: { ...f.env, FAKE_OWNER: owner },
    detached: true,
    stdio: "ignore",
  });
  d.unref();
  return d.pid as number;
}
/** An owner that starts the fake daemon, names itself in `FAKE_OWNER` and exits at once. */
const OWNER = `const { spawn } = require("node:child_process");
const stat = require("node:fs").readFileSync("/proc/self/stat", "utf8");
const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
const [cli, repo] = process.argv.slice(1);
const env = { ...process.env, FAKE_OWNER: process.pid + ":" + start };
const d = spawn(process.execPath, [cli, "daemon", repo], { cwd: repo, env, detached: true, stdio: "ignore" });
d.unref();
console.log(d.pid);`;

describe("a fake daemon whose owner ended before it started (014-32, review B4)", {
  timeout: 30_000,
}, () => {
  it("ends when its owner exited right after spawning it, its root kept", async () => {
    const f = root();
    const repo = join(f.dir, "repo");
    mkdirSync(repo);
    const owner = spawnSync(process.execPath, ["-e", OWNER, cliOf(f), repo], {
      env: f.env,
      encoding: "utf8",
    });
    const daemon = Number(owner.stdout.trim());
    expect(daemon).toBeGreaterThan(0);
    expect(await until(() => !alive(daemon))).toBe(true);
    expect(existsSync(repo)).toBe(true);
  });

  it("ends when its owner is a zombie or its pid names another process, and runs while it lives", async () => {
    const f = root();
    const living = startDaemon(f, `${process.pid}:${startOf(process.pid)}`);
    // A zombie: the shell's child exits, and the `sleep` the shell became never reaps it.
    const shell = spawn("sh", ["-c", "sleep 0.3 & echo $!; exec sleep 30"]);
    try {
      const [line] = (await new Promise<Buffer>((r) => shell.stdout.once("data", r)))
        .toString()
        .split("\n");
      const zombie = Number(line);
      const start = startOf(zombie);
      expect(start).not.toBeNull();
      expect(await until(() => startOf(zombie) === null && existsSync(`/proc/${zombie}`))).toBe(
        true,
      );
      const ofZombie = startDaemon(f, `${zombie}:${start}`);
      const reused = startDaemon(f, `${process.pid}:0`);
      expect(await until(() => !alive(ofZombie) && !alive(reused))).toBe(true);
      expect(alive(living)).toBe(true);
    } finally {
      shell.kill("SIGKILL");
    }
  });
});
