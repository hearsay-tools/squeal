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
 * this worktree, its baseline run when it was the baseline, or a run in
 * another worktree at a commit when inherited. Replaces "baseline finding".
 * A baseline runs at start or, after a wait, at the install, so it names its
 * revision and not "at start" (task 001-107, review wave 11 N1).
 */
export function seenLine(entry: TransitionEntry, revision: number): string {
  const from = inheritedFrom(entry);
  const baseline = entry.baseline === true;
  const parts = [
    change(entry),
    from === null
      ? `seen by Squeal's ${baseline ? "baseline " : ""}run at revision ${entry.observedAt}`
      : `seen by Squeal's run in ${from}, inherited ${baseline ? "by the baseline " : ""}at revision ${entry.observedAt}`,
    validityText(entry, revision),
  ];
  return parts.filter((p) => p !== null).join(", ");
}

/**
 * Spec 004 D8: a slow failure's provenance, in place of `seenLine` and the
 * attribution line: the slow tier's run at a revision and the artifact that
 * run was declared to test, since a slow file tests a build output its
 * closure does not reach; "unknown" when its declaration was not recorded.
 */
export function slowSeenLine(entry: TransitionEntry, revision: number): string {
  const artifact = entry.slowArtifact;
  const from = inheritedFrom(entry);
  const parts = [
    change(entry),
    from === null
      ? `slow tier, Squeal's run saw it at revision ${entry.observedAt}`
      : `slow tier, Squeal's run in ${from} saw it, inherited at revision ${entry.observedAt}`,
    artifact === null
      ? "declared artifact unknown"
      : artifact === undefined || artifact.length === 0
        ? "against no declared artifact"
        : `against ${artifact.join(", ")} as of revision ${entry.observedAt}`,
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

/** What the attribution lines count: changes in the worktree, anyone's (review wave 10d, N1). */
const CHANGED_HERE = "files changed here since this session started";

/** Whether the failure's imports hold a file changed since registration; `null` when not known. */
export function touchesLine(entry: TransitionEntry): string | null {
  const paths = entry.changesInClosure;
  if (paths === undefined) return null;
  if (paths.length === 0) return `none of the ${CHANGED_HERE} are in its imports`;
  const more = paths.length - TOUCHED_SHOWN;
  const shown = paths.slice(0, TOUCHED_SHOWN).join(", ");
  return `touches ${CHANGED_HERE}: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
}

/** The load a timed-out test ran under; `null` for any other failure. */
export function loadLine(entry: TransitionEntry): string | null {
  return entry.loadAverage === undefined
    ? null
    : `load average ${entry.loadAverage.toFixed(2)} when it ran`;
}

/**
 * The header sentence about installed dependencies, with a leading space;
 * empty when none applies. One at most: a worktree with none installed is
 * never said to follow an install (task 001-94, review wave 10b S1).
 */
export function installSentences(header: StatusHeader): string {
  if (header.dependenciesInstalled === false) {
    return " No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.";
  }
  const lockfile = header.installedLockfile;
  return lockfile === undefined
    ? ""
    : ` These results follow a dependency install (${lockfile} changed).`;
}
