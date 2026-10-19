import { testFileId } from "../core/keys/index.js";
import { testFileKeyOf } from "../core/state/index.js";
import { formatCheck, unknownFileText } from "../core/status/index.js";
import {
  type EpochMs,
  isSlowLane,
  SLOW_LANE_PREFIX,
  type StatusSnapshot,
  type TestFileRef,
} from "../core/types/index.js";
import type { NamedFile, NamedVerdict, PendingReason } from "./named-files.js";
import type { FileClass } from "./verdict.js";

/*
 * Task 011-12 (011 C15, issues 17 and 23): the text a named wait gives each
 * selected file. A line per class lists them, each pending file with what
 * holds it and each current or stale one with its verdict; the verdict line
 * counts the pending ones by reason, at most one clock time a group.
 */

/** How many files a class line names before "and N more". */
export const CLASS_FILES_SHOWN = 10;

const CLASSES: readonly [FileClass, string][] = [
  ["pending", "Pending"],
  ["current", "Current"],
  ["stale", "Stale"],
  ["unknown", "Unknown"],
];

/** `Pending (2): a: running since 12:00:03 in the vitest lane; b: queued`, one line per class there is. */
export function classLines(files: readonly NamedFile[], command: string): string[] {
  return CLASSES.flatMap(([state, label]) => {
    const of = files.filter((f) => f.state === state);
    if (of.length === 0) return [];
    const shown = of.slice(0, CLASS_FILES_SHOWN).map((f) => fileText(f, command));
    const more = of.length > CLASS_FILES_SHOWN ? `; and ${of.length - CLASS_FILES_SHOWN} more` : "";
    return [`${label} (${of.length}): ${shown.join("; ")}${more}`];
  });
}

function fileText(f: NamedFile, command: string): string {
  const name = pathText(f.testFile);
  if (f.pending !== undefined) return `${name}: ${reasonText(f.pending, command)}`;
  if (f.unknown !== undefined) return unknownFileText(f.unknown);
  if (f.verdict === undefined) return name;
  return f.state === "stale" ? `${name}: last ${f.verdict}` : `${name}: ${f.verdict}`;
}

/** As status names a file: the project, when there is one, leads the path. */
function pathText({ project, path }: TestFileRef): string {
  return project === "" ? path : `${project}: ${path}`;
}

/** One pending file's reason with its bound (011 C15's list). */
export function reasonText(reason: PendingReason, command: string): string {
  switch (reason.kind) {
    case "running":
      return `running${reason.since === null ? "" : ` since ${clock(reason.since)}`} in the ${laneText(reason.lane)} lane`;
    case "queued": {
      const promoted = reason.promoted === true;
      if (reason.behind === null) return promoted ? "queued, promoted" : "queued";
      const tier = `behind the ${laneText(reason.lane)} tier running since ${clock(reason.behind)}`;
      return promoted ? `queued, promoted, ${tier}` : `queued ${tier}`;
    }
    case "claim":
      return `waiting for ${reason.worktree}'s run of its key${reason.until === null ? "" : `, at most until ${clock(reason.until)}`}`;
    case "slow": {
      const when = reason.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
      return `slow, run ${when} or on \`${command} run --slow\``;
    }
    case "unlisted":
      return `revision ${reason.revision} not listed yet, because the runner part waits for the run in flight, each of its calls bounded at ${Math.ceil(reason.callBoundMs / 1_000)} s`;
  }
}

/** How many reason groups the verdict line names before the rest's count (task 011-13). */
export const REASON_GROUPS_SHOWN = 5;

/**
 * The pending files counted by reason, for the verdict line: `1 running in
 * the vitest lane since 12:00:03, 2 queued behind the vitest tier running
 * since 12:00:03`. A group gives one clock time, its earliest start or its
 * latest bound, and the line names `REASON_GROUPS_SHOWN` groups, then counts
 * the files of the rest, so it stays bounded however many files are selected
 * and however many worktrees hold them (review wave-1.11 S1). The class
 * lines and `wait.testFiles` still give every file's own reason.
 */
export function reasonGroups(files: readonly NamedFile[], command: string): string {
  const groups = new Map<string, { n: number; reason: PendingReason }>();
  for (const { pending } of files) {
    if (pending === undefined) continue;
    const id = groupId(pending);
    const group = groups.get(id);
    groups.set(id, {
      n: (group?.n ?? 0) + 1,
      reason: group === undefined ? pending : widest(group.reason, pending),
    });
  }
  const all = [...groups.values()];
  const shown = all
    .slice(0, REASON_GROUPS_SHOWN)
    .map(({ n, reason }) => `${n} ${reasonText(reason, command)}`);
  const rest = all.slice(REASON_GROUPS_SHOWN);
  if (rest.length === 0) return shown.join(", ");
  const more = rest.reduce((sum, { n }) => sum + n, 0);
  const others = rest.length === 1 ? "1 other reason" : `${rest.length} other reasons`;
  return [...shown, `and ${more} more for ${others}`].join(", ");
}

function groupId(reason: PendingReason): string {
  switch (reason.kind) {
    case "running":
      return `running ${reason.lane}`;
    case "queued":
      return `queued ${reason.lane} ${reason.behind === null} ${reason.promoted === true}`;
    case "claim":
      return `claim ${reason.worktree}`;
    default:
      return reason.kind;
  }
}

/** Of two reasons of one group, the earliest start or the latest bound. */
function widest(a: PendingReason, b: PendingReason): PendingReason {
  if (a.kind === "running" && b.kind === "running") {
    return a.since === null || (b.since !== null && b.since < a.since) ? b : a;
  }
  if (a.kind === "queued" && b.kind === "queued" && a.behind !== null && b.behind !== null) {
    return b.behind < a.behind ? b : a;
  }
  if (a.kind === "claim" && b.kind === "claim") {
    return a.until === null || (b.until !== null && b.until > a.until) ? b : a;
  }
  return a;
}

/** `vitest`, or `slow vitest` for a slow lane (004 D2). */
function laneText(lane: string): string {
  if (!isSlowLane(lane)) return lane;
  const runner = lane.slice(SLOW_LANE_PREFIX.length);
  return runner === "" ? "slow" : `slow ${runner}`;
}

/** Local `HH:MM:SS`, as a human reads a clock. */
function clock(at: EpochMs): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The selected files' known failures, each as status lists it (spec 005 D2: "in full"). */
export function namedFailures(
  files: readonly TestFileRef[],
  knownFailures: StatusSnapshot["knownFailures"],
): string[] {
  const ids = new Set(files.map(testFileId));
  return knownFailures
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
 * One selected file in `NamedWaitPayload.testFiles` (011 C15, issue 23): its
 * class, its verdict when it is `current` or `stale` (the last stored), and
 * for a `pending` or `unknown` one the reason the text gives.
 */
export interface NamedFileEntry extends TestFileRef {
  readonly state: FileClass;
  readonly verdict?: NamedVerdict;
  readonly reason?: string;
}

export function fileEntry(f: NamedFile, command: string): NamedFileEntry {
  const { project, path } = f.testFile;
  const reason =
    f.pending !== undefined
      ? reasonText(f.pending, command)
      : f.unknown !== undefined
        ? `${f.unknown.ran ? "ran, nothing recorded" : "no result"}: ${f.unknown.reason ?? "no reason was kept"}`
        : undefined;
  return {
    project,
    path,
    state: f.state,
    ...(f.verdict === undefined ? {} : { verdict: f.verdict }),
    ...(reason === undefined ? {} : { reason }),
  };
}
