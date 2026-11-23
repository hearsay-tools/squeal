import { durationText, plural } from "../text.js";
import type { GroupTierState, SlowTierWait, StatusHeader } from "../types/status.js";
import {
  capitalized,
  currentText,
  type LaneWords,
  pendingText,
  sharedWaitText,
} from "./slow-text.js";

/*
 * Spec 019 D6 (row 019-16): a line per configured test group that is not
 * all current, by the group's name, as the slow-tier line words the default
 * `slow` group (004 D8): its files by class, what the daemon does about the
 * pending ones, when Squeal runs them, whether Stop waits, and the command
 * that runs the group now. For example: `e2e: 12 test files; 12 pending,
 * waiting for the agent to pause. Squeal runs them when the agent pauses,
 * and Stop waits up to 2 min for them; `squeal run e2e --wait 60000` runs
 * them now and waits for their results.` A `manual` group's files wait for
 * `squeal run <group>` (row 019-47).
 */

/**
 * The line of each group in `header.groupTiers` that is not all current, in `checks` order;
 * with `only`, of the groups it names (a change delivery's changed groups).
 */
export function groupTierLines(
  header: StatusHeader,
  command: string,
  only?: readonly string[],
): string[] {
  const late = header.daemon?.state === "down";
  return (header.groupTiers ?? []).flatMap((group) => {
    if (only !== undefined && !only.includes(group.name)) return [];
    const line = groupTierText(group, header.revision, late, command);
    return line === null ? [] : [line];
  });
}

/** One group's line; `null` while every listed file of it is current, or none is listed. */
export function groupTierText(
  group: GroupTierState,
  revision: number,
  late: boolean,
  command: string,
): string | null {
  const open = group.testFiles - group.current;
  if (open <= 0) return null;
  const parts: string[] = [];
  if (group.current > 0) parts.push(`${group.current} ${currentText(group)}`);
  if (group.pending > 0) parts.push(groupPendingText(group, late, command));
  if (group.notRun > 0) parts.push(`${group.notRun} not run at revision ${revision}`);
  return (
    `${group.name}: ${plural(group.testFiles, "test file")}; ${parts.join("; ")}. ` +
    `${capitalized(groupDoes(group))}; ${groupRunText(group, command, open)}.`
  );
}

/**
 * The pending files' words. A `commit` group's queued files wait for a
 * commit, or for `squeal run <group>` (019-10 decision 7), a `manual`
 * group's for `squeal run <group>` alone (row 019-47), and the daemon
 * publishes no wait for them: the line says what they wait for.
 */
function groupPendingText(group: GroupTierState, late: boolean, command: string): string {
  const held = group.at === "commit" || group.at === "manual";
  if (group.activity !== null || !held)
    return pendingText(group.pending, group.activity, late, groupWords(group));
  const asked = requestedOf(group);
  const waiting = group.pending - asked;
  const parts: string[] = [];
  // Row 023-67 (X2): files a request queued run now; only the rest wait.
  if (asked > 0) parts.push(`${asked} queued by a request (${requestsText(group, command)})`);
  if (waiting > 0) {
    const what = group.at === "commit" ? "a commit" : `\`${command} run ${group.name}\``;
    parts.push(`${waiting} pending${outsideText(group, waiting)}, waiting for ${what}`);
  }
  return parts.join(", ");
}

/**
 * Row 023-79 (dogfood round 10, Z3): ` (a.e2e.ts)`, the pending files no
 * request queued, when the state names them all (1 to 3); else nothing.
 */
function outsideText(group: GroupTierState, waiting: number): string {
  const paths = group.pendingOutside ?? [];
  return paths.length === waiting ? ` (${paths.join(", ")})` : "";
}

/** Row 023-67 (X2): of the group's pending files, those a request queued. */
export function requestedOf(group: GroupTierState): number {
  return Math.min(group.pending, group.requested ?? 0);
}

/** The requests that queue a held group's files: `squeal status --at <commit> --run` and a narrow run. */
function requestsText(group: GroupTierState, command: string): string {
  return `\`${command} status --at <commit> --run\` or \`${command} run ${group.name} <path>...\``;
}

