import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isAdapterRoot } from "./paths.js";
import { isDue, readUpdateState } from "./state.js";

/*
 * Row 002-34 (spec 002 D8, `wave-5-contract.md`): at SessionStart, after the
 * adapter selected and loaded this runtime, start a background update check
 * when one is due. The hook does not wait for it: the child is detached, its
 * output goes nowhere, and what it finds applies to new sessions. The
 * child's arguments name this retained runtime's CLI, so a prune sees it in
 * use. Other hooks never schedule, so no tool boundary reaches the network.
 */

/** The fixed plugin's root, as the adapter passes it to the runtime (row 002-29). */
const ADAPTER_ROOT_ENV = "SQUEAL_ADAPTER_ROOT";
const CLI = join("dist", "cli", "squeal.mjs");

export interface ScheduleOptions {
  /** The runtime's hook environment: `PLUGIN_ROOT`, `PLUGIN_DATA`, `SQUEAL_ADAPTER_ROOT`. */
  readonly env: NodeJS.ProcessEnv;
  readonly now?: () => number;
  /** Starts the detached child; tests record it. */
  readonly start?: (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => void;
}

/**
 * Starts `node <runtime>/dist/cli/squeal.mjs codex-runtime update
 * --plugin-root <adapter> --data <data> --background` when a check is due
 * and returns its arguments; `null` when none is due, or the hook did not
 * come through a fixed plugin's adapter.
 */
export function scheduleRuntimeUpdate(options: ScheduleOptions): readonly string[] | null {
  const { env } = options;
  const adapter = env[ADAPTER_ROOT_ENV] ?? "";
  const runtime = env.PLUGIN_ROOT ?? "";
  const data = env.PLUGIN_DATA ?? "";
  if (adapter === "" || runtime === "" || data === "" || !isAdapterRoot(adapter)) return null;
  if (!isDue(readUpdateState(data), (options.now ?? Date.now)())) return null;
  const cli = join(runtime, CLI);
  if (!existsSync(cli)) return null;
  const args = [
    cli,
    "codex-runtime",
    "update",
    "--plugin-root",
    adapter,
    "--data",
    data,
    "--background",
  ];
  (options.start ?? startDetached)(process.execPath, args, env);
  return args;
}

function startDetached(file: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(file, args, { cwd: env.PLUGIN_DATA, detached: true, stdio: "ignore", env });
  // A child that cannot start is not the hook's failure.
  child.on("error", () => undefined);
  child.unref();
}
