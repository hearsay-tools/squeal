import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Throwaway probe config (issue #192): only this directory's probe.
export default defineConfig({
  root: resolve(import.meta.dirname, "../../../../../.."),
  test: {
    include: ["docs/specifications/020-quality-gate/research/probes/issue-192/*.probe.ts"],
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
