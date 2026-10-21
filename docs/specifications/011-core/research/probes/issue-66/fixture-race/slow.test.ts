import { test } from "vitest";
// Same bytes in both worktrees; sleeps past the tier timeout only in worktree a.
test("slow only in worktree a", async () => {
  if (import.meta.url.includes("/a/slow.test.ts")) await new Promise((r) => setTimeout(r, 6000));
}, 20000);
