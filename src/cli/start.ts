import { setTimeout as sleep } from "node:timers/promises";
import { ensureDaemon, probeDaemon } from "../core/daemon/ensure.js";
import { formatStatus, readStatus } from "../core/status/index.js";
import { worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";

/** A spawned daemon binds its socket in about 100 ms; a loaded machine gets more. */
const SPAWN_WAIT_MS = 10_000;

/**
 * `squeal start [root]`: makes sure a daemon serves the worktree, then
 * prints its status. Exit code 0 once a daemon answers, 1 otherwise.
 */
export async function startCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal start [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  // This CLI's own script is the daemon to spawn (review wave 3, B1); `SQUEAL_CLI` overrides it.
  const cli = process.argv[1];
  const result = await ensureDaemon(root, cli === undefined ? {} : { cli });
  if (result === "unavailable") {
    io.stderr(`squeal: no daemon could be reached or started for ${root}\n`);
    return 1;
  }
  if (result === "spawned") {
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while ((await probeDaemon(root, 100)).state !== "alive") {
      if (Date.now() > deadline) {
        io.stderr(`squeal: spawned a daemon for ${root}, but it did not answer\n`);
        return 1;
      }
      await sleep(50);
    }
  }
  io.stdout(`Squeal daemon ${result} for ${root}\n\n`);
  const now = io.now ?? Date.now;
  io.stdout(formatStatus(readStatus(root, { now }), now()));
  return 0;
}
