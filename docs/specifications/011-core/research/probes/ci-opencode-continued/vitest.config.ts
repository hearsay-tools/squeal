import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["docs/specifications/011-core/research/probes/ci-opencode-continued/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
