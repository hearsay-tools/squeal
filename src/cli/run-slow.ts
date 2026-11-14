import { SLOW_NOT_SUPPORTED } from "../core/daemon/run-slow.js";
import { NO_PASS } from "../core/scheduler/request-intake.js";
import { plural } from "../core/text.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { DaemonResponse, RequestTaken, RunSlowResponse } from "../core/types/daemon.js";
import { daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { statusWaitCommand } from "./status-wait.js";
import { askWithin } from "./wait/socket.js";
import { untilTaken } from "./wait/wait.js";
import { takeWait } from "./wait-arg.js";

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;

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
 * Row 011-327: a request the daemon did not answer within its bound has no
 * verdict, 3 with `--wait`, 1 without. Row 011-337: so has a request the
 * daemon refused for want of a reconciliation pass (`NO_PASS`), as with
 * `run --all --wait`.
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
  const noVerdict = (text: string): number => {
    if (wait.waitMs === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`No verdict: ${text}\n`);
    return 3;
  };
  // Row 011-327 (decision 4 item 1): the request ends by the deadline; a busy daemon is words.
  const first = await askWithin(socketPath, { type: "run-slow" }, deadline);
  if (first !== null && "unanswered" in first) {
    return noVerdict(
      `the daemon did not answer the run --slow request${first.unanswered}; it may still take it once its current work allows`,
    );
  }
  const requested = await taken(socketPath, first, io, deadline);
  if (requested === "no-daemon") {
    io.stderr(`squeal: no daemon running for ${root}; start one with squeal start\n`);
    return 1;
  }
  if (requested === null) return 1;
  if ("refused" in requested) return noVerdict(requested.refused);
  if ("pending" in requested) {
    io.stdout(pendingText(requested, wait.waitMs === null ? null : Date.now() - started));
    return wait.waitMs === null ? 0 : 3;
  }
  io.stdout(requestedText(requested));
  const { queued } = requested;
  if (wait.waitMs === null) return 0;
  const left = Math.max(0, wait.waitMs - (Date.now() - started));
  return statusWaitCommand(left, false, io, queued > 0);
}

/**
 * What the scheduler queued (spec 004 D2). Row 011-337: an answer that names
 * the install it waits for says so, as `run <group>`'s does (row 011-324).
 */
function requestedText({ revision, queued, installWait }: RequestTaken): string {
  if (installWait !== undefined)
    return `No slow files run at revision ${revision}: ${installWait}.\n`;
  return queued > 0
    ? `Slow tier requested at revision ${revision}: ${plural(queued, "slow file")} queued; they run once no fast work is pending.\n`
    : `No slow files to run at revision ${revision}: none are declared in squeal.config.json or all are current.\n`;
}

/** Row 011-337: a request the daemon refused for want of a pass; the words after `squeal: ` or `No verdict: `. */
interface Refused {
  readonly refused: string;
}

/** A request the scheduler had not taken: its id, and the words after "did not answer" when a status request got no answer. */
export interface Pending {
  readonly pending: string;
  readonly unanswered?: string;
}

/**
 * The line for a request the scheduler has not taken by the deadline: a
 * receipt without `--wait`; with it, after `waitedMs`, the wait's end with
 * no verdict and the command that waits on (row 011-271). It says only what
 * is known of the request: the store may hold slow results from before it
 * (review 0.1.382 B2). Row 011-327: a status request the daemon did not
 * answer within its bound, a busy daemon, says so in place of the deadline.
 */
export function pendingText(
  { pending: requestId, unanswered }: Pending,
  waitedMs: number | null,
): string {
  if (waitedMs === null) {
    const busy = unanswered === undefined ? "" : ` did not answer about it${unanswered} and`;
    return `Slow tier requested (request ${requestId}); the daemon${busy} takes it once its current work allows\n`;
  }
  const after = `after ${(waitedMs / 1000).toFixed(1)} s`;
  const ended =
    unanswered === undefined
      ? `Returned on timeout ${after}: the daemon has not taken slow tier request ${requestId} yet`
      : `Returned without a verdict ${after}: the daemon did not answer about slow tier request ${requestId}${unanswered}`;
  return `${ended}; the request is pending and this command has no verdict for it. The daemon takes it once its current work allows; \`squeal status --wait 60000 <slow test file>\` then waits for that file's result.\n`;
}

/**
 * Waits until the scheduler took the request or `deadline` (epoch ms)
 * passed (`untilTaken`). `null` after printing why it failed; `pending` with
 * the request's id when the deadline passed first; `refused` when the daemon
 * refused it for want of a pass, which the command words by `--wait`.
 */
async function taken(
  socketPath: AbsolutePath,
  first: DaemonResponse | null,
  io: CliIo,
  deadline: number,
): Promise<RunSlowResponse["requested"] | Pending | Refused | "no-daemon"> {
  if (first === null) return "no-daemon";
  const outcome = await untilTaken({ loop: "run-slow", socketPath, first, deadline });
  const failed = (text: string) => {
    io.stderr(`squeal: ${text}\n`);
    return null;
  };
  switch (outcome.kind) {
    case "taken":
      return outcome.answer.requested;
    case "pending":
      return { pending: outcome.answer.requestId };
    // A daemon from before `run-slow` does not know the request.
    case "unsupported":
      return failed(SLOW_NOT_SUPPORTED);
    case "refused":
      return failed(`run --slow failed: ${outcome.error}`);
    case "failed":
      if (outcome.error === SLOW_NOT_SUPPORTED) return failed(SLOW_NOT_SUPPORTED);
      // Row 011-337: no verdict, as `run --all` gives; a daemon before the row words it alike.
      if (outcome.error.startsWith(NO_PASS))
        return { refused: `run --slow failed: ${outcome.error}` };
      return failed(`run --slow failed: ${outcome.error}`);
    case "stopped":
      return failed("the daemon stopped before taking the request");
    // Row 011-327: a status request the daemon did not answer within its bound is a busy daemon.
    case "unanswered":
      return { pending: outcome.answer.requestId, unanswered: outcome.words };
    case "unknown group":
      // A `run-slow` answer names no group.
      throw new Error(`squeal run --slow: the request loop ended as ${outcome.kind}`);
  }
}
