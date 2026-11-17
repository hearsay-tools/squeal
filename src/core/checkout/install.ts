import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installCommand } from "../scheduler/install-command.js";
import type { AbsolutePath } from "../types/common.js";
import { stopGroup } from "./checkout.js";

/*
 * Spec 023 D4.3 (row 023-05): a frozen install in the checkout with the
 * project's own package manager, as `installCommand` names it for the note
 * a worktree without an install shows. It runs in a process group of its
 * own, so a budget that runs out stops the manager and every child it
 * started.
 */

/** The output kept for a failed install's log: the tail, where the error is. */
const LOG_CHARS = 64 * 1024;

export interface InstallOptions {
  /** The install's whole budget: past it, its group is stopped. */
  readonly timeoutMs: number;
  /** The install's environment; `process.env` by default. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Told the install's process group, its leader's pid, once it starts: the
   * caller records it, so a sweep stops it when the caller dies (row 023-16).
   */
  readonly started?: (group: number) => void;
}

export type InstallResult =
  | { readonly ok: true; readonly command: string; readonly ms: number }
  | {
      readonly ok: false;
      readonly command: string;
      readonly ms: number;
      /** `exit <code>`, `signal <name>`, `timed out after <ms> ms` or the spawn error. */
      readonly reason: string;
      /** The tail of standard output and standard error together. */
      readonly log: string;
    };

/** Installs `tree`'s dependencies from its lockfile, frozen; never throws. */
export async function installCheckout(
  tree: AbsolutePath,
  options: InstallOptions,
): Promise<InstallResult> {
  const command = await installCommand(tree, await manifestOf(tree));
  const [program = "npm", ...args] = command.split(" ");
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  return new Promise((resolve) => {
    let log = "";
    const keep = (chunk: Buffer) => {
      log = (log + chunk.toString("utf8")).slice(-LOG_CHARS);
    };
    const child = spawn(program, args, {
      cwd: tree,
      env: options.env ?? process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid !== undefined) options.started?.(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) void stopGroup(child.pid).catch(() => {});
    }, options.timeoutMs);
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, command, ms: ms(), reason: error.message, log });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolve({ ok: true, command, ms: ms() });
        return;
      }
      const reason = timedOut
        ? `timed out after ${options.timeoutMs} ms`
        : code !== null
          ? `exit ${code}`
          : `signal ${signal}`;
      resolve({ ok: false, command, ms: ms(), reason, log });
    });
  });
}

async function manifestOf(tree: AbsolutePath): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(tree, "package.json"), "utf8"));
  } catch {
    return null;
  }
}
