import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["research/probes/issue-117/probe.test.ts"],
    maxWorkers: 1,
    hookTimeout: 60_000,
  },
});
