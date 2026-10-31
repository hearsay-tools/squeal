import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HandOff, writeThenCommit } from "../shared/hand-off.js";
import type { HookDeps } from "../shared/hook.js";
import { sessionRootFiles } from "../shared/session-root.js";
import type { Handler } from "./hook.js";
import { runHandler } from "./run.js";

/**
 * Process wrapper of one bundled hook: stdin in, stdout and stderr out, exit
 * code set. Never calls `process.exit`, so piped output is flushed on every
 * platform; nothing is left open when `runHook` returns. The reports the
 * output carries commit once it is written (row 011-288). `overrides` are
 * for tests: a stand-in daemon, an environment.
 */
export async function runMain(
  name: string,
  handler: Handler,
  overrides: Partial<HookDeps> = {},
): Promise<void> {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No readable stdin: the hook has no input and stays silent.
  }
  // Row 011-288: a report commits once its output is written.
  const handOff = new HandOff();
  const result = await runHandler(name, handler, stdin, {
    env: process.env,
    handOff,
    sessionRoots: sessionRootFiles(process.env),
    // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs (review wave 3, B1).
    cli: fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url)),
    ...waiterTimeout(process.env.SQUEAL_WAITER_TIMEOUT_MS),
    ...overrides,
  });
  process.exitCode = result.exitCode;
  await writeThenCommit(handOff, [
    [process.stdout, result.stdout],
    [process.stderr, result.stderr],
  ]);
}

/** `SQUEAL_WAITER_TIMEOUT_MS` shortens the idle waiter, for tests and debugging. */
function waiterTimeout(value: string | undefined): { waiterTimeoutMs?: number } {
  const ms = Number(value);
  return value !== undefined && Number.isInteger(ms) && ms > 0 ? { waiterTimeoutMs: ms } : {};
}
