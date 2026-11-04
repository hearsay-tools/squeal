import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../core/daemon/policy.js";
import { worktreeIdFor } from "../core/fs/index.js";
import { groupView } from "../core/scheduler/slow.js";
import { formatStatus, holdVerdictLine, readStatus } from "../core/status/index.js";
import { plural } from "../core/text.js";
import type {
  AbsolutePath,
  DaemonRequest,
  DaemonResponse,
  StatusHold,
  Store,
  TestFileRef,
  WorktreeId,
} from "../core/types/index.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS } from "./daemon-access.js";
import type { CliIo } from "./main.js";
import { inStore } from "./run-lanes.js";
import { statusCommand } from "./status-command.js";
import {
  type FileVerdict,
  failuresText,
  holdOfWait,
  noVerdictText,
  readClasses,
  readVerdict,
  verdictCode,
} from "./verdict.js";

/** How often the wait reads the store, as `run --all --wait` (C6 as amended, task 011-42). */
const STORE_POLL_MS = 1_000;
/** Every this many polls, the wait asks whether the daemon is still there: every 5 s. */
const PING_POLLS = 5;
/** The least a socket request at the deadline waits, so a daemon that answers at once is heard. */
const SOCKET_FLOOR_MS = 50;

/**
 * Row 019-24 item 3 (review 0.1.397 S1): how long a socket request of
 * `run <group>` may wait for its answer, what is left before `deadline`
 * (epoch ms; `Infinity` for a bare `--wait`), at most the CLI's bound and
 * at least `SOCKET_FLOOR_MS`.
 */
export function socketBound(deadline: number): number {
  return Math.max(SOCKET_FLOOR_MS, Math.min(CLI_SOCKET_TIMEOUT_MS, deadline - Date.now()));
}

/** `askWithin`'s words when the deadline bounded the request: what is left of the wait ran out. */
export const BEFORE_DEADLINE = " before the deadline";

/**
 * A request's answer within `socketBound(deadline)`: the response, `null`
 * when no daemon listens, or, when the socket gave none, the words that
 * follow "the daemon did not answer …": ` before the deadline`, ` within
 * 2 s`, or `: <the socket's error>`. Never a throw, so the command's
 * no-verdict path words it (exit 3 with `--wait`).
 */
export async function askWithin(
  socketPath: AbsolutePath,
  request: DaemonRequest,
  deadline: number,
): Promise<DaemonResponse | null | { readonly unanswered: string }> {
  const timeoutMs = socketBound(deadline);
  try {
    return await askDaemon(socketPath, request, timeoutMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ETIMEDOUT") {
      return { unanswered: `: ${(error as Error).message}` };
    }
    return {
      unanswered:
        timeoutMs < CLI_SOCKET_TIMEOUT_MS
          ? BEFORE_DEADLINE
          : ` within ${CLI_SOCKET_TIMEOUT_MS / 1_000} s`,
    };
  }
}

/** A taken `run-group` request the wait gives the verdict of. */
export interface GroupWait {
  readonly root: AbsolutePath;
  readonly socketPath: AbsolutePath;
  readonly group: string;
  /** Test files the request queued (`RunGroupResponse.requested.queued`). */
  readonly queued: number;
  /** Epoch ms; `Infinity` for a bare `--wait`. */
  readonly deadline: number;
  /** The `requested` line, printed after the verdict line. */
  readonly line: string;
}

/** How the wait on a group's files ended. */
type Outcome =
  | { readonly kind: "ended" | "deadline"; readonly verdict: FileVerdict }
  | { readonly kind: "on-hold"; readonly hold: StatusHold }
  | { readonly kind: "stopped" };

/**
 * `squeal run <group> --wait` (spec 019 D6): once the scheduler took the
 * request, reads the store once a second until none of the group's test
 * files is pending, the deadline passed, the worktree is on hold with one
 * of them queued, or the daemon went away. Then prints the group's verdict
 * line, the request's line and status, as `run --all --wait` does for a
 * checkpoint, and returns its code (spec 005 D1): 0 when every test file of
 * the group is current and none fails, 1 with known failures, 3 when Squeal
 * has no verdict. A file whose result an edit made stale, which the group's
 * moment does not run again, ends the wait with no verdict.
 */
