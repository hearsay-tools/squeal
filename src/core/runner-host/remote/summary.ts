/*
 * Spec 026 D12.1 (row 026-20, lessons D2): the one line plain `squeal
 * status` prints for a worktree's remote, as `Remote: <line>`. The daemon
 * writes it as the note of `REMOTE_SUMMARY_TOPIC` each time a lane's state,
 * the machine or its disk changes; status reads the latest. It names the
 * provider and machine (the target until one is acquired), the state, the
 * lanes and runners, where planning runs, the environment mode, and the last
 * proof or the reason of a refusal, a loss or a degraded disk. An empty
 * note says the worktree has no remote lane any more.
 *
 * This module imports no runtime code, so status reads the topic with none
 * of the lane's dependencies.
 */

/** The note topic of the remote's one status line (D12.1). */
export const REMOTE_SUMMARY_TOPIC = "remote-lane:summary";

/** Where a remote stands, as D12.1 names it; `not connected` before a deferred lane's first run. */
export type RemoteState =
  | "awake"
  | "sleeping"
  | "connecting"
  | "not connected"
  | "degraded-disk"
  | "refused"
  | "unreachable"
  | "released";

/** One lane's state, as `RemoteLaneRunner.report` gives it. */
export interface LaneReport {
  readonly state: "ready" | "asleep" | "connecting" | "not connected" | "refused" | "unreachable";
  /** Why it is refused or unreachable. */
  readonly reason?: string;
  /** When its connection's first run was proven. */
  readonly provenAt?: number;
  /** Under `remote-key`, the remote machine its results are keyed to: `linux/x64, Node v26.13.0`. */
  readonly machine?: string;
}

export interface SummaryInput {
  readonly provider: string;
  /** The machine's id once acquired; else the lane's target, else `null`. */
  readonly machine: string | null;
  readonly lanes: readonly string[];
  readonly runners: readonly string[];
  readonly planning: "local" | "remote";
  readonly environmentMode: "match-local" | "remote-key";
  /** The runner's own lanes' states; a per-pass lane's are left out. */
  readonly reports: readonly LaneReport[];
  /** A degraded disk the lanes run on anyway (`onSlowDisk: "warn"`); `null`: none. */
  readonly degradedDisk: string | null;
  /** The daemon's exit released the machine. */
  readonly released: boolean;
}

/** The state and reason of the remote: the worst of its lanes, a refusal first. */
export function remoteState(input: SummaryInput): {
  readonly state: RemoteState;
  readonly reason?: string;
} {
  if (input.released) return { state: "released" };
  const { reports } = input;
  for (const state of ["refused", "unreachable"] as const) {
    const found = reports.find((r) => r.state === state);
    if (found !== undefined) return { state, ...reasonOf(found.reason) };
  }
  if (reports.some((r) => r.state === "connecting")) return { state: "connecting" };
  if (reports.some((r) => r.state === "ready")) {
    return input.degradedDisk === null
      ? { state: "awake" }
      : { state: "degraded-disk", reason: input.degradedDisk };
  }
  if (reports.length > 0 && reports.every((r) => r.state === "asleep"))
    return { state: "sleeping" };
  return { state: "not connected" };
}

/**
 * `command cmd:lan-1: awake; background and edit runs of vitest, node-test;
 * planning remote; environment match-local; proven at <ISO time>`.
 */
export function remoteSummaryLine(input: SummaryInput): string {
  const { state, reason } = remoteState(input);
  const who = input.machine === null ? input.provider : `${input.provider} ${input.machine}`;
  const keyed = input.reports.find((r) => r.machine !== undefined)?.machine;
  const proven = input.reports.flatMap((r) => (r.provenAt === undefined ? [] : [r.provenAt]));
  const last = state === "awake" || state === "degraded-disk" ? Math.max(...proven) : null;
  return [
    `${who}: ${state}${reason === undefined ? "" : ` (${reason})`}`,
    `${listText(input.lanes)} runs of ${input.runners.join(", ")}`,
    `planning ${input.planning}`,
    `environment ${input.environmentMode}${keyed === undefined ? "" : ` (${keyed})`}`,
    ...(last === null || !Number.isFinite(last)
      ? []
      : [`proven at ${new Date(last).toISOString()}`]),
  ].join("; ");
}

function reasonOf(reason: string | undefined): { reason?: string } {
  return reason === undefined || reason === "" ? {} : { reason };
}

/** `a, b and c`. */
function listText(parts: readonly string[]): string {
  return parts.length < 2
    ? parts.join("")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
