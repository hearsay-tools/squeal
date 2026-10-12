import { runnerPartText } from "../core/state/index.js";
import { plural } from "../core/text.js";
import type { DaemonLiveness, StatusSnapshot } from "../core/types/index.js";
import type { StatusWait, StatusWaitEdit, StatusWaitSlow } from "./status-wait.js";

/** A wait that ended with a snapshot. */
export type EndedWait = Extract<StatusWait, { result: StatusSnapshot }>;

/**
 * The first line of `status --wait`: why it returned. With the edit's files
 * (`StatusWaitEdit`), what it held for and what else is pending.
 */
export function waitLine(wait: EndedWait, command = "squeal"): string {
  const line = ownLine(wait, command);
  return wait.slow === undefined || wait.outcome === "no-daemon"
    ? line
    : `${line}${slowText(wait.slow)}`;
}

function ownLine(wait: EndedWait, command: string): string {
  const { outcome, transitions, edit, result: snapshot } = wait;
  const after = `after ${(wait.waitedMs / 1_000).toFixed(1)} s`;
  const at = `at revision ${snapshot.revision}`;
  const running =
    outcome === "quiet"
      ? `${checkpointText(snapshot, command)}${wait.slow === undefined ? slowTierText(snapshot, command) : ""}`
      : "";
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
      return edit.testFiles === 0
        ? `Returned on quiet: the edits since revision ${edit.since} changed no file a Squeal test reads, so Squeal has no result for them; the counts below are earlier results ${at} ${after}${pending}${others}`
        : `Returned on quiet: nothing the edits since revision ${edit.since} re-keyed is pending (${plural(edit.testFiles, "test file")}) ${at} ${after}${pending}${others}`;
    case "news":
      return `Returned on news: ${newsText(wait, files)}, ${at} ${after}${pending}${others}`;
    default:
      return `Returned on timeout ${after}: ${edit.pending} of the ${files} pending ${at}${pending}${others}`;
  }
}

/**
 * The edit's transitions in its files, then the held slow files' in theirs,
 * each named only when there is one (review wave-13ak, S1).
 */
function newsText(wait: EndedWait, files: string): string {
  const slow = wait.slow?.transitions ?? 0;
  const own = wait.transitions - slow;
  const parts: string[] = [];
  if (own > 0) parts.push(`${plural(own, "transition")} in the ${files}`);
  if (slow > 0) {
    const held = `${plural(wait.slow?.held ?? 0, "slow file")} run --slow queued`;
    parts.push(`${parts.length === 0 ? plural(slow, "transition") : slow} in the ${held}`);
  }
  return parts.join(" and ");
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

/**
 * Task 001-282: what `run --slow --wait` held for, the slow files its
 * request queued, and those of them still pending, by path.
 */
function slowText(slow: StatusWaitSlow): string {
  if (slow.held === 0) return "";
  const queued = `${plural(slow.held, "slow file")} run --slow queued`;
  if (slow.pending.length === 0) {
    return `; the ${queued} ${slow.held === 1 ? "has its result" : "have their results"}`;
  }
  return `; ${slow.pending.length} of the ${queued} pending: ${slow.pending.join(", ")}`;
}

/**
 * Task 001-282: a quiet `status --wait` says the slow files it did not wait
 * for, those not current (spec 004 D9), and the command that does.
 */
function slowTierText(snapshot: StatusSnapshot, command: string): string {
  const tier = snapshot.slowTier;
  const open = tier === undefined ? 0 : tier.pending + tier.notRun;
  if (open === 0) return "";
  return (
    `; ${plural(open, "slow file")} ${open === 1 ? "is" : "are"} not current, ` +
    `which this wait does not hold for: \`${command} run --slow --wait 60000\` runs and waits for ${open === 1 ? "it" : "them"}`
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
