import { defineConfig } from "vitest/config";

// Throwaway probe config for issue 93: runs only this directory's probe.
export default defineConfig({
  test: {
    root: "../../../../../..",
    include: ["docs/specifications/002-codex-adapter/research/probes/issue-93/*.probe.ts"],
  },
});
