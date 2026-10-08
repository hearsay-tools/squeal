import { startDaemon } from "../core/daemon/daemon.js";
import { ownSignals } from "../core/daemon/signals.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal daemon <root> [--await-lock <ms>]\n";

/**
 * `squeal daemon <root>`: the daemon of one worktree, in the foreground.
 * Hooks start it detached (spec 001 D10). With `--await-lock <ms>`, the
 * successor a step-down spawns (task 001-130), it waits up to that long for
 * the lock the old daemon holds instead of exiting at once. It moves out of the root and
 * into its own temp directory however it was started. Logs to stderr. Exit code 0 when
 * it stopped normally or another daemon serves the worktree, 1 when it could
 * not serve.
 */
export async function daemonCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [root, ...extra] = args;
  const awaitLockMs = lockWait(extra);
  if (root === undefined || root.startsWith("-") || awaitLockMs === null) {
    io.stderr(USAGE);
    return 2;
  }
  const log = (line: string) => io.stderr(`squeal daemon: ${line}\n`);
  let signalled = false;
  let stop = () => {
    signalled = true;
  };
  const restore = ownSignals(() => stop());
  try {
    const daemon = await startDaemon({
      root,
      log,
      ownsProcess: true,
      ...(awaitLockMs === undefined ? {} : { awaitLockMs }),
    });
    if ("reason" in daemon) {
      log(daemon.message);
      return daemon.code;
    }
    stop = () => void daemon.stop("signal");
    // A signal during start stops the daemon as soon as it owns something to shut down.
    if (signalled) stop();
    const exit = await daemon.exited;
    log(exit.message);
    // Everything is closed; a handle a dependency left open must not keep the process.
    setTimeout(() => process.exit(exit.code), 2_000).unref();
    return exit.code;
  } finally {
    restore();
  }
}

/** No options: `undefined`; `--await-lock <ms>` with a whole number up to an hour: it; else `null`. */
function lockWait(options: readonly string[]): number | undefined | null {
  if (options.length === 0) return undefined;
  const [flag, value, ...rest] = options;
  if (flag !== "--await-lock" || value === undefined || rest.length > 0) return null;
  const ms = Number(value);
  return /^\d+$/.test(value) && ms <= 3_600_000 ? ms : null;
}
