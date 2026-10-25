import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { lowerProcess } from "../../core/daemon/low-priority.js";

/** How a test file's process ended. Recorded in the run log and trusted for nothing (D5). */
export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Set when the process could not start, such as a missing executable. */
  readonly error: string | null;
}

export interface GroupProcess {
  readonly exited: Promise<ProcessExit>;
  /** Signals the whole process group: the runner, its test child and what they spawned. */
  kill(signal: NodeJS.Signals): void;
}

export interface GroupProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Starts `command` in its own process group with stdout and stderr written
 * to files, so they outlive a killed run. When the leader exits, whatever
 * is left of its group is killed: a test's children go with the run. It
 * runs at `nice` 10 from its start, and what it spawns inherits that (001
 * D11 Capacity, task 001-378).
 */
export function startGroup(options: GroupProcessOptions): GroupProcess {
  const out = openSync(options.stdout, "a");
  const err = openSync(options.stderr, "a");
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", out, err],
  });
  closeSync(out);
  closeSync(err);
  if (child.pid !== undefined) lowerProcess(child.pid);
  let done = false;
  const kill = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // the group is already gone
    }
  };
  const exited = new Promise<ProcessExit>((resolve) => {
    child.once("error", (error) => {
      done = true;
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("exit", (code, signal) => {
      if (done) return;
      done = true;
      kill("SIGKILL");
      resolve({ code, signal, error: null });
    });
  });
  return { exited, kill: (signal) => (done ? undefined : kill(signal)) };
}
