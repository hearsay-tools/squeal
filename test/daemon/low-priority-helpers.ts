import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, onTestFinished } from "vitest";
import { EscapedChildren } from "../../src/core/daemon/escaped.js";

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
export async function leaderGroup() {
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

/** The least time between two scans of the group, `ORPHANS_EVERY_MS` in `escaped.ts`. */
export const SCAN_EVERY_MS = 1_000;

/**
 * `children` for `lowerWhile`, its looks watched (task 011-257): `after(at,
 * done)` resolves at a look's start once `done()` holds, or at the second
 * look started at `at` or later, when the first has returned and what it
 * found is lowered. `found` holds every pid a look returned.
 */
export function watched(children: Pick<EscapedChildren, "carriers">) {
  const found = new Set<number>();
  let waiters: ((started: number) => void)[] = [];
  return {
    found,
    async carriers(lane: string, since: number, lost?: boolean) {
      const started = Date.now();
      for (const waiter of waiters) waiter(started);
      const entries = await children.carriers(lane, since, lost);
      for (const { pid } of entries) found.add(pid);
      return entries;
    },
    after(at: number, done: () => boolean): Promise<void> {
      let begun = 0;
      return new Promise((resolve) => {
        const waiter = (started: number) => {
          if (started >= at) begun++;
          if (!done() && begun < 2) return;
          waiters = waiters.filter((other) => other !== waiter);
          resolve();
        };
        waiters.push(waiter);
      });
    },
  };
}
