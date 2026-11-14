import { defineConfig } from "vitest/config";

// Throwaway: runs only the group-wait-edits probe (row 011-332), never part of Squeal's suite.
export default defineConfig({
  test: {
    include: ["probe.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 600_000,
    // The repository's leftover-daemon check, as the daemon tests have it.
    globalSetup: ["../../../../../../test/global-teardown.ts"],
  },
});
