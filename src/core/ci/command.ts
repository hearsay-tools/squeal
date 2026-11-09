import { spawn } from "node:child_process";
import { constants } from "node:os";

/** The signals `runCommand` passes on to its command. */
const FORWARDED = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** A command that could not start: why, and the shell's code for it. */
export interface NotStarted {
  readonly failed: string;
  readonly code: 126 | 127;
}

/**
 * Runs `command` in `cwd` with `env` and the inherited stdio, and passes
 * SIGINT, SIGTERM and SIGHUP on to it (spec 018 D8). Resolves with its exit
 * code, `128 + n` for signal `n`, or why it could not start: 127 when it is
 * not found, 126 otherwise, as a shell exits. `squeal hold` runs its command
 * the same way, with the inherited env (`src/cli/hold.ts`).
 */
export function runCommand(
  command: readonly [string, ...string[]],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<number | NotStarted> {
  const [program, ...args] = command;
  return new Promise((resolve) => {
    let started = false;
    let settled = false;
    const child = spawn(program, args, { cwd, env, stdio: "inherit" });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    for (const signal of FORWARDED) process.on(signal, forward);
    const done = (result: number | NotStarted) => {
      if (settled) return;
      settled = true;
      for (const signal of FORWARDED) process.off(signal, forward);
      resolve(result);
    };
    child.once("spawn", () => {
      started = true;
    });
    // After the spawn an error is a failed signal; the exit still decides.
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (started) return;
      const code = error.code === "ENOENT" ? 127 : 126;
      done({ failed: `could not run ${program}: ${error.message}`, code });
    });
    child.once("exit", (code, signal) =>
      done(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0))),
    );
  });
}
