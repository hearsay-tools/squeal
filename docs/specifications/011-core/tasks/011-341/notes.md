# 011-341 and 011-342: the admission's two design differences (worker notes)

Worker 0c0970aa, wave 93 W1, 2026-11-14. Design: `research/admission.md`, "Differences between the copies", items 1 and 2. Branch `cez/0c0970aa`, base `b28e28051`. Both differences happened; both are closed.

## 011-341: no lane starts while runner work is pending

**Test:** `test/scheduler/admission-runner-work.test.ts`. A configured group `late` (Vitest, `tests: [test/b.test.ts]`, `at: edit`, `after: []`) in the 019-10 group fixture. An edit queues `b`. When the lane takes the lock to list its files, the lock watcher (`watchLock`) sends a batch that touches `src/core.ts` with its own bytes and a later mtime. That batch's pass queues a touched-unchanged refinement (`RunnerWork.queueTouched`, task 001-159): runner work, and no revision, so no preemption ends the lane's run. The lock runs tasks in call order: the pass's turn comes after the listing and before the lane's selection. Deterministic: 5 of 5 runs failed the same way before the fix.

**Before the fix:** the order after the listing was `listed`, `run test/b.test.ts`, `runner work`. The lane's selection (`slow-tier.ts` `#select`) acts on `LaneAnswer.refusal`, and `Admission#laneHalt` read no runner work. Only `editPending` covers runner work, and only for groups that follow `tests`.

**Fix:** `Admission#laneHalt` refuses with `runner-work` after `held`, so `refusal` holds it for every lane. The refusal sends the lane back (`#select` returns `null`, the run is `"again"`), the pump's next pass sees `fast === "runner-work"`, drains, and asks the lane again. After the fix: `listed`, `runner work`, `run test/b.test.ts`.

- `waits` is unchanged: the published activity (`waiting for: fast`) and the slow lane's status still read `after` only. A lane refused for runner work publishes nothing new; the refusal lasts as long as the drain.
- The halt reads `runnerWork` (`RunnerWork.size`) only, as `Admission.fast` does for the fast lanes. A refinement in its runner phase (`refining`) does not refuse, as it does not refuse a fast tier: the pump's rule today. Not changed.
- Table: the pinned row "difference 1, row 011-341" now reads "no lane starts while runner work is pending, `after` or not" and checks `lint`, `e2e` and `slow`, and that `held` goes first. The row "waits for `tests` while an edit's work is pending" now expects `runner-work` as the refusal for the runner-work case; its `waits` stays `after-tests`.
- Spec 019 `status.md`: one dated line on D3, as the brief asked.

**Behaviour:** a configured group that follows no `tests` (a lint group, an e2e group with `after: []`) no longer starts a run in the short gap between an edit's batch and the runner's refresh of that edit. Before, such a run could start at keys the runner had not refreshed yet, and its result could be stored at an old key. A user sees at most a slightly later start of that group's run (the length of one runner refresh); no message, status field or CLI output changes.

## 011-342: the import re-walk gives way to every lane's waiting files

**Test:** `test/scheduler/admission-rewalk-lanes.test.ts`, built like `admission-rewalk.test.ts`. A first daemon stores closures and results; its walks are deleted. Then a new file `test/late.test.ts` of a configured group `late` with `deferUnderLoad` 1.0 per CPU and 60 s, and the load guard reads 10. The next daemon starts `lookup-then-run-missing`, so `late` is queued and waits for the load. The test waits for its activity `{ waiting, for: load }`, waits 500 ms more (ten guard rechecks), and expects no re-walk closure call. Then the load falls; `late` runs and the re-walk walks the rest.

**Before the fix:** the re-walk walked `gate`, `gen`, `math`, `plain`, `strings` and `upper` while `late` waited, 3 of 3 runs. `#facts().slowWaiting` read only `readSlowActivity` (the default `slow` group's key); a configured group publishes under `groupTiersMetaKey` (`publishGroupActivity`).

**Fix:** `#facts().slowWaiting` calls a new `#laneWaiting(context)`: the default `slow` activity, then `readGroupActivity` for each lane in `GroupTiers.lanes(policy)`. Read lazily as before: at most once per answer, and only when `rewalk` asks after the halt check. `StartFacts.slowWaiting` keeps its name and type; its comment now says every group lane. All group lanes are `SlowTier` lanes, so the name still fits.

- Table: the pinned row "difference 2, row 011-342" now reads "the re-walk gives way to any lane's waiting files". The table is pure, so it cannot show which keys `#facts` reads; the row points at the scheduler test.

**Behaviour:** after an upgrade, the one-time import re-walk no longer takes runner time while a configured group's file waits for the load guard or its slot. That file runs first, as a default slow file already did. `squeal reach` counts the whole suite a little later on such a machine. No message, status field or CLI output changes.

## Type changes

None to exported types. `StartFacts.slowWaiting` has a new comment only. New private method `Scheduler#laneWaiting`.

## Checks

- `node_modules/.bin/vitest run` on `admission.test.ts`, `admission-runner-work.test.ts`, `admission-rewalk-lanes.test.ts`, `admission-rewalk.test.ts`, `import-rewalk.test.ts`, `import-rewalk-retry.test.ts`: 6 files, 55 tests passed.
- `test/keys/key-format.test.ts`: 12 passed, no version raise.
- `pnpm run lint`, `pnpm run typecheck`: clean.
- Squeal's affected verdict: see the final report (about 590 files read `admission.ts` and `scheduler.ts`).

## For the next worker

- A deterministic way to put a batch between a lane's listing and its selection: `watchLock` on the operation `listing the queued files of group <name>`, then `handleBatch` from inside the listener (it calls `lock.run` at once, so its turn comes next). Use a touched-unchanged path, not a content change: a revision preempts every lane (`#groups.preempt()`), and the preemption check after `#probe()` races with the pass.
- In a re-walk test, a file the start keys new gets a closure call of its own; filter it out of the walk log.
