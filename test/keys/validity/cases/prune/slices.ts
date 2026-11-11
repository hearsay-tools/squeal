import type { Case } from "../../case.js";

/*
 * Row 021-09 (spec 021 D3): the prune runs as slices of one write
 * transaction each. Whether it runs at once (`Store.prune`) or slice by
 * slice, it keeps and removes what the last release's single pass did:
 * results under a live key or newest on main, a removed worktree's rows and
 * runs, expired checkpoints and checks no row names, then the size cap.
 */
export const PRUNE_SLICES: readonly Case[] = [
  {
    kind: "prune",
    name: "a removed worktree, expired results, runs and checkpoints, at 7 days",
    why: "021-09: a prune in slices keeps and removes what the single pass did, logs included",
    input: {
      worktrees: [
        { id: "main", root: "main", rows: 2 },
        { id: "linked", root: "live", rows: 2 },
        { id: "removed", root: "gone", rows: 3 },
      ],
      liveKeys: [{ worktree: "linked", key: "k-live" }],
      results: [
        { worktree: "removed", key: "k-removed-old", count: 300, daysAgo: 30, run: "r-removed" },
        { worktree: "removed", key: "k-removed-new", count: 2, daysAgo: 3, run: "r-removed-kept" },
        { worktree: "linked", key: "k-live", count: 2, daysAgo: 30, run: "r-live" },
        { worktree: "linked", key: "k-old", count: 300, daysAgo: 20, run: "r-old" },
        { worktree: "main", key: "k-main", count: 2, daysAgo: 30, run: "r-main" },
      ],
      runs: [
        { id: "r-removed", worktree: "removed", endedDaysAgo: 30, checkpoint: "cp-removed" },
        { id: "r-removed-kept", worktree: "removed", endedDaysAgo: 3 },
        { id: "r-live", worktree: "linked", endedDaysAgo: 30 },
        { id: "r-old", worktree: "linked", endedDaysAgo: 20, checkpoint: "cp-old" },
        { id: "r-main", worktree: "main", endedDaysAgo: 30 },
        { id: "r-running", worktree: "linked", endedDaysAgo: null },
        { id: "r-recent", worktree: "linked", endedDaysAgo: 1 },
      ],
      checkpoints: [
        { id: "cp-removed", worktree: "removed", completedDaysAgo: 30 },
        { id: "cp-old", worktree: "linked", completedDaysAgo: 20 },
        { id: "cp-new", worktree: "linked", completedDaysAgo: 1 },
      ],
    },
  },
  {
    kind: "prune",
    name: "the size cap evicts the unprotected results, then main's, never a live key's",
    why: "021-09: the cap's eviction in slices removes what the single pass did, tier by tier",
    input: {
      worktrees: [
        { id: "main", root: "main" },
        { id: "linked", root: "live", rows: 1 },
      ],
      liveKeys: [{ worktree: "linked", key: "k-live" }],
      results: [
        { worktree: "linked", key: "k-recent", count: 200, daysAgo: 1, run: "r-linked" },
        { worktree: "main", key: "k-main", count: 50, daysAgo: 1, run: "r-main" },
        { worktree: "linked", key: "k-live", count: 5, daysAgo: 1, run: "r-linked" },
      ],
      maxSizeMb: 0,
    },
  },
];
