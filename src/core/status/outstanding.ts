import { readPolicy } from "../daemon/policy.js";
import { testFileId } from "../keys/index.js";
import { runnerPartBoundMs } from "../scheduler/runner-work-bound.js";
import { slowView } from "../scheduler/slow.js";
import type {
  AbsolutePath,
  CheckpointInProgress,
  DaemonLiveness,
  EpochMs,
  LoadNow,
  OutstandingGroup,
  OutstandingStanding,
  PendingRetries,
  Store,
  TestFileRef,
  WorktreeId,
} from "../types/index.js";
import { standingsOf, type WorktreeReads } from "./standing.js";
import { groupId, widest } from "./standing-groups.js";

/*
 * Row 011-29 (011 C6 as amended 2026-10-20; `tasks/011-24/design.md` 1.1 and
 * section 3): the work that keeps the worktree's test files from being
 * current, as groups of files that read alike, each with where they stand,
 * so status names what advances each group (`nextStep`) or that nothing
 * does. Built in the snapshot's read transaction from the rows it read.
 */

/** What the snapshot read beyond `WorktreeReads` that the groups need. */
export interface OutstandingReads extends WorktreeReads {
  readonly daemon: DaemonLiveness;
  readonly pendingRetries?: PendingRetries;
  readonly checkpoint?: CheckpointInProgress;
}

/** Groups in the order status prints them: what holds everything, then what an agent can run. */
const ORDER: readonly OutstandingStanding["kind"][] = [
  "no-daemon",
  "listing",
  "unlisted",
  "checkpoint",
  "retry",
  "no-install",
  "setup-failed",
  "runner",
  "timed-out",
  "no-result",
  "stale",
  "never-run",
  "claim",
  "running",
  "queued",
  "slow",
];

/**
 * The worktree's outstanding work. With no daemon validating, one group
 * says so and nothing else does: no file advances until one starts, and a
 * retry waits in the store for it. While the daemon has not listed the
 * test files, one group says that. Otherwise every test file not current
 * is in one group, a file with a pending retry in the retry's, and the
 * slow files the `Slow tier:` line counts are left out, except a running
 * one whose project has a global setup (gh-46).
 */
export function outstandingOf(
  store: Store,
  worktreeId: WorktreeId,
  root: AbsolutePath,
  reads: OutstandingReads,
  now: EpochMs,
  load: () => LoadNow,
): readonly OutstandingGroup[] {
  const { daemon, header } = reads;
  if (daemon.state !== "alive") {
    const since = daemon.since;
    return [{ standing: { kind: "no-daemon", since, revision: header.revision }, files: [] }];
  }
  if (header.testFilesListed === false) return [{ standing: { kind: "listing" }, files: [] }];
  const policy = readPolicy(root);
  const slow = slowView(policy);
  const retries = retryStandings(reads.pendingRetries, worktreeId);
  const refs = reads.keys
    .map((row) => row.testFile)
    .sort((a, b) => testFileId(a).localeCompare(testFileId(b)));
  const files = standingsOf(store, worktreeId, root, daemon, now, load, reads)(refs);
  const groups = new Map<string, { standing: OutstandingStanding; files: TestFileRef[] }>();
  const add = (standing: OutstandingStanding, ref: TestFileRef | null) => {
    const id = groupId(standing);
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, { standing, files: ref === null ? [] : [ref] });
      return;
    }
    if (ref !== null) group.files.push(ref);
    group.standing = widest(group.standing, standing);
  };
  for (const file of files) {
    const retry = retries.get(testFileId(file.testFile));
    if (retry !== undefined) {
      add(retry, file.testFile);
      continue;
    }
    const standing = file.state === "current" ? undefined : (file.standing ?? file.pending);
    if (standing === undefined) continue;
    const held = standing.kind === "running" && standing.setup !== undefined;
    if (slow.isSlow(file.testFile) && !held) continue;
    add(standing, file.testFile);
  }
  // The revision's own line, unless a group of its queued files already says it (row 011-57).
  const said = [...groups.values()].some((g) => g.standing.kind === "unlisted");
  if (header.runnerPartPending === true && !said) add(unlisted(header, policy), null);
  if (reads.checkpoint !== undefined && !reads.checkpoint.owed) {
    add({ kind: "checkpoint" }, null);
  }
  return [...groups.values()].sort(
    (a, b) => ORDER.indexOf(a.standing.kind) - ORDER.indexOf(b.standing.kind),
  );
}

function unlisted(
  header: WorktreeReads["header"],
  policy: ReturnType<typeof readPolicy>,
): OutstandingStanding {
  return {
    kind: "unlisted",
    revision: header.revision,
    callBoundMs: runnerPartBoundMs(policy.runner.timeoutMs),
  };
}

/** Each pending retry's standing (C5), by `testFileId`: each is at a listed file's current key. */
function retryStandings(
  pending: PendingRetries | undefined,
  worktreeId: WorktreeId,
): ReadonlyMap<string, OutstandingStanding> {
  const retries = new Map<string, OutstandingStanding>();
  for (const r of pending?.retries ?? []) {
    retries.set(testFileId(r.testFile), {
      kind: "retry",
      reason: r.reason,
      noResult: r.noResult === true,
      runningSince: r.runningSince ?? null,
      elsewhere: r.claimedBy !== null && r.claimedBy !== worktreeId,
    });
  }
  return retries;
}
