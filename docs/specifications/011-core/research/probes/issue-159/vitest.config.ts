import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    disableConsoleIntercept: true,
    include: ["docs/specifications/011-core/research/probes/issue-159/stop.test.ts"],
    maxWorkers: 1,
    testTimeout: 10_000,
  },
});
