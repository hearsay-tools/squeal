import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __SQUEAL_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-314/refusal.test.ts"],
    maxWorkers: 1,
    testTimeout: 15_000,
  },
});
