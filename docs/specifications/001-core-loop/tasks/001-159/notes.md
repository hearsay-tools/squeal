# 001-159: a touch no revision names discards every cached transform

2026-10-09, Vitest 5.0.3 on Vite 8.3.2, Node 24.21.0, Linux.

## Where the event was dropped

Not in the watcher. A revert and its restore inside one batch reach `reconcileBatch` (`src/core/scheduler/batch.ts`) as an ordinary candidate: its stat moved, so `diffCandidates` hashes it, finds the old hash, and records only a stat cache update. No `FileChange`, so no revision and no `runner.invalidate`. The stat cache update is the only trace, and it is the signal: a `set` update for a path with a cached entry whose stat differs from the update's, and no change for that path.

What does not count:

- A racy entry re-hashed on the stat it was hashed with (D3). Nothing wrote it, and every interval pass re-hashes the racy entries of the last edit: counting them would discard the instance 30 s after every edit.
- A path that appeared and went within the batch. Claude Code's Edit tool writes `<file>.tmp.<pid>.<random>` and renames it over the file; that temp path is new and gone in one batch. Counting it would discard on every agent edit.
- A path git ignores is never a candidate unless a closure names it (extra files): those count.

Which files: any candidate, so any file under the worktree that git does not ignore, plus the ignored ones a closure names. Not only closure or observed paths: B2's `@import`ed stylesheet is in no closure.

## The signal

