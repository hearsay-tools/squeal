// Throwaway probe config for research/wait-from-store.md (task 001-256).
// Run from the repository root:
//   npx vitest run --config docs/specifications/001-core-loop/research/probes/wait-from-store/vitest.config.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, "../../../../../.."),
    include: ["docs/specifications/001-core-loop/research/probes/wait-from-store/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
  },
});
