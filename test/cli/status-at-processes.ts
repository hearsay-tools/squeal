import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/*
 * Rows 023-07 and 023-08: what the killed-run tests share: waiting for a
 * file, and whether a process still runs. A zombie waiting for its reaper
 * does not count as running.
 */

export async function waitFor(path: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`${path} was not written in ${ms} ms`);
    await delay(50);
  }
}

/** Whether `pid` runs: it exists and is not a zombie waiting for its reaper. */
export function alive(pid: number): boolean {
  if (existsSync("/proc/self/stat")) {
    try {
      const text = readFileSync(`/proc/${pid}/stat`, "utf8");
      return text.slice(text.lastIndexOf(")") + 2)[0] !== "Z";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `pid`'s `/proc` state line, for a failure's message. */
export function stateOf(pid: number): string {
  try {
    return `${pid}: ${readFileSync(`/proc/${pid}/stat`, "utf8").trim()}`;
  } catch {
    return `${pid}: no /proc entry`;
  }
}

export async function gone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > deadline) return false;
    await delay(50);
  }
  return true;
}
