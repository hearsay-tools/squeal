# Spec 018 wave 3.6: a running request keeps the daemon awake

Approved by the human 2026-11-09 ("Idle stop: A: fix Squeal"), found by the 018-08 trial.

## 018-12 progress on an explicit request counts as activity for the idle exit

Use /worker. Shape: repair.

Outcome: a daemon that never had a consumer (CI, `squeal start` in a terminal) does not stop for idleness while a run request it accepted (`run --all`, `run --fast`, `run <group>`, retry) is still making progress; it stops `daemon.idleExitMinutes` after the request ends or after its last progress.

Evidence (researcher a9fd78c8, read in source at `squeal--v0.1.418` and reproduced in a fixture with `idleExitMinutes: 1`): cezarion trial run 42530503204 stopped 60 min 39 s after the daemon was ready, with 1,414 of 1,746 files done and 332 queued, "daemon stopped: idle for 1 h with no registered consumers". The idle check is `src/core/daemon/lifecycle.ts:266-273` (`at - context.lastActive() >= idleMs`). `lastActive` is set at ready (`daemon.ts:832`) and by the desk's `onActivity` (`daemon.ts:869-872`), which only requests call (`handlers.ts:214` nudge, `:218` retry, `:222` run-all, `:272` run-group); running tests and `ping` from `--wait` are not activity.

Read: the lifecycle doc comment in `lifecycle.ts` (lines about 175 to 210: the human's rules on idle, departure grace and the bounded drain, defect 24, tasks 004-29, 001-219, 011-163) and keep every one of them.

Starting seam: a failing test first, in the style of the existing lifecycle tests: a daemon with no consumer, a short idle period, an explicit request whose files keep finishing past that period; it must not stop until the request ends, then must stop one idle period later. First edit offered as a lead: a file of an open explicit request ending counts as activity (so a request that stops making progress still lets the daemon exit after one idle period, no new bound needed). A daemon with only its own background work (baselines, catch-up) and no open request keeps today's idle exit.

Owns: `src/core/daemon/lifecycle.ts`, `src/core/daemon/daemon.ts`, `src/core/daemon/handlers.ts` if needed, the scheduler hook that reports a request's file ending, their tests.

Leave alone: key inputs; the departure and drain paths except where they share the activity hook (say so). No `pnpm run build`.

Done when: the new test fails before and passes after; the existing lifecycle and drain tests still pass; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean; the final message names what counts as activity now.

## 018-12 R1 repair after review FAIL (`reviews/wave-3.6.md`, B1 to B3)

Use /worker. Shape: repair, on candidate `cand/0.1.419`.

Outcome: the idle exit sees every file end of an open explicit request, and only those, so a request in progress never lets the daemon stop and background work never keeps it up.

Read: `reviews/wave-3.6.md` B1, B2 and B3 with their reproductions and "Fix sized for one worker" lines; the 018-12 section above; `src/core/scheduler/request-progress.ts`.

One rule for all three (the coordinator's direction): record a request's file end at the scheduler boundary where that file's result is stored or its run ends, as an event, never reconstructed from the phase when the lifecycle polls (B2). Register for each request exactly the files it selected, with its lane restriction, not the whole checkpoint it joined (B1). Register retry work where a retry is actually claimed and queued, shared by the direct request, interval reconciliation and startup; waiting at a closed load gate stays no progress (B3).

Starting seam: the three reproductions as failing tests first (`test/scheduler/request-progress.test.ts`, `test/scheduler/retry-fixture.ts`), plus the review's extra cases: an empty fast request while a slow baseline stays open; a completion followed by a re-queue before a read, with no end added for the finished request by the later background run; a pending retry at startup.

Owns: `src/core/scheduler/request-progress.ts`, `src/core/scheduler/scheduler.ts`, the retry and reconciliation paths it needs, `src/core/daemon/lifecycle.ts` and `daemon.ts` only if the reading changes, their tests.

Leave alone: key inputs; checkpoint joining and the baseline's own result attribution. No `pnpm run build`.

Done when: each new test fails before its fix and passes after; the existing request-progress, lifecycle, drain, retry and narrow-run tests pass; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.
