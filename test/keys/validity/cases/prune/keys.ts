import type { Case } from "../../case.js";

/*
 * Row 011-315 (spec 015 D8): the code store's prune asks the main store only
 * about the keys its coverage records hold (`ResultRepo.keysWithResults`)
 * instead of reading every key (`keysSince(0)`). After the main store's
 * prune, a key keeps a coverage record while it has a result: the answer
 * names the kept keys, each once, and no pruned or never stored key.
 */
export const PRUNE_KEYS: readonly Case[] = [
  {
    kind: "prune",
    name: "the keys with a result after a prune, asked as the code store's prune asks",
    why: "011-315: keysWithResults answers the keys keysSince(0) named, so the same coverage records stay",
    input: {
      worktrees: [
        { id: "main", root: "main" },
        { id: "linked", root: "live", rows: 1 },
        { id: "removed", root: "gone" },
      ],
      liveKeys: [{ worktree: "linked", key: "k-live" }],
      results: [
        { worktree: "removed", key: "k-removed", count: 2, daysAgo: 30, run: "r-removed" },
        { worktree: "linked", key: "k-old", count: 2, daysAgo: 20, run: "r-old" },
        { worktree: "linked", key: "k-live", count: 2, daysAgo: 30, run: "r-live" },
        { worktree: "linked", key: "k-recent", count: 1, daysAgo: 1, run: "r-recent" },
        { worktree: "main", key: "k-main", count: 1, daysAgo: 30, run: "r-main" },
      ],
      asked: ["k-recent", "k-removed", "k-never", "k-live", "k-old", "k-main", "k-recent"],
    },
  },
];
