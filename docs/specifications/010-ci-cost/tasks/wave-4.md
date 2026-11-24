# Spec 010 Wave 4: CI matrix, balanced sharding, shared test builds, and slow test speedups

Approved by the human (2026-11-24, "Get it done") after measuring CI run `45484754351` (`cand/0.1.627`, 2,278 files, 8,229 s summed on Node 22, 9,103 s on Node 26, 23.4 min median wall, 131 job-min/push).

All five rows own disjoint files and run in parallel. None runs `pnpm run build` in its worktree (the coordinator builds and bumps `package.json` to `0.1.629` at integration). Do not touch `src/cli/wait/named.ts` or `test/harness/codex/cache-fixture.ts` (peer coordinator `0266d2c5` Wave 3).

---

## Row 010-35: CI Node matrix, duration-balanced sharding, caching, and `version-sensitive.txt` pruning

- **Shape**: slice
- **Outcome**: Cut CI push wall time from ~23 min to ~7–9 min and runner-minutes from ~131 to ~65–70 by moving Node 26 to version-sensitive on push + sharded nightly, expanding Node 22 to 6 duration-balanced shards, caching `uv` and `/tmp/squeal-e2e-cache`, and pruning non-version-sensitive heavy tests from `test/version-sensitive.txt`.
- **Read**: `docs/specifications/010-ci-cost/spec.md`, `.github/workflows/ci.yml`, `test/version-sensitive.txt`, `test/version-sensitive.test.ts`.
- **Owns**: `.github/workflows/ci.yml`, `scripts/ci-shard.mjs`, `ci/test-timings.json`, `test/ci-shard.test.ts`, `test/version-sensitive.txt`, `test/version-sensitive.test.ts`. Leave all other files alone.
- **Starting seam**:
  1. Write `ci/test-timings.json` (from the provided Node 22 CI timings map, files >= 2,000 ms) and `scripts/ci-shard.mjs` (Node ESM, zero external deps): discovers all `test/**/*.test.ts` and `src/**/*.test.ts` excluding `test/fixtures/**` (matching `vitest.config.ts`), accepts `--shard <i>/<n>`, `--exclude <path>` (repeatable), `--pin <path>:<shard>` (pin `test/keys/validity/compare.test.ts` to shard 1 so only shard 1 needs `fetch-depth: 0`), and `--print` (for testing) or invokes `pnpm exec vitest run <files...>` with LPT duration-balanced bin packing and longest-file-first ordering within each shard (unknown files assigned deterministically by sha1 hash at a default weight of 500 ms). Add unit tests in `test/ci-shard.test.ts` verifying complete disjoint partitioning, pinning, excludes, and balance.
  2. Update `.github/workflows/ci.yml`:
     - `node22`: 6 shards (`shard: [1, 2, 3, 4, 5, 6]`), run via `node scripts/ci-shard.mjs --shard ${{ matrix.shard }}/6 --pin test/keys/validity/compare.test.ts:1 --exclude test/harness/opencode-dispose.test.ts`; keep `fetch-depth: 0` on shard 1 only (`fetch-depth: ${{ matrix.shard == 1 && 0 || 1 }}`); run `opencode-dispose.test.ts` alone on shard 6; keep Build + bundle-drift checks on shard 1.
     - `node26`: run on push (`main`, `cand/**`), PR, and `workflow_dispatch` with `test/version-sensitive.txt` (matching `node24` without duplicating lint/typecheck/build).
     - `nightly`: run a matrix over `node-version: [24, 26]` × `shard: [1, 2, 3]` using `node scripts/ci-shard.mjs --shard ${{ matrix.shard }}/3 --pin test/keys/validity/compare.test.ts:1 --exclude test/harness/opencode-dispose.test.ts` (plus `opencode-dispose.test.ts` alone on shard 3, `fetch-depth: 0` on shard 1 only).
     - Caching across test jobs: set `enable-cache: true` on `astral-sh/setup-uv@v10.3.0`, and add `actions/cache@v4` for `/tmp/squeal-e2e-cache` keyed by `${{ runner.os }}-squeal-e2e-node-<ver>-${{ hashFiles('pnpm-lock.yaml', 'test/fixtures/e2e/node-test/packages/*/package.json') }}`.
  3. Prune heavy non-Node-version-sensitive tests from `test/version-sensitive.txt` by moving them into the `# Exempt:` section with concise reasons (e.g., `test/scheduler/backlog-slots-overhead.test.ts`, `test/e2e/spec-026-remote.test.ts`, `test/code/gate/collect-budget.test.ts`, `test/cli/warmup.test.ts`, `test/scheduler/edit-beside-backlog.test.ts`, `test/cli/code-gate-keep-kill.test.ts`, `test/scheduler/backlog-slots.test.ts`, `test/code/gate/collect-lanes.test.ts` — keep every test that actually checks Node-version-dependent behavior like `test/runners/node-test/`, `test/integration/node-test`, `test/e2e/node-test`, `test/code/crap/lazy`, `test/harness/opencode/bridge`, `test/e2e/shipped-plugin`, `test/e2e/pi-update`, `test/keys/environment`, `test/node-pin/`, `test/ci-action/`, `test/runners/vitest/observe-fidelity`, `test/kit/node-test`). Ensure `test/version-sensitive.test.ts` passes with zero stale or missing entries.
