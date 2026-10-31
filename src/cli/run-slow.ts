import { setTimeout as sleep } from "node:timers/promises";
import { SLOW_NOT_SUPPORTED } from "../core/daemon/run-slow.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, DaemonResponse, RunSlowResponse } from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusWaitCommand } from "./status-wait.js";
import { takeWait } from "./wait-arg.js";

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;

/**
 * `squeal run --slow [--wait <ms>]`: the slow tier's explicit trigger (spec
 * 004 D2), requested over the daemon socket. Prints what the scheduler
 * queued; with `--wait`, then waits as `status --wait` does, and also for
 * the slow files it queued to have their results (task 001-282), and prints
 * its answer. The ms are one budget: the scheduler's taking the request
 * counts against it, and the result wait gets what is left (row 011-271,
 * gh-119). Without `--wait`, a request the scheduler has not taken within
 * 10 s prints its receipt. Exit code 0 when requested, taken or not, 1 when
 * no daemon runs, the daemon has no slow tier or the request failed, 2 on a
 * usage error, 3 when the wait ended before the scheduler took the request or
 * before the queued slow files had results (`slowWaitCode`, task 004-66).
 */
export async function runSlowCommand(
  args: readonly string[],
  io: CliIo,
  usage: string,
): Promise<number> {
  const wait = takeWait(args);
  // Task 004-61: `run --all --slow` is the slow lane, as `run --slow` is.
  const extra =
    typeof wait === "string" ? undefined : wait.rest.find((a) => a !== "--slow" && a !== "--all");
  if (typeof wait === "string" || extra !== undefined) {
    const problem = typeof wait === "string" ? wait : `unknown argument "${extra}" with --slow`;
    io.stderr(`squeal run: ${problem}\n${usage}`);
    return 2;
  }
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const started = Date.now();
  const deadline = started + (wait.waitMs ?? RECORD_WAIT_MS);
  const first = await askDaemon(socketPath, { type: "run-slow" });
  const requested = await taken(socketPath, first, io, deadline);
  if (requested === "no-daemon") {
    io.stderr(`squeal: no daemon running for ${root}; start one with squeal start\n`);
    return 1;
  }
  if (requested === null) return 1;
  if ("pending" in requested) {
    io.stdout(pendingText(requested.pending, wait.waitMs === null ? null : Date.now() - started));
    return wait.waitMs === null ? 0 : 3;
  }
  const { revision, queued } = requested;
  io.stdout(
    queued > 0
      ? `Slow tier requested at revision ${revision}: ${plural(queued, "slow file")} queued; they run once no fast work is pending.\n`
      : `No slow files to run at revision ${revision}: none are declared in squeal.config.json or all are current.\n`,
  );
  if (wait.waitMs === null) return 0;
  const left = Math.max(0, wait.waitMs - (Date.now() - started));
  return statusWaitCommand(left, false, io, queued > 0);
}

/**
 * The line for a request the scheduler has not taken by the deadline: a
 * receipt without `--wait`; with it, after `waitedMs`, the wait's end with
 * no verdict and the command that waits on (row 011-271). It says only what
 * is known of the request: the store may hold slow results from before it
 * (review 0.1.382 B2).
 */
function pendingText(requestId: string, waitedMs: number | null): string {
  if (waitedMs === null) {
    return `Slow tier requested (request ${requestId}); the daemon takes it once its current work allows\n`;
  }
  return `Returned on timeout after ${(waitedMs / 1000).toFixed(1)} s: the daemon has not taken slow tier request ${requestId} yet; the request is pending and this command has no verdict for it. The daemon takes it once its current work allows; \`squeal status --wait 60000 <slow test file>\` then waits for that file's result.\n`;
}

/**
 * Polls the daemon until the scheduler took the request or `deadline` (epoch
 * ms) passed. `null` after printing why it failed; `pending` with the
 * request's id when the deadline passed first.
 */
async function taken(
  socketPath: AbsolutePath,
  first: DaemonResponse | null,
  io: CliIo,
  deadline: number,
): Promise<RunSlowResponse["requested"] | { readonly pending: string } | "no-daemon"> {
  if (first === null) return "no-daemon";
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
    if (Date.now() > deadline) return { pending: state.requestId };
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
