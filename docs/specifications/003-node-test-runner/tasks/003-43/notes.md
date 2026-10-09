# 003-43 worker notes: a run that observes a new preload path

Raised by 001 `reviews/wave-13i.md` B2. Status when written (2026-10-09): the node-test half and the probes are committed; the scheduler half (variant B below) is agreed with the 001 coordinator and waits for 001-187 to reach main.

## Why the scheduler

A node:test preload's computed load is an environment input (D5), known only after a run. The scheduler stores a tier's results under the key it selected before the run (`recordTier`), and the node:test adapter reports no growth, so a run that first loads such a path stores its result under a key that lacks it. Another worktree differing only in that file shares the key; with 001-170's heal, its pass healed the other worktree's own fail.

What does not work inside `src/runners/node-test/` alone:

- Dropping the files from `completedFiles`: they become `unknown` and fail their checkpoint (`Ledger.markUnknown` calls `checkpoints.failed`).
- Reporting the preload paths as per-file `RunReport.observed` (001-134's rule): the path enters each file's closure now and the environment after the next re-key, so every first observation costs one more run, and the shared core observed set duplicates the adapter's.

## Seam (variant B, the coordinators' choice)

- `RunReport.environmentObserved` (additive, `src/core/types/runner.ts`): per project, the environment files the run loaded, keyed or not. The node:test adapter fills it from `Observed.record`, which returns the preloads' observed-only paths. Committed in `7757d09`.
- `src/core/scheduler/environment-growth.ts` (new): `rekeyEnvironments(context, report, tier)`, under the lock in `Scheduler.#fly` before `prepareObserved`. A tier file grew when an observed path is missing from its `TierFile.inputs` (what it was keyed with), not from the environment the keys hold now: a refinement may re-read the environment during the run. The environments are read again only when the keys' current environment also lacks a path. Uses 001-187's `WorktreeKeys.environmentFiles`.
- `recordTier`: a grown file stores nothing, so no flaky note, heal or 001-171 re-run; after the loop `settle` applies the environment's key changes and `rerunGrown` re-queues each grown file at its new key, unless another worktree's result made it current. It counts `discards`; at `MAX_DISCARDS` (3) the file is `unknown`, the reason naming the paths. 001-168's barrier is unchanged: a withheld report completes no file.
- `TierObservations.environment` (additive, `scheduler/observed.ts`) carries the growth to `recordTier`; `composite-runner.ts` merges the field.

## Tests

- `test/scheduler/observed-growth.test.ts`: B2's gated ordering, and a key test (B runs, reopens, finds its own fail with no run; A keys differently). Both `it.fails` until the scheduler half lands (`1e8eb8a`). The skipped "after B started" case is re-enabled then. `preloadGrowth` asserts 4 or 6 runs: 6 when B's first run went under keys lacking the path (measured 20 of 20 on Node 24 and 22), 4 when the 003-26 timer re-keys B before its first tier.
- `test/scheduler/environment-growth.test.ts` (new): a preload loading a new helper in every process, counted outside the worktree, ends `unknown` after 3 runs.
- 001-187's `test/scheduler/preload-heal.test.ts:136` asserts the window itself (A runs under B's key); with this change the keys differ. The edit is proposed to the coordinator; the rest of that test holds.

## Measured

Variant B on 001-187's tip `29e8bd7`, in a scratch extract: applies cleanly; tsc and biome clean; `test/scheduler`, `test/runners/node-test`, `test/daemon` 602 passed, 3 failed: `graph-bundle` (no built dist in scratch), a departure timing test (passed alone), and `preload-heal.test.ts:136` above.

No adapter version raise: no stored key changes for a run that loaded nothing new.
