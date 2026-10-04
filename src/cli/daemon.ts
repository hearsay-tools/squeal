import { startDaemon } from "../core/daemon/daemon.js";
import { ownSignals } from "../core/daemon/signals.js";
import type { CliIo } from "./main.js";

const USAGE = "usage: squeal daemon <root>\n";

/**
 * `squeal daemon <root>`: the daemon of one worktree, in the foreground.
 * Hooks start it detached (spec 001 D10). Logs to stderr. Exit code 0 when
 * it stopped normally or another daemon serves the worktree, 1 when it could
 * not serve.
 */
export async function daemonCommand(args: readonly string[], io: CliIo): Promise<number> {
  const [root, ...extra] = args;
  if (root === undefined || root.startsWith("-") || extra.length > 0) {
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
    const daemon = await startDaemon({ root, log });
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
