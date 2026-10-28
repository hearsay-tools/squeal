import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["research/probes/issue-116/probe.test.ts"],
    maxWorkers: 1,
    testTimeout: 10000,
  },
});
