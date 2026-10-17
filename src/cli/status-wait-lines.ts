import { testFileId } from "../core/keys/index.js";
import { runnerPartText, testFileKeyOf } from "../core/state/index.js";
import { countedText, formatCheck } from "../core/status/index.js";
import { plural } from "../core/text.js";
import type { DaemonLiveness, StatusSnapshot } from "../core/types/index.js";
import type { SyncState } from "./status-sync.js";
import type { StatusWait, StatusWaitEdit, StatusWaitSlow } from "./status-wait.js";
import type { NamedWait } from "./status-wait-paths.js";
import { failuresText, noVerdictText, verdictCode } from "./verdict.js";
import type { DownReason, HeartbeatLapse } from "./wait-liveness.js";

/** A wait that ended with a snapshot. */
export type EndedWait = Extract<StatusWait, { result: StatusSnapshot }>;

/**
 * The first line of `status --wait`: why it returned. With the edit's files
 * (`StatusWaitEdit`), what it held for and what else is pending.
 */
export function waitLine(wait: EndedWait, command = "squeal"): string {
  const line = ownLine(wait, command);
  const slow = wait.slow === undefined || wait.outcome === "no-daemon" ? "" : slowText(wait.slow);
  return `${line}${slow}${lapseText(wait.lapse)}`;
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
      return `Returned without a daemon: ${noDaemonText(snapshot.daemon, wait.down)}; results are as of revision ${snapshot.revision}`;
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

/** A named-files wait that ended with a snapshot. */
type EndedNamed = Extract<NamedWait, { result: StatusSnapshot }>;

/** How many selected test files the line names before "and N more". */
const NAMED_FILES_SHOWN = 10;

/**
 * Spec 005 D2: the first line of `status --wait <ms> <path>...` is the
 * verdict on the selected test files as D1 words a checkpoint's, then the
 * line naming them. A path that selects nothing says D2's text.
 */
export function namedLine(wait: EndedNamed, command = "squeal"): string {
  const { verdict, selection } = wait;
  const after = `after ${(wait.waitedMs / 1_000).toFixed(1)} s`;
  const none = (why: string) => `Named test files have no verdict: ${why}`;
  let line: string;
  switch (wait.outcome) {
    case "unmatched":
      return `No verdict: ${selection.unmatched.map((p) => `no test file's closure holds ${p}`).join("; ")}`;
    case "no-daemon":
      line = none(
        `${noDaemonText(wait.result.daemon, wait.down)}; results are as of revision ${verdict.revision}; \`${command} start\` starts one`,
      );
      break;
    case "timeout":
      line = none(
        `the deadline passed ${after}: ${unsyncedText(wait.sync, verdict.revision) ?? noVerdictText(verdict) ?? "no result yet"}`,
      );
      break;
    case "settled": {
      const why = verdictCode(verdict) === 3 ? noVerdictText(verdict) : null;
      line =
        why === null
          ? `Named test files at revision ${verdict.revision}: ${failuresText(verdict.failures)}; ${plural(verdict.testFiles, "test file")}, each with a current result, ${after}`
          : none(why);
    }
  }
  const files = selection.files.map((f) => f.path);
  const shown = files.slice(0, NAMED_FILES_SHOWN).join(", ");
  const more =
    files.length > NAMED_FILES_SHOWN ? ` and ${files.length - NAMED_FILES_SHOWN} more` : "";
  return `${line}${lapseText(wait.lapse)}\nSelected: ${shown}${more}`;
}

/** The selected files' known failures, each as status lists it (spec 005 D2: "in full"). */
export function namedFailures(wait: EndedNamed): string[] {
  const ids = new Set(wait.selection.files.map(testFileId));
  return wait.result.knownFailures
    .filter((f) => ids.has(testFileKeyOf(f.check)))
    .flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...(f.summary === "" ? [] : [`        ${f.summary}`]),
      `        ${[
        ...(f.location === null
          ? []
          : [`at ${f.location.path}:${f.location.line}:${f.location.column}`]),
        `observed at revision ${f.observedAt}`,
        f.validity,
      ].join(", ")}`,
    ]);
}

/**
 * Review wave-1, B1: why a named wait's deadline came before the revision
 * holding the edits made before it, or `null` when it did not.
 */
function unsyncedText(sync: SyncState, revision: number): string | null {
  if (sync.state === "pending") {
    return `the daemon has not stored its pass over the edits made before the wait; results are as of revision ${revision}`;
  }
  if (sync.state === "synced" && sync.revision > revision) {
    return `the daemon's pass is at revision ${sync.revision} and results are as of revision ${revision}`;
  }
  return null;
}

/**
 * As delivered headers word it (spec 001 D10: "no daemon running since
 * <time>"), then why the wait found none (task 004-66): a stopped daemon
 * cleared its record; a silent one's heartbeat stopped and nothing listened
 * on its socket for `WAIT_DOWN_MS` past the heartbeat's grace.
 */
function noDaemonText(daemon: DaemonLiveness, down: DownReason | undefined): string {
  if (daemon.state === "alive" || daemon.since === null) return "no daemon is running";
  const since = `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
  if (down === "silent") {
    return `${since}: its heartbeat stopped and nothing listens on its socket`;
  }
  return down === "stopped" ? `${since}: the daemon stopped` : since;
}

/**
 * Task 004-66 (issue 12): a wait that went on through a stale heartbeat
 * says so, since status read meanwhile said no daemon is validating.
 */
function lapseText(lapse: HeartbeatLapse | undefined): string {
  if (lapse === undefined) return "";
  const age = Math.round(lapse.staleMs / 1_000);
  return `; the daemon's heartbeat went ${age} s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on`;
}

function anyPending(snapshot: StatusSnapshot): boolean {
  const { counts, testFilesWithoutChecks, runnerPartPending } = snapshot;
  return counts.pending + testFilesWithoutChecks.pending > 0 || runnerPartPending === true;
}

/** `2 checks (1 test, 1 test file loaded) and 1 test file without checks pending` (spec 005 D1). */
function pendingText(snapshot: StatusSnapshot): string {
  const checks = snapshot.counts.pending;
  const files = snapshot.testFilesWithoutChecks.pending;
  const word = checks === 1 ? "check" : "checks";
  const parts = [countedText(checks, word, snapshot.fileLevelCounts?.pending)];
  if (files > 0) parts.push(`${plural(files, "test file")} without checks`);
  if (snapshot.runnerPartPending === true) parts.push(runnerPartText(snapshot.revision));
  return parts.length === 1
    ? `${parts[0]} pending`
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} pending`;
}
