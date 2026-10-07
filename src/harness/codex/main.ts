import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CodexHandler } from "./hook.js";
import { runCodexHandler } from "./run.js";

/**
 * Process wrapper of one bundled Codex hook: stdin in, stdout and stderr out,
 * exit 0. Never calls `process.exit`, so piped output is flushed.
 */
export async function runMain(name: string, handler: CodexHandler): Promise<void> {
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No readable stdin: the hook has no input and stays silent.
  }
  const result = await runCodexHandler(name, handler, stdin, {
    env: process.env,
    // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs.
    cli: fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url)),
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}
