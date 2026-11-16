# Wave 117: the last calendar waits, and two test timings (rows 011-382, 011-386, 011-387, 011-388)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Rows: 011-382 lint quiet, 011-386 status rows, 011-387 backlog-tiers, 011-388 status-wait-pool"). Base: main at 0.1.526. The four workers own disjoint files. Rows 011-382 and 011-386 change `src/` and share one candidate with a version raise after coordinator 4d2ecbfc's 0.1.527; rows 011-387 and 011-388 are test-only.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-382

Use /worker. Shape: slice. Effort medium.

Outcome: the lint pass's quiet after an edit ends after its elapsed time across a calendar change, as the scheduler's waits do since row 011-377.

Read: board row 011-382; `tasks/011-377/notes.md` (Design, "Repair after review 0.1.524"); `reviews/0.1.524.md` "Inputs for the coordinator"; `src/core/lint/pass/idle.ts` (line 49 repeats the edit-quiet calculation); `src/core/scheduler/calendar-steps.ts`.

Lead: test first, a set-back and a set-forward of 1 h on the virtual clock after an edit (fails today). Then reuse the scheduler's quiet or its calendar-step mechanism, not a third copy. Owns: `src/core/lint/pass/` and its tests. Done when: row 011-382's done-when; `GLOSSARY.md` "Elapsed time" no longer names the lint copy as an exception (that line only); behaviour without a calendar change unchanged.

## W2: row 011-386

Use /worker. Shape: slice. Effort medium.

Outcome: after a calendar set-back, status keeps showing a live yield row and a live pool-wait row, and still drops a predecessor daemon's rows.

Read: board row 011-386; `tasks/011-377/notes.md` "Repair after review 0.1.524" (B1: `CalendarSteps.stamp`); `reviews/0.1.524.md` B1; `test/scheduler/calendar-steps-seams.test.ts` (the owner-to-reader tests for quiet and promotions).

Lead: copy the B1 test shape for the yield rows and the pool's wait rows (owner to public reader, a real daemon record, set-back and set-forward, a predecessor's row rejected), failing first; then stamp both through `CalendarSteps.stamp`. No row shape change. Owns: the yield and pool-wait row writers and their tests. Leave alone: `src/core/lint/` (W1), `local-permits.ts`, `src/core/capacity/` (card 10).

## W3: row 011-387 (test-only)

Use /worker. Shape: slice. Effort medium.

Outcome: `backlog-tiers` "cancels a backlog tier for an edit" takes its lower bound from the same source as its trigger, so a slow runner cannot fail it by one file.

Read: board row 011-387; `test/scheduler/backlog-tiers.test.ts` (around line 95 to 130). Owns: that file. Done when: the case still fails if the cancel loses completed files (show how, reverted); 3 of 3.

## W4: row 011-388 (test-only)

Use /worker. Shape: slice. Effort medium.

Outcome: `status-wait-pool` checks the line's shape and an elapsed time bounded by the wait it asked for, not an exact tenth, as row 011-374 did for `status-wait-paused`.

Read: board rows 011-388 and 011-374; `tasks/011-374/notes.md`; `test/cli/status-wait-pool.test.ts:141`. Owns: that file and its helpers. Done when: the product text unchanged; 3 of 3; notes name the bound and why it is not host-tuned.

All: lint, typecheck, `key-format` without a raise for W1 and W2, and `squeal status --wait 60000` on the changed paths; notes under `tasks/011-38N/notes.md`.

## R1 (W3, W4): review of cand/011-387-388

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-387-388` at `a96399becd55be2f8541ccb6deab1ac3dfb816e3`; candidate CI run 43961834724. Test files and notes only: no `src/` change, no version raise. Range `2ca6a943c..a96399becd55be2f8541ccb6deab1ac3dfb816e3`: worker 55f47307's commit (row 011-388) and worker bdd420d0's two (row 011-387), cherry-picked without conflict. Read: board rows 011-387, 011-388, 011-374; this file's W3 and W4; `tasks/011-387/notes.md`, `tasks/011-388/notes.md`; `tasks/011-374/notes.md`.

Check, each as proven, plausible or unverified:

1. **011-387.** The cancel case starts the edit after 20 files the runner reported as ended (`RunOptions.fileEnded`, through a wrapper of `h.runner.run`) and checks the cancelled report holds each of them by name; the trigger and the bound come from one source, so a slow runner cannot fail it by one file; the case still fails if a cancel loses a completed file (the notes' mutation); nothing is host-tuned.
2. **011-388.** `status-wait-pool` checks the printed elapsed time between the requested wait less 1 ms and the call's own measured duration plus 1 ms, then compares every other word exactly; the product text is unchanged; nothing is host-tuned; the case still fails on a wrong word.

Coordinator at the candidate: lint and typecheck pass; both files pass (7 tests, load 22). Workers: each case 3 of 3 at load 24 to 37. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-387-388.md` and commit it on your branch.
