import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { lockFileFor } from "../../src/core/store/index.js";
import type { BundleRun } from "../harness/bundle-helpers.js";
import type { E2E } from "./harness.js";

/*
 * Task 001-337: the bad-config restart's `daemonReady` timed out at 45 s five
 * times with no evidence, since cleanup removed the fixture. On that timeout
 * this prints what the restart left (stderr and the error, so a gate's log
 * shows it) and keeps the fixture directory.
 */

const run = promisify(execFile);
const PS_FIELDS = "pid,ppid,stat,etime,pcpu,wchan:20,args";

/**
 * This plugin copy's daemons with their `ps` state, wait channel and age, as
 * `daemonPids` finds them, from one `ps` that does not block the test.
 */
export async function daemonProcesses(plugin: string): Promise<string> {
  const at = new Date().toISOString();
  const ps = await run("ps", ["-eo", PS_FIELDS]).catch((error: unknown) => ({
    stdout: `ps failed: ${String(error)}`,
  }));
  const daemon = `${join(plugin, "dist/cli/squeal.mjs")} daemon`;
  const [header = "", ...rows] = ps.stdout.split("\n");
  const found = rows.filter((row) => row.includes(daemon));
  return [at, header, ...(found.length === 0 ? ["no daemon process"] : found)].join("\n");
}

/** What the restart did before the wait: the stop, the third SessionStart, and the daemons after each. */
export interface Restart {
  readonly stop: BundleRun & { readonly at: string };
  readonly afterStop: Promise<string>;
  readonly sessionStart: BundleRun & { readonly text: string | null; readonly at: string };
  readonly afterSessionStart: Promise<string>;
}

/** `wait`, and on its failure the restart's evidence, with the fixture kept; rethrows. */
export async function withRestartEvidence<T>(
  e: E2E,
  restart: Restart,
  wait: () => Promise<T>,
): Promise<T> {
  try {
    return await wait();
  } catch (error) {
    const evidence = await collect(e, restart, error);
    console.error(`001-337 restart evidence:\n${evidence}`);
    const wrapped = new Error(
      `${(error as Error).message}\n001-337 restart evidence:\n${evidence}`,
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function collect(e: E2E, restart: Restart, error: unknown): Promise<string> {
  const settle = <T>(p: Promise<T>) => p.catch((err: unknown) => `failed: ${String(err)}`);
  const status = await settle(e.status(e.main));
  const evidence = {
    error: String(error),
    stop: restart.stop,
    afterStop: await settle(restart.afterStop),
    sessionStart: restart.sessionStart,
    afterSessionStart: await settle(restart.afterSessionStart),
    atFailure: await settle(daemonProcesses(e.plugin)),
    ping: await settle(e.ping(e.main)),
    status:
      typeof status === "string"
        ? status
        : { daemon: status.daemon, revision: status.revision, daemonNotes: status.daemonNotes },
    lockFree: lockFree(e.main),
    store: await settle(run("ls", ["-laR", join(e.main, ".git/squeal")]).then((r) => r.stdout)),
    loadavg: readFileSync("/proc/loadavg", "utf8").trim(),
    kept: e.keep(),
  };
  return JSON.stringify(evidence, null, 2);
}

/** Whether the worktree's daemon lock is free now: taken and released at once. */
function lockFree(root: string): boolean | string {
  try {
    const lock = acquireDaemonLock(lockFileFor(join(root, ".git"), worktreeIdFor(root)));
    lock?.release();
    return lock !== null;
  } catch (error) {
    return `failed: ${String(error)}`;
  }
}
