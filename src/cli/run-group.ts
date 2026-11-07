import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../core/daemon/policy.js";
import { GROUP_NOT_SUPPORTED, NARROW_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { groupView } from "../core/scheduler/slow.js";
import { plural } from "../core/text.js";
import type { ResolvedGroup } from "../core/types/check-groups.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { DaemonResponse, RunGroupResponse } from "../core/types/daemon.js";
import { daemonSocket, worktreeRoot } from "./daemon-access.js";
import { deadlineText } from "./group-pending.js";
import type { CliIo } from "./main.js";
import { runNarrowCommand } from "./run-group-narrow.js";
import { askWithin, BEFORE_DEADLINE, socketBound, waitForGroup } from "./run-group-wait.js";
import type { RunLanes } from "./run-lanes.js";
import { runLintGroupCommand } from "./run-lint-group.js";

/**
 * `run <group>`'s usage line, printed after `run`'s usage with a group's
 * errors only, so `run`'s own errors read as before groups (row 019-15).
 */
const GROUP_USAGE = "       squeal run <group> [<path>...] [--wait [<ms>]]\n";
/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;
const POLL_MS = 100;

/** `run`'s arguments once `--wait` and its milliseconds are taken out (`takeAllWait`). */
export interface GroupArgs {
  /** `null` without `--wait`; `Infinity` for a bare `--wait`. */
  readonly waitMs: number | null;
  readonly rest: readonly string[];
}

/**
 * `run`'s arguments when they name a group (spec 019 D6): no lane flag, and
 * a word that is not a flag; else `null`, and `runCommand` reads them.
 */
export function groupArgs(lanes: RunLanes | null, wait: GroupArgs | string): GroupArgs | null {
  if (lanes !== null || typeof wait === "string") return null;
  return wait.rest.some((arg) => !arg.startsWith("-")) ? wait : null;
}

/** What the scheduler queued for the request (`RunGroupResponse.requested`). */
type Requested = NonNullable<RunGroupResponse["requested"]>;

/**
 * `squeal run <group> [--wait [<ms>]]` (spec 019 D6): group `<group>`'s test
 * files run now, whatever its moment, through the daemon's `run-group`
 * request; `run --slow` does this for the default `slow` group. Prints what
 * the scheduler queued. With `--wait`, then waits up to `<ms>` from the
 * start, or without a bound, until none of the group's test files is
 * pending, and gives the group's verdict (`waitForGroup`).
 *
 * Exit code 0 when requested, 1 when no daemon runs or the request failed,
 * 2 on a usage error: an unknown group, which the error lists the groups
 * for. With `--wait`, 0 when every test file of the group is current and
 * none fails, 1 with known failures, 3 when Squeal has no verdict, as `run
 * --all --wait`. A lint group goes to `runLintGroupCommand` (row 019-22).
 */
export async function runGroupCommand(args: GroupArgs, io: CliIo, usage: string): Promise<number> {
  const usageError = (problem: string): number => {
    io.stderr(`squeal run: ${problem}\n${usage}${GROUP_USAGE}`);
    return 2;
  };
  const flag = args.rest.find((arg) => arg.startsWith("-"));
  if (flag !== undefined) return usageError(`unknown argument "${flag}" with a group`);
  const [name = "", ...paths] = args.rest;
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const { groups } = groupView(readPolicy(root));
  const group = groups.find((g) => g.name === name);
  if (group === undefined) {
    return usageError(`no group "${name}"; the groups are ${andList(groups.map((g) => g.name))}`);
  }
  // Row 019-49 (019 D6 "Narrow run"): a lint group runs whole.
  if (group.select.kind === "lint" && paths.length > 0) {
    return usageError(`group ${name} is a lint group, which takes no paths: squeal run ${name}`);
  }
  if (group.select.kind === "lint")
    return runLintGroupCommand({ root, group, waitMs: args.waitMs }, io);
  if (paths.length > 0) {
    return runNarrowCommand({ root, group, paths, waitMs: args.waitMs }, io, usageError);
  }
  const wait = args.waitMs;
  const noVerdict = (text: string): number => {
    if (wait === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`No verdict: ${text}\n`);
    return 3;
  };
  // Row 019-24 item 3 (review 0.1.397 S1): one deadline bounds every socket request and sleep.
  const deadline = Date.now() + (wait ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root, socketBound(deadline));
  const first = await askWithin(socketPath, { type: "run-group", group: name }, deadline);
  if (first === null)
    return noVerdict(`no daemon running for ${root}; start one with squeal start`);
  if ("unanswered" in first) {
    return noVerdict(
      `the daemon did not answer the request to run group ${name}${first.unanswered}; it may still take it once its current work allows`,
    );
  }
  const taken = await takenRequest(socketPath, first, deadline);
  if (typeof taken === "string") return noVerdict(taken);
  if ("pending" in taken) {
    io.stdout(pendingText(root, taken.pending, wait !== null));
    return wait === null ? 0 : 3;
  }
  const state = taken.requested;
  const line = requestedText(group, state);
  if (wait === null) {
    io.stdout(line);
    return 0;
  }
  return waitForGroup({ root, socketPath, group: name, queued: state.queued, deadline, line }, io);
}

/**
 * `Group <name> requested at revision <n>: <k> test files queued; they run
 * now.`, or once the groups it runs after (D1 `after`) have nothing pending.
 */
function requestedText(group: ResolvedGroup, { revision, queued }: Requested): string {
  const { name, after } = group;
  if (queued === 0) {
    return `No test files of group ${name} to run at revision ${revision}: the group has none or all are current.\n`;
  }
  const when =
    after.length === 0
      ? "now"
      : `once ${andList(after)} ${after.length === 1 ? "has" : "have"} nothing pending`;
  return `Group ${name} requested at revision ${revision}: ${plural(queued, "test file")} queued; they run ${when}.\n`;
}

/**
 * A request the scheduler had not taken by the deadline, as its last answer
 * gives it: a receipt without `--wait`; with it, no verdict, what held the
 * request and the next action (row 011-302).
 */
export function pendingText(root: AbsolutePath, answer: RunGroupResponse, waited: boolean): string {
  const { group, requestId } = answer;
  return waited
    ? `Group ${group} has no verdict: ${deadlineText(root, answer, null)}\n`
    : `Group ${group} requested (request ${requestId}); the daemon takes it once its current work allows\n`;
}

/** A `run-group` answer once the scheduler took the request. */
export type TakenGroup = RunGroupResponse & { readonly requested: Requested };

/**
 * Polls `run-group-status` until the scheduler took the request or
 * `deadline` (epoch ms) passed: its answer then, `pending` with the
 * request's last answer, or why it failed. Each poll and sleep ends by the deadline;
 * a poll with no answer by then is `pending` (row 019-24). A daemon that
 * does not know the request is `unsupported`: `GROUP_NOT_SUPPORTED` for
 * `run-group`, `NARROW_NOT_SUPPORTED` for `run-group-paths` (row 019-49).
 */
export async function takenRequest(
  socketPath: AbsolutePath,
  first: DaemonResponse,
  deadline: number,
  unsupported: string = GROUP_NOT_SUPPORTED,
): Promise<TakenGroup | { readonly pending: RunGroupResponse } | string> {
  let state = first;
  for (;;) {
    if (!state.ok || state.type !== "run-group") {
      // A daemon from before check groups, or before narrow runs, does not know the request.
      const error = state.ok ? "unexpected answer" : state.error;
      return error.startsWith("unknown request type") ? unsupported : runFailed(error);
    }
    if (state.requested !== null) return state as TakenGroup;
    if (state.unknown) {
      return `the daemon's policy has no group "${state.group}" yet; it reloads squeal.config.json when it sees the file change`;
    }
    if (state.error !== null) {
      const known = state.error === GROUP_NOT_SUPPORTED || state.error === NARROW_NOT_SUPPORTED;
      return known ? state.error : runFailed(state.error);
    }
    const { requestId } = state;
    if (Date.now() > deadline) return { pending: state };
    await sleep(Math.max(0, Math.min(POLL_MS, deadline - Date.now())));
    const next = await askWithin(socketPath, { type: "run-group-status", requestId }, deadline);
    if (next === null) return "the daemon stopped before taking the request";
    if ("unanswered" in next) {
      if (next.unanswered === BEFORE_DEADLINE) return { pending: state };
      return `the daemon did not answer about request ${requestId}${next.unanswered}; the request is pending, and the daemon takes it once its current work allows`;
    }
    state = next;
  }
}

function runFailed(error: string): string {
  return `squeal run <group> failed: ${error}`;
}

/** `a`, `a and b`, `a, b and c`. */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
