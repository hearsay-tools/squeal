import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Throwaway probe config (row 020-59): only this directory's probe.
export default defineConfig({
  root: resolve(import.meta.dirname, "../../../../../.."),
  test: {
    include: ["docs/specifications/020-quality-gate/tasks/wave-22-020-59/probe/*.probe.ts"],
    testTimeout: 3_600_000,
    fileParallelism: false,
  },
});
