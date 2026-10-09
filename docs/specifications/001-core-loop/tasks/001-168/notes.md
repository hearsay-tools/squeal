# 001-168: no result recorded while a touch could be pending; the optimizer rebuilt at every start; no own-write exemption

2026-10-09, Vitest 5.0.3 on Vite 8.3.2, Node 24.21.0, Linux. Repairs `reviews/wave-13e.md` B1 to B3.

## B1: the own-write exemption is gone

`VitestAdapter.run` withholds a run that heard a touch whoever wrote the path. `VitestObserver.take` returns the observed inputs only again; the recorder's written set is used only to keep written paths out of the observed inputs (`src/runners/observe/inputs.ts`), as before 001-159.

A fixture writer (a test that rewrites a worktree file with the bytes it holds) is `unknown` with the reason whenever its touch is heard during its run, observed or not (`touched-in-flight.test.ts`, the liveness assertions retired). The skill's `references/reports.md` names the remedy: write outside the worktree or under an ignored path no `inputs` entry names. The brief also named "declare the file"; that does not help under this rule, since a declared file is in the key and the barrier (B2) counts its touch, so the reference says so instead.

## B2: the completion barrier

`changedSince` (`src/core/scheduler/stability.ts`) returns the touched paths beside the changed ones: a path whose stat moved since the snapshot and whose bytes hash as before. `touchedUnchanged` moved there from `batch.ts`, one rule for a batch and for the barrier. In `#fly`, after the run and before recording:

- the tier's inputs (`stabilityPaths`: the assembled closure, so declared inputs and observed paths, plus environment files and lockfile) are diffed against the tier's selection snapshot, and the observed growth paths against the live cache (`prepareObserved`);
- any touch makes `withheldForTouch` drop every completed file, so `recordTier` marks the tier's files `unknown` with `squeal: <paths> was written while this run was in flight and ended as it was; ... (task 001-168)`;
- the touched paths join the paths reconciled after recording, so the runner hears them before its next run.

