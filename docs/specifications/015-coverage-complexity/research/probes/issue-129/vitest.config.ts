import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["docs/specifications/015-coverage-complexity/research/probes/issue-129/probe.test.ts"],
    maxWorkers: 1,
  },
});
