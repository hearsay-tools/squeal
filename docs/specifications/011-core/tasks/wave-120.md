# Wave 120: the pool's wait reads one bracketed sample (row 011-390)

Coordinator 4c0bbe28, 2026-11-17. Approved by the human on 2026-11-17 ("Row 390: Approve"). Base: main at 0.1.538. The candidate takes a version after coordinator c3fe14c9's 0.1.539, settled by request.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Write `~`, not a home-directory path, in notes. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-390

Use /worker. Shape: slice. Effort medium.

Outcome: a thread pause between the pool wait's two clock reads no longer looks like a calendar step, so a pause makes no extra write of the pool-wait row; a real step still rewrites it at once.

Read: board row 011-390; `reviews/0.1.531.md` S1 (the probe and its fix scope); `tasks/011-389/notes.md`; `tasks/011-377/notes.md` "Repair after review 0.1.524" (S1: the bracketed sample); `src/core/scheduler/calendar-steps.ts` (`CalendarSteps.observe`, `steppedClock`, `SURE_SAMPLE_MS`).

Lead: test first. Copy the review's probe as a `PoolWaits` owner test: both clocks advance 200 ms between the two reads, no `shiftCalendar`; it must keep one start write until the 10 s refresh is due (fails today with 3 writes). Then the first edit, in `src/core/scheduler/pool-wait.ts` `refused` (lines 142 to 160): take the step from an accepted calendar-step observation, the scheduler's `CalendarSteps` (passed in at `scheduler.ts:306`) or the same bracketed rule (elapsed, calendar, elapsed; a pair wider than `SURE_SAMPLE_MS` is left out), not a third copy. Keep the interval accounting on elapsed time.

Owns: `src/core/scheduler/pool-wait.ts`, its construction in `scheduler.ts` (a few lines), and the pool-wait tests. Leave alone: `local-permits.ts`, `src/core/capacity/` (card 10), `busy-resume.ts`, `store/busy.ts` (card 9), `record-tier.ts`.

Done when: the new test failed before and passes; a real 1 h set-back and set-forward still rewrite the row at once (row 011-389's tests unchanged and passing); no row shape, reader, status text, log text or key change; no host-tuned threshold; lint, typecheck, `key-format` without a raise, the pool-wait and calendar-step tests 3 of 3, `squeal status --wait 60000` on the changed paths (report pending as pending); `tasks/011-390/notes.md` says which source of the step was taken and why.

## R1 (W1): review of cand/0.1.540

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.540` at `f6ddf93e1f4c66d5c35a8dccbead6ac494d61825`; candidate CI run 44035727756. Range `b85898220..f6ddf93e1f4c66d5c35a8dccbead6ac494d61825` (main at 0.1.539): worker 58724cf5's one commit (row 011-390), cherry-picked without conflict, then the 0.1.540 raise and bundles. Read: board row 011-390; this file's W1; `tasks/011-390/notes.md`; `reviews/0.1.531.md` S1; `tasks/011-389/notes.md`; `src/core/scheduler/calendar-steps.ts`.

Check, each as proven, plausible or unverified:

1. **The pause.** `PoolWaits` takes its step from the scheduler's `CalendarSteps.total` (`#publishedSteps` in place of `#publishedOffset`); the new owner test (both clocks advance 200 ms between the reads, no `shiftCalendar`) keeps one start write until the 10 s refresh, and failed before with writes at 10000000, 10002000 and 10004200.
2. **A real step.** A step the scheduler's sample sees still rewrites the row at once: `refused` reads `now()` before `total`, so the same reading's step counts. Is there an order of reads, or a caller without `steps`, where a real step is missed or counted late, and does it matter to a user (status shows an old gate for up to the 10 s refresh)?
3. **What stays.** Row 011-389's set-back, set-forward and 31 s gap tests pass unchanged except the helper passing `steps`; interval accounting stays on elapsed time; no row shape, reader, status text, log text or key change; no host-tuned threshold; `steps` optional in `PoolWaitsOptions` (only caller: `scheduler.ts`).

Coordinator at the candidate: lint, typecheck, `check:private`, `check:version origin/main` (0.1.539 to 0.1.540); `key-format`, `version-sensitive`, `calendar-steps-rows`, `calendar-steps-sample` 32/32 at load 27. Worker: pool-wait and calendar-step tests 19/19 three times at load 12; 49/49 with `status-wait-pool`. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/0.1.540.md` and commit it on your branch.
