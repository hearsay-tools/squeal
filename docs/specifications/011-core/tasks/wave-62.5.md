# Wave 62.5: repair of review 0.1.384 (B1)

Coordinator dd7baf7f, 2026-10-31. Review `reviews/0.1.384.md` FAIL on `cand/0.1.384` `02b528e0a`: B1 proven. Host policy as in `wave-60.md`. No `pnpm run build`; not yours: board, spec, `status.md`, bundles, version.

## RP1: B1 (row 011-283: an already-current file keeps a finished wait alive)

Use /worker. Shape: repair, one commit, on your branch `cez/9a2c6bb0`.

Read: `reviews/0.1.384.md` B1 (reproduction and bounded fix); `wave-62.md` W1 rule 3; your `tasks/011-283/notes.md`.

Seam and lead: the seen-tracking in `Promotions` (`src/core/scheduler/promotions.ts:107`, `:227`) treats a current selected file like one not yet queued. Give `Promotions` the fact that a selected file is current at its key or settled (from the scheduler call at `scheduler.ts:664`, where current-at-key is known), so a wait ends once every selected file is current or had its turn. Keep the unqueued-and-pending case (a held retry) open until the deadline. The decision stays in `Promotions`; no CLI re-send, no second ordering path.

Owns: W1's files, `scheduler.ts` at that call only, new or extended tests, a section R1 in `tasks/011-283/notes.md`.

Done when, red before and green after: the review's paired probe as a scheduler test (wait [A current, B queued]; B settles; the row is gone; a later edit of B runs after a new wait C; the [B] control); a selected unqueued file that becomes current through a shared result ends the wait. The six first-slice tests and existing promotion tests still pass; lint and typecheck pass; affected results read with `squeal status --wait 60000 <paths>`.

Stop and report if the fix needs a change to retry priority, slow eligibility, tier selection, keys or verdicts.
