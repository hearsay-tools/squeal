import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../core/daemon/policy.js";
import { GROUP_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { groupView } from "../core/scheduler/slow.js";
import { plural } from "../core/text.js";
import type {
  AbsolutePath,
  DaemonResponse,
  ResolvedGroup,
  RunGroupResponse,
} from "../core/types/index.js";
import { askDaemon, daemonSocket, worktreeRoot } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { waitForGroup } from "./run-group-wait.js";
import type { RunLanes } from "./run-lanes.js";

/**
 * `run <group>`'s usage line, printed after `run`'s usage with a group's
 * errors only, so `run`'s own errors read as before groups (row 019-15).
 */
const GROUP_USAGE = "       squeal run <group> [--wait [<ms>]]\n";
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
 * for, or a lint group. With `--wait`, 0 when every test file of the group
 * is current and none fails, 1 with known failures, 3 when Squeal has no
 * verdict, as `run --all --wait`.
 */
export async function runGroupCommand(args: GroupArgs, io: CliIo, usage: string): Promise<number> {
  const usageError = (problem: string): number => {
    io.stderr(`squeal run: ${problem}\n${usage}${GROUP_USAGE}`);
    return 2;
  };
  const flag = args.rest.find((arg) => arg.startsWith("-"));
  if (flag !== undefined) return usageError(`unknown argument "${flag}" with a group`);
  const [name = "", other] = args.rest;
  if (other !== undefined) return usageError(`one group at a time: "${name}" and "${other}"`);
  const root = worktreeRoot(undefined, io);
  if (root === null) return 1;
  const { groups } = groupView(readPolicy(root));
  const group = groups.find((g) => g.name === name);
  if (group === undefined) {
    return usageError(`no group "${name}"; the groups are ${andList(groups.map((g) => g.name))}`);
  }
  if (group.select.kind === "lint") {
    return usageError(
      `group "${name}" has lint checks, and \`squeal run <group>\` runs test groups only; \`squeal lint\` shows the lint findings`,
    );
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
  const deadline = Date.now() + (wait ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root);
  const first = await askDaemon(socketPath, { type: "run-group", group: name });
  if (first === null)
    return noVerdict(`no daemon running for ${root}; start one with squeal start`);
  const state = await taken(socketPath, first, deadline);
  if (typeof state === "string") return noVerdict(state);
  if ("pending" in state) {
    io.stdout(pendingText(name, state.pending, wait !== null));
    return wait === null ? 0 : 3;
  }
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
 * A request the scheduler had not taken by the deadline: a receipt without
 * `--wait`; with it, no verdict, and only what is known of the request.
 */
function pendingText(name: string, requestId: string, waited: boolean): string {
  const allows = "the daemon takes it once its current work allows";
  return waited
    ? `Group ${name} has no verdict: the deadline passed before the daemon took request ${requestId}; the request is pending, and ${allows}\n`
    : `Group ${name} requested (request ${requestId}); ${allows}\n`;
}

/**
 * Polls `run-group-status` until the scheduler took the request or
 * `deadline` (epoch ms) passed: what it queued, `pending` with the
 * request's id, or why it failed.
 */
async function taken(
  socketPath: AbsolutePath,
  first: DaemonResponse,
  deadline: number,
): Promise<Requested | { readonly pending: string } | string> {
  let state = first;
  for (;;) {
    if (!state.ok || state.type !== "run-group") {
      // A daemon from before check groups does not know the request.
      const error = state.ok ? "unexpected answer" : state.error;
      return error.startsWith("unknown request type") ? GROUP_NOT_SUPPORTED : runFailed(error);
    }
    if (state.requested !== null) return state.requested;
    if (state.unknown) {
      return `the daemon's policy has no group "${state.group}" yet; it reloads squeal.config.json when it sees the file change`;
    }
    if (state.error !== null) {
      return state.error === GROUP_NOT_SUPPORTED ? GROUP_NOT_SUPPORTED : runFailed(state.error);
    }
    if (Date.now() > deadline) return { pending: state.requestId };
    await sleep(POLL_MS);
    const next = await askDaemon(socketPath, {
      type: "run-group-status",
      requestId: state.requestId,
    });
    if (next === null) return "the daemon stopped before taking the request";
    state = next;
  }
}

function runFailed(error: string): string {
  return `squeal run <group> failed: ${error}`;
}

/** `a`, `a and b`, `a, b and c`. */
function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