export async function waitForGroup(wait: GroupWait, io: CliIo): Promise<number> {
  const view = groupView(readPolicy(wait.root));
  const isOwn = (ref: TestFileRef) => view.of(ref).name === wait.group;
  const outcome = await ended(wait, isOwn);
  const now = io.now ?? Date.now;
  const command = statusCommand(io.env ?? process.env);
  const [line, code] = verdictLine(wait, outcome, command);
  io.stdout(`Group ${wait.group} ${line}\n${wait.line}\n`);
  io.stdout(formatStatus(readStatus(wait.root, { now }), now(), command));
  return code;
}

/** The verdict line after `Group <name> `, and the exit code. */
function verdictLine(wait: GroupWait, outcome: Outcome, command: string): [string, 0 | 1 | 3] {
  const none = (why: string): [string, 3] => [`has no verdict: ${why}`, 3];
  switch (outcome.kind) {
    case "on-hold":
      return [
        `is queued and runs when the hold ends. ${holdVerdictLine(outcome.hold, command)}`,
        3,
      ];
    case "stopped":
      return none("the daemon stopped before the group's test files had results");
    case "deadline": {
      const { byClass, revision } = outcome.verdict;
      const pending = plural(byClass.pending, "test file");
      return none(
        `the deadline passed with ${pending} pending at revision ${revision}; the group goes on in the daemon`,
      );
    }
    case "ended": {
      const { verdict } = outcome;
      if (verdict.testFiles === 0) {
        return none(`the group has no listed test files at revision ${verdict.revision}`);
      }
      const why = noVerdictText(verdict);
      if (why !== null) return none(why);
      const queued = Math.min(wait.queued, verdict.testFiles);
      return [
        `completed at revision ${verdict.revision}: ${failuresText(verdict.failures)}; ${plural(verdict.testFiles, "test file")}, ${queued} queued by this request`,
        verdictCode(verdict),
      ];
    }
  }
}

/**
 * Polls the store until the wait ends. A killed daemon never runs the
 * files; every `PING_POLLS` polls the wait asks whether it is still there,
 * within the deadline. A ping with no answer is a busy daemon, not a
 * stopped one: the store still decides (row 019-24).
 */
async function ended(wait: GroupWait, isOwn: (ref: TestFileRef) => boolean): Promise<Outcome> {
  const id = worktreeIdFor(wait.root);
  for (let polls = 0; ; polls++) {
    const seen = inStore(wait.root, (store) => pollGroup(store, id, isOwn, wait.deadline));
    if (seen === null) return { kind: "stopped" };
    if (seen !== "open") return seen;
    if (
      polls % PING_POLLS === PING_POLLS - 1 &&
      (await askWithin(wait.socketPath, { type: "ping" }, wait.deadline)) === null
    ) {
      return { kind: "stopped" };
    }
    await sleep(Math.max(0, Math.min(STORE_POLL_MS, wait.deadline - Date.now())));
  }
}

/**
 * One poll: `open` while a file of the group is pending, or the runner has
 * not listed the revision's files, before `deadline`. The scheduler stored
 * the request's files as pending before it answered the request, so the
 * first poll already sees them.
 */
function pollGroup(
  store: Store,
  id: WorktreeId,
  isOwn: (ref: TestFileRef) => boolean,
  deadline: number,
): Outcome | "open" {
  const files = store.testFileKeys
    .list(id)
    .map((row) => row.testFile)
    .filter(isOwn);
  const classes = readClasses(store, id, files);
  const open = classes.byClass.pending > 0 || classes.unlisted;
  const late = Date.now() >= deadline;
  if (open && !late) {
    // Row 011-73 (C6 as amended 2026-10-21): no tier starts on hold, so the wait returns with it.
    const hold = holdOfWait(store, id, () => store.testFileKeys.list(id, files), Date.now());
    return hold === null ? "open" : { kind: "on-hold", hold };
  }
  return { kind: open ? "deadline" : "ended", verdict: readVerdict(store, id, files) };
}
