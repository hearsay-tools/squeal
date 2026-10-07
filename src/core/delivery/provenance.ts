import { isInstalledLockfile } from "../keys/index.js";
import type { StatusHeader, TransitionEntry } from "../types/index.js";

/*
 * Where a reported result came from (task 001-91, lessons defect 16): that
 * Squeal's own runner saw it and at which revision, whether the agent's
 * changes reach a failure, the load a timeout ran under, and whether the
 * results follow an install or a worktree with none.
 */

const upper = (outcome: string) => outcome.toUpperCase();

/** Changed paths a failure names before the rest is counted, as the header does. */
const TOUCHED_SHOWN = 3;

export function change(entry: TransitionEntry): string {
  switch (entry.kind) {
    case "first-seen-fail":
      return entry.from === null ? "first observed: FAIL" : `${upper(entry.from)} -> FAIL`;
    case "fail-changed":
      return "FAIL -> FAIL, failure changed";
    default:
      return `${entry.from === null ? "NONE" : upper(entry.from)} -> ${upper(entry.to)}`;
  }
}

function inheritedFrom(entry: TransitionEntry): string | null {
  if (entry.origin.kind !== "inherited") return null;
  const commit =
    entry.origin.commit === null ? "no commit" : `commit ${entry.origin.commit.slice(0, 12)}`;
  return `${entry.originRoot ?? `worktree ${entry.origin.worktreeId}`} at ${commit}`;
}

function validityText(entry: TransitionEntry, revision: number): string | null {
  if (entry.validity === "pending") return `revision ${revision} pending`;
  return entry.validity === "stale" ? "stale" : null;
}

/**
 * The change and who saw it, for a failure: Squeal's run at a revision of
 * this worktree, at start when it was the baseline, or in another worktree
 * at a commit when inherited. Replaces "baseline finding".
 */
export function seenLine(entry: TransitionEntry, revision: number): string {
  const from = inheritedFrom(entry);
  const parts = [
    change(entry),
    from === null
      ? `seen by Squeal's run at revision ${entry.observedAt}`
      : `seen by Squeal's run in ${from}, inherited at revision ${entry.observedAt}`,
    entry.baseline === true ? "at start (baseline)" : null,
    validityText(entry, revision),
  ];
  return parts.filter((p) => p !== null).join(", ");
}

/** Provenance of a recovery that is not own and current; `null` when it is. */
export function recoveryProvenance(entry: TransitionEntry, revision: number): string | null {
  const parts: string[] = [];
  if (entry.validity === "stale") parts.push(`stale, observed at revision ${entry.observedAt}`);
  if (entry.validity === "pending") {
    parts.push(`observed at revision ${entry.observedAt}, revision ${revision} pending`);
  }
  const from = inheritedFrom(entry);
  if (from !== null) parts.push(`inherited from ${from}`);
  return parts.length === 0 ? null : parts.join("; ");
}

/** Whether the failure's imports hold a file changed since registration; `null` when not known. */
export function touchesLine(entry: TransitionEntry): string | null {
  const paths = entry.changesInClosure;
  if (paths === undefined) return null;
  if (paths.length === 0) return "none of your changes are in its imports";
  const more = paths.length - TOUCHED_SHOWN;
  const shown = paths.slice(0, TOUCHED_SHOWN).join(", ");
  return `touches your changes: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
}

/** The load a timed-out test ran under; `null` for any other failure. */
export function loadLine(entry: TransitionEntry): string | null {
  return entry.loadAverage === undefined
    ? null
    : `load average ${entry.loadAverage.toFixed(2)} when it ran`;
}

/** Header sentences about installed dependencies, each with a leading space; empty when none applies. */
export function installSentences(header: StatusHeader): string {
  const none =
    header.dependenciesInstalled === false
      ? " No dependencies are installed in this worktree; failures that cannot find a package are expected until an install."
      : "";
  const lockfile = header.changedPaths?.find(isInstalledLockfile);
  const install =
    lockfile === undefined
      ? ""
      : ` These results follow a dependency install (${lockfile} changed).`;
  return `${none}${install}`;
}
