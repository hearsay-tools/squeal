import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HandOff, type OutputStream, writeThenCommit } from "../shared/hand-off.js";
import type { HookDeps } from "../shared/hook.js";
import { sessionRootFiles } from "../shared/session-root.js";
import { antigravityCommand } from "./command.js";
import type { AntigravityHandler } from "./hook.js";
import { keepOnSpawn, keptAntigravityCli } from "./kept.js";
import { runAntigravityHandler } from "./run.js";

/**
 * Spec 024 D4: PreToolUse's internal deadline, below its `hooks.json`
 * timeout of 5 s. Antigravity blocks a tool call whose PreToolUse hook it
 * kills at the timeout, so the hook gives up first and allows the call.
 */
export const PRE_TOOL_USE_DEADLINE_MS = 1_500;

/** Where a hook process writes and how it ends; tests give their own. */
export interface HookIo {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  /** Ends the process at the deadline. Default `process.exit`. */
  readonly exit: (code: number) => void;
  /** The fail-open deadline: `PRE_TOOL_USE_DEADLINE_MS` for `pre-tool-use`, none for the others. */
  readonly deadlineMs: number | null;
}

const deadlineOf = (name: string): number | null =>
  name === "pre-tool-use" ? PRE_TOOL_USE_DEADLINE_MS : null;

/**
 * Process wrapper of one bundled Antigravity hook: stdin in, stdout and
 * stderr out, exit 0. Calls `process.exit` only at PreToolUse's deadline,
 * when it has written nothing.
 */
export async function runMain(name: string, handler: AntigravityHandler): Promise<void> {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No readable stdin: the hook has no input and stays silent.
  }
  await runHookInput(name, handler, stdin, process.env);
}

/**
 * One Antigravity hook on stdin text already read, in `env`. Writes the
 * hook's stdout and stderr, then commits the reports they carry (row
 * 011-288, `writeThenCommit`); never throws. With a deadline (D4), an
 * unref'd timer abandons the prepared reports and exits 0 with empty stdout
 * when the handler has not answered in time, and a late answer is dropped;
 * an answer in time clears it before anything is written. `overrides` are
 * for tests: a stand-in daemon; `io` the streams, the exit and the deadline.
 */
export async function runHookInput(
  name: string,
  handler: AntigravityHandler,
  stdin: string,
  env: NodeJS.ProcessEnv,
  overrides: Partial<HookDeps> = {},
  io: Partial<HookIo> = {},
): Promise<void> {
  const exit = io.exit ?? ((code: number) => process.exit(code));
  const deadline = io.deadlineMs === undefined ? deadlineOf(name) : io.deadlineMs;
  // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs; once a hook kept
  // this version's copy (spec 024 D1), the copy's CLI.
  const cli =
    keptAntigravityCli(env) ?? fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url));
  // Row 011-288: a report commits once its output is written.
  const handOff = new HandOff();
  const deps: HookDeps = {
    env,
    sessionRoots: sessionRootFiles(env),
    cli,
    command: antigravityCommand(env, cli),
    handOff,
    ...overrides,
  };
  let late = false;
  const timer =
    deadline === null
      ? null
      : setTimeout(() => {
          late = true;
          handOff.abandon();
          exit(0);
        }, deadline);
  timer?.unref();
  // SessionStart keeps the copy itself; every other hook keeps it when it spawns (row 005-81).
  const kept = name === "session-start" ? deps : keepOnSpawn(deps);
  const result = await runAntigravityHandler(name, handler, stdin, kept);
  if (timer !== null) clearTimeout(timer);
  if (late) {
    // What the handler handed over after the deadline stays owed.
    handOff.abandon();
    return;
  }
  await writeThenCommit(handOff, [
    [io.stdout ?? process.stdout, result.stdout],
    [io.stderr ?? process.stderr, result.stderr],
  ]);
}
