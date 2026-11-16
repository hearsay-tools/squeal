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

## R2 (W1, W2): review of cand/0.1.529

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.529` at `2fa68aa8d6862f662f472fc641bb271591e6a2e8`; candidate CI run 43968493359. Range `6f9f051be..2fa68aa8d6862f662f472fc641bb271591e6a2e8` (main at 0.1.527): worker ede0d6d2's two commits (row 011-386), worker 54a85ba0's three (row 011-382), cherry-picked without conflict, then the 0.1.529 raise and bundles (0.1.528 is coordinator d36c4d53's, not on main). Read: board rows 011-382 and 011-386; this file's W1 and W2; `tasks/011-382/notes.md`, `tasks/011-386/notes.md`; `tasks/011-377/notes.md` "Repair after review 0.1.524"; `reviews/0.1.524.md` B1 and "Inputs for the coordinator".

Check, each as proven, plausible or unverified:

1. **011-386.** The yield row (`TierYields.#publish`) and the pool-wait row (`poolWaitsPublish`) are stamped no earlier than the daemon's stored start; status keeps a live row across a 1 h set-back and set-forward; a predecessor's row stays rejected; no row shape or reader changed. The worker's named limit (`PoolWaits` keeps `since`, `last` and `#publishedAt` on calendar time: after a set-back the row's refresh waits until the calendar passes the last write, so status can show an old gate for up to the set-back): is it a defect a user sees, and should it be its own row?
2. **011-382.** The lint pass's edit quiet reads through `steppedClock` with its own `CalendarSteps` and counts the latest revision from first sight; a 1 h set-back and set-forward leave the same wait; behaviour without a calendar change is unchanged; `LintIdleOptions` takes a `clock` (one caller, the daemon; `daemon.ts` passes `hostClock(this.#now)`). The named limit: a step between an edit and the lint wait's first read of that revision is not corrected. Is a separate `CalendarSteps` here right, or should it share the scheduler's?
3. **`GLOSSARY.md` "Elapsed time"** now names only the command hold as a calendar wait; is that true after both rows?
4. **Behaviour preserved** without a calendar change: no tier, order, width, status payload, note text, CLI output or key change.

Coordinator at the candidate: lint, typecheck, `check:version origin/main` (0.1.527 to 0.1.529); `key-format` 12/12 alone; `version-sensitive`, `lint/pass/idle`, the three calendar-step files, `one-loop-source`, the model test 51/51 at load 70. Workers: 011-386 28 files 145 tests; 011-382 `idle` 6/6, Squeal 260 of 357 current with only the four bundle checks failing (fixed by the bundle commit). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/0.1.529.md` and commit it on your branch.
