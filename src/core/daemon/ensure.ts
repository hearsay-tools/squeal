import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdFor } from "../store/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";

/*
 * Minimal probe-and-spawn written by task 001-31 because 001-30, which owns
 * the daemon, runs in parallel. 001-30's version replaces this file; the
 * signature of `ensureDaemon` is the contract between the two.
 */

/** `alive`: a daemon answered. `spawned`: none did and one was started. `unavailable`: neither. */
export type EnsureDaemonResult = "alive" | "spawned" | "unavailable";

export interface EnsureDaemonOptions {
  /** Spec 001 D9: the socket is used "only for liveness and nudges with a 100 ms timeout". */
  readonly socketTimeoutMs: number;
}

/**
 * Spec 001 D1: "The unix socket for liveness is `<runtime dir>/squeal-<worktree-hash>.sock`,
 * never under the worktree". The runtime dir is `$XDG_RUNTIME_DIR`, else the OS temp dir.
 */
export function socketPathFor(worktreeId: WorktreeId): AbsolutePath {
  return join(process.env.XDG_RUNTIME_DIR || tmpdir(), `squeal-${worktreeId}.sock`);
}

/**
 * Spec 001 D10: "A hook that finds no live socket spawns `squeal daemon <root>` detached
 * (`detached: true`, `stdio: 'ignore'`, `unref()`), about 70 ms, and returns without
 * waiting." A socket that accepts no connection within the timeout belongs to a hung
 * daemon that holds the lock, so nothing is spawned and the result is `unavailable`.
 */
export async function ensureDaemon(
  root: AbsolutePath,
  options: EnsureDaemonOptions,
): Promise<EnsureDaemonResult> {
  const probe = await probeSocket(socketPathFor(worktreeIdFor(root)), options.socketTimeoutMs);
  if (probe === "alive") return "alive";
  if (probe === "unavailable") return "unavailable";
  const cli = findCli();
  if (cli === null) return "unavailable";
  try {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", cli, "daemon", root],
      { cwd: root, detached: true, stdio: "ignore" },
    );
    // A failed exec is reported asynchronously; the hook has already returned by then.
    child.on("error", () => {});
    child.unref();
    return "spawned";
  } catch {
    return "unavailable";
  }
}

type Probe = "alive" | "dead" | "unavailable";

function probeSocket(path: AbsolutePath, timeoutMs: number): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (probe: Probe) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(probe);
    };
    const timer = setTimeout(() => done("unavailable"), timeoutMs);
    socket.on("connect", () => done("alive"));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      done(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "dead" : "unavailable");
    });
  });
}

/**
 * The CLI entry point next to this module: `SQUEAL_CLI` when set, else `dist/cli/index.js`
 * from the compiled package, else `cli/squeal.mjs` beside a plugin hook bundle
 * (`plugins/claude-code/dist/`), where this module is inlined.
 */
function findCli(): AbsolutePath | null {
  const override = process.env.SQUEAL_CLI;
  if (override) return existsSync(override) ? override : null;
  const candidates = ["../../cli/index.js", "./cli/squeal.mjs"];
  for (const candidate of candidates) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  return null;
}
