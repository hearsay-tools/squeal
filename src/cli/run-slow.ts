import { setTimeout as sleep } from "node:timers/promises";
import { SLOW_NOT_SUPPORTED } from "../core/daemon/run-slow.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, DaemonResponse, RunSlowResponse } from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusWaitCommand } from "./status-wait.js";
import { takeWait } from "./wait-arg.js";

/** How long to wait for the scheduler to take the request. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;

/**
 * `squeal run --slow [--wait <ms>]`: the slow tier's explicit trigger (spec
 * 004 D2), requested over the daemon socket. Prints what the scheduler
 * queued; with `--wait`, then waits as `status --wait` does and prints its
 * answer. Exit code 0 when requested, 1 when no daemon runs, the daemon has
 * no slow tier or the request failed, 2 on a usage error.
 */
export async function runSlowCommand(
  args: readonly string[],
  io: CliIo,
  usage: string,
): Promise<number> {
  const wait = takeWait(args);
  const extra = typeof wait === "string" ? undefined : wait.rest.find((a) => a !== "--slow");
  if (typeof wait === "string" || extra !== undefined) {
    const problem = typeof wait === "string" ? wait : `unknown argument "${extra}" with --slow`;
    io.stderr(`squeal run: ${problem}\n${usage}`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const requested = await taken(socketPath, await askDaemon(socketPath, { type: "run-slow" }), io);
  if (requested === "no-daemon") {
    io.stderr(`squeal: no daemon running for ${root}; start one with squeal start\n`);
    return 1;
  }
  if (requested === null) return 1;
  const { revision, queued } = requested;
  io.stdout(
    queued > 0
      ? `Slow tier requested at revision ${revision}: ${plural(queued, "slow file")} queued; they run once no fast work is pending.\n`
      : `No slow files to run at revision ${revision}: none are declared in squeal.config.json or all are current.\n`,
  );
  return wait.waitMs === null ? 0 : statusWaitCommand(wait.waitMs, false, io);
}

/**
 * Polls the daemon until the scheduler took the request. `null` after
 * printing why it failed or is still pending.
 */
async function taken(
  socketPath: AbsolutePath,
  first: DaemonResponse | null,
  io: CliIo,
): Promise<RunSlowResponse["requested"] | "no-daemon"> {
  if (first === null) return "no-daemon";
  const deadline = Date.now() + RECORD_WAIT_MS;
  let state = first;
  for (;;) {
    if (!state.ok || state.type !== "run-slow") {
      // A daemon from before `run-slow` does not know the request.
      const error = state.ok ? "unexpected answer" : state.error;
      io.stderr(
        `squeal: ${error.startsWith("unknown request type") ? SLOW_NOT_SUPPORTED : `run --slow failed: ${error}`}\n`,
      );
      return null;
    }
    if (state.requested !== null) return state.requested;
    if (state.error !== null) {
      io.stderr(
        `squeal: ${state.error === SLOW_NOT_SUPPORTED ? SLOW_NOT_SUPPORTED : `run --slow failed: ${state.error}`}\n`,
      );
      return null;
    }
    if (Date.now() > deadline) {
      io.stdout(
        `Slow tier requested (request ${state.requestId}); the daemon takes it once its current work allows\n`,
      );
      return null;
    }
    await sleep(POLL_MS);
    const next = await askDaemon(socketPath, {
      type: "run-slow-status",
      requestId: state.requestId,
    });
    if (next === null) {
      io.stderr("squeal: the daemon stopped before taking the request\n");
      return null;
    }
    state = next;
  }
}
