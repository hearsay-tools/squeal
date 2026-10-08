# 001-146: a stored result from a module older than the bytes its key names

2026-10-09, host of 24 CPUs at load 107 to 143, Vitest 5.0.3 on Vite 8.3.2.

## Cause

The Vitest instance kept a transform of `src/cli/run.ts` read while the rebase had the old file on disk, and nothing invalidated it after the restore. Keys and Vitest read the file at different moments: the key uses the hash the watcher computed at reconciliation (D2), while Vite reads the file whenever it first needs the transform: a worker's fetch during a tier, or `importClosure` during a refinement's `closure`/`affected`. Once cached, that transform is served until `invalidateFile` drops it.

The watcher did nothing wrong. A revert and its restore inside one debounced batch (100 ms quiet, 500 ms maximum) give the path the hash it already had, so reconciliation drops it and no revision names it. With no revision, the scheduler calls no `invalidate` for it, and the scheduler's stability check (`changedSince`) compares content hashes only, so it sees nothing either. A transform read in between keeps the reverted bytes for good. Two answers to the brief's questions:

- The watcher folds the revert and the restore into no change (by design, D2). The Vitest instance keeps the module it loaded during the revert.
- The key is computed from bytes read at a different moment than Vite's load. That is the gap.

In the incident (`reflog.txt`), the cherry-picks at 23:30:43 and 23:30:44 changed `run.ts`, so its revision invalidated it. At 23:30:51 `rebase (start): checkout origin/main` put the old `run.ts` back, and `rebase (pick) a0f426e` restored it within the same second. A refinement or tier in flight read `run.ts` lazily in that window. Run `acd5f2eb` four minutes later executed the old module (`unknown argument "--slow"`) under key `a84a304f3638`, which names the restored bytes. Which call read it, a worker fetch or an `importClosure` walk, cannot be told from the evidence. Both paths are reproduced below.

Ruled out by reading Vite 8.3.2 and Vitest 5.0.3: Vite's own guard (`timestamp > mod.lastInvalidationTimestamp`) drops a transform an invalidation overtook, and the forks pool's tmp copy (`tmpDir/sha1(id)`) is rewritten on each re-transform.

## Reproduction

- `test/runners/vitest/sources.test.ts`, deterministic, one adapter: run, `invalidate(src/mod.ts)`, write the old bytes, `closure()`, write the new bytes back, run. Without the fix the run reports `fail` (old module). Also for the `unit` project of a `projects` config. A test file that reverts, loads the module by a computed `import()` and restores it shows the in-run case: without the fix it completed with what it loaded.
- `test/integration/revert-restore.test.ts`, a real daemon from the sources. The reverting test file plants the transform. The test retries while the watcher splits the two writes into revisions (that proves nothing) and asserts that no revision named `src/mod.ts`. Then a new test file imports the module. Without the fix: the reverting run is stored `current pass`, and the new file is stored `FAIL expected 'old' to be 'new'` while a fresh `vitest run` of it exits 0. That is the incident's shape. With the fix, both match the disk.

## Fix

`src/runners/vitest/sources.ts`. A `pre` Vite plugin's `load` hook stamps each project file before Vite reads it (stat, then the bytes' sha1) and returns `null`, so Vite's load is unchanged. `invalidate()` and every `run()` first invalidate each cached file whose bytes no longer match its stamp. The check uses the stat-cache rule: hash only when the stat moved or is racy (`isRacy`, 2 s). After a run, a file read during that run whose bytes moved drops the test files that import it from `completedFiles` (all of the run's files when the module graph shows no importer: a computed `import()`). The scheduler then records them `unknown` with the reason, which names the path. A touch is hashed once and drops nothing.

`test/runners/vitest/structural.test.ts` "an unrelated add or delete leaves every other transform cached" used an unreported edit of `src/math.ts` as its probe. The new rule invalidates exactly that. The test now counts transforms through a fixture plugin, and it still fails when `invalidateStructural` falls back to invalidating everything.

## Not settled here

- `test/scheduler/runs.test.ts` "runs a file again when a batch during its crashed run gave it a new key" wrote the fix in `beforeRun`, before `adapter.run`, and relied on the cached crashing transform surviving that unreported edit. It is outside Owns. Commit `030361d` has the crashing test write its own fix before `SIGKILL`, with the same assertions. The coordinator is asked to agree; default: keep it. Other `beforeRun` edits in `test/scheduler/` still pass. The run now executes the edited bytes, and the stability check discards it as before.

- An `unknown` file is not queued again until its key moves (`Ledger.markUnknown`). The brief allows that. A re-run, like `discard`, would be better, but it is `src/core/scheduler/` (spec 004's).
- A closure fetched while such a window was open may name the reverted bytes' imports. The next `invalidate` drops the transform, but the scheduler keeps that closure until the file's key moves. Closing this needs `invalidate` to report the files it dropped (an additive `InvalidateResult` field) and the scheduler to re-fetch their importers' closures: scheduler work too.
- Not checked: files loaded without the plugin (Vitest's `fsModuleCache`, or a project whose Vite server lacks the root's overrides; the `projects` fixture has it). Also not checked: a write in the microseconds between the plugin's read and Vite's own read, within the stat granularity.
- Cost: one extra `lstat` and read per transform, and one `lstat` per cached project file at each `invalidate` and twice per `run`. Not measured beyond `structural-cost.test.ts` passing.
- `plugins/claude-code/dist` and the Codex bundles now differ from the build (`test/harness/plugin.test.ts`, `test/harness/codex/plugin.test.ts`). This row does not own them. The landing rebuilds them.
