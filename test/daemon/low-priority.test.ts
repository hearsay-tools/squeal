import { type ChildProcess, spawn } from "node:child_process";
import { getPriority } from "node:os";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { EscapedChildren } from "../../src/core/daemon/escaped.js";
import { lowerWhile, TEST_NICE } from "../../src/core/daemon/low-priority.js";
import { childrenOf, statOf } from "../../src/core/daemon/terminate.js";

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

/** `LEADER` in its own group, `daemon` the `EscapedChildren` standing in for it, `sleeper(lane)` its sleeper's pid. */
async function leaderGroup() {
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
  const daemon = new EscapedChildren(undefined, leader.pid);
  // the group's members at the start are never the daemon's: let that scan finish first
  await sleep(500);
  const sleeper = async (lane: string): Promise<number> => {
    leader.stdin?.write(`${JSON.stringify(daemon.envFor(lane))}\n`);
    return Number((await lines.next()).value);
  };
  return { daemon, sleeper };
}

/**
 * A daemon's stand-in that leads its own group: on its one line, an env, it
 * starts a carrier with it whose child starts a sleeper, and the child
 * prints `{ middle, late }`, its own pid and the sleeper's (review wave-18 B1).
 */
const NESTING_LEADER = `const { spawn } = require("node:child_process");
const middle = \`const { spawn } = require("node:child_process");
const late = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
console.log(JSON.stringify({ middle: process.pid, late: late.pid }));
setTimeout(() => {}, 30000);\`;
const root = \`require("node:child_process").spawn(process.execPath, ["-e", \${JSON.stringify(middle)}], { stdio: ["ignore", "inherit", "ignore"] });
setTimeout(() => {}, 30000);\`;
require("node:readline").createInterface({ input: process.stdin }).once("line", (line) => {
  spawn(process.execPath, ["-e", root], { env: { ...process.env, ...JSON.parse(line) }, stdio: ["ignore", "inherit", "ignore"] });
});
console.log("ready");
`;

/** Every descendant `pid` has now, as the daemon's walk lists them. */
function descendants(pid: number): number[] {
  return childrenOf(pid).flatMap((child) => [child, ...descendants(child)]);
}

/** A process that sleeps until the test ends: its pid stands in for a fork's, or a fork's child's. */
function sleeper(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
    stdio: "ignore",
  });
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  if (child.pid === undefined) throw new Error("no sleeper");
  return child.pid;
}

/**
 * A fork, lowered as lane `fast`'s carrier from the first look, whose child
 * `late` is listed by its walk only once `listed()` holds: a clone not yet made.
 */
function lateChild(listed: () => boolean) {
  const fork = sleeper();
  const late = sleeper();
  const entry = statOf(fork);
  if (entry === null) throw new Error("no fork");
  const settled = new AbortController();
  const running = lowerWhile({ carriers: async () => [entry] }, "fast", 0, settled.signal, () =>
    listed() ? [late] : [],
  );
  const stop = async () => {
    settled.abort();
    await running;
  };
  onTestFinished(stop);
  return { fork, late, lowering: { stop } };
}

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

  it("lowers a child still being forked when its fork was lowered (001-437)", {
    timeout: 15_000,
  }, async () => {
    // A clone copies its parent's nice as it starts, and is listed among the
    // parent's children only once it is made: 15 walks, over 5 s, miss it, at nice 0.
    let walks = 0;
    const { fork, late, lowering } = lateChild(() => walks++ >= 15);
    for (let waited = 0; waited < 12_000 && getPriority(late) < TEST_NICE; waited += 50)
      await sleep(50);
    expect({ fork: getPriority(fork), late: getPriority(late) }).toEqual({
      fork: TEST_NICE,
      late: TEST_NICE,
    });
    await lowering.stop();
  });

  it("walks a lowered fork once a second after its first, and lowers a late child so (001-437)", async () => {
    const started = Date.now();
    const walked: number[] = [];
    const { late, lowering } = lateChild(() => {
      walked.push(Date.now() - started);
      return Date.now() - started >= 1_500;
    });
    for (let waited = 0; waited < 4_000 && getPriority(late) < TEST_NICE; waited += 50)
      await sleep(50);
    const lowered = Date.now() - started;
    await lowering.stop();
    expect(getPriority(late)).toBe(TEST_NICE);
    // listed from 1.5 s on, found by the next once-a-second walk
    expect(lowered).toBeLessThan(1_500 + 1_500);
    expect(walked.filter((at) => at >= 1_250 && at < 2_250).length).toBeLessThanOrEqual(2);
  });

  it("leaves a fork of another lane at the daemon's priority", async () => {
    const own = getPriority();
    expect(await shortFork("slow:vitest")).toEqual({ own, child: own });
  });

  it("lowers a carrier its parent left in the daemon's group before a look found it (001-401 S1)", async () => {
    const { daemon, sleeper } = await leaderGroup();
    const settled = new AbortController();
    const lowering = lowerWhile(daemon, "fast", daemon.mark(), settled.signal);
    onTestFinished(async () => {
      settled.abort();
      await lowering;
    });
    const lowered = async (): Promise<number> => {
      const pid = await sleeper("fast");
      for (let waited = 0; waited < 3_000 && getPriority(pid) < TEST_NICE; waited += 50)
        await sleep(50);
      return getPriority(pid);
    };
    // the first, then one after the scan's least interval, found by the exit of its shell
    expect(await lowered()).toBe(TEST_NICE);
    await sleep(1_100);
    expect(await lowered()).toBe(TEST_NICE);
  });

  it("lowers a late child its lowered parent left in the group while the carrier lives (wave-18 B1)", {
    timeout: 15_000,
  }, async () => {
    const leader = spawn(process.execPath, ["-e", NESTING_LEADER], {
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
    const daemon = new EscapedChildren(undefined, leader.pid);
    await sleep(500);
    const since = daemon.mark();
    // the first scan for orphans, before the carrier: no child of the daemon exits after it
    expect(await daemon.carriers("fast", since)).toEqual([]);
    leader.stdin?.write(`${JSON.stringify(daemon.envFor("fast"))}\n`);
    const { middle, late } = JSON.parse(String((await lines.next()).value)) as {
      middle: number;
      late: number;
    };
    const settled = new AbortController();
    let walks = 0;
    // the first walk lists the middle child alone, its sleeper not yet made; it exits after
    const lowering = lowerWhile(daemon, "fast", since, settled.signal, (pid) => {
      if (++walks > 1) return descendants(pid);
      setTimeout(() => process.kill(middle, "SIGKILL"), 10);
      return [middle];
    });
    onTestFinished(async () => {
      settled.abort();
      await lowering;
    });
    for (let waited = 0; waited < 5_000 && getPriority(late) < TEST_NICE; waited += 50)
      await sleep(50);
    expect(getPriority(late)).toBe(TEST_NICE);
  });

  it("keeps another lane's orphan for that lane's look when one lane's look scans (wave-13bt S1)", async () => {
    const { daemon, sleeper } = await leaderGroup();
    const since = daemon.mark();
    expect(await daemon.carriers("fast", since)).toEqual([]);
    // the one exit: the slow lane's shell, its sleeper left in the group at the daemon's nice
    const pid = await sleeper("slow:vitest");
    await sleep(1_100);
    expect(await daemon.carriers("fast", since)).toEqual([]);
    const slow = await daemon.carriers("slow:vitest", since);
    expect(slow.map((entry) => entry.pid)).toEqual([pid]);
  });
});