- `InvalidatedPath.kind` gains `"touch"` (additive, `src/core/types/runner.ts`). The composite runner, the recovering runner and the slow-instance wrapper carry it as they carry the other kinds.
- `reconcileBatch` returns `{ applied, touched }`. With a revision, the touched paths ride its runner part (`queueRefine(..., touched)`, one `invalidate` call with the changes). Without one, `RunnerWork.queueTouched` queues a runner-only refinement, as `queueObserved` does. Tiers wait for it like for any runner work.
- Touch-only refinements queued and not started take later touches: `npm run build` rewrites the bundles over three batches; it costs one recreate, not three.
- `src/core/daemon/slow-instance.ts` (the 002/003/004 coordinator's, by agreement with the 001 coordinator, its own commit `ed9d1c2`): a touch reaches a live slow instance at once; the other kinds stay queued until its next run.

## The discard (`src/runners/vitest/adapter.ts`)

`invalidate` records the touched paths synchronously, before the Gate, so a run in flight hears them. A touch-only call returns at once with every current project as recreated. The next call of either lane replaces the instance (`#instance`'s stale rule): transforms and module graphs of every project and environment, the global setup, `#sources`, `#config`. The start that follows a touch passes Vite's inline `forceOptimizeDeps: true`, so the optimizer rebuilds its bundles from the disk; other starts reuse them.

A run whose instance heard a touch before the run ended (after `#instance` returned it) returns none of its files completed, with `vitest adapter: <paths> was written during this run and ended as it was; ... (task 001-159)` (`withoutTouched` in `moved.ts`). The scheduler records them unknown, as for 001-146.

Recreating, rather than invalidating in place, is the only way found to drop the global setup's state and the optimizer's in-memory metadata. Reporting the projects as recreated makes the refinement fetch every closure again, from the new instance: a closure fetched during the transient window (001-146's open item) is replaced too.

## Regressions

All under the real scheduler, store and adapter. Each plants transient bytes in the scheduler's own adapter during its first closure walk (`probeTouched`, `test/integration/touched-repo.ts`), restores the disk, then hands the scheduler the watch batch of the restore before its first tier. `warmOn` asserts the warm run passed, so a probe that planted nothing fails.

| Probe | Test | Without the discard |
|---|---|---|
| Virtual module whose declared input has its own transform (wave-13d B1), observe on/off | `touched-caches.test.ts` | stores both PASS current: fails |
| CSS `@import`, without and with `inputs: ["src/base.css"]` (wave-13d B2), observe on/off | `touched-caches.test.ts` | stores PASS current: fails |
| Optimizer through an alias (wave-13d S1), observe on/off | `touched-caches.test.ts` | stores PASS current: fails; also fails with the discard but no `forceOptimizeDeps` |
| One and two projects with config files of their own (wave-13 B2, wave-13b B2), query variant beside the plain module (wave-13c B1), the slow instance's own cache (wave-13c S1), observe on/off | `touched-stamped.test.ts` | pass: the per-module stamps catch these |
| A touch heard during a fast run and a slow run | `touched-in-flight.test.ts` | stores PASS current: fails; the slow one also fails without the slow-instance edit |
| Which batch paths are touches; coalescing | `test/scheduler/touched.test.ts` | the racy case fails if every equal re-hash counts |

Fresh-adapter controls: in `touched-caches.test.ts` for the new probes; the stamped probes' controls are in `project-config-stamps.test.ts` and `query-stamps.test.ts`, which pass unchanged.

The optimizer probe plants by removing the fixture's `node_modules/.vite` and recreating the instance (a config `change`) while the transient bytes are on disk: an instance builds the bundle when it starts, so a warm run alone on transient bytes reads the bundle of the bytes the instance started on.

## How often (the measurement)

A script ran the real change feed (`createChangeFeed`) over this worktree for this whole session, with an in-memory copy of the stat cache, and logged each batch's changed, touched-unchanged and transient paths (script kept outside the repository, not committed).

- This agent session (Claude Code Edit and Write, `sed -i`, Python rewrites, `biome check --write`, `cp` restores of counterfactual edits, `git commit`, `npm ci`, Vitest runs): FILLED_SESSION.
- Scripted operations in a scratch clone, each its own batch:

| Operation | Batches with a touch |
|---|---|
| Agent edit (temp file and rename, new bytes) | 0 (the temp file is transient) |
| `git checkout -- file` of an edited file | 0 (a change) |
| Editor atomic save, unchanged bytes | 1 |
| Editor in-place save, unchanged bytes | 1 |
| `vim :w`, unchanged | 1 |
| `touch` | 1 |
| `git status`, `git diff`, `tsc --noEmit` | 0 |
| `biome check --write`, `biome format --write` on formatted files | 0 (biome writes only what it changes) |
| `git checkout HEAD~5` and back | 1 (16 files) |
| `git stash push` and `pop` of an edit | 1 |
| commit, `git reset --hard HEAD~1`, `git reset --hard HEAD@{1}` | 1 |
| `npm run build` with nothing to change | 3 batches (31 bundle files), one recreate after coalescing |

So the discard follows deliberate round trips and builds, not edits.

Cost, measured on this repository (276 test files, a clone at this row's base) with the adapter alone: the refinement after a touch (environment, listing, every closure, on the new instance) took 1,981, 1,890 and 2,911 ms in three tries, against 340 ms for the same calls warm and 2,042 ms for a cold start (load average about 40 on 24 CPUs). The tier's runs after it transform cold once more for what the closures did not reach. Plus an optimizer rebuild where the optimizer is on (off by default in Vitest).

## Decisions the spec did not settle

- **A run that ended before the touch was heard is stored.** The brief covers a run in flight when the event arrives. A run that read transient bytes through a cache the stamps do not check and ended between the restore and the touch reaching the runner (the debounce plus reconciliation, under a second) is stored as it ran. Closing it needs the scheduler to hold a tier's recording until the watcher's batch covering the tier's end is reconciled, or to re-queue the files of tiers recorded within that window; both are beyond passing the signal.
- **Withheld files stay unknown until their key moves** (`Ledger.markUnknown`, as 001-146 left it). A touch during a backlog tier leaves its files unknown; re-queueing them would be better and is scheduler work.
- **A touch reports every project recreated**, so every closure is fetched again. Cheaper would be to recreate lazily and keep the closures; chosen because a closure fetched in the window may miss an import, and the event is rare.
- **The optimizer cache on disk outlives a daemon.** A bundle built on transient bytes by an instance that never heard the touch (a daemon that stopped first) is reused by the next daemon's first instance. Not covered; the next daemon's start has no touch to act on.
- `slow-instance.ts` is outside this row's files; changed by agreement (above).

## For the next worker

- `adapter.ts` is 455 lines; the touch state is two fields and a filter. `moved.ts` holds both report filters (`withoutFiles`, `withoutTouched`).
- The plugin bundles were not rebuilt (`test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` fail until the landing rebuilds them).