/**
 * A group's waits in its own words. The daemon publishes `fast` for a
 * lane waiting for any group it follows (019-10 decision 10): the line
 * names the groups of its `after`.
 */
function groupWords(group: GroupTierState): LaneWords {
  const waitingFor = (wait: SlowTierWait): string => {
    if (wait === "fast") return followedGroupsText(group.after);
    if (wait === "slot") {
      return `capacity (whether the ${group.name} group's slot or the shared worker pool holds it is not known)`;
    }
    return sharedWaitText(wait);
  };
  return { waitingFor, files: `${group.name} files` };
}

/**
 * What a lane waiting for the groups it follows waits for (019-10 decision
 * 10), as its line and a retry's wait (row 019-27) say it: `an earlier
 * group` when it has no `after`.
 */
export function followedGroupsText(after: readonly string[]): string {
  return after.length === 0 ? "an earlier group" : afterText(after);
}

/** `the unit group's files`, `the tests and unit groups' files`. */
function afterText(names: readonly string[]): string {
  if (names.length === 1) return `the ${names[0]} group's files`;
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)} groups' files`;
}

/** When Squeal runs the group's files (D1 moments), and whether Stop waits for them (D4). */
function groupDoes(group: GroupTierState): string {
  const when = groupWhenText(group);
  const asked = requestedOf(group);
  const runs =
    asked > 0
      ? requestedDoes(group, asked, when)
      : group.notRun === 0
        ? `Squeal runs them ${when}`
        : group.pending === 0
          ? "Squeal has not queued them"
          : `Squeal runs the pending ones ${when} and has not queued the rest`;
  const stop =
    group.stopWaitMs === undefined
      ? ""
      : `, and Stop waits up to ${durationText(group.stopWaitMs)} for them`;
  return `${runs}${stop}`;
}

/** Row 023-67 (X2): what Squeal does with a held group's requested files, and with the rest. */
function requestedDoes(group: GroupTierState, asked: number, when: string): string {
  const now = asked === group.pending ? "runs them now" : "runs the requested ones now";
  const rest = group.pending - asked;
  if (rest === 0 && group.notRun === 0) return `Squeal ${now}`;
  if (rest === 0) return `Squeal ${now} and has not queued the rest`;
  const queued = `the other pending ones ${when}`;
  return group.notRun === 0
    ? `Squeal ${now}, ${queued}`
    : `Squeal ${now}, ${queued}, and has not queued the rest`;
}

/** When Squeal runs the group's queued files, by its moment and `after` (D1); `status --wait` says it too. */
export function groupWhenText(group: GroupTierState): string {
  const following = group.after.length === 0 ? "" : ` and after ${afterText(group.after)}`;
  switch (group.at) {
    case "edit": {
      const quiet =
        group.quietMs > 0 ? ` once no edit came for ${durationText(group.quietMs)}` : "";
      return `after each edit${quiet}${following}`;
    }
    case "pause":
    case "stop":
      return `when the agent pauses${following}`;
    case "commit":
      return "at each commit";
    case "manual":
      return "only on request";
  }
}

/**
 * `squeal run <group> --wait 60000` (D6): it runs the group whatever its
 * moment and waits for the results. While the files wait for a moment, the
 * line says it runs them now; at `edit` it is the wait for their results,
 * as `run --slow --wait` is named for slow files (004-83).
 */
export function groupRunText(group: GroupTierState, command: string, open: number): string {
  const one = open === 1;
  const results = one ? "its result" : "their results";
  // Row 023-67 (X2): a held group whose every open file a request queued runs already.
  const requested = group.notRun === 0 && requestedOf(group) === group.pending;
  const waiting =
    !requested && (group.at !== "edit" || group.notRun > 0 || group.activity?.kind === "waiting");
  const does = waiting
    ? `runs ${one ? "it" : "them"} now and waits for ${results}`
    : `waits for ${results}`;
  return `\`${command} run ${group.name} --wait 60000\` ${does}`;
}