- **Done when**: `pnpm exec vitest run test/ci-shard.test.ts test/version-sensitive.test.ts`, `pnpm run lint`, `pnpm run typecheck` pass; `node scripts/ci-shard.mjs --shard 1/6 --print` through `6/6` partitions all repo test files cleanly with zero overlap and `compare.test.ts` in shard 1.
- **Role**: Use /worker.

---

## Row 010-36: Shared per-run test build cache and fast unit project in `vitest.config.ts`

- **Shape**: slice
- **Outcome**: Eliminate ~90 redundant full `tsrs`/`esbuild` builds per test run via a lazy per-run build cache that preserves stray-process attribution and Squeal input observation, and run pure unit tests in a faster Vitest project in `vitest.config.ts`.
- **Read**: `vitest.config.ts`, `test/global-teardown.ts`, `test/daemon/helpers.ts`, `test/daemon/strays.ts`, `test/e2e/spec-026-build.ts`, `test/helpers/build-inputs.ts`, `src/runners/vitest/adapter.ts` (lines 340–360).
- **Owns**: `vitest.config.ts`, `test/global-teardown.ts`, `test/global-teardown.test.ts`, `test/daemon/helpers.ts`, `test/daemon/strays.ts`, `test/daemon/strays.test.ts`, `test/e2e/spec-026-build.ts`, `test/helpers/build-inputs.ts`, `test/helpers/build-inputs.test.ts`. Leave all other files alone.
- **Starting seam**:
  1. **Shared per-run build cache** in `test/daemon/helpers.ts` (`buildCli`) and `test/e2e/spec-026-build.ts` (`buildPluginDist`):
     - Use the Vitest run directory (`runDirectory()` in `test/daemon/strays.ts`, injected by `test/global-teardown.ts` as `squealTestRun`). When running under a live Vitest `runDir` (not raw `TEST_CACHE`), build once into `<runDir>/_shared-cli/` (using a temp dir + atomic rename / lock so parallel workers never race) storing `dist/` and `inputs.json` (the list returned by `compileObserved`).
     - Each `buildCli()` call still creates its own `testBuildDir(expect.getState().testPath)` (so `ownerOf(runDir, args)` in `test/global-teardown.ts` continues to blame the exact test file that leaked a daemon!), links (hardlink with copy fallback) `dist/` from `_shared-cli/dist` into `dir/dist`, writes `package.json`, copies `OBSERVE_FILES` when `options.observe === true`, and calls `observeBuildInputs(cachedInputs)` so Squeal's recorder observes every compiled source file on every cache hit.
     - Do the same lazy once-per-runDir cache for `buildPluginDist()` in `test/e2e/spec-026-build.ts` (storing `_shared-plugin-dist/` in `runDir`, hardlinking/copying into `testBuildDir`, and calling `observeMetafile` / `observeBuildInputs` if applicable).
     - Add/update tests verifying cache reuse (second call skips `tsrs`), stray owner attribution still works, and `observeBuildInputs` is still called on cache hits.
  2. **Fast unit project in `vitest.config.ts`**:
     - Split `vitest.config.ts` into two Vitest `projects`:
       - `unit`: pure unit-test directories that never spawn daemons, never call `process.chdir`, and need no OS process fork per file (`test/status/**`, `test/delivery/**`, `test/policy/**`, `test/ps/**`, `test/presence/**`, `test/reach/**`, `test/capacity/**`, `test/retry/**`, `test/slow/**`, `test/state/**`, `test/revision/**`, `test/plugins/**`, `test/hash/**`, `test/fs/**`, `test/proof/**`, `test/core/**`, `test/run-evidence/**`, `test/shared/**`, `test/store/**`, `test/evals/**`, `test/*.test.ts`, `src/**/*.test.ts` — verify every included directory passes cleanly!). Configure `pool: "threads"` and `isolate: false` (or `isolate: true` if any file leaks shared module state; verify with `pnpm exec vitest run --project unit`!).
       - `isolated`: all remaining `test/**/*.test.ts` (excluding `test/fixtures/**` and the `unit` includes), keeping default `pool: "forks"` and `isolate: true` and `globalSetup: ["test/global-teardown.ts"]`.
     - Verify `define: { __SQUEAL_VERSION__: JSON.stringify(TEST_VERSION) }` and `globalSetup` apply cleanly to both projects, and verify `pnpm exec vitest run --project unit` AND targeted `isolated` files AND `pnpm exec vitest run --shard=1/6 test/status/slow-tier.test.ts` all pass.
