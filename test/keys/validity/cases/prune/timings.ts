import type { Case } from "../../case.js";

/*
 * Row 005-93: the late bound measures a worktree's start delay and overhead from its newest
 * completed edit runs (`RunRepo.recentTimings`), each with its files' durations from its own
 * results. After a prune: a run the prune dropped, a checkpoint's run, a running one and another
 * worktree's are not among them, and `limit` keeps the newest.
 */
export const PRUNE_TIMINGS: readonly Case[] = [
  {
    kind: "prune",
    name: "a worktree's newest completed edit runs after a prune, with their files' durations",
    why: "005-93: recentTimings reads only completed edit runs of the worktree, newest first, at most limit",
    input: {
      worktrees: [
        { id: "main", root: "main" },
        { id: "linked", root: "live", rows: 1 },
      ],
      liveKeys: [
        { worktree: "linked", key: "k-a" },
        { worktree: "linked", key: "k-b" },
        { worktree: "linked", key: "k-c" },
      ],
      results: [
        { worktree: "linked", key: "k-a", count: 3, daysAgo: 1, run: "r-new" },
        { worktree: "linked", key: "k-b", count: 2, daysAgo: 2, run: "r-mid" },
        { worktree: "linked", key: "k-c", count: 4, daysAgo: 3, run: "r-old" },
        { worktree: "main", key: "k-main", count: 1, daysAgo: 1, run: "r-main" },
      ],
      runs: [
        { id: "r-new", worktree: "linked", endedDaysAgo: 1 },
        { id: "r-mid", worktree: "linked", endedDaysAgo: 2 },
        { id: "r-old", worktree: "linked", endedDaysAgo: 3 },
        { id: "r-expired", worktree: "linked", endedDaysAgo: 20 },
        { id: "r-checkpoint", worktree: "linked", endedDaysAgo: 1, checkpoint: "cp" },
        { id: "r-running", worktree: "linked", endedDaysAgo: null },
        { id: "r-main", worktree: "main", endedDaysAgo: 1 },
      ],
      checkpoints: [{ id: "cp", worktree: "linked", completedDaysAgo: 1 }],
      timings: { worktree: "linked", limit: 2 },
    },
  },
];
