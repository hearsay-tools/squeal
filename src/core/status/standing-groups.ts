import type { OutstandingStanding } from "../types/index.js";

/*
 * Row 011-27: files that read alike share a group, the named class lines'
 * and, row 011-29, status's `Outstanding:` block.
 */

/** The group a standing reads in: files with one id print as one line. */
export function groupId(s: OutstandingStanding): string {
  switch (s.kind) {
    case "running":
      return `running ${s.lane} ${(s.files ?? 1) > 1} ${s.setup?.file ?? ""}`;
    case "queued":
      return `queued ${s.lane} ${s.behind === null} ${s.promoted === true}`;
    case "claim":
      return `claim ${s.worktree}`;
    case "stale":
      return `stale ${s.verdict} ${s.lookupOnly}`;
    case "timed-out":
    case "no-result":
    case "runner":
      return `${s.kind} ${s.reason}`;
    case "retry":
      return `retry ${s.reason} ${s.noResult} ${s.runningSince} ${s.elsewhere}`;
    default:
      return s.kind;
  }
}

/** Of two standings of one group, the earliest start or the latest bound. */
export function widest<S extends OutstandingStanding>(a: S, b: S): S {
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
