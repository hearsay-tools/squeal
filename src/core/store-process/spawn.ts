import { spawn } from "node:child_process";
import { closeSync, mkdirSync } from "node:fs";
import { openDaemonLog } from "../daemon/log-file.js";
import { argv0For, storeCheckLabel } from "../process-label.js";
import type { RunnerHostLaunch } from "../runner-host/channel.js";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/common.js";
import { storeProcessLogPath } from "./paths.js";

/*
 * Spec 021 D22.2 (row 021-36): a daemon that needs to write and finds no
 * store process starts one, as a hook starts a daemon (spec 001 D10):
 * detached, with the daemon's Node, its arguments and CLI, its working
 * directory the store directory, its output the store process's log. It
 * does not wait for it: the batch at hand is written here, the next goes to
 * it. Two daemons that start one at once start two processes, and the one
 * that does not take `locks/store-code.sqlite` exits at once.
 */

/** How a daemon starts the store process: as it starts a runner host (D8). */
export type StoreProcessLaunch = RunnerHostLaunch;

/** `squeal <project> store`: the store process's argv0 on Linux, display only. */
export function storeProcessLabel(commonDir: AbsolutePath): string {
  return storeCheckLabel(commonDir).replace(/ check$/, " store");
}

/** Starts `squeal store-process <commonDir> --store code`; its pid, `null` when the spawn failed. */
export function spawnStoreProcess(
  commonDir: AbsolutePath,
  launch: StoreProcessLaunch,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  let log: number | null = null;
  try {
    const cwd = storePaths(commonDir).dir;
    mkdirSync(cwd, { recursive: true });
    log = openDaemonLog(storeProcessLogPath(commonDir, "code"));
    const quiet = launch.execArgv.some((arg) => arg.startsWith("--disable-warning"))
      ? []
      : ["--disable-warning=ExperimentalWarning"];
    const child = spawn(
      launch.execPath,
      [...quiet, ...launch.execArgv, launch.cli, "store-process", commonDir, "--store", "code"],
      {
        argv0: argv0For(storeProcessLabel(commonDir)),
        cwd,
        detached: true,
        stdio: log === null ? "ignore" : ["ignore", log, log],
        env,
      },
    );
    // A failed spawn reports its error later; a daemon must never crash on it.
    child.on("error", () => {});
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  } finally {
    if (log !== null) {
      try {
        closeSync(log);
      } catch {
        // Already closed.
      }
    }
  }
}