- **Done when**: `pnpm exec vitest run --project unit`, `pnpm exec vitest run test/global-teardown.test.ts test/daemon/strays.test.ts test/helpers/build-inputs.test.ts test/daemon/child-env.test.ts test/e2e/spec-026-tiered.test.ts` (or a quick daemon test), `pnpm run lint`, and `pnpm run typecheck` pass.
- **Role**: Use /worker.

---

## Row 010-37: Fix slow daemon & CLI wait/timeout tests and deferred-runner quiet

- **Shape**: slice
- **Outcome**: Cut ~600+ s from the slowest daemon and CLI tests (`deferred-keying.test.ts` 261 s → < 20 s, `spec-026-tiered.test.ts` 98 s → < 20 s, `drain-wait.test.ts` 176 s → < 25 s, `status-at-now-daemon.test.ts` 100 s → < 15 s) while preserving all production defaults and fixing `status --wait` quiet under deferred-only runners.
- **Read**: `src/cli/wait/status.ts`, `src/cli/wait/listing.ts`, `src/core/daemon/lifecycle.ts`, `src/core/daemon/daemon.ts`, `src/cli/daemon.ts`, `src/cli/status-at-call.ts`, `test/daemon/deferred-keying.test.ts`, `test/e2e/spec-026-tiered.test.ts`, `test/daemon/drain-wait.test.ts`, `test/cli/status-at-now-daemon.test.ts`.
- **Owns**: `src/cli/wait/status.ts`, `src/cli/wait/listing.ts`, `src/core/daemon/lifecycle.ts`, `src/core/daemon/daemon.ts`, `src/cli/daemon.ts`, `src/cli/status-at-call.ts`, `src/cli/status-at.ts`, `test/daemon/deferred-keying.test.ts`, `test/e2e/spec-026-tiered.test.ts`, `test/daemon/drain-wait.test.ts`, `test/cli/status-at-now-daemon.test.ts`, `test/daemon/lifecycle.test.ts`, `test/daemon/departure.test.ts`, `test/daemon/drain.test.ts`, and any new unit tests in `test/cli/wait/` or `test/daemon/` for the new options/behavior.
- **Must leave alone**: `src/cli/wait/named.ts` (peer `0266d2c5`), `test/daemon/helpers.ts` (row 010-36), `test/e2e/spec-026-build.ts` (row 010-36), `test/harness/codex/cache-fixture.ts`. Do not run `pnpm run build`.
- **Starting seam**:
  1. **Deferred-runner quiet in `status --wait`** (`deferred-keying.test.ts` 261 s, `spec-026-tiered.test.ts` 98 s):
     - Inspect why `squeal status --wait 30000` times out for 30 s on every call when all Vitest groups are `at: "manual"`. Check `src/cli/wait/status.ts`, `src/cli/wait/listing.ts`, and `src/core/status/header.ts` (do not break existing `test/cli/wait/` or `test/status/` tests!). When a worktree has only deferred/manual runners (no runnable group pending, no runner actively listing), `status --wait` should settle on quiet once the daemon has synced the revision instead of burning 30 s waiting for a deferred runner that intentionally never starts.
     - Add an internal test env var override in `src/cli/daemon.ts` / `src/core/daemon/daemon.ts` for `SQUEAL_TEST_HOST_IDLE_MS` (positive integer ms, passed into `startDaemon({ hostIdleMs })`, ignored unless set) so `test/daemon/deferred-keying.test.ts` can verify host idle close in ~2–3 s instead of waiting 60 s (`hostIdleMinutes: 1`), and shorten its `delay(8_000)` to a tight verification (e.g. `2_000`) while keeping a unit test asserting `hostIdleMinutes` production scaling stays `minutes * 60_000`.
  2. **`drain-wait.test.ts` (176 s → < 25 s)**:
     - Allow overriding `DRAIN_SLOW_WAIT_MS` in `src/core/daemon/lifecycle.ts` (through `LifecycleTimings.drainSlowWaitMs` and internal test env `SQUEAL_TEST_DRAIN_SLOW_WAIT_MS` in `src/cli/daemon.ts` / `daemon.ts`), using the actual configured duration in the stop note (`${Math.round(drainSlowWaitMs / 1000)} s`, preserving exact `60 s` in production!).
     - Update `test/daemon/drain-wait.test.ts` to run with `SQUEAL_TEST_DRAIN_SLOW_WAIT_MS=4000` (and proportional 2 s / 1.5 s / 3 s holds) + add a unit assertion that `DRAIN_SLOW_WAIT_MS === 60_000`.
  3. **`status-at-now-daemon.test.ts` (100 s → < 15 s)**:
     - Allow optional `defaultWaitMs` in `StatusAtOptions` (`src/cli/status-at.ts` / `src/cli/status-at-call.ts`, defaulting to `RUN_WAIT_MS = 100_000`).
     - In `test/cli/status-at-now-daemon.test.ts`, assert `RUN_WAIT_MS === 100_000` explicitly, then pass `defaultWaitMs: 3_000` (with `waitMs` still omitted!) so the test proves the omitted-`waitMs` default path and deadline return in ~3 s instead of 100 s.
  4. **Check `daemon/lifecycle.test.ts`, `daemon/departure.test.ts`, `daemon/drain.test.ts`**: trim any redundant fixed sleeps where safe without loosening assertions.
