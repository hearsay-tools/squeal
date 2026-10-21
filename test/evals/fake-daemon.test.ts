import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { leftoverProcesses } from "../../evals/lib/index.mjs";
import { type FakeRoot, fakeRoot, pids, removeRoot, runCell } from "./fake-cell.js";

// 014-32 (014 lessons, P10): two fake daemons of evals cells ran for over an hour after their
// root was removed. A fake daemon leads its own session and carries no mark of Squeal's, so only
// its runner's teardown stopped it, and a runner killed or crashed first left it running. Each
// case ends a cell on such a path and finds no process of its fake daemon.

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // It ended after the scan.
  }
};
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
/** The processes of the cell's fake daemons, found by their command line, not by a logged pid. */
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
  for (const { pid, line } of leftoverProcesses(f.dir)) if (!/ daemon /.test(line)) kill(pid);
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
    const f = await abandoned({ FAKE_OWNER: String(owner.pid) });
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
    await runCell(f, [...CELL, "--timeout-s", "5"], { FAKE_HARNESS: "hang" }, (child) => {
      const poll = setInterval(() => {
        if (pids(f, "daemons").length > 0 && pids(f, "harness").length >= 2) {
          clearInterval(poll);
          left = daemons(f).length;
          removeRoot(f);
        }
      }, 50);
      child.on("exit", () => clearInterval(poll));
    });
    expect(left).toBe(1);
    expect(existsSync(f.dir)).toBe(false);
    expect(await until(() => leftoverProcesses(f.dir).length === 0)).toBe(true);
  });
});
