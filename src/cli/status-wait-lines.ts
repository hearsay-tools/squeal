import { runnerPartText } from "../core/state/index.js";
import { plural } from "../core/text.js";
import type { DaemonLiveness, StatusSnapshot } from "../core/types/index.js";
import type { StatusWait, StatusWaitEdit } from "./status-wait.js";

/** A wait that ended with a snapshot. */
export type EndedWait = Extract<StatusWait, { result: StatusSnapshot }>;

/**
 * The first line of `status --wait`: why it returned. With the edit's files
 * (`StatusWaitEdit`), what it held for and what else is pending.
 */
export function waitLine(wait: EndedWait, command = "squeal"): string {
  const { outcome, transitions, edit, result: snapshot } = wait;
  const after = `after ${(wait.waitedMs / 1_000).toFixed(1)} s`;
  const at = `at revision ${snapshot.revision}`;
  const running = outcome === "quiet" ? checkpointText(snapshot, command) : "";
  if (edit !== undefined && outcome !== "no-daemon") {
    return `${editLine(edit, wait, at, after)}${running}`;
  }
  switch (outcome) {
    case "quiet":
      return `Returned on quiet: nothing pending ${at} ${after}${running}`;
    case "news":
      return `Returned on news: ${plural(transitions, "transition")} since the wait started, ${at} ${after}`;
    case "no-daemon":
      return `Returned without a daemon: ${noDaemonText(snapshot.daemon)}; results are as of revision ${snapshot.revision}`;
    case "timeout":
      return `Returned on timeout ${after}: ${pendingText(snapshot)} ${at}`;
  }
}

/**
 * Lessons, defect 32: the line says what the wait held for, the test files
 * the edits since revision N re-keyed, and what else is pending or changed,
 * which did not hold it.
 */
function editLine(edit: StatusWaitEdit, wait: EndedWait, at: string, after: string): string {
  const files = `${plural(edit.testFiles, "test file")} the edits since revision ${edit.since} re-keyed`;
  const others =
    edit.otherTransitions > 0
      ? `; ${plural(edit.otherTransitions, "transition")} of other checks`
      : "";
  const pending = anyPending(wait.result) ? `; ${pendingText(wait.result)} in all` : "";
  switch (wait.outcome) {
    case "quiet":
      return `Returned on quiet: nothing the edits since revision ${edit.since} re-keyed is pending (${plural(edit.testFiles, "test file")}) ${at} ${after}${pending}${others}`;
    case "news":
      return `Returned on news: ${plural(wait.transitions, "transition")} in the ${files}, ${at} ${after}${pending}${others}`;
    default:
      return `Returned on timeout ${after}: ${edit.pending} of the ${files} pending ${at}${pending}${others}`;
  }
}

/**
 * Task 001-217 (005 proposal b): a quiet wait says what it did not wait for,
 * a checkpoint still running, and how to wait for that.
 */
function checkpointText(snapshot: StatusSnapshot, command: string): string {
  const checkpoint = snapshot.checkpoint;
  if (checkpoint === undefined || checkpoint.owed) return "";
  const what =
    checkpoint.kind === "run-all" ? "a `run --all` checkpoint" : "the baseline checkpoint";
  return (
    `; ${what} is still running (${checkpoint.done} of ${plural(checkpoint.total, "test file")} done), ` +
    `which this wait does not hold for: \`${command} run --all --wait\` waits for it`
  );
}

/** As delivered headers word it (spec 001 D10: "no daemon running since <time>"). */
function noDaemonText(daemon: DaemonLiveness): string {
  if (daemon.state === "alive" || daemon.since === null) return "no daemon is running";
  return `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
}

function anyPending(snapshot: StatusSnapshot): boolean {
  const { counts, testFilesWithoutChecks, runnerPartPending } = snapshot;
  return counts.pending + testFilesWithoutChecks.pending > 0 || runnerPartPending === true;
}

function pendingText(snapshot: StatusSnapshot): string {
  const checks = snapshot.counts.pending;
  const files = snapshot.testFilesWithoutChecks.pending;
  const parts = [plural(checks, "check")];
  if (files > 0) parts.push(`${plural(files, "test file")} without checks`);
  if (snapshot.runnerPartPending === true) parts.push(runnerPartText(snapshot.revision));
  return parts.length === 1
    ? `${parts[0]} pending`
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} pending`;
}