- **Done when**: `pnpm exec vitest run test/daemon/deferred-keying.test.ts test/e2e/spec-026-tiered.test.ts test/daemon/drain-wait.test.ts test/cli/status-at-now-daemon.test.ts test/keys/key-format.test.ts` and affected `test/cli/wait/` + `test/daemon/` tests pass, each of those four files runs in under 25 s locally, and `pnpm run lint` + `pnpm run typecheck` pass.
- **Role**: Use /worker.

---

## Row 010-38: Speed up slow scheduler and code-gate tests

- **Shape**: slice
- **Outcome**: Cut ~350–450 s from the six slowest scheduler and code-gate test files while preserving every invariant and regression proof.
- **Read**: `test/scheduler/timed-out-tier.test.ts`, `test/scheduler/backlog-tiers.test.ts`, `test/scheduler/backlog-slots-overhead.test.ts`, `test/cli/code-gate-keep.test.ts`, `test/code/gate/collect-budget.test.ts`, `test/code/gate/collect-order.test.ts`.
- **Owns**: Those six test files only. Leave all `src/` and other test files alone.
- **Starting seam**:
  1. `test/scheduler/timed-out-tier.test.ts` (125 s → < 25 s): test the halving-down-to-one algorithm (including `oneWorker` where the hanging file runs first) using a fast injected/fake runner or smaller file count (`count = 4`, `timeoutMs = 10_000` for one real Vitest timeout proof, and an in-process fake runner with `timeoutMs = 50` for the multi-step halving chain!). Keep every assertion (completed files kept, hanging file isolated as `unknown` with `cause: "timeout"`, halving bound holds).
  2. `test/scheduler/backlog-tiers.test.ts` (130 s → < 35 s): reduce fixture size and rounds from 200 files × 8 runs to a size that still proves large-backlog batching vs `tierSize: 4` (e.g., 40–60 files, 1 paired round instead of 3 + cold, and `suite(40, 100)` for the cancel test, `suite(12, 200)` for the unrelated-edit test). Verify all assertions (`tiers.length <= 3`, `ratio < 2`, `told.length >= 5`, completed files preserved) stay rock-solid even on a loaded 4-vCPU CI runner.
  3. `test/scheduler/backlog-slots-overhead.test.ts` (86–126 s → < 25 s): reduce `FILES` from 300 to 60–80, `spinMs` from 50 to 25, and `ROUNDS` from 2 to 1 (or keep 2 rounds with 60 files) while keeping the exact commit-gathering assertion (`commits <= FILES * 0.6`) and CPU ratio bound (`<= 5.5x`, verify locally and leave generous CI headroom).
  4. `test/cli/code-gate-keep.test.ts` (95 s → < 30 s), `test/code/gate/collect-budget.test.ts` (60 s → < 22 s), `test/code/gate/collect-order.test.ts` (50 s → < 18 s): lower `BUDGET` from 25–30 s to 8–10 s (and in `collect-budget`'s fixture check if `patient.test.ts` sleeps 6 s — if so, check `test/code/gate/collect-fixture.ts` or adjust `BUDGET` safely above `patient`'s sleep, e.g., 10–12 s; do not break any sibling test sharing `collect-fixture.ts`!).
