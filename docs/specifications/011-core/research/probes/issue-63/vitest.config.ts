import { defineConfig } from "vitest/config";

// Throwaway probe config for gh-63: runs only this directory's probe, from the repository root.
export default defineConfig({
  root: new URL("../../../../../../", import.meta.url).pathname,
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-63/*.probe.ts"],
    maxWorkers: 1,
  },
});
