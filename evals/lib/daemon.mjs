// The cell's Squeal daemons: found by their command line, and waited for after `squeal stop`
// (005-06 and 005-07 saw `stop` return while the daemon was still exiting).
import { spawnSync } from "node:child_process";

/** Pids of `node <cli> daemon <root>` processes serving `root`. */
export function daemonPids(root) {
  const ps = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout ?? "";
  return ps
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m && / daemon /.test(m[2]) && m[2].includes(` daemon ${root}`))
    .map((m) => Number(m[1]));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits up to `ms` for each pid to exit, then sends SIGTERM and, 2 s later, SIGKILL.
 * Returns `[{ pid, exitedMs, signal }]`: `signal` is `null` when the process exited by itself.
 */
export async function waitForExit(pids, ms = 10_000) {
  const out = [];
  for (const pid of pids) {
    const t0 = Date.now();
    while (alive(pid) && Date.now() - t0 < ms) await sleep(50);
    let signal = null;
    for (const sig of ["SIGTERM", "SIGKILL"]) {
      if (!alive(pid)) break;
      signal = sig;
      process.kill(pid, sig);
      const t1 = Date.now();
      while (alive(pid) && Date.now() - t1 < 2000) await sleep(50);
    }
    out.push({ pid, exitedMs: Date.now() - t0, signal });
  }
  return out;
}
