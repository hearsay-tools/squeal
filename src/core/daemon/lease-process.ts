import { harnessAlive, pidNamespace, readProcStat } from "../delivery/harness-process.js";
import type { LeaseProcess } from "../types/daemon-writes.js";

/*
 * Review 0.1.442 B3 (row 021-16): the write lease belongs to a process. A
 * client paused between deciding a report and handing it to its host keeps
 * the lease while it lives, as a process paused inside `BEGIN IMMEDIATE`
 * kept SQLite's write lock, so no other client tells that report meanwhile;
 * a client that died loses it, as SQLite rolls a dead writer back.
 */

/** Process `pid` as a lease names it: with its start time and PID namespace where `/proc` has them. */
export function leaseProcess(pid: number = process.pid): LeaseProcess {
  const namespace = pidNamespace();
  let startTime: number | null = null;
  try {
    startTime = namespace === null ? null : (readProcStat(pid)?.startTime ?? null);
  } catch {
    startTime = null;
  }
  return { pid, startTime, pidNamespace: startTime === null ? null : namespace };
}

/**
 * Whether `holder` lives: `false` once it is surely gone (missing, its PID
 * reused, a zombie), `null` when that cannot be told (another PID
 * namespace, an unreadable stat). Without `/proc`, a signal 0 tells whether
 * its PID is in use.
 */
export function leaseProcessAlive(holder: LeaseProcess): boolean | null {
  const { pid, startTime, pidNamespace: namespace } = holder;
  if (startTime !== null && namespace !== null) {
    try {
      return harnessAlive(
        { pid, startTime, pidNamespace: namespace },
        pidNamespace(),
        readProcStat,
      );
    } catch {
      return null;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ESRCH" ? false : code === "EPERM" ? true : null;
  }
}
