// Throwaway: runs only this folder's probe, with the repository's global teardown.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["docs/specifications/019-run-triggers/research/probes/stop-wait/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
  },
});
