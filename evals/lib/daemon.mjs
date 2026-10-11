// The cell's Squeal daemons: found by their command line, and waited for after `squeal stop`
// (005-06 and 005-07 saw `stop` return while the daemon was still exiting).
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Processes whose command line names `dir` (a cell), other than `pgrep` and the runner itself:
 * `[{ pid, line }]`. Anything left at the end of a cell is the cell's own, to be stopped.
 */
export function leftoverProcesses(dir) {
  return (spawnSync("pgrep", ["-af", dir], { encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .filter((l) => l && !l.includes("pgrep") && !l.includes("run-cell.mjs"))
    .map((line) => ({ pid: Number(line.split(" ")[0]), line }))
    .filter((p) => p.pid !== process.pid);
}

/**
 * Stops the daemons serving `work`: `stop()` (the pinned CLI's `squeal stop`, returning its
 * last line, or null when there is no CLI or repository yet), then each pid found before or
 * after is waited for and escalated (`waitForExit`). Logs and returns the exits.
 */
export async function stopDaemons({ work, stop, why, log }) {
  const pids = daemonPids(work);
  const said = stop() ?? "no stop command";
  const exits = await waitForExit([...new Set([...pids, ...daemonPids(work)])]);
  log(`daemon stopped (${why}): ${said}; ${JSON.stringify(exits)}`);
  return exits;
}

/**
 * Kills every process still naming `cell` (`leftoverProcesses`), listing them in
 * `<out>/leftovers.txt`. Returns how many there were.
 */
export async function stopLeftovers({ cell, out, log }) {
  const left = leftoverProcesses(cell);
  if (!left.length) return 0;
  log(`leftover processes: ${left.length}`);
  appendFileSync(join(out, "leftovers.txt"), `${left.map((p) => p.line).join("\n")}\n`);
  await waitForExit(
    left.map((p) => p.pid),
    0,
  );
  return left.length;
}
