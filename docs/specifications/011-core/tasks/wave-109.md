# Wave 109: every decision in a step reads the step's one reading (row 011-372)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Row 372: Approve"). Evidence: `../reviews/0.1.518.md` S1 (the helpers that still read the clock inside a turn, with lines). Base: main at 0.1.519 (released). Candidate 0.1.520 (row 011-369, the wake loop's one time) is held for the human's clock-policy decision and touches `clock.ts` and `wakes.ts`; this row stays out of those files, and whichever lands second rebases.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-372

Use /worker. Shape: slice. Effort high.

Outcome: within one step's turn, every decision reads the step's one reading (`Turn.at`); clock reads that remain in the turn are action timestamps (a tier's start, a row's write) or wake bookkeeping, each named.

Read: board row 011-372; `reviews/0.1.518.md` S1; `step.ts`, `step-live.ts`, `beside.ts` (`besideFiles` reads `context.now()` at line 36 and calls `ledger.orderedBatches()` without the reading at line 51), adoption, claim and deadline reads, slow-release bookkeeping; `test/scheduler/step-reading.test.ts`.

Seam: test first. Lead: extend `step-reading.test.ts` with a virtual clock whose `now()` counts its reads during one step's turn, and pin the decision reads to the step's one; then pass `at` through `besideFiles`, `orderedBatches` and each decision helper the count finds. Keep start and write timestamps and wake bookkeeping as their own reads and list them in the notes.

Owns: `src/core/scheduler/` decision helpers that take a reading (`beside.ts`, `ledger.ts`, `queue.ts`, `claims.ts` read paths, `step-live.ts`, and others the count finds; name each), `test/scheduler/step-reading.test.ts` and new tests. Leave alone: `clock.ts`, `wakes.ts`, `options.ts` (row 011-369), `busy-resume.ts`, `store/busy.ts`, `local-permits.ts`, `src/core/capacity/` (cards 9, 10), `record-tier.ts`.

Done when: row 011-372's done-when; `tasks/011-372/notes.md` lists each remaining read and why it stays; behaviour preserved (no tier, order, width, status payload, note text, CLI output or key change); `key-format` without a raise; lint, typecheck and `squeal status --wait 60000` on the changed paths pass; the model test passes once when the load is below the CPU count.

## R1 (W1): review of cand/0.1.520

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.520` at `da570536b9674b242f0a0704d5ce2219405fbb16`; candidate CI run 43839480465. (0.1.520 is reused: the earlier candidate with that number, row 011-369's one-calendar-clock version, was abandoned and never landed.) Range `78c81d619..da570536b9674b242f0a0704d5ce2219405fbb16`: worker fe5d8433's four commits (row 011-372), cherry-picked without conflict, then the 0.1.520 raise and bundles. Read: board row 011-372; this file's W1; `tasks/011-372/notes.md`; `reviews/0.1.518.md` S1.

Check, each as proven, plausible or unverified:

1. **One reading for decisions.** `step-reading.test.ts` counts clock reads made by a step's decisions and pins them to 0 beyond the step's own (edit, beside-a-batch, slow-lane scenarios: 4, 180 and 14 before, 0 after); the count cannot miss a read path (it counts at the clock, not at chosen call sites).
2. **The reads that remain** are what the notes say: tier-start stamps, row writes (`acceptedAt`, the pool's wait row), the lock label, wake bookkeeping. None of them feeds a decision in the same turn. `Promotions.#settle` and its row are named as later candidates.
3. **Behaviour preserved.** Passing the step's reading instead of a fresh one changes each decision's time by at most the turn's length; prove or refute that no tier, order, width, status payload, note text, CLI output or key changes, and that no deadline or claim bound now fires a turn early or late in a way a user sees. Squeal flags `SlowTier.#select` (complexity 27) and `tier-start.ts` `act` (22), both over 20 before this row: say whether this row made them worse.
4. **Row 011-369** is being reworked beside this row on `clock.ts` and `wakes.ts` (two named clocks); say if anything here will conflict.

Coordinator at the candidate: lint, typecheck, `check:version origin/main`; direct runs of `step-reading`, `step`, `untracked-promises`, `one-loop-source`, `version-sensitive` pass; `key-format` failed once as a whole file in a parallel run at load 97 and passed 12/12 alone at load 106. Worker: model test 15/15; Squeal 19 of 942 current (the rest queued at load 76 to 94). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; the host is loaded by another project. Write `reviews/0.1.520.md` (overwrite the abandoned candidate's file: move it first to `reviews/0.1.520-abandoned-one-clock.md`) and commit both on your branch.

## R2 (W1 repair): re-review of cand/0.1.520 after `reviews/0.1.520.md`

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.520` at `49baa84ecf86d7420a0826db979b0496428bfd38`; candidate CI run 43843816001. Rebuilt on main `f44628134`: worker fe5d8433's four first-round commits (unchanged), its repair (`3833faca8`, `240877e8e`), then the 0.1.520 raise and bundles. Narrow: the repair, against `reviews/0.1.520.md` B1 and S1. Read that review and `tasks/011-372/notes.md` "Repair after review 0.1.520".

Check, each as proven, plausible or unverified: B1's paused-backlog scenario is in `step-reading.test.ts`, failed before the fix (46 reads) and passes after; `Ledger.ordered` forwards `now` to `#drains` from both callers; S1's value checks (every yield check and plan receives the step's own reading) catch a wrong reading; the two threshold cases left out (a quiet window, another worktree's claim limit) are a fair follow-up and not hiding a break; the notes' corrected statement (a deadline that passes during a turn counts from the next step) is right and changes nothing a user sees beyond a turn's length. The first candidate's CI failed one coverage timing case (`test/code/coverage/writer-turns.test.ts:62`, 232 against a 100 ms budget on Node 26): say whether this row could reach it.

Coordinator at the candidate: lint, typecheck, `check:version`; `key-format` 12/12, `version-sensitive` 7/7, `step-reading` 4/4, `step` 52/52, each run alone at load 74. Worker: before the fix 1 failed with the review's 46 reads; after, 4/4. CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout. Write `reviews/0.1.520-r2.md` and commit it on your branch.
