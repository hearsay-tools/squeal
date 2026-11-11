# 018-28 notes: an import re-keys a running daemon; default branch without origin/HEAD

Worker c3bfb900, 2026-11-10. Spec 018 D11, D14; brief `tasks/wave-10.md` section 018-28; evidence `research/shared-proof.md` Q2, Q3.

## Item 1: the re-key after an import

Cause (Q2): the daemon keys its files at start, then the reader imports. The import adds observed entries to the shared store (`addMissingEntries`) and re-keys its results under this worktree's list with those entries (D11). The daemon's in-memory observed view (`ObservedSets` in `WorktreeKeys`) did not read them again, so its keys stayed without the observed paths until a restart. The 5 s observed timer (task 003-26, `lifecycle.ts`) reads only node:test, pytest and runtime-file projects (`observedLoads`), never a Vitest project.

Fix, reusing the 003-26 path:

- `src/core/shared/imports-seen.ts`, `ImportsSeen`: the import ids in the store when the daemon's loop starts; `take(reread)` hands the projects of each later import to `reread`, and sees them only when `reread` took them.
- `daemon.ts` `#requestRetries` calls `take((projects) => scheduler.refreshObserved(projects))` before `requestRetries`. Both import paths reach it: the reader's `imported` callback, and `squeal import`, which sends `retry` to every daemon of the repository.
- `Scheduler.refreshObserved(projects?)` (additive): with projects, `keys.refreshObserved(projects)` first, which puts the files whose set grew into `#grownElsewhere`; then the runner-only refinement it queued anyway, whose `regrowObserved` calls `setClosure` for them. The ledger settles them, and the lookup adopts the imported results.

Tests: `test/shared/import-rekey.test.ts` (scheduler with a fake runner, reader, fixture remote; red before: 0 of 3), `test/shared/imports-seen.test.ts`, and `test/daemon/shared-reader-daemon.test.ts` "a daemon's first start with a published export": real daemons and Vitest; a CI clone runs the suite, a test reads `data/input.txt`, its store's export is published; a clone with `origin` removed and added again is current 5 of 5 at its first start, and `squeal import` into a running daemon of a remote-less clone is too. Without the daemon change: 4 of 5, 1 "content differs", as the cezar proof measured; the `squeal import` part never reaches 5.

The fixture's `test/gen.test.ts` imports `src/gen/client.ts`, which `.gitignore` leaves out, so a clone reads "closure list differs" for it. That is correct; the test removes the file from the CI commit.

## Item 2: status names the cause (not changed)

The brief asked for it "if any window remains". Measured in the daemon test at host load 60 (n=4): the files were current 0 to 27 ms after `status` first showed the import; in the two samples that caught the gap, status said "not adopted yet" (4 files), never "content differs". So no window with the wrong reason was seen, and status is unchanged.

A window can remain in theory: the queued refinement waits for a refinement already in its runner phase, and `refreshObserved` returns false while the daemon waits for an install (that daemon restarts, and its start reads every entry). A precise reason would need the daemon to publish when its keys took an import, for example a per-worktree meta mark cleared when the regrow's refinement applies (`runner-work.ts`). Status can not tell it apart from a content difference from the store alone: the store keeps no per-path hashes of the export's commit, and `import_files` keeps list hashes, not lists.

## Item 3: the default branch without origin/HEAD

`choose.ts` `advertisedUpstream`: for `origin`, else the first remote, `git ls-remote --symref <remote> HEAD`, the branch of the `ref: refs/heads/<name>\tHEAD` line, and `refs/remotes/<remote>/<name>` only when the clone holds it (`rev-parse --verify`). The reader (`#advertised`) asks it only when `upstreamOf` finds no local `refs/remotes/<remote>/HEAD`, with `networkEnv`, the listing's kill timer (`listTimeoutMs`) and its stop. A found branch is kept for the reader's life; a miss is asked again only after `HEAD` moves, so batches reach no remote for it. The note naming `git remote set-head origin --auto` stays when the remote can not be reached, names no default branch, or the clone lacks that branch. Nothing is written: no `set-head`.

`init.defaultBranch` was not used: it is this machine's default for new repositories, not the remote's default branch.

Tests: `test/shared/reader-upstream.test.ts` (removed and added remote, offline with the retry after a commit, the kill timer, the missing tracking branch) and a stop case in `reader-lifecycle.test.ts`.

## Left for later

- The key-parts note of D11 is unchanged: a project whose policy has `observe.runtimeInputs` off keys no observed paths, but the import's re-key (`transfer-rekey.ts`) adds the shared observed entries anyway, so its files would not match. Not seen in cezar (runtime inputs on).
- Bundles are not rebuilt (brief: no build); the coordinator's build carries `daemon.ts`, `scheduler.ts`, `choose.ts`, `reader.ts` and `imports-seen.ts` into `plugins/*/dist`.

## Repair R1 (review of 0.1.428): status names the pending re-key; the records' worker counted once

Worker 02b58941, 2026-11-11. Review `reviews/0.1.428.md` B1 and B2.

B1. The window is real (the reviewer held the runner's next invalidation: `content=3` until the re-key applied). The daemon now publishes which imports its keys have not taken, in a worktree row (`importsWaiting`, `src/core/scheduler/imports-waiting.ts`):

- `ImportsSeen.take` hands the fresh import ids beside the projects; `Scheduler.refreshObserved(projects, imports)` (additive parameter) marks them in the same synchronous step that puts the grown files in `#grownElsewhere`.
- `RunnerWork.#refine` reads the marked ids when its apply takes the lock, before `applyRunnerPart` (whose `regrowObserved` consumes those files), and removes them after `ledger.commit`. A mark added while the apply awaits stays until the next refinement (`queueObserved` queued one): status may say "waiting" a moment too long, never "content differs" too early. A refinement that throws leaves the mark for the next one.
- `Scheduler.start` empties the row: a start keys every import the store holds.
- Status (`src/core/status/imports.ts`): a file that would read "content differs" reads `keysPending`, "waiting for keys after the import", while its import is marked. A new D5 reason: the spec's list needs the coordinator's amendment.

Still possible: the moment between an import's commit and the daemon's `take` (the same process for the reader, one socket message for `squeal import`) reads "content differs"; closing it would need the import's own transaction to write the mark.

Tests: `test/shared/import-rekey.test.ts` "names the keys it waits for ..." (red before: `content: 3`), `test/scheduler/imports-waiting.test.ts`.

B2. `map-client.cjs` adds the records' worker's event-loop busy time (which holds its evidence time; ESM top-level code too, measured) to the Vitest process's clock at close, and the worker's own evidence file carried its own clock. The worker now starts with `COUNTED_OUTSIDE` in its `workerData`, and `clock.cjs` in such a thread reads 0: the thread is still counted, its time once. Test: `test/runners/vitest/ci-map-client-clock.test.ts`, a 300 ms evidence-only job in the worker under the real hook (red before: 584 ms; now within 1.4x).
