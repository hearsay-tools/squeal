import { type ChildProcess, spawn } from "node:child_process";
import { getPriority } from "node:os";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { EscapedChildren } from "../../src/core/daemon/escaped.js";
import { lowerWhile, TEST_NICE } from "../../src/core/daemon/low-priority.js";

/*
 * 001 D11 Priority (task 001-393): a Vitest fork worker, a child of the
 * daemon carrying its lane's mark, runs at `nice` 10 from its start, not
 * from a poll a second later, so a fork shorter than a second is lowered
 * too. This process stands in for the daemon. Run at `nice` 10 already
 * (under a lowered daemon), the checks hold trivially.
 */

/** Prints its own priority and its child's, 400 ms after it starts: a fork shorter than 1 s. */
const SHORT_FORK = `const { spawn } = require("node:child_process");
const { getPriority } = require("node:os");
const child = spawn(process.execPath, ["-e", "setTimeout(() => console.log(require('node:os').getPriority()), 400)"], { stdio: ["ignore", "pipe", "ignore"] });
let out = "";
child.stdout.on("data", (chunk) => { out += chunk; });
child.on("exit", () => console.log(JSON.stringify({ own: getPriority(), child: Number(out.trim()) })));
`;

/** A short fork of `lane`'s run, started 450 ms into it, past a one-second poll's first look at 250 ms. */
async function shortFork(lane: string): Promise<{ own: number; child: number }> {
  const children = new EscapedChildren();
  const settled = new AbortController();
  const lowering = lowerWhile(children, "fast", children.mark(), settled.signal);
  onTestFinished(async () => {
    settled.abort();
    await lowering;
  });
  await sleep(450);
  const fork = spawn(process.execPath, ["-e", SHORT_FORK], {
    env: { ...process.env, ...children.envFor(lane) },
    stdio: ["ignore", "pipe", "ignore"],
  });
  onTestFinished(() => {
    fork.kill("SIGKILL");
  });
  return JSON.parse(await output(fork)) as { own: number; child: number };
}

/**
 * A daemon's stand-in that leads its own group: on each line, an env, it runs
 * a shell with it that leaves a sleeper behind and exits, and prints the
 * sleeper's pid (review 001-401 S1).
 */
const LEADER = `const { spawnSync } = require("node:child_process");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const env = { ...process.env, ...JSON.parse(line) };
  const shell = spawnSync("/bin/sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { env, encoding: "utf8" });
  console.log(shell.stdout.trim());
});
console.log("ready");
`;

function output(child: ChildProcess): Promise<string> {
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  return new Promise((done) => child.on("exit", () => done(out)));
}

describe.runIf(process.platform === "linux")("lowerWhile: forks at nice 10 (001-393)", () => {
  it("lowers a fork shorter than 1 s, and its child", async () => {
    expect(await shortFork("fast")).toEqual({ own: TEST_NICE, child: TEST_NICE });
  });

  it("leaves a fork of another lane at the daemon's priority", async () => {
    const own = getPriority();
    expect(await shortFork("slow:vitest")).toEqual({ own, child: own });
  });

  it("lowers a carrier its parent left in the daemon's group before a look found it (001-401 S1)", async () => {
    const leader = spawn(process.execPath, ["-e", LEADER], {
      detached: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    onTestFinished(() => {
      try {
        if (leader.pid !== undefined) process.kill(-leader.pid, "SIGKILL");
      } catch {
        // gone
      }
    });
    const lines = createInterface({ input: leader.stdout as NodeJS.ReadableStream })[
      Symbol.asyncIterator
    ]();
    expect((await lines.next()).value).toBe("ready");
    const children = new EscapedChildren(undefined, leader.pid);
    // the group's members at the start are never the daemon's: let that scan finish first
    await sleep(500);
    const settled = new AbortController();
    const lowering = lowerWhile(children, "fast", children.mark(), settled.signal);
    onTestFinished(async () => {
      settled.abort();
      await lowering;
    });
    const sleeper = async (): Promise<number> => {
      leader.stdin?.write(`${JSON.stringify(children.envFor("fast"))}\n`);
      const pid = Number((await lines.next()).value);
      for (let waited = 0; waited < 3_000 && getPriority(pid) < TEST_NICE; waited += 50)
        await sleep(50);
      return getPriority(pid);
    };
    // the first, then one after the scan's least interval, found by the exit of its shell
    expect(await sleeper()).toBe(TEST_NICE);
    await sleep(1_100);
    expect(await sleeper()).toBe(TEST_NICE);
  });
});
