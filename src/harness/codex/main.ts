import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sessionRootFiles } from "../shared/session-root.js";
import { codexCommand } from "./command.js";
import type { CodexHandler } from "./hook.js";
import { keepOnSpawn, keptCodexCli } from "./kept.js";
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
  await runHookInput(name, handler, stdin, process.env);
}

/**
 * One Codex hook on stdin text already read, in `env`: what `runMain` does
 * after reading stdin, and what the fixed plugin's adapter runs in-process
 * through `runtime-entry.ts` (spec 002 D9). Writes the hook's stdout and
 * stderr; never throws.
 */
export async function runHookInput(
  name: string,
  handler: CodexHandler,
  stdin: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  // Bundled, this module is dist/<hook>.mjs or dist/runtime.mjs and the CLI dist/cli/squeal.mjs;
  // once a hook kept this version's copy (spec 005 D3 as amended 2026-10-21), the copy's CLI.
  const cli = keptCodexCli(env) ?? fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url));
  const deps = {
    env,
    sessionRoots: sessionRootFiles(env),
    cli,
    command: codexCommand(env, cli),
  };
  // SessionStart keeps the copy itself; every other hook keeps it when it spawns (row 005-81).
  const kept = name === "session-start" ? deps : keepOnSpawn(deps);
  const result = await runCodexHandler(name, handler, stdin, kept);
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}
