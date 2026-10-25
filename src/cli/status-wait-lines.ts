import { HANDOFF_BOUND_MS } from "../core/delivery/handoff.js";
import { testFileId } from "../core/keys/index.js";
import { runnerPartText, slowWaitText } from "../core/state/index.js";
import { statusRevisionText } from "../core/status/identity.js";
import {
  countedText,
  failureCountText,
  formatStatus,
  holdLines,
  holdVerdictLine,
  notCurrentText,
  type StatusFormatOptions,
  splitByValidity,
} from "../core/status/index.js";
import { stoppingState } from "../core/status/stopping.js";
import { plural, testFileText } from "../core/text.js";
import type { DaemonLiveness, EpochMs, StatusSnapshot } from "../core/types/index.js";
import { classLines, namedFailures, reasonGroups } from "./named-file-lines.js";
import { heldByPaths, namedPathLines, pathsText } from "./named-path-lines.js";
import type { SyncState } from "./status-sync.js";
import type { StatusWait, StatusWaitEdit, StatusWaitSlow } from "./status-wait.js";
import { focusedVerdictText, focusLines, refusedLine } from "./status-wait-focus-lines.js";
import { type NamedWait, namedResult } from "./status-wait-paths.js";
import { failuresText, noVerdictText, type SelectionResult, verdictCode } from "./verdict.js";
import type { DownReason, HeartbeatLapse } from "./wait-liveness.js";

/** A wait that ended with a snapshot. */
export type EndedWait = Extract<StatusWait, { result: StatusSnapshot }>;

/**
 * The last line of `status --wait`, its verdict (issue 26): why it returned,
 * then the worktree's known failures and outstanding work. With the edit's
 * files (`StatusWaitEdit`), what it held for and what else is pending.
 */
export function waitLine(wait: EndedWait, command = "squeal"): string {
  // Row 011-73 (C6 as amended 2026-10-21): the hold is the verdict, and says what ends it.
  if (wait.outcome === "on-hold" && wait.hold !== undefined) {
    return `${holdVerdictLine(wait.hold, command)}${worktreeText(wait.result)}`;
  }
  const line = ownLine(wait, command);
  const slow = wait.slow === undefined || wait.outcome === "no-daemon" ? "" : slowText(wait.slow);
  const live = wait.outcome === "no-daemon" ? "" : liveText(wait.result.daemon, wait.lapse);
  return `${line}${slow}${live}${worktreeText(wait.result)}`;
}

/**
 * `status --wait`'s human text: status's default text, or with `--full` the
 * full one, then last its verdict (issue 26; 011 C6 as amended 2026-10-20,
 * row 011-29).
 */
export function waitText(
  wait: EndedWait,
  now: EpochMs,
  command = "squeal",
  options: StatusFormatOptions = {},
): string {
  return `${formatStatus(wait.result, now, command, options)}\n${waitLine(wait, command)}\n`;
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
      return `Returned without a daemon: ${noDaemonText(snapshot.daemon, wait.down, command)}; results are as of revision ${snapshot.revision}`;
    case "timeout":
      return `Returned on timeout ${after}: ${pendingText(snapshot)} ${at}`;
    case "on-hold":
      return `Returned on hold ${at} ${after}`;
  }
}

/**
 * Lessons, defect 32: the line says what the wait held for, the test files
 * the edits since revision N re-keyed, and what else changed, which did not
 * hold it. Row 011-29 (gh-41): a quiet one says it holds for those files
 * only while the rest of the worktree has work outstanding, which the
 * worktree part counts.
 */
function editLine(edit: StatusWaitEdit, wait: EndedWait, at: string, after: string): string {
  const files = `${plural(edit.testFiles, "test file")} the edits since revision ${edit.since} re-keyed`;
  const others =
    edit.otherTransitions > 0
      ? `; ${plural(edit.otherTransitions, "transition")} of other checks`
      : "";
  switch (wait.outcome) {
    case "quiet": {
      const rest =
        anyPending(wait.result) || (wait.result.outstanding ?? []).length > 0
          ? "; this wait does not hold for the rest of the worktree"
          : "";
      return `Returned on quiet: ${quietText(edit)}, ${at} ${after}${rest}${others}`;
    }
    case "news":
      return `Returned on news: ${newsText(wait, files)}, ${at} ${after}${others}`;
    default:
      return `Returned on timeout ${after}: ${edit.pending} of the ${files} pending ${at}${others}`;
  }
}

