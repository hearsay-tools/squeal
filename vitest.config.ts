import { defineConfig } from "vitest/config";
import { TEST_VERSION } from "./test/fixed-version.js";

/*
 * Row 010-36: three projects. `unit` holds the folders whose test files
 * start no daemon and never change the working directory; each forked worker
 * keeps its modules from one file to the next (`isolate: false`), which cut
 * the CPU of these files by 40% (2,287 files: 434 here, 2026-11-24). Worker
 * threads were 4x slower there and break `process.cpuUsage` measurements, so
 * they stay forks. `unit-isolated` holds the files of those folders that
 * replace a module with `vi.mock`, which leaks into the next file without
 * isolation, and those that import a helper registering a hook when its
 * module is evaluated: a kept module registers it on the first file alone
 * (review 0.1.629 B3). Helpers defer cleanups to `test/unit-cleanup.ts`, the
 * `unit` setup file, instead; `test/unit-isolation.test.ts` holds both lists
 * to that. `isolated` holds every other test file, each in a fresh module graph.
 */
export const UNIT = [
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
export const MOCKED = [
  "test/delivery/sending-overlay-cost.test.ts",
  "test/presence/io.test.ts",
  "test/presence/reads.test.ts",
  "test/presence/registration-order.test.ts",
  "test/state/revision-commit.test.ts",
  "test/status/torn-read.test.ts",
];

/**
 * Files of `UNIT` that import a helper with a top-level `afterEach`,
 * `afterAll`, `beforeEach` or `beforeAll` (review 0.1.629 B3).
 */
export const HOOKED = [
  "test/delivery/hold-code-wait.test.ts",
  "test/evals/code-lines.test.ts",
  "test/evals/codex-runtime-hold.test.ts",
  "test/evals/lint-lines.test.ts",
  "test/plugins/codex/fast-path.test.ts",
  "test/presence/hook-stop.test.ts",
  "test/presence/marks-stopped.test.ts",
  "test/presence/marks.test.ts",
  "test/presence/news.test.ts",
  "test/presence/presence.test.ts",
  "test/presence/told.test.ts",
  "test/presence/wait.test.ts",
  "test/reach/command.test.ts",
  "test/reach/setup-chains.test.ts",
  "test/reach/stale.test.ts",
  "test/status/listing-failed.test.ts",
  "test/status/why-foreign-key.test.ts",
  "test/status/why-replaced.test.ts",
  "test/status/why-revert.test.ts",
  "test/store/import-graph-aliases.test.ts",
  "test/store/key-shadow.test.ts",
  "test/store/prune-keyed.test.ts",
  "test/store/prune-plans.test.ts",
  "test/store/prune-removed.test.ts",
];

export const EXCLUDE = ["test/fixtures/**", "node_modules/**"];

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
        test: {
          name: "unit",
          include: UNIT,
          exclude: [...EXCLUDE, ...MOCKED, ...HOOKED],
          isolate: false,
          // Review 0.1.629 B3: drains the helpers' cleanups after each test of every file.
          setupFiles: ["test/unit-cleanup.ts"],
        },
      },
      { extends: true, test: { name: "unit-isolated", include: [...MOCKED, ...HOOKED] } },
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
