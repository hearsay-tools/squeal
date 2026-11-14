import { formatStatus } from "../core/status/format-status.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { StatusResult, StatusSnapshot } from "../core/types/status.js";
import type { CliIo } from "./main.js";
import { namedWaitCommand } from "./named-print.js";
import { baseOf } from "./named-selection.js";
import { statusCommand } from "./status-command.js";
import { syncDaemon } from "./status-sync.js";
import { type NamedTextOptions, waitLine, waitText } from "./status-wait-lines.js";
import type { StatusWait, StatusWaitEdit, StatusWaitOptions } from "./wait/status.js";
import { SETTLE_MS, STATUS_POLL_MS, type StatusWaitOutcome } from "./wait/status-table.js";
import { statusWait } from "./wait/wait.js";

export type {
  StatusWait,
  StatusWaitEdit,
  StatusWaitOptions,
  StatusWaitSlow,
} from "./wait/status.js";
export type { StatusWaitOutcome } from "./wait/status-table.js";

/** How often `status --wait` reads the store (C6 as amended, task 011-42). */
export const STATUS_WAIT_POLL_MS = STATUS_POLL_MS;

/**
 * The shortest wait that may end without a daemon, which a daemon a hook
 * just spawned needs to record its heartbeat, and the shortest that may end
 * on quiet when no daemon can sync (one from before the `sync` request). A
 * daemon that syncs decides quiet instead (lessons, defect 30). Row 011-331:
 * the status waits' settle cell (`SETTLE_MS`).
 */
export const STATUS_WAIT_SETTLE_MS = SETTLE_MS;

/**
 * The `wait` field `status --json --wait` adds to the snapshot: the same
 * outcome as the first human line.
 */
export interface StatusWaitPayload {
  readonly outcome: StatusWaitOutcome;
  readonly waitedMs: number;
  readonly transitions: number;
  /** Present when the daemon named the edit's test files (task 001-186). */
  readonly edit?: StatusWaitEdit;
}

/**
 * Spec 001 D7: "`squeal status --wait <ms>` blocks until nothing is pending
 * at the current revision or a new transition is recorded, then prints the
 * snapshot". Reads the store every `pollMs`, and once its sync answers.
 * Without a validating daemon nothing pending can finish, so once the settle
 * time passed with no daemon alive it returns `no-daemon` instead of `quiet`
 * or a long timeout; a
 * daemon a hook just spawned has the settle time to record its heartbeat.
 * Pending includes the runner part of the current revision (D2 as amended).
 *
 * Quiet is decided at a revision that holds every edit made before the wait
 * (lessons, defect 30): the daemon is asked for a reconciliation pass at the
 * start (`syncDaemon`), and quiet waits until the store's revision reached
 * the one that pass left. On a loaded host the edit's revision committed up
 * to 3.1 s after the edit, past any fixed delay. A daemon that cannot sync
 * falls back to the settle time.
 *
 * A new transition is found the way delivery finds one (D6): the known
 * states at the start of the wait act as a view, and any notable difference
 * from it is news. A check that broke and recovered between two reads is not.
 * A store that cannot be read at the start ends the wait at once; a read that
 * fails later (a busy lock) is skipped.
 *
 * Lessons, defect 32 (tasks 001-186, 001-191): once the store's refined
 * revision reached the pass's, the store's re-key moves name the test files
 * every revision up to it re-keyed, those whose move had its result since
 * the start view included (`answerMoves`, task 001-258), and the window
 * keeps those of the revisions since the wait last heard and of earlier
 * ones not yet seen through (`lastHeard`, `editWindow`). Then quiet is none
 * of those files pending, slow ones aside, whatever else runs, and news is
 * a transition of one of their checks; until the moves are read, neither.
 * Every commit to the moves after the window reads them again, so a move
 * recorded later joins it (review wave 13ad, S1, task 001-267).
 * A daemon that names no incarnation (one before task 001-268) or cannot
 * sync, moves lost since the start, and a record that incarnation did not
 * write last or a daemon registered since, read before the window or at any
 * read after it (`movesTrusted`, review waves 13ac and 13ad, B1), leave the
 * wait as before: nothing pending at all, and any check's news.
 *
 * With `holdSlow` (task 001-282), quiet also needs every slow file pending
 * at the first read to have its result, and their transitions are news.
 *
 * Task 004-66 (issue 12): a stale heartbeat is no daemon only once
 * `watchDaemon` finds none, a cleared record or a socket dead for `downMs`;
 * a daemon whose heartbeat lapsed keeps the wait going, and the line says so.
 */
