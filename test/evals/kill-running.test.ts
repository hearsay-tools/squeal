import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupLive, killRunning, runBounded } from "../../evals/lib/index.mjs";
import { alive } from "./fake-cell.js";

// A runner's teardown returns only once the session's process group has no live process left:
// main's CI saw run-cell.test.ts's S2 test find a just-killed harness still there (006, 2026-10-11).
// Its tests run in order: once one has called killRunning, runBounded starts nothing (006-97).
describe("killRunning", () => {
  it("waits until every process in the session's group is gone", async () => {
    let out = "";
    const session = runBounded({
      command: "sh",
      args: ["-c", "sleep 30 & echo $! $$; wait"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 60_000,
      onStdout: (d) => {
        out += d.toString();
      },
      log: () => {},
    });
    const deadline = Date.now() + 10_000;
    while (!/\d+ \d+/.test(out) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    const [child, shell] = out.trim().split(" ").map(Number) as [number, number];
    expect(alive(child) && alive(shell)).toBe(true);
    let resumed = false;
    void session.then(() => {
      resumed = true;
    });
    await killRunning("SIGKILL");
    // Its run has settled: the shell is reaped and what its end resumes has run (006-97).
    expect(resumed).toBe(true);
    expect(groupLive(shell)).toBe(false);
    expect(alive(child)).toBe(false);
    expect(alive(shell)).toBe(false);
    expect((await session).signal).toBe("SIGKILL");
  });

  it("returns at once when nothing is running", async () => {
    const start = Date.now();
    await killRunning("SIGKILL");
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("leaves runBounded starting nothing once it has run (006-97)", async () => {
    await killRunning("SIGKILL");
    const dir = mkdtempSync(join(tmpdir(), "squeal-evals-kill-"));
    try {
      const logged: string[] = [];
      const r = await runBounded({
        command: "sh",
        args: ["-c", `touch ${join(dir, "started")}`],
        cwd: dir,
        env: process.env,
        timeoutMs: 5_000,
        log: (s: string) => logged.push(s),
      });
      expect(r).toEqual({ exit: null, signal: null, timedOut: false, spawnError: "stopping" });
      expect(existsSync(join(dir, "started"))).toBe(false);
      expect(logged).toEqual(["the teardown has begun: sh -c not started"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
