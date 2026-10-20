import { defineConfig } from "vitest/config";

// Throwaway probe config for gh-51: runs only this directory's probe, from the repository root.
export default defineConfig({
  root: new URL("../../../../../../", import.meta.url).pathname,
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-51/*.probe.ts"],
    maxWorkers: 1,
  },
});
