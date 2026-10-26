import { durationText, plural, testFileText } from "../text.js";
import type {
  SlowPendingCounts,
  SlowTierActivity,
  SlowTierState,
  SlowTierWait,
  StatusHeader,
} from "../types/index.js";

/*
 * Spec 004 D8: the one slow-tier line delivered headers and `squeal status`
 * print when the repository declares slow files. Factual, as every header
 * line is (001 D6).
 */

const WAITING_FOR: Readonly<Record<SlowTierWait, string>> = {
  fast: "fast test files",
  idle: "the agent to pause",
  slot: "the slow slot another worktree's slow tier holds",
  load: "host load to drop",
};

/** Local `HH:MM`, as a human reads a clock. */
export function clockText(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `a`, `a and b`, `a, b and 2 more`: at most two names, as a line stays short. */
function filesText(paths: readonly string[]): string {
  const [a, b] = paths;
  if (paths.length === 1) return a ?? "";
  if (paths.length === 2) return `${a} and ${b}`;
  return `${a}, ${b} and ${paths.length - 2} more`;
}

/**
 * What the pending slow files are doing, from the daemon's published
 * activity: "last reported" when no daemon is validating, since it may be
 * old news (the header's liveness sentence says why). Every running file
 * counts, an idle tier's several by name or number (004-35).
 */
function pendingText(pending: number, activity: SlowTierActivity | null, late: boolean): string {
  if (activity === null) return `${pending} pending`;
  const reported = late ? "last reported " : "";
  if (activity.kind === "waiting") {
    return `${pending} pending, ${reported}waiting for ${WAITING_FOR[activity.for]}`;
  }
  const paths = activity.paths ?? [activity.path];
  const several = paths.length > 1;
  const since = clockText(activity.since);
  const last =
    activity.lastDurationMs === null
      ? "no earlier run"
      : `${several ? "longest " : ""}last run ${durationText(activity.lastDurationMs)}`;
  const what = several
    ? `${paths.length} slow files since ${since}: ${filesText(paths)}`
    : `${activity.path} since ${since}`;
  const running = `${reported}running ${what} (${last})`;
  return pending === paths.length ? running : `${pending} pending, ${running}`;
}

/** When the current slow files ran: a revision, or the range their runs spread over. */
function currentText(tier: SlowTierState): string {
  return tier.currentUpTo === undefined
    ? `current at revision ${tier.currentAt}`
    : `current at revisions ${tier.currentAt} to ${tier.currentUpTo}`;
}

/**
 * The slow-tier line, or `null` when the header has no slow tier. The
 * daemon's activity is the one the JSON carries, kept when no daemon is
 * validating (lessons defect 8c). It ends with what Squeal or Stop does
 * about the slow files (`stopText`), then the wait for those not current
 * (`slowWaitText`). `command` is how the text names the CLI.
 */
export function slowTierText(header: StatusHeader, command: string): string | null {
  const tier = header.slowTier;
  if (tier === undefined) return null;
  if (tier.testFiles === 0) return `Slow tier: no slow test files listed yet; ${stopText(tier)}.`;
  const parts: string[] = [];
  if (tier.current > 0) parts.push(`${tier.current} ${currentText(tier)}`);
  if (tier.pending > 0) {
    parts.push(pendingText(tier.pending, tier.activity, header.daemon?.state === "down"));
  }
  if (tier.notRun > 0) parts.push(`${tier.notRun} not run at revision ${header.revision}`);
  const open = tier.testFiles - tier.current;
  const runs = open <= 0 ? "" : `; ${slowWaitText(command, open)}`;
  return (
    `Slow tier: ${plural(tier.testFiles, "test file")}; ${parts.join("; ")}. ` +
    `${capitalized(stopText(tier))}${runs}.`
  );
}

/**
 * Spec 004 D8 as amended 2026-10-19 (row 004-83): every text that names
 * `open` slow files not current names the one wait for their results, under
 * both policies. `run --slow --wait` queues those not queued and joins a run
 * already going, so it reads as a wait, not as a second run.
 */
export function slowWaitText(command: string, open: number): string {
  return `\`${command} run --slow --wait 60000\` waits for ${open === 1 ? "its result" : "their results"}`;
}

/**
 * Row 004-83 (D8 as amended 2026-10-19): the `Affected checks` line names
 * the slow files among its running and queued work, a few by path and the
 * rest by count, and the wait for them; `""` with none pending.
 */
export function slowAffectedText(slow: SlowPendingCounts | undefined, command: string): string {
  const n = slow?.testFiles ?? 0;
  if (slow === undefined || n === 0) return "";
  const shown = (slow.files ?? []).map(testFileText);
  const rest = n - shown.length;
  const named =
    shown.length === 0
      ? ""
      : rest > 0
        ? ` ${shown.join(", ")} and ${rest} more`
        : ` ${listed(shown)}`;
  return `; among them ${plural(n, "slow test file")}${named === "" ? "" : `,${named}`}: ${slowWaitText(command, n)}`;
}

/** `a`, `a and b`, `a, b and c`. */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * What happens to the slow files: Squeal runs the queued ones after the fast
 * tests under `slow.trigger: "continuous"`, or once the agent pauses under
 * `"idle"` (`pausesOnly`; D2's trigger a, amended 2026-10-18, row 004-80;
 * the `idle` wait above; task 001-317). A file not run is not queued, and a
 * pause queues nothing (with `baseline.onStart: "lookup-only"` a miss stays
 * so), so the line claims no run for it: `run --slow` is what runs it
 * (review wave-13ax B1, task 001-323). With `stop.requireSlowSuite` on Stop
 * waits up to its bound, or, before the harness's waiting entry ran in the
 * worktree, holds the agent once (004 D9 as amended 2026-10-12).
 */
function stopText(tier: SlowTierState): string {
  if (tier.stopWaitMs !== undefined) {
    return `Stop waits up to ${durationText(tier.stopWaitMs)} for them or holds the agent once`;
  }
  const when = slowRunsWhen(tier);
  if (tier.notRun === 0) return `Squeal runs them ${when}`;
  if (tier.pending === 0) return "Squeal has not queued them";
  return `Squeal runs the pending ones ${when} and has not queued the rest`;
}

/** When Squeal runs queued slow files, by `slow.trigger` (D8 as amended 2026-10-18). */
export function slowRunsWhen(tier: Pick<SlowTierState, "pausesOnly">): string {
  return tier.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
