import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Handler } from "./hook.js";
import { runHandler } from "./run.js";

/**
 * Process wrapper of one bundled hook: stdin in, stdout and stderr out, exit
 * code set. Never calls `process.exit`, so piped output is flushed on every
 * platform; nothing is left open when `runHook` returns.
 */
export async function runMain(name: string, handler: Handler): Promise<void> {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No readable stdin: the hook has no input and stays silent.
  }
  const result = await runHandler(name, handler, stdin, {
    env: process.env,
    // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs (review wave 3, B1).
    cli: fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url)),
    ...waiterTimeout(process.env.SQUEAL_WAITER_TIMEOUT_MS),
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

/** `SQUEAL_WAITER_TIMEOUT_MS` shortens the idle waiter, for tests and debugging. */
function waiterTimeout(value: string | undefined): { waiterTimeoutMs?: number } {
  const ms = Number(value);
  return value !== undefined && Number.isInteger(ms) && ms > 0 ? { waiterTimeoutMs: ms } : {};
}