export function waitForStatus(cwd: AbsolutePath, options: StatusWaitOptions): Promise<StatusWait> {
  // Row 011-331: the wait module's edit wait polls and decides.
  return statusWait({ wait: "edit", cwd, options });
}

/**
 * The consumer a wait runs as, from its shell: the session from
 * `CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID` or `OPENCODE_SESSION_ID`, and,
 * for OpenCode alone, the agent from `OPENCODE_AGENT_ID` (`main` for a root
 * session, the child session's id for a child, spec 008 D2), so a child's pull
 * is credited to `(root, child)`. Codex's shell names no agent: every consumer
 * of its session counts.
 */
export function waitConsumer(env: Readonly<Record<string, string | undefined>>): {
  readonly session: string | null;
  readonly agent: string | null;
} {
  const session = env.CLAUDE_CODE_SESSION_ID ?? env.CODEX_SESSION_ID ?? null;
  if (session !== null) return { session, agent: null };
  const opencode = env.OPENCODE_SESSION_ID;
  if (opencode === undefined || opencode === "") return { session: null, agent: null };
  const agent = env.OPENCODE_AGENT_ID;
  return { session: opencode, agent: agent === undefined || agent === "" ? null : agent };
}

/**
 * Task 004-66 (issue 12): `run --slow --wait`'s code once its wait ended, 3
 * when the slow files its request queued have no verdict, since no daemon
 * will run them or the deadline passed first, as a named wait's (spec 005
 * D1); else 0.
 */
export function slowWaitCode(wait: Extract<StatusWait, { result: StatusSnapshot }>): 0 | 3 {
  if (wait.outcome === "no-daemon" || wait.outcome === "on-hold") return 3;
  return wait.outcome === "timeout" && (wait.slow?.pending.length ?? 0) > 0 ? 3 : 0;
}

/**
 * `squeal status [--json] --wait <ms>`. Exit code 0 on quiet, news, no daemon
 * or timeout, but `slowWaitCode`'s with `holdSlow`; 3 on hold (row 011-73); 1 when status is unavailable. The line saying why the wait
 * ended comes last in the human rendering, after the snapshot (issue 26), and goes to stderr with `--json`,
 * where stdout is the snapshot payload plus a `wait` field
 * (`StatusWaitPayload`) with the same outcome. `holdSlow` is
 * `run --slow --wait`'s (`StatusWaitOptions`). With `paths`, the wait is
 * spec 005 D2's on the test files they select (`namedWaitCommand`), printed
 * as `named` says (`--full`, `--notes`; row 011-28).
 */
export async function statusWaitCommand(
  timeoutMs: number,
  json: boolean,
  io: CliIo,
  holdSlow = false,
  paths: readonly string[] = [],
  named: NamedTextOptions = {},
): Promise<number> {
  const now = io.now ?? Date.now;
  const env = io.env ?? process.env;
  if (paths.length > 0) {
    const pollMs = STATUS_WAIT_POLL_MS;
    const settleMs = STATUS_WAIT_SETTLE_MS;
    return namedWaitCommand(paths, { ...named, json }, io, {
      timeoutMs,
      pollMs,
      settleMs,
      now,
      sync: syncDaemon,
    });
  }
  const wait = await waitForStatus(io.cwd ?? process.cwd(), {
    timeoutMs,
    now,
    ...waitConsumer(env),
    holdSlow,
  });
  const result: StatusResult = wait.result;
  if (wait.outcome === "unavailable") {
    io.stdout(json ? `${JSON.stringify(result, null, 2)}\n` : formatStatus(result, now()));
    return 1;
  }
  const line = `${waitLine(wait, statusCommand(env))}\n`;
  if (json) {
    const payload: StatusWaitPayload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      transitions: wait.transitions,
      ...(wait.edit === undefined ? {} : { edit: wait.edit }),
    };
    io.stdout(`${JSON.stringify({ ...result, wait: payload }, null, 2)}\n`);
    io.stderr(line);
  } else {
    const base = baseOf(wait.result.worktreeRoot, io.cwd ?? process.cwd());
    io.stdout(waitText(wait, now(), statusCommand(env), { ...named, base }));
  }
  // Row 011-73 (C6 as amended 2026-10-21): on hold, the wait has no verdict.
  return holdSlow || wait.outcome === "on-hold" ? slowWaitCode(wait) : 0;
}
