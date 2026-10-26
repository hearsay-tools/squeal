import { startDaemon } from "../core/daemon/daemon.js";
import { cgroupUnit, ownSignals, signalNote } from "../core/daemon/signals.js";
import { eslintProvider } from "../core/lint/provider/index.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal daemon <root> [--await-lock <ms>]\n";

/**
 * `squeal daemon <root>`: the daemon of one worktree, in the foreground.
 * Hooks start it detached (spec 001 D10). With `--await-lock <ms>`, the
 * successor a step-down spawns (task 001-130), it waits up to that long for
 * the lock the old daemon holds; without it, a daemon that loses the lock
 * waits only while no daemon is recorded serving (task 001-340,
 * `VACANT_LOCK_WAIT_MS`). It moves out of the root and
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
  // Row 011-250: the note names the signal and the unit, read once, at the signal.
  let signalled: string | null = null;
  let stop = (note: string) => {
    signalled = note;
  };
  const restore = ownSignals((signal) => stop(signalNote(signal, cgroupUnit())));
  try {
    const daemon = await startDaemon({
      root,
      log,
      ownsProcess: true,
      // Spec 017 D3: the project's own ESLint, used only while `lint.enabled` holds (goal 1).
      lintProvider: (projectRoot) => eslintProvider({ root: projectRoot }),
      ...(awaitLockMs === undefined ? {} : { awaitLockMs }),
    });
    if ("reason" in daemon) {
      log(daemon.message);
      return daemon.code;
    }
    stop = (note) => void daemon.stop("signal", note);
    // A signal during start stops the daemon as soon as it owns something to shut down.
    if (signalled !== null) stop(signalled);
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
