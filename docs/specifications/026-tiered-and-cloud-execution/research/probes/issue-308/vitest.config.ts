import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __SQUEAL_VERSION__: JSON.stringify("0.1.665") },
  test: {
    include: ["docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-308/ignored.test.ts"],
    maxWorkers: 1,
  },
});
