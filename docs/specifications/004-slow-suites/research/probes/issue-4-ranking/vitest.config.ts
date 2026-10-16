import { defineConfig } from "vitest/config";

// Throwaway: runs only the issue-4 probe, never part of Squeal's suite.
export default defineConfig({
  test: {
    include: ["probe.test.ts"],
    testTimeout: 1_800_000,
    hookTimeout: 120_000,
  },
});
