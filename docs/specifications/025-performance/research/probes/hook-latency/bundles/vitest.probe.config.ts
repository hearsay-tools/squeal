// Throwaway probe config (row 025-14): runs only hook-runs.probe.ts.
import { defineConfig } from "vitest/config";
import { TEST_VERSION } from "../../../../../../../test/fixed-version.js";

export default defineConfig({
  root: new URL("../../../../../../../", import.meta.url).pathname,
  define: { __SQUEAL_VERSION__: JSON.stringify(TEST_VERSION) },
  test: {
    include: ["docs/specifications/025-performance/research/probes/hook-latency/bundles/hook-runs.probe.ts"],
    testTimeout: 3_600_000,
  },
});
