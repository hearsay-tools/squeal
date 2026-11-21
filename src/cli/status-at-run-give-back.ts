import { setTimeout as delay } from "node:timers/promises";
import type { AbsolutePath } from "../core/types/common.js";
import type { TakeBackResult } from "../core/types/scheduler.js";
import type { DaemonPorts, NowRunEnd } from "./status-at-run-now.js";
import { askWithin } from "./wait/socket.js";

/*
 * Row 023-34 (T1, lessons round 5; spec 023 D4.11): `--run` gives back
 * what it queued in the worktree's daemon. In round 5 a wide `--run` left
 * about 1,300 files queued there after its budget, and the narrowed call
 * that followed waited behind them for its whole budget. At the call's
 * end, after its daemon files had the rest of the budget, the files its
 * narrow runs queued and that have not started are taken out of the
 * daemon's queue (`take-back`); the report says how many. A file that runs
 * goes on; one an edit or another wait asked for stays queued.
 */

/** What the group wait says when the budget ended before the daemon's runs did. */
export const BUDGET_ENDED = "the budget ended; their runs go on in the daemon";

/** How long the take-back may take after the budget: the scheduler takes it under its lock. */
export const TAKE_BACK_MS = 10_000;

/** How often the take-back's status is asked. */
const POLL_MS = 100;

/** A daemon before take-back, or one that cannot take back: the report keeps today's line. */
export const NOT_SUPPORTED = "this daemon cannot take back";

/** `take-back` and its status until the scheduler answered or `deadline` (epoch ms). */
export async function askTakeBack(
  socketPath: AbsolutePath,
  coveredIds: readonly string[],
  deadline: number,
): Promise<TakeBackResult | string> {
  const first = await askWithin(socketPath, { type: "take-back", coveredIds }, deadline);
  let answer = first;
  for (;;) {
    if (answer === null) return "no daemon answered";
    if ("unanswered" in answer) return `the daemon did not answer${answer.unanswered}`;
    if (!answer.ok) {
      const unknown = answer.error.startsWith("unknown request type");
      return unknown || answer.error === NOT_SUPPORTED ? NOT_SUPPORTED : answer.error;
    }
    if (answer.type !== "take-back") return `the daemon answered ${answer.type}`;
    if (answer.result !== null) return answer.result;
    if (answer.error !== null) return answer.error;
    if (Date.now() + POLL_MS >= deadline) return "the daemon had not taken it by the deadline";
    await delay(POLL_MS);
    const status = { type: "take-back-status", requestId: answer.requestId } as const;
    answer = await askWithin(socketPath, status, deadline);
  }
}

/**
 * The call's end for its daemon files: they have the rest of the budget
 * (to `endMs`, `performance.now()`), then what is left is taken back. The
 * end gets `takenBack`; the group wait's "go on in the daemon" leaves its
 * problem once they were taken back. `end` as it was when nothing was
 * asked of the daemon, or no daemon answers.
 */
export async function giveBack(
  end: NowRunEnd,
  endMs: number,
  ports: DaemonPorts,
): Promise<NowRunEnd> {
  const { asked } = end;
  if (asked === undefined || asked.coveredIds.length === 0 || ports.takeBack === undefined)
    return end;
  const left = endMs - performance.now();
  const waited =
    left > 0 ? await ports.wait(asked.files, Date.now() + left).catch(() => BUDGET_ENDED) : null;
  if (waited === null && end.problem === null) return end;
  const result = await ports
    .takeBack(asked.coveredIds, Date.now() + TAKE_BACK_MS)
    .catch((e: unknown) => String(e));
  if (result === NOT_SUPPORTED) return end;
  if (typeof result === "string") {
    const why = `their take-back failed: ${result}`;
    return { ...end, problem: end.problem === null ? why : `${end.problem}; ${why}` };
  }
  return { ...end, problem: without(end.problem, BUDGET_ENDED), takenBack: result };
}

/** `problems` (joined by "; ") without `text`; `null` when nothing is left. */
function without(problems: string | null, text: string): string | null {
  if (problems === null) return null;
  const left = problems
    .split(text)
    .map((part) => part.replace(/^; |; $/g, ""))
    .filter((part) => part !== "")
    .join("; ");
  return left === "" ? null : left;
}
