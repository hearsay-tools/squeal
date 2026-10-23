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
  // Bundled, this module is dist/<hook>.mjs and the CLI dist/cli/squeal.mjs; once a hook
  // kept this version's copy (spec 005 D3 as amended 2026-10-21), the copy's CLI instead.
  const cli =
    keptCodexCli(process.env) ?? fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url));
  const deps = {
    env: process.env,
    sessionRoots: sessionRootFiles(process.env),
    cli,
    command: codexCommand(process.env, cli),
  };
  // SessionStart keeps the copy itself; every other hook keeps it when it spawns (row 005-81).
  const kept = name === "session-start" ? deps : keepOnSpawn(deps);
  const result = await runCodexHandler(name, handler, stdin, kept);
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}
