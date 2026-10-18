import { plural } from "../text.js";
import type {
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

/** `12 s`, `1 min 12 s`. */
export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest === 0 ? "" : ` ${rest} s`}`;
}

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

/**
 * The declared artifacts by name when one, else by count: cezar declares 25
 * globs, and the line names them in `status --json` and `--notes` (001-413).
 */
function artifactText(artifact: readonly string[]): string {
  const [only] = artifact;
  return artifact.length === 1 && only !== undefined
    ? only
    : `${artifact.length} declared artifacts`;
}

/**
 * What the current slow files ran against: the artifact their runs were
 * declared to test, or "unknown" for those whose record is missing (review
 * wave 2, B2), never the declaration on disk today.
 */
function currentText(tier: SlowTierState): string {
  const unknown = tier.artifactUnknown ?? 0;
  const at =
    tier.currentUpTo === undefined
      ? `revision ${tier.currentAt}`
      : `revisions ${tier.currentAt} to ${tier.currentUpTo}`;
  if (unknown >= tier.current) return `current at ${at}, declared artifact unknown`;
  const against =
    tier.artifact.length === 0
      ? `current at ${at}, against no declared artifact`
      : `current against ${artifactText(tier.artifact)} as of ${at}`;
  return unknown === 0 ? against : `${against} (declared artifact unknown for ${unknown})`;
}

/**
 * Task 004-76 (`research/slow-tier-role.md` 5): with sources changed since
 * the declared artifact the current files ran against, that the change is
 * untested, never how to build (004-71's rule: no message names a build
 * command). Without a known artifact there is nothing the changes are not in.
 */
function untestedText(tier: SlowTierState): string {
  const unknown = tier.artifactUnknown ?? 0;
  if (tier.artifact.length === 0 || unknown >= tier.current) {
    return "these files have not tested the source changes since";
  }
  const it = tier.artifact.length === 1 ? "it" : "them";
  return `the source changes since are not in ${it}, so these files have not tested them`;
}

/**
 * The slow-tier line, or `null` when the header has no slow tier. The
 * daemon's activity is the one the JSON carries, kept when no daemon is
 * validating (lessons defect 8c). It ends with what Squeal or Stop does
 * about the slow files (`stopText`). `command` is how the text names the CLI.
 */
export function slowTierText(header: StatusHeader, command: string): string | null {
  const tier = header.slowTier;
  if (tier === undefined) return null;
  if (tier.testFiles === 0) return `Slow tier: no slow test files listed yet; ${stopText(tier)}.`;
  const parts: string[] = [];
  if (tier.current > 0) {
    const untested = tier.sourcesChangedSince ? `; ${untestedText(tier)}` : "";
    parts.push(`${tier.current} ${currentText(tier)}${untested}`);
  }
  if (tier.pending > 0) {
    parts.push(pendingText(tier.pending, tier.activity, header.daemon?.state === "down"));
  }
  const skip = skippedReason(tier);
  if (tier.notRun > 0) {
    const skipped = skip === null ? "" : `, skipped: ${skip}`;
    parts.push(`${tier.notRun} not run at revision ${header.revision}${skipped}`);
  }
  const runs =
    tier.current >= tier.testFiles
      ? ""
      : skip === null
        ? `; \`${command} run --slow\` runs them now`
        : `; the next revision or \`${command} run --slow\` checks it again`;
  return (
    `Slow tier: ${plural(tier.testFiles, "test file")}; ${parts.join("; ")}. ` +
    `${capitalized(stopText(tier))}${runs}.`
  );
}

/**
 * Spec 004 D8 as amended 2026-10-17 (task 004-65): why the slow files not run
 * were skipped, the precondition the daemon found unmet; `null` when none was.
 */
export function skippedReason(tier: SlowTierState | undefined): string | null {
  return tier?.skipped ?? null;
}

/**
 * What happens to the slow files: by default Squeal runs the queued ones
 * once the agent pauses (D2's idle trigger, the `idle` wait above; task
 * 001-317). A file not run is not queued, and a pause queues nothing (with
 * `baseline.onStart: "lookup-only"` a miss stays so), so the line claims no
 * run for it: `run --slow` is what runs it (review wave-13ax B1, task
 * 001-323). With `stop.requireSlowSuite` on Stop waits up to its bound, or,
 * before the harness's waiting entry ran in the worktree, holds the agent
 * once (004 D9 as amended 2026-10-12). A skipped tier runs once its
 * precondition holds; Stop does not wait for it (D8 as amended 2026-10-17).
 */
function stopText(tier: SlowTierState): string {
  if (skippedReason(tier) !== null) {
    return tier.stopWaitMs === undefined
      ? "Squeal runs them once the precondition holds"
      : "Squeal runs them once the precondition holds, and Stop holds the agent once naming it";
  }
  if (tier.stopWaitMs !== undefined) {
    return `Stop waits up to ${durationText(tier.stopWaitMs)} for them or holds the agent once`;
  }
  if (tier.notRun === 0) return "Squeal runs them when the agent pauses";
  if (tier.pending === 0) return "Squeal has not queued them";
  return "Squeal runs the pending ones when the agent pauses and has not queued the rest";
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
