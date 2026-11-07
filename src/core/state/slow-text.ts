import { durationText, plural, testFileText } from "../text.js";
import type { SlowSlotHolders } from "../types/standing.js";
import type {
  SlowPendingCounts,
  SlowTierActivity,
  SlowTierState,
  SlowTierWait,
  StatusHeader,
} from "../types/status.js";

/*
 * Spec 004 D8: the one slow-tier line delivered headers and `squeal status`
 * print when the repository declares slow files. Factual, as every header
 * line is (001 D6).
 */

/*
 * Row 011-291: the tier publishes `pool` when the shared worker pool refuses
 * a permit and `slot` when the slow slot is taken. A daemon before it
 * published `slot` for both (row 011-282), so `slot`'s words still name
 * capacity, as `holdText` does (review 0.1.382 B1), unless status records who
 * holds the slot (`SLOT_HELD`).
 */
const WAITING_FOR: Readonly<Record<SlowTierWait, string>> = {
  fast: "fast test files",
  idle: "the agent to pause",
  slot: "capacity (whether the slow slot or the shared worker pool holds it is not known)",
  pool: "the shared worker pool",
  load: "host load to drop",
};

/** Row 011-58's words, while live holders in other worktrees hold every permit of the slot. */
const SLOT_HELD = "the slow slot another worktree's slow tier holds";

/** Whether `slot` records live holders, none of them this worktree, of all its permits. */
function slotHeld(slot: SlowSlotHolders | undefined): boolean {
  if (slot === undefined) return false;
  const held = slot.holders.reduce((sum, h) => sum + h.permits, 0);
  return held >= slot.permits && slot.holders.every((h) => h.kind === "live" && h.self !== true);
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

/** How a lane's line words what its pending files wait for and run as (row 019-16). */
export interface LaneWords {
  /** What a published wait waits for: `fast test files`, `the agent to pause`. */
  readonly waitingFor: (wait: SlowTierWait) => string;
  /** Several of the lane's files running at once: `slow files`. */
  readonly files: string;
}

/** The slow-tier line's words: today's (004 D8), with the slot's holders when status read them. */
function slowWords(slot: SlowSlotHolders | undefined): LaneWords {
  return {
    waitingFor: (wait) => (wait === "slot" && slotHeld(slot) ? SLOT_HELD : WAITING_FOR[wait]),
    files: "slow files",
  };
}

/** A wait's words that name no lane: the agent's pause, the pool, the load (row 019-16). */
export function sharedWaitText(wait: Exclude<SlowTierWait, "fast" | "slot">): string {
  return WAITING_FOR[wait];
}

/**
 * What a lane's pending files are doing, from the daemon's published
 * activity: "last reported" when no daemon is validating, since it may be
 * old news (the header's liveness sentence says why). Every running file
 * counts, an idle tier's several by name or number (004-35).
 */
export function pendingText(
  pending: number,
  activity: SlowTierActivity | null,
  late: boolean,
  words: LaneWords,
): string {
  if (activity === null) return `${pending} pending`;
  const reported = late ? "last reported " : "";
  if (activity.kind === "waiting") {
    return `${pending} pending, ${reported}waiting for ${words.waitingFor(activity.for)}`;
  }
  const paths = activity.paths ?? [activity.path];
  const several = paths.length > 1;
  const since = clockText(activity.since);
  const last =
    activity.lastDurationMs === null
      ? "no earlier run"
      : `${several ? "longest " : ""}last run ${durationText(activity.lastDurationMs)}`;
  const what = several
    ? `${paths.length} ${words.files} since ${since}: ${filesText(paths)}`
    : `${activity.path} since ${since}`;
  const running = `${reported}running ${what} (${last})`;
  return pending === paths.length ? running : `${pending} pending, ${running}`;
}

/** When the current files of a lane ran: a revision, or the range their runs spread over. */
export function currentText(tier: Pick<SlowTierState, "currentAt" | "currentUpTo">): string {
  return tier.currentUpTo === undefined
    ? `current at revision ${tier.currentAt}`
    : `current at revisions ${tier.currentAt} to ${tier.currentUpTo}`;
}

/**
 * The slow-tier line, or `null` when the header has no slow tier. The
 * daemon's activity is the one the JSON carries, kept when no daemon is
 * validating (lessons defect 8c). It ends with what Squeal or Stop does
 * about the slow files (`stopText`), then the wait for those not current
 * (`slowWaitText`). `command` is how the text names the CLI. Status passes
 * the slot's holders it read (row 011-58); a header has none.
 */
export function slowTierText(
  header: StatusHeader & { readonly slowSlot?: SlowSlotHolders },
  command: string,
): string | null {
  const tier = header.slowTier;
  if (tier === undefined) return null;
  if (tier.testFiles === 0) return `Slow tier: no slow test files listed yet; ${stopText(tier)}.`;
  const parts: string[] = [];
  if (tier.current > 0) parts.push(`${tier.current} ${currentText(tier)}`);
  if (tier.pending > 0) {
    const late = header.daemon?.state === "down";
    parts.push(pendingText(tier.pending, tier.activity, late, slowWords(header.slowSlot)));
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
 * worktree, holds the agent (004 D9 as amended 2026-10-12): once, or up to
 * `stop.maxHolds` times in a turn (019 D4 step 3, row 019-24).
 */
function stopText(tier: SlowTierState): string {
  if (tier.stopWaitMs !== undefined) {
    return `Stop waits up to ${durationText(tier.stopWaitMs)} for them or holds the agent ${holdsText(tier.maxHolds)}`;
  }
  const when = slowRunsWhen(tier);
  if (tier.notRun === 0) return `Squeal runs them ${when}`;
  if (tier.pending === 0) return "Squeal has not queued them";
  return `Squeal runs the pending ones ${when} and has not queued the rest`;
}

/**
 * How many times Stop may hold the agent in one turn, `stop.maxHolds` (spec
 * 019 D4 step 3): `once` at the default 1, as the texts said before the key
 * (row 019-24), else `up to N times in a turn`.
 */
export function holdsText(maxHolds: number | undefined): string {
  return maxHolds === undefined || maxHolds <= 1 ? "once" : `up to ${maxHolds} times in a turn`;
}

/** When Squeal runs queued slow files, by `slow.trigger` (D8 as amended 2026-10-18). */
export function slowRunsWhen(tier: Pick<SlowTierState, "pausesOnly">): string {
  return tier.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
