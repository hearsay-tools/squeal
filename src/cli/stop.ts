import { askDaemon, daemonSocket, delay, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";

/** Shutdown waits for the tier in flight (D10); the CLI waits this long before saying so. */
const STOP_WAIT_MS = 60_000;

/** `squeal stop [root]`: asks the worktree's daemon to shut down and waits for it to go. */
export async function stopCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal stop [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response === null) {
    io.stdout(`No daemon running for ${root}\n`);
    return 0;
  }
  if (!response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}\n`);
    return 1;
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while ((await askDaemon(socketPath, { type: "ping" }).catch(() => "busy")) !== null) {
    if (Date.now() > deadline) {
      io.stdout(`Stop requested; the daemon for ${root} is finishing the tier in flight\n`);
      return 0;
    }
    await delay(50);
  }
  io.stdout(`Squeal daemon stopped for ${root}\n`);
  return 0;
}
