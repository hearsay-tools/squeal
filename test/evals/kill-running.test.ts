import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { groundTruth, groupLive, killRunning, runBounded } from "../../evals/lib/index.mjs";
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

  it("leaves a ground truth after it writing nothing (006-98)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-evals-kill-"));
    try {
      mkdirSync(join(dir, "scripts"));
      writeFileSync(join(dir, "scripts/a.test.mjs"), "");
      const out = join(dir, "out");
      mkdirSync(out);
      const refused = { exit: null, signal: null, timedOut: false, spawnError: "stopping" };
      const truth = await groundTruth({ cwd: dir, env: process.env, out, log: () => {} });
      expect(truth).toEqual({ vitest: refused, nodeTest: { ...refused, files: 1 } });
      expect(existsSync(join(out, "truth.json"))).toBe(false);
      expect(existsSync(join(out, "truth.node.txt"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 006-98: a judge script ends the groups runBounded runs on SIGINT and SIGTERM, before any
// continuation of theirs runs, and exits 128 + n. A child process installs it twice and starts a
// shell that, with a child of its own, ignores both signals.
const SCRIPT = `import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBounded, stopOnSignal } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "../../evals/lib/session.mjs")).href)};
const dir = process.argv[2];
stopOnSignal();
stopOnSignal();
writeFileSync(join(dir, "listeners"), process.listenerCount("SIGINT") + " " + process.listenerCount("SIGTERM"));
const loop = "trap '' INT TERM; echo $$ >> pids; while :; do sleep 1; done";
runBounded({
  command: "sh",
  args: ["-c", 'sh -c "$0" & ' + loop, loop],
  cwd: dir,
  env: process.env,
  timeoutMs: 60_000,
  log: () => {},
}).then(() => writeFileSync(join(dir, "resumed"), ""));
`;

describe("stopOnSignal", { timeout: 30_000 }, () => {
  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ] as const)("ends every running group on %s and exits %i", async (signal, code) => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-evals-signal-"));
    const pids = () =>
      existsSync(join(dir, "pids"))
        ? readFileSync(join(dir, "pids"), "utf8").split("\n").filter(Boolean).map(Number)
        : [];
    try {
      writeFileSync(join(dir, "script.mjs"), SCRIPT);
      const child = spawn(process.execPath, [join(dir, "script.mjs"), dir], { stdio: "ignore" });
      const closed = new Promise<number | null>((r) => child.on("close", (c) => r(c)));
      await vi.waitFor(() => expect(pids()).toHaveLength(2), { timeout: 10_000, interval: 20 });
      child.kill(signal);
      expect(await closed).toBe(code);
      expect(readFileSync(join(dir, "listeners"), "utf8")).toBe("1 1");
      expect(pids().filter(alive)).toEqual([]);
      expect(pids().some(groupLive)).toBe(false);
      expect(existsSync(join(dir, "resumed"))).toBe(false);
    } finally {
      for (const pid of pids().filter(alive)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
