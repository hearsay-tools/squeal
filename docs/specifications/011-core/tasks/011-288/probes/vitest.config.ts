import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["docs/specifications/011-core/tasks/011-288/probes/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
