import { defineConfig } from "vitest/config";

// Throwaway probe for issue 91; runs only this folder.
export default defineConfig({
  test: { include: ["docs/specifications/011-core/research/probes/issue-91/*.probe.ts"] },
});
