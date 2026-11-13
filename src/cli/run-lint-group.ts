import { GROUP_NOT_SUPPORTED } from "../core/daemon/run-group.js";
import { plural } from "../core/text.js";
import type { ResolvedGroup } from "../core/types/check-groups.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { RunGroupResponse } from "../core/types/daemon.js";
import { daemonSocket } from "./daemon-access.js";
import { deadlineText } from "./group-pending.js";
import type { CliIo } from "./main.js";
import { statusCommand } from "./status-command.js";
import { stoppedText } from "./wait/presence.js";
import { askWithin, socketBound } from "./wait/socket.js";
import type { LintGroupOutcome } from "./wait/table.js";
import { runWait, untilTaken } from "./wait/wait.js";

/*
 * Spec 019 D6 for a lint group (row 019-22; agreed with the coordinator
 * 2026-11-04, request b166dde6: `run-group.ts` hands a lint group here).
 * `squeal run <group>` asks the daemon's `run-group`, which lints every
 * pending check of the group's tools now, whatever its moment. With
 * `--wait`, the lint store is read until none of them is left to lint.
 */

/** How long to wait for the scheduler to take the request without `--wait`. */
const RECORD_WAIT_MS = 10_000;

/** One `squeal run <lint group>`. */
export interface LintGroupRun {
  readonly root: AbsolutePath;
  readonly group: ResolvedGroup;
  /** `null` without `--wait`; `Infinity` for a bare `--wait`. */
  readonly waitMs: number | null;
}

type Requested = NonNullable<RunGroupResponse["requested"]>;

/**
 * Exit code 0 when requested, 1 when no daemon runs or the request failed.
 * With `--wait`: 0 when every lint check of the group is linted with no
 * findings, 1 with findings, 3 when Squeal has no verdict. The daemon's
 * discovery, every socket call and every sleep end by the wait's one
 * deadline, as for a test group (row 019-26, review 0.1.398 B3).
 */
export async function runLintGroupCommand(run: LintGroupRun, io: CliIo): Promise<number> {
  const { root, group, waitMs: wait } = run;
  const noVerdict = (text: string): number => {
    if (wait === null) {
      io.stderr(`squeal: ${text}\n`);
      return 1;
    }
    io.stdout(`Group ${group.name} has no verdict: ${text}\n`);
    return 3;
  };
  const deadline = Date.now() + (wait ?? RECORD_WAIT_MS);
  const socketPath = await daemonSocket(root, socketBound(deadline));
  const state = await taken(root, socketPath, group.name, deadline);
  if (typeof state === "string") return noVerdict(state);
  const line = requestedText(group.name, state);
  if (wait === null) {
    io.stdout(line);
    return 0;
  }
  // The lint group wait (`src/cli/wait/`): until none of the group's checks is left to lint.
  const files = { kind: "group", group: group.name } as const;
  const outcome = await runWait({ wait: "lint group", root, socketPath, deadline, files });
  const [verdict, code] = lintGroupVerdictLine(
    outcome,
    group,
    statusCommand(io.env ?? process.env),
  );
  io.stdout(`Group ${group.name} ${verdict}\n${line}`);
  return code;
}

const PENDING = "the request is pending, and the daemon takes it once its current work allows";

/** The request, then `run-group-status` until the scheduler took it (`untilTaken`): what it queued, or why not. */
async function taken(
  root: AbsolutePath,
  socketPath: AbsolutePath,
  group: string,
  deadline: number,
): Promise<Requested | string> {
  const first = await askWithin(socketPath, { type: "run-group", group }, deadline);
  if (first === null) return "no daemon is running; start one with squeal start";
  if ("unanswered" in first) {
    return `the daemon did not answer the request to run group ${group}${first.unanswered}; it may still take it once its current work allows`;
  }
  const outcome = await untilTaken({ loop: "run-group", socketPath, first, deadline });
  switch (outcome.kind) {
    case "taken":
      return outcome.answer.requested as Requested;
    // Review 0.1.409 B1: the line, and its store read, only once the deadline passed.
    case "pending":
      return deadlineText(root, outcome.answer, "run the linter yourself");
    case "unsupported":
      return GROUP_NOT_SUPPORTED;
    case "refused":
    case "failed":
      return failed(outcome.error);
    case "unknown group":
      return `the daemon's policy has no group "${outcome.answer.group}" yet; it reloads squeal.config.json when it sees the file change`;
    case "stopped":
      return "the daemon stopped before taking the request";
    case "unanswered":
      return `the daemon did not answer about request ${outcome.answer.requestId}${outcome.words}; ${PENDING}`;
  }
}

const failed = (error: string) => `squeal run <group> failed: ${error}`;

function requestedText(group: string, { revision, queued }: Requested): string {
  if (queued === 0) {
    return `No lint checks of group ${group} to lint at revision ${revision}: none is pending.\n`;
  }
  return `Group ${group} requested at revision ${revision}: ${plural(queued, "lint check")} queued; they lint now.\n`;
}

/** The verdict after `Group <name> `, and the exit code. */
export function lintGroupVerdictLine(
  outcome: LintGroupOutcome,
  group: ResolvedGroup,
  command: string,
): [string, 0 | 1 | 3] {
  const none = (why: string): [string, 3] => [`has no verdict: ${why}`, 3];
  switch (outcome.kind) {
    case "off":
      return none("lint is off: lint.enabled is false in squeal.config.json");
    case "unread":
      return none("the lint store cannot be read");
    case "stopped":
      return none(
        `the daemon stopped before the group's lint checks were linted (${stoppedText(outcome.daemon, command)})`,
      );
    case "deadline":
      return none(
        `the deadline passed with ${plural(outcome.counts.linting, "lint check")} pending; the group goes on in the daemon`,
      );
    case "ended": {
      const { files, failing, held, unknown } = outcome.counts;
      if (files === 0) return none("the group has no lint checks");
      if (held > 0) {
        const next = group.at === "manual" ? `another \`squeal run ${group.name}\`` : "a commit";
        return none(
          `${plural(held, "lint check")} changed after the request and ${held === 1 ? "waits" : "wait"} for ${next}`,
        );
      }
      if (unknown > 0) return none(`${plural(unknown, "lint check")} could not be linted`);
      if (failing > 0) {
        return [
          `completed: lint findings in ${failing} of ${plural(files, "file")}; \`squeal lint\` lists them`,
          1,
        ];
      }
      return [`completed: no lint findings in ${plural(files, "file")}`, 0];
    }
  }
}
