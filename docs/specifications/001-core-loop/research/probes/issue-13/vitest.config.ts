// Throwaway probe config for research/issue-13.md. Not product code.
// Run from the repository root:
//   npx vitest run --config docs/specifications/001-core-loop/research/probes/issue-13/vitest.config.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, "../../../../../.."),
    include: ["docs/specifications/001-core-loop/research/probes/issue-13/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
  },
});