/** `none of the 91 test files the edits since revision 1 re-keyed is pending`. */
function quietText(edit: StatusWaitEdit): string {
  const since = `the edits since revision ${edit.since} re-keyed`;
  if (edit.testFiles === 0) return `${since} no test file`;
  if (edit.testFiles === 1) return `the 1 test file ${since} is not pending`;
  return `none of the ${edit.testFiles} test files ${since} is pending`;
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
 * for, those not current (spec 004 D9), and the command that does. Spec 004
 * D8 as amended 2026-10-18 (gh-35, task 004-71): it follows
 * `stop.requireSlowSuite`, read as the `Slow tier:` line reads it (a
 * `stopWaitMs` only when on); off, the files are not required before the
 * agent finishes. Under `slow.trigger: "continuous"` it says the pending
 * ones run after the fast tests, as the `Slow tier:` line does, so the
 * return on quiet does not read as their running only on a pause; under
 * `"idle"` it is 004-71's text (row 004-80). Off, it names the wait for
 * them, `slowWaitText` (D8 as amended 2026-10-19, row 004-83).
 */
function slowTierText(snapshot: StatusSnapshot, command: string): string {
  const tier = snapshot.slowTier;
  if (tier === undefined) return "";
  const open = tier.pending + tier.notRun;
  if (open === 0) return "";
  const them = open === 1 ? "it" : "them";
  const runs =
    tier.pausesOnly === true || tier.pending === 0
      ? ""
      : ` and Squeal runs ${tier.notRun === 0 ? them : "the pending ones"} after the fast tests`;
  const files = `${plural(open, "slow file")} ${open === 1 ? "is" : "are"} not current${runs}`;
  if (tier.stopWaitMs === undefined) {
    return `; ${files}; this repository does not require ${them} before you finish; ${slowWaitText(command, open)}`;
  }
  return (
    `; ${files}, which this wait does not hold for: ` +
    `\`${command} run --slow --wait 60000\` runs and waits for ${them}`
  );
}

/** A named-files wait that ended with a snapshot. */
export type EndedNamed = Extract<NamedWait, { result: StatusSnapshot }>;

/** How many selected test files the line names before "and N more". */
const NAMED_FILES_SHOWN = 10;

/**
 * Spec 005 D2: the verdict on the selected test files as D1 words a
 * checkpoint's, printed last (issue 26) after the line naming them
 * (`selectedLine`), then the worktree's known failures and outstanding work.
 * A timeout counts the pending files by what holds them (011 C15,
 * `reasonGroups`). A path that selects nothing says D2's text, alone when no
 * path selects a file, else beside the verdict on the files the others
 * select, which it leaves without a clean one (row 011-63). The slow
 * files left for a pause are named after the verdict, or are the reason for
 * none when they are all it selected (task 004-78, `pauseText`). A snapshot
 * (`status <path>...` without `--wait`, row 011-28) names no deadline and no
 * time, and names its revision once.
 */
export function namedLine(wait: EndedNamed, command = "squeal"): string {
  const { verdict, selection } = wait;
  const result = namedResult(wait);
  const snapshot = wait.snapshot === true;
  const after = `after ${(wait.waitedMs / 1_000).toFixed(1)} s`;
  const none = (why: string) => `Named test files have no verdict: ${why}`;
  // A snapshot's reason that names no revision of its own (005 D2 as amended 2026-10-20).
  const noneAt = (why: string) =>
    snapshot
      ? `Named test files have no verdict at revision ${verdict.revision}: ${why}`
      : none(why);
  // Row 011-63 (gh-59): the paths that select nothing, beside the verdict on what the others
  // select; row 011-206 (gh-83): and those that name a test file Squeal does not run.
  const paths = pathsText(selection);
  let beside = wait.outcome === "unmatched" || paths === "" ? "" : `; ${paths}`;
  let line: string;
  switch (wait.outcome) {
    case "unmatched":
      line = `No verdict: ${paths}`;
      break;
    case "focused":
      // Row 011-146 (C15): a focused answer, never the file's verdict.
      line =
        wait.focus === undefined
          ? none("no result yet")
          : focusedVerdictText(wait.focus, command, wait.selection.base);
      break;
    case "no-daemon": {
      const asOf = snapshot ? "" : `; results are as of revision ${verdict.revision}`;
      const start = wait.down === "handoff" ? "" : `; \`${command} start\` starts one`;
      line = noneAt(`${noDaemonText(wait.result.daemon, wait.down, command)}${asOf}${start}`);
      break;
    }
    case "slow":
      line = noneAt(`every selected test file is slow: ${pauseText(wait, command)}`);
      break;
    case "on-hold":
      // Row 011-73 (C6 as amended 2026-10-21): the hold is the verdict line.
      line =
        wait.hold === undefined
          ? none("the worktree is on hold")
          : holdVerdictLine(wait.hold, command);
      break;
    case "timeout": {
      const why = timeoutText(wait, result, command);
      line = none(snapshot ? why : `the deadline passed ${after}: ${why}`);
      break;
    }
    case "settled": {
      const why = verdictCode(verdict) === 3 ? noVerdictText(verdict) : null;
      // Row 011-27: what advances each group; the pending files left are those left for a pause.
      const groups = reasonGroups(
        wait.files.filter((f) => f.state !== "pending"),
        command,
        wait.selection.base,
      );
      const counted = `${failuresText(verdict.failures)}; ${plural(verdict.testFiles, "test file")}, each with a current result${snapshot ? "" : `, ${after}`}`;
      if (heldByPaths(result)) {
        // Row 011-63: with no failure among them, a path that selects nothing is why there is no
        // verdict; row 011-206 (gh-83): or one Squeal does not run, whose readers' verdict is apart.
        const which = result.reason === "not-run" ? "selected" : "the other paths select";
        line = none(
          `${paths}; the test files ${which} at revision ${verdict.revision}: ${counted}`,
        );
        beside = "";
      } else {
        line =
          why === null
            ? `Named test files at revision ${verdict.revision}: ${counted}`
            : none(groups === "" ? why : `${why}: ${groups}`);
      }
    }
  }
  const pause =
    (wait.leftForPause ?? []).length > 0 &&
    (wait.outcome === "settled" || wait.outcome === "timeout")
      ? `; ${pauseText(wait, command)}`
      : "";
  const live = wait.outcome === "no-daemon" ? "" : liveText(wait.result.daemon, wait.lapse);
  return `${line}${beside}${pause}${live}${worktreeText(wait.result)}`;
}

/**
 * Task 004-78 (research `atomic-flags-0215.md` 4, item 1): the selected slow
 * files a named wait left for a pause, by path, and what this repository's
 * `stop.requireSlowSuite` asks of them, read as the quiet line reads it
 * (`slowTierText`, 004-71): off, not required before the agent finishes; on,
 * `run --slow --wait` runs and waits for them. Off, it names that wait too
 * (row 004-83).
 */
function pauseText(wait: EndedNamed, command: string): string {
  const files = wait.leftForPause ?? [];
  const n = files.length;
  const shown = files.slice(0, NAMED_FILES_SHOWN).map(testFileText).join(", ");
  const more = n > NAMED_FILES_SHOWN ? ` and ${n - NAMED_FILES_SHOWN} more` : "";
  const them = n === 1 ? "it" : "them";
  const what =
    `${plural(n, "slow test file")} ${n === 1 ? "waits" : "wait"} for a pause or ` +
    `\`${command} run --slow\`, which this wait does not hold for: ${shown}${more}`;
  return wait.result.slowTier?.stopWaitMs === undefined
    ? `${what}; this repository does not require ${them} before you finish; ${slowWaitText(command, n)}`
    : `${what}; this repository requires ${them} before you finish: \`${command} run --slow --wait 60000\` runs and waits for ${them}`;
}

/** The test files a named wait selected, or `null` when its paths selected none. */
export function selectedLine(wait: EndedNamed): string | null {
  if (wait.outcome === "unmatched") return null;
  const files = wait.selection.files.map((f) => f.path);
  const shown = files.slice(0, NAMED_FILES_SHOWN).join(", ");
  const more =
    files.length > NAMED_FILES_SHOWN ? ` and ${files.length - NAMED_FILES_SHOWN} more` : "";
  return `Selected: ${shown}${more}`;
}

/** How `namedText` prints the worktree's status (row 011-28). */
export interface NamedTextOptions {
  /** `--full`: the worktree's status before the selection, as before row 011-28. */
  readonly full?: boolean;
  /** `--notes`: that status with every note in full (task 001-222). */
  readonly allNotes?: boolean;
  /** Row 011-146: `--check` texts, which the named wait sends as `focus` (011 C15). */
  readonly checks?: readonly string[];
}

/**
 * `status [--wait <ms>] <path>...`'s human text (005 D2 as amended
 * 2026-10-20, gh-44): the revision line, the selected files and their
 * failures in full, the class lines, then last their verdict (issue 26).
 * With `full`, the worktree's status in place of the revision line.
 */
export function namedText(
  wait: EndedNamed,
  now: EpochMs,
  command = "squeal",
  options: NamedTextOptions = {},
): string {
  const selected = selectedLine(wait);
  const refused = refusedLine(wait.focus);
  const lines = [
    ...(selected === null ? [] : [selected]),
    ...namedPathLines(wait.selection),
    ...namedFailures(wait.selection.files, wait.result.knownFailures),
    // Row 011-146 (C15): the focused block, before the classes it leaves pending.
    ...focusLines(wait.focus, wait.selection.base),
    ...namedClassLines(wait, command),
    namedLine(wait, command),
  ];
  const head =
    options.full === true
      ? `${formatStatus(wait.result, now, command, {
          full: true,
          allNotes: options.allNotes === true,
          ...(wait.selection.base === undefined ? {} : { base: wait.selection.base }),
        })}\n`
      : [`Revision: ${statusRevisionText(wait.result)}`, ...holdLines(wait.result.holds, command)]
          .map((line) => `${line}\n`)
          .join("");
  // Row 011-146 (C15): an older daemon's fallback is the first line.
  return `${refused === null ? "" : `${refused}\n`}${head}${lines.join("\n")}\n`;
}

/**
 * Task 011-12 (011 C15, issue 23): with no clean verdict, a line per class of
 * the selected files, each pending one with what holds it and each current
 * or stale one with its verdict; none once every file is current.
 */
export function namedClassLines(wait: EndedNamed, command = "squeal"): string[] {
  if (wait.outcome === "unmatched") return [];
  if (wait.outcome === "settled" && verdictCode(wait.verdict) !== 3) return [];
  return classLines(wait.files, command, wait.selection.base);
}

/**
 * Row 011-206 (011 C15): the clause of a read with no verdict by the reason
 * `namedResult` gives it: a lapsed heartbeat, the daemon's pass not stored
 * (`unsyncedText`), else the files still held by what holds them, or a
 * focused run with every file current.
 */
function timeoutText(wait: EndedNamed, result: SelectionResult, command: string): string {
  const { verdict } = wait;
  if (result.result === "none" && result.reason === "lapsed") {
    return `the daemon's heartbeat had lapsed at the last read; results are as of revision ${verdict.revision}`;
  }
  const unsynced = unsyncedText(wait.sync, verdict.revision, wait.snapshot === true);
  if (unsynced !== null) return unsynced;
  const paused = new Set((wait.leftForPause ?? []).map(testFileId));
  const holding = wait.files.filter((f) => !paused.has(testFileId(f.testFile)));
  const groups = reasonGroups(holding, command, wait.selection.base);
  const why = noVerdictText(verdict);
  return why === null ? "no result yet" : groups === "" ? why : `${why}: ${groups}`;
}

/**
 * Review wave-1, B1: why a named wait's deadline came before the revision
 * holding the edits made before it, or `null` when it did not; a snapshot's
 * sync, after its 750 ms (row 011-28), or one the daemon could not answer
 * (review of cand/0.1.233, B1).
 */
function unsyncedText(sync: SyncState, revision: number, snapshot: boolean): string | null {
  if (sync.state === "unsupported" && snapshot) {
    return `results are as of revision ${revision}; the daemon did not answer its sync, so they may not hold the latest edits`;
  }
  if (sync.state === "pending" && snapshot) {
    return `results are as of revision ${revision}; the daemon has not stored its pass over the latest edits`;
  }
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
 * on its socket for `WAIT_DOWN_MS` past the heartbeat's grace. Row 011-34:
 * a stopping daemon's handoff did not finish within its bound, and
 * `squeal start` finishes it.
 */
function noDaemonText(
  daemon: DaemonLiveness,
  down: DownReason | undefined,
  command: string,
): string {
  if (down === "handoff") {
    const to = daemon.stopping?.to === undefined ? "" : ` to ${daemon.stopping.to}`;
    return `the handoff${to} did not finish within ${Math.round(HANDOFF_BOUND_MS / 1_000)} s; \`${command} start\` finishes it`;
  }
  if (daemon.state === "alive" || daemon.since === null) return "no daemon is running";
  const since = `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
  if (down === "silent") {
    return `${since}: its heartbeat stopped and nothing listens on its socket`;
  }
  return down === "stopped" ? `${since}: the daemon stopped` : since;
}

/**
 * Row 011-34: a wait that ends while the daemon is stopping says so, in
 * place of a lapse, which the stopping daemon's stopped heartbeat is.
 */
function liveText(daemon: DaemonLiveness, lapse: HeartbeatLapse | undefined): string {
  if (daemon.stopping === undefined) return lapseText(lapse);
  return `; the daemon is ${stoppingState(daemon.stopping)}, so the wait went on`;
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

/**
 * Issue 26: a wait's verdict line ends with the worktree's known failures and
 * what is not current, as status's `Known failures` line says them (011 C6
 * as amended 2026-10-20, gh-45), so a `tail` keeps them.
 */
function worktreeText(snapshot: StatusSnapshot): string {
  // Current failures only, as the `Known failures` headline counts them (011 C6, 011-15).
  const current = splitByValidity(snapshot.knownFailures).current;
  return `. Worktree: known failures ${failureCountText(current.map((f) => f.check))}${notCurrentText(snapshot)}`;
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
