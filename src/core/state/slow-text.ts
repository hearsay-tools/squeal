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

/**
 * What the pending slow files are doing, from the daemon's published
 * activity: "last reported" when no daemon is validating, since it may be
 * old news (the header's liveness sentence says why).
 */
function pendingText(pending: number, activity: SlowTierActivity | null, late: boolean): string {
  if (activity === null) return `${pending} pending`;
  const reported = late ? "last reported " : "";
  if (activity.kind === "waiting") {
    return `${pending} pending, ${reported}waiting for ${WAITING_FOR[activity.for]}`;
  }
  const last =
    activity.lastDurationMs === null
      ? "no earlier run"
      : `last run ${durationText(activity.lastDurationMs)}`;
  const running = `${reported}running ${activity.path} since ${clockText(activity.since)} (${last})`;
  return pending === 1 ? running : `${pending} pending, ${running}`;
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
      : `current against ${tier.artifact.join(", ")} as of ${at}`;
  return unknown === 0 ? against : `${against} (declared artifact unknown for ${unknown})`;
}

/**
 * The slow-tier line, or `null` when the header has no slow tier. The
 * daemon's activity is the one the JSON carries, kept when no daemon is
 * validating (lessons defect 8c). `command` is how the text names the CLI.
 */
export function slowTierText(header: StatusHeader, command: string): string | null {
  const tier = header.slowTier;
  if (tier === undefined) return null;
  if (tier.testFiles === 0) {
    return "Slow tier: no slow test files listed yet; not covered by Stop's wait.";
  }
  const parts: string[] = [];
  if (tier.current > 0) {
    parts.push(
      `${tier.current} ${currentText(tier)}${tier.sourcesChangedSince ? ", sources changed since" : ""}`,
    );
  }
  if (tier.pending > 0) {
    parts.push(pendingText(tier.pending, tier.activity, header.daemon?.state === "down"));
  }
  if (tier.notRun > 0) parts.push(`${tier.notRun} not run at revision ${header.revision}`);
  const runs = tier.current < tier.testFiles ? `; \`${command} run --slow\` runs them now` : "";
  return (
    `Slow tier: ${plural(tier.testFiles, "test file")}; ${parts.join("; ")}. ` +
    `Not covered by Stop's wait${runs}.`
  );
}
