import { lstatSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";

/*
 * Row 026-37 (#301), review 0.1.658 B2 and N1: what lets a daemon decide
 * that a tracked machine's worktree is gone, and so delete the machine.
 *
 * B2: a worktree is `gone` only when its path is confirmed missing
 * (`ENOENT`, `ENOTDIR`). Any other error (a parent without search
 * permission, an I/O error) is `unknown`: the machine is kept, never
 * deleted on a guess. Prune and the daemon's exit use this one check.
 *
 * N1: a path is evidence only in the filesystem it was written in. Each
 * new record names its `scope`: the host name plus the mount namespace
 * (`/proc/self/ns/mnt`) where readable, else the host name alone. The
 * automatic prune acts only on records of its own scope, or on records
 * without one, which predate the field.
 */

export type WorktreePresence = "present" | "gone" | "unknown";

/** Whether `path` is there, confirmed missing, or not knowable from here. */
export function worktreePresence(path: string): WorktreePresence {
  try {
    lstatSync(path);
    return "present";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "gone" : "unknown";
  }
}

let scope: string | null = null;

/** This process's filesystem scope: `<host> mnt:[<inode>]`, or the host name alone. */
export function machineScope(): string {
  if (scope !== null) return scope;
  let namespace = "";
  try {
    namespace = readlinkSync("/proc/self/ns/mnt");
  } catch {
    // Not Linux, or no procfs here: the host name alone.
  }
  scope = namespace === "" ? hostname() : `${hostname()} ${namespace}`;
  return scope;
}
