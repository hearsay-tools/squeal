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
