# 004 wave 1.5 briefs: the wave-1 review's blockers

Read `reviews/wave-1.md` (FAIL at `7314670`), spec 004 D2 and D9, `status.md`. Do not run `npm run build`; the coordinator builds at integration. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Load on this host is high: re-run a failing file alone before calling the failure yours. A test that runs a slow file under a real daemon sets `slow.maxLoadPerCpu` high.

The 001 coordinator's 001-140 is rewriting `src/core/scheduler/scheduler.ts` (`#select`, `#running`) now: do not edit that file. If a fix cannot be made without it, stop and report.

## 004-20 the slow tier rechecks its trigger; Stop never waits for slow files (B1, B2)

Outcome: no slow file starts after its trigger is gone, and a Stop with only slow files pending returns at once.

Shape: repair. Test first: each of the review's two probes is a failing test on `7314670` before the fix, on Node 22 and 24.

B1, seam `SlowTier.#select` in `src/core/scheduler/slow-tier.ts` (the slow tier's own, after the slot and the guard): check the trigger again under the lock (idle or absent consumers, an open slow request, or this file's open run-all checkpoint, as `#candidate` does; one shared predicate, not a copy). Trigger gone: the file stays queued, the slot is released, the guard's remaining budget is kept. Tests: the review's probe (consumer enters a turn during the guard wait, no batch) and a control (an explicit request still runs in a turn).

B2, seam `waitForPending` in `src/harness/shared/stop.ts:172` and `isPending` in `src/core/state/header.ts:85`: Stop waits only for fast pending checks and files and the runner part; slow files stay in status and in the silent Stop's `endTurn()` snapshot. How Stop tells slow pending from fast is yours to choose (an additive header count is fine; 004-15 will build its slow-tier line on it, so name it plainly). Tests through the shared Stop path, both harnesses: positive `stop.waitMs` with only slow pending returns promptly and records the slow file; fast plus slow waits for the fast and returns with the slow pending. Leave `stop.requireSlowSuite` to 004-15.

Owns: `src/core/scheduler/slow-tier.ts`, `src/harness/shared/stop.ts`, `src/core/state/header.ts` and the status type it reads (additive), `test/scheduler/slow-tier.test.ts`, Stop tests under `test/harness/`. Leave alone: `src/core/scheduler/scheduler.ts` and the rest of the scheduler (001-140), `src/runners/**` (003-39), the CLI.

Done when: both probes are tests that pass; lint, typecheck, full suite on Node 24 and 22 (failures passing alone named). Report every type change.

Use /worker.

## 003-39 a preload's createRequire load stays with the preloads (S1)

Outcome: a helper a `--require` or `--import` preload loads through `createRequire(...)` is in the project's environment, never in a test file's observed closure.

Read: `reviews/wave-1.md` S1 and its two preload probes; `docs/specifications/003-node-test-runner/tasks/003-37/notes.md` (what the recorder sees); spec 003 D5 as amended 2026-10-09.

Shape: repair. Test first: both probes (CJS and ESM preload) fail on `7314670` on Node 22 and 24. Seam: record at load time which process phase made a load whose parent is no loaded module (the recorder in `src/runners/node-test/runtime/recorder.cjs` knows whether the test file has started loading), so `observedClosure` (`run/observed.ts:55`) keeps a preload's orphan loads with the preloads; test-owned `createRequire(package.json)` loads and spawned-CLI loads stay file-owned (`adapter-attribution.test.ts` unchanged). Raise `NODE_TEST_ADAPTER_VERSION` if keys change, and amend D5's sentence in spec 003 with a dated `status.md` line.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, fixtures under `test/fixtures/node-test/`, spec 003 D5 and its `status.md`. Leave alone: everything else.

Done when: both probes are tests on Node 22 and 24 with the helper in `environment().files` and absent from both test closures; existing attribution tests unchanged; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-21 re-review of wave 1.5

Outcome: `reviews/wave-1.5.md`, committed: are `reviews/wave-1.md` B1, B2 and S1 closed, and did the fixes break anything around them.

Range: the 004-20 and 003-39 commits and the 0.1.48 bundles on main (`git log --oneline 8c473c4..<0.1.48 build commit>`; the 001 commits there are out of scope). Re-run the review's own B1, B2 and S1 probes on Node 22 and 24 first. Then: can the shared trigger predicate let a file run that `#candidate` would not have chosen, or hold one forever; does `slowPending` stay consistent with `counts.pending` and `testFilesWithoutChecks.pending` under a torn read; does the preload tag misplace a test's own load (an absolute `--require` path, a worker thread, `node -e`, a test that spawns `node` with `--require`).

Rules as for 004-14. This is the second and last review round on this slice: a remaining blocker goes to the human, not to a third round.

Use /reviewer.
