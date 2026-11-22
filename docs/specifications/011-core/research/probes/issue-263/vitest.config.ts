import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __SQUEAL_VERSION__: JSON.stringify("0.1.591") },
  cacheDir: "docs/specifications/011-core/research/probes/issue-263/.runtime/cache",
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-263/*.probe.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