- **Done when**: `pnpm exec vitest run` on all six files passes cleanly and noticeably faster, plus `pnpm run lint` and `pnpm run typecheck` pass.
- **Role**: Use /worker.

---

## Row 010-39: Speed up slow E2E tests and cache pytest template venvs

- **Shape**: slice
- **Outcome**: Cut ~250–350 s from the slowest E2E test files (`e2e/pytest.test.ts`, `e2e/run-triggers.test.ts`, `e2e/policy.test.ts`, `e2e/lifecycle.test.ts`, `e2e/worktrees.test.ts`, `e2e/transitions.test.ts`) without dropping harness or Python-version coverage.
- **Read**: `test/e2e/pytest.test.ts`, `test/e2e/run-triggers.test.ts`, `test/e2e/policy.test.ts`, `test/e2e/lifecycle.test.ts`, `test/e2e/worktrees.test.ts`, `test/e2e/transitions.test.ts`, `test/e2e/install.ts`, `test/e2e/harness.ts`.
- **Owns**: Those eight files only. Leave `test/e2e/spec-026-build.ts` (row 010-36), `test/e2e/spec-026-tiered.test.ts` (row 010-37), and `test/version-sensitive.txt` (row 010-35) alone.
- **Starting seam**:
  1. `test/e2e/pytest.test.ts` (246–301 s → < 100 s) + `test/e2e/install.ts` + `test/e2e/harness.ts`:
     - Replace the full `PLUGINS (2) × PYTHONS (2)` Cartesian matrix (4 combos × 2 tests = 8 full runs) with pairwise coverage: `(claude-code, 3.10)`, `(claude-code, 3.13)`, `(codex, 3.13)` (covers both plugins, both Python versions, and both pytest 8 and pytest 9, cutting 25% immediately) — and consider combining the single-worktree edit/deny/stop checks or speeding up venv setup!
     - In `test/e2e/install.ts`: check whether copying a pre-synced venv cache in `/tmp/squeal-e2e-cache` works cleanly with `uv` / Python (note Python `.venv/bin/pytest` has hardcoded shebang paths unless relocated or `python -m pytest` is invoked — verify carefully before caching `.venv`! If shebangs break on copy, use `uv sync --locked --offline` after warming uv's wheel cache once in `beforeAll`!). Keep at least one real `uvSync(wt3)` call for the unsynced→synced worktree scenario.
  2. `test/e2e/run-triggers.test.ts` (157 s → < 45 s):
     - Lower `WAIT_MS` from `20_000` to `4_000` (so `LONG_DELAY_MS = 3 * WAIT_MS = 12_000`), lower `LINGER_MS` from `3_000` to `1_000`, and update the regex on line 182 from `after 20 s` to `after ${WAIT_MS / 1000} s`. Verify `stop.slowWaitMs` allows `4_000` cleanly under load.
  3. `test/e2e/policy.test.ts` (94 s), `test/e2e/lifecycle.test.ts` (59 s), `test/e2e/worktrees.test.ts` (33 s), `test/e2e/transitions.test.ts` (28 s):
     - Check whether any sleeps/polling intervals can be tightened or whether secondary plugins (`codex`, `antigravity`) can share fixtures or trim redundant slow-sleep iterations while keeping every spec-002 and spec-024 contract verified. Do not weaken any assertion or drop Antigravity/Codex hook coverage.
- **Done when**: `pnpm exec vitest run test/e2e/pytest.test.ts test/e2e/run-triggers.test.ts test/e2e/policy.test.ts test/e2e/lifecycle.test.ts test/e2e/worktrees.test.ts test/e2e/transitions.test.ts` passes cleanly and significantly faster, plus `pnpm run lint` and `pnpm run typecheck` pass.
- **Role**: Use /worker.
