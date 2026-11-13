import { AWAITING_INSTALL_REASON } from "../core/scheduler/install.js";
import { formatStatus } from "../core/status/format-status.js";
import { holdVerdictLine } from "../core/status/holds.js";
import { readStatus } from "../core/status/snapshot.js";
import { plural } from "../core/text.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import { type FileVerdict, failuresText, noVerdictText, verdictCode } from "./verdict.js";
import type { InstallHold } from "./wait/progress.js";
import type { GroupOutcome } from "./wait/table.js";
import { runWait } from "./wait/wait.js";

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
  const { root, socketPath, deadline, group } = wait;
  const files =
    wait.files === undefined
      ? ({ kind: "group", group } as const)
      : ({ kind: "list", files: wait.files } as const);
  const outcome = await runWait({ wait: "group", root, socketPath, deadline, files });
  const now = io.now ?? Date.now;
  const command = statusCommand(io.env ?? process.env);
  const [line, code] = verdictLine(wait, outcome, command);
  const subject =
    wait.files === undefined ? `Group ${wait.group}` : `Selected test files of group ${wait.group}`;
  io.stdout(`${subject} ${line}\n${wait.line}\n`);
  io.stdout(formatStatus(readStatus(wait.root, { now }), now(), command));
  return code;
}

/** The verdict line after the subject, and the exit code. */
function verdictLine(wait: GroupWait, outcome: GroupOutcome, command: string): [string, 0 | 1 | 3] {
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
