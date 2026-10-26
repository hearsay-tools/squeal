// Throwaway: runs only this probe, outside the repository's test include.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["docs/specifications/011-core/research/probes/source-path-selection/*.probe.ts"] },
});
