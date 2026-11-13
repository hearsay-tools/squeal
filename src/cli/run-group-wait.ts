import { setTimeout as sleep } from "node:timers/promises";
import { readPolicy } from "../core/daemon/policy.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { AWAITING_INSTALL_REASON } from "../core/scheduler/install.js";
import { groupView } from "../core/scheduler/slow.js";
import { formatStatus } from "../core/status/format-status.js";
import { holdVerdictLine } from "../core/status/holds.js";
import { readStatus } from "../core/status/snapshot.js";
import { plural } from "../core/text.js";
import type { AbsolutePath, WorktreeId } from "../core/types/common.js";
import type { DaemonRequest, DaemonResponse } from "../core/types/daemon.js";
import type { TestFileRef } from "../core/types/keys.js";
import {
  awaitingInstallMetaKey,
  installCommandMetaKey,
  parseAwaitingInstall,
} from "../core/types/scheduler.js";
import type { StatusHold } from "../core/types/standing.js";
import type { Store } from "../core/types/store.js";
import { askDaemon, CLI_SOCKET_TIMEOUT_MS } from "./daemon-access.js";
import type { CliIo } from "./main.js";
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
import { inStore } from "./wait/reads.js";

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
  /**
   * Row 019-49 (019 D6 "Narrow run"): the test files the paths selected;
   * the wait is for them alone. Absent: every file of the group.
   */
  readonly files?: readonly TestFileRef[];
  /** The paths that select no test file of any group: no clean verdict, as a named wait. */
  readonly unmatched?: readonly string[];
}

/**
 * Review 0.1.411-r2 (row 019-52): at the deadline, the worktree waits for an
 * install, so none of the files runs; `command` installs the dependencies,
 * `null` when the daemon names none.
 */
interface InstallHold {
  readonly command: string | null;
}

/** How the wait on a group's files ended. */
type Outcome =
  | { readonly kind: "ended"; readonly verdict: FileVerdict }
  | { readonly kind: "deadline"; readonly verdict: FileVerdict; readonly install?: InstallHold }
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
  const outcome = await ended(wait, ownOf(wait));
  const now = io.now ?? Date.now;
  const command = statusCommand(io.env ?? process.env);
  const [line, code] = verdictLine(wait, outcome, command);
  const subject =
    wait.files === undefined ? `Group ${wait.group}` : `Selected test files of group ${wait.group}`;
  io.stdout(`${subject} ${line}\n${wait.line}\n`);
  io.stdout(formatStatus(readStatus(wait.root, { now }), now(), command));
  return code;
}

/** Which files the wait is for: the narrow run's selection (row 019-49), else the group's. */
function ownOf(wait: GroupWait): (ref: TestFileRef) => boolean {
  if (wait.files !== undefined) {
    const ids = new Set(wait.files.map(testFileId));
    return (ref) => ids.has(testFileId(ref));
  }
  const view = groupView(readPolicy(wait.root));
  return (ref) => view.of(ref).name === wait.group;
}

/** The verdict line after the subject, and the exit code. */
function verdictLine(wait: GroupWait, outcome: Outcome, command: string): [string, 0 | 1 | 3] {
  const narrow = wait.files !== undefined;
  const none = (why: string): [string, 3] => [`${narrow ? "have" : "has"} no verdict: ${why}`, 3];
  switch (outcome.kind) {
    case "on-hold": {
      const queued = narrow ? "are queued and run" : "is queued and runs";
      return [`${queued} when the hold ends. ${holdVerdictLine(outcome.hold, command)}`, 3];
    }
    case "stopped":
      return none(
        `the daemon stopped before the ${narrow ? "selected" : "group's"} test files had results`,
      );
    case "deadline": {
      const { byClass, revision } = outcome.verdict;
      if (outcome.install !== undefined) {
        return none(installHeldText(outcome.install, revision, narrow));
      }
      const pending = plural(byClass.pending, "test file");
      const on = narrow ? "their runs go on" : "the group goes on";
      return none(
        `the deadline passed with ${pending} pending at revision ${revision}; ${on} in the daemon`,
      );
    }
    case "ended":
      return endedLine(wait, outcome.verdict, none);
  }
}

/**
 * Review 0.1.411-r2: the deadline line while the worktree waits for an
 * install. No file runs before it, so no run goes on in the daemon.
 */
function installHeldText(install: InstallHold, revision: number, narrow: boolean): string {
  const which = narrow ? "the selected test files" : "the group's test files";
  const how = install.command === null ? "" : `; \`${install.command}\` installs them`;
  return `the deadline passed at revision ${revision} while ${AWAITING_INSTALL_REASON}, so Squeal runs none of ${which} before the dependencies are installed${how}`;
}

/**
 * The verdict of files that all have results. Row 019-49: a path that
 * selects nothing leaves no clean verdict, as a named wait (005-67): 1 with
 * a known failure among the selected files, else 3.
 */
function endedLine(
  wait: GroupWait,
  verdict: FileVerdict,
  none: (why: string) => [string, 3],
): [string, 0 | 1 | 3] {
  if (verdict.testFiles === 0) {
    return none(`the group has no listed test files at revision ${verdict.revision}`);
  }
  const why = noVerdictText(verdict);
  if (why !== null) return none(why);
  const unmatched = wait.unmatched ?? [];
  const nothing =
    unmatched.length === 0
      ? ""
      : `${unmatched.join(", ")} ${unmatched.length === 1 ? "selects" : "select"} no test file of any group`;
  const code = verdictCode(verdict);
  if (code === 0 && nothing !== "") return none(nothing);
  const queued = Math.min(wait.queued, verdict.testFiles);
  return [
    `completed at revision ${verdict.revision}: ${failuresText(verdict.failures)}; ${plural(verdict.testFiles, "test file")}, ${queued} queued by this request${nothing === "" ? "" : `; ${nothing}`}`,
    code,
  ];
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
  const verdict = readVerdict(store, id, files);
  return open ? { kind: "deadline", verdict, ...installOf(store, id) } : { kind: "ended", verdict };
}

/** Whether the worktree waits for an install (`parseAwaitingInstall`), with the command that ends it. */
function installOf(store: Store, id: WorktreeId): { readonly install?: InstallHold } {
  if (parseAwaitingInstall(store.meta.get(awaitingInstallMetaKey(id))) === null) return {};
  const command = store.meta.get(installCommandMetaKey(id));
  return { install: { command: command === "" ? null : command } };
}
