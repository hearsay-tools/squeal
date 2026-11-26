import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-283/probe.test.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