The route chosen is the stat pass, not a flushed change feed: the feed lives in the daemon, outside this row. "If a touch can still arrive after recording": not for a path any key names. A covered path whose stat at the barrier equals its snapshot stat was not written between selection and the barrier, so a later touch of it was written after the run ended. No retirement of shared rows or forced re-run was needed, and none is implemented. A path no key names (an undeclared `@import`ed stylesheet) is outside the barrier, as a real edit of it is outside the key; only a touch the runner hears during the run withholds for it (B1's CSS regression).

**The cost of the rule**: a touch reconciled after selection withholds the run even when the runner heard it before the run began. The scheduler cannot see when the adapter took its instance, and the brief and the human chose "withhold on any touch over a run's interval". In practice a tier is never selected with runner work pending, so this needs a batch landing in the moment between selection and the adapter's start. A probe that restores a file after selection and sends no batch at all (the stamp probes of 001-151, 001-154, 001-157) is now withheld rather than stored as the stamps left it; those probes now assert the honest unknown with the barrier's reason (`withheldByBarrier`, `stamps-repo.ts`). The touch probes of 001-159 (`probeTouched`) now queue the restore's batch on the scheduler's lock during the first closure walk, so it is reconciled before the first tier is selected; they still assert current FAIL and still fail without the adapter's discard. The slow-instance touch probe (`touched-stamped.test.ts`) plants after selection by construction, so it asserts the withheld run.

Withheld files stay `unknown` until their key moves (no re-queue), as 001-159 left it: a re-queue would loop on a self-writer whose written path is in its own closure.

Not covered: a same-size rewrite within one tick of a coarse `mtime` and `ctime` (a filesystem with 1 s or 2 s stamps) does not move the stat, so the barrier cannot see it; ext4 and APFS have nanosecond stamps.

## B3: the optimizer at every start

`#start` always passes Vite's inline `forceOptimizeDeps: true`. Every start goes through it: fast and slow (the daemon builds both with `createVitestAdapter`), initial, replacement after a touch or recreate. `slow-instance.ts` needed no change.

## Regressions

| Probe | Test | Without the fix |
|---|---|---|
| B1: a held virtual test rewrites its declared input `src/mod.ts`, cached on transient bytes; observe on/off; fresh control | `touched-own-write.test.ts` | passes (the barrier withholds it too) |
| B1: a held CSS test rewrites `src/base.css`, which no closure names; observe on/off; fresh control | `touched-own-write.test.ts` | observe on stores PASS: fails |
| B2: virtual module cached on transient bytes, the tier ends before the restore's batch; the late batch, a `results.byKey` lookup, a second worktree on the same store; observe on/off; fresh control | `touched-late.test.ts` | stores PASS current, the lookup hits, and the second worktree inherits PASS: fails (the inheritance assertion fails alone too) |
| B3: optimizer bundle built on transient bytes, scheduler and adapter closed, the cache kept; a new adapter, then a restarted scheduler and a forced checkpoint, each from the stale cache; observe on/off; uncached control | `touched-restart.test.ts` | new adapter PASS, and alone the forced checkpoint stores PASS: fails |

Counterfactuals were run by hand (barrier passed no touches; the committed adapter of before B3; the written filter put back), then restored.

## Start cost (B3)

Script kept outside the repository (`start-cost.mjs` in the task's temp directory): per round, `createVitest("test", { root, watch: false, reporters: [], update: "none", includeTaskLocation: true, fsModuleCache: false }, force ? { forceOptimizeDeps: true } : {})`, `standalone()`, `globTestSpecifications()`, optionally `runTestSpecifications` of one file, then `close()`. One warm-up instance first; rounds alternate which setting goes first. 24 CPUs, load average 18 to 117 (other agents' gates), so single values swing 2x to 4x.

The cezar clone: `git clone --no-hardlinks /home/agent/projects/cezar /tmp/squeal-168-cezar` (at `c07b0bf`), `npm ci`, every command in a subshell `cd`'d into the clone with every `CEZ_*` variable unset; removed afterwards.

| Repository | Measured | Off (ms, median) | On (ms, median) |
|---|---|---|---|
| Squeal (Vitest 5.0.3, 294 files), 9 rounds | start | 239, 57, 53, 134, 116, 112, 118, 67, 52 (112) | 130, 68, 138, 186, 70, 80, 126, 77, 37 (80) |
| Squeal | start + `test/hash/blob.test.ts` | 1425 ... 1938 (1,897) | 2401 ... 3751 (2,383) |
| cezar (Vitest 4.1.10, 651 files), 9 rounds | start | 176, 426, 157, 193, 316, 108, 193, 112, 129 (176) | 156, 316, 154, 273, 370, 206, 134, 139, 78 (156) |
| cezar | start + a `web` file (jsdom, React) | 4,498 to 17,503 (5,794) | 4,040 to 19,998 (6,010) |
| cezar | start + a `server` file | 2,023 to 3,716 (3,025) | 1,563 to 3,751 (2,554) |
| alias fixture, optimizer on (ssr and client), 7 rounds | start + its one test | 323 to 782 (437) | 326 to 701 (489) |

Neither repository enables Vitest's dependency optimizer (off by default), so `forceOptimizeDeps` has nothing to rebuild and the start cost is the same within noise. The cost is real only where a project enables it: one bundle rebuild per instance start, about 50 ms for one small aliased module here. An earlier 5-round pass (load 18 to 42) gave the same picture: Squeal start 23 against 21 ms, cezar start 41 against 40 ms, cezar start with a `web` file 2,288 against 2,381 ms, with a `server` file 391 against 425 ms.

## For the next worker

- `tiers.ts` is about 400 lines and `adapter.ts` about 460; nothing was split.
- The plugin bundles were not rebuilt (`test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` fail until the landing rebuilds them).
