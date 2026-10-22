import type { FixtureProcess } from "./fixture.js";
import type { SnapshotHost } from "./fixture-snapshot.js";
import { NODE, writeProcesses } from "./fixture-stores.js";

/*
 * Spec 014 D7's host-wide rule (`reviews/wave-2.md` B1): `orphan-waiter`
 * reads every process of the host, which the second sample, Squeal's
 * processes only, does not hold. None of the processes here is Squeal's,
 * so only the first sample has them.
 */

/** An ordinary process of this user: no mark, not Node. */
function plain(pid: number, ppid: number, over: Partial<FixtureProcess>): FixtureProcess {
  return {
    pid,
    ppid,
    pgid: pid,
    comm: "bash",
    nice: 0,
    ageS: 600,
    lifeCpuPct: 1,
    cmdline: ["bash"],
    environ: {},
    ...over,
  };
}

/** A slot waiter of a session: `node <bundle>/dist/waiter.mjs`. */
function waiter(pid: number, ppid: number): FixtureProcess {
  return plain(pid, ppid, {
    comm: "node",
    cmdline: [NODE, "/home/user/.claude/plugins/cache/hearsay/squeal/0.1.240/dist/waiter.mjs"],
  });
}

export interface HostRules {
  /** The waiter whose parent is gone, and the one whose parent lives. */
  readonly goneParent: number;
  readonly liveParent: number;
}

/** Two waiters, one whose parent is gone and one whose parent lives. */
export function writeHostRules(host: SnapshotHost): HostRules {
  writeProcesses(host, [waiter(720, 999), plain(722, 1, {}), waiter(721, 722)]);
  return { goneParent: 720, liveParent: 721 };
}
