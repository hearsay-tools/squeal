import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HandOff, writeThenCommit } from "../shared/hand-off.js";
import type { HookDeps } from "../shared/hook.js";
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
 * stderr, then commits the reports they carry (row 011-288); never throws.
 * `overrides` are for tests: a stand-in daemon.
 */
export async function runHookInput(
  name: string,
  handler: CodexHandler,
  stdin: string,
  env: NodeJS.ProcessEnv,
  overrides: Partial<HookDeps> = {},
): Promise<void> {
  // Bundled, this module is dist/<hook>.mjs or dist/runtime.mjs and the CLI dist/cli/squeal.mjs;
  // once a hook kept this version's copy (spec 005 D3 as amended 2026-10-21), the copy's CLI.
  const cli = keptCodexCli(env) ?? fileURLToPath(new URL("./cli/squeal.mjs", import.meta.url));
  // Row 011-288: a report commits once its output is written.
  const handOff = new HandOff();
  const deps = {
    env,
    sessionRoots: sessionRootFiles(env),
    cli,
    command: codexCommand(env, cli),
    handOff,
    ...overrides,
  };
  // SessionStart keeps the copy itself; every other hook keeps it when it spawns (row 005-81).
  const kept = name === "session-start" ? deps : keepOnSpawn(deps);
  const result = await runCodexHandler(name, handler, stdin, kept);
  await writeThenCommit(handOff, [
    [process.stdout, result.stdout],
    [process.stderr, result.stderr],
  ]);
}
