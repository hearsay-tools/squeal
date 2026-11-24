import { defineConfig } from "vitest/config";
import { TEST_VERSION } from "./test/fixed-version.js";

/*
 * Row 010-36: three projects. `unit` holds the folders whose test files
 * start no daemon and never change the working directory; each forked worker
 * keeps its modules from one file to the next (`isolate: false`), which cut
 * the CPU of these files by 40% (2,287 files: 434 here, 2026-11-24). Worker
 * threads were 4x slower there and break `process.cpuUsage` measurements, so
 * they stay forks. `mocked` holds the files of those folders that replace a
 * module with `vi.mock`, which leaks into the next file without isolation.
 * `isolated` holds every other test file, each in a fresh module graph.
 */
const UNIT = [
  "test/status/**/*.test.ts",
  "test/delivery/**/*.test.ts",
  "test/policy/**/*.test.ts",
  "test/ps/**/*.test.ts",
  "test/presence/**/*.test.ts",
  "test/reach/**/*.test.ts",
  "test/capacity/**/*.test.ts",
  "test/retry/**/*.test.ts",
  "test/slow/**/*.test.ts",
  "test/state/**/*.test.ts",
  "test/revision/**/*.test.ts",
  "test/plugins/**/*.test.ts",
  "test/hash/**/*.test.ts",
  "test/fs/**/*.test.ts",
  "test/proof/**/*.test.ts",
  "test/core/**/*.test.ts",
  "test/run-evidence/**/*.test.ts",
  "test/shared/**/*.test.ts",
  "test/store/**/*.test.ts",
  "test/evals/**/*.test.ts",
  "test/*.test.ts",
  "src/**/*.test.ts",
];

/** Files of `UNIT` that replace modules with `vi.mock`. */
const MOCKED = [
  "test/delivery/sending-overlay-cost.test.ts",
  "test/presence/io.test.ts",
  "test/presence/reads.test.ts",
  "test/presence/registration-order.test.ts",
  "test/state/revision-commit.test.ts",
  "test/status/torn-read.test.ts",
];

const EXCLUDE = ["test/fixtures/**", "node_modules/**"];

export default defineConfig({
  // Row 011-425: workers report a fixed version and read no `package.json` for it.
  define: { __SQUEAL_VERSION__: JSON.stringify(TEST_VERSION) },
  test: {
    exclude: EXCLUDE,
    // Fails the run when a daemon a test started outlives it (lessons, defect 29).
    // The root's runs once for the run; every project inherits what it provides.
    globalSetup: ["test/global-teardown.ts"],
    projects: [
      {
        extends: true,
        test: { name: "unit", include: UNIT, exclude: [...EXCLUDE, ...MOCKED], isolate: false },
      },
      { extends: true, test: { name: "mocked", include: MOCKED } },
      {
        extends: true,
        test: {
          name: "isolated",
          include: ["test/**/*.test.ts", "src/**/*.test.ts"],
          exclude: [...EXCLUDE, ...UNIT],
        },
      },
    ],
  },
});
