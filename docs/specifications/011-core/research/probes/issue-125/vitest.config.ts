import { defineConfig } from "vitest/config";

// Throwaway probes. Normal repository config does not include this directory.
export default defineConfig({
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-125/*.probe.ts"],
    maxWorkers: 1,
    testTimeout: 15_000,
  },
});
