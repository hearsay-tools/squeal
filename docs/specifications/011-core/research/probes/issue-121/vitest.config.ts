import { defineConfig } from "vitest/config";

// Throwaway research only. The repository's normal config excludes this directory.
export default defineConfig({
  test: { include: ["docs/specifications/011-core/research/probes/issue-121/*.probe.ts"] },
});
