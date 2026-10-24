# 015 wave 1d: the complexity defects from the working day

Briefed by coordinator 52e58f23 on 2026-10-24, after 0.1.295. One worker, beside wave 2b (015-12, `wave-2.md` W4). Source: `lessons.md` "Round 1 (015-10)", "Proposed rows", and `tasks/015-10/part-b.md` for each case's evidence. Row 015-38 (transitions from a pull) waits for the human and is not in this wave.

## W1: 015-34 to 015-37

Use /worker. Shape: repair. Starts from main at 0.1.295. Outcome: a session is told complexity only for changes it made, and its registration never says `0 functions over` while nothing is counted.
- Read `spec.md` D5, D6 and D7 with their 2026-10-24 amendments, the four proposed rows in `lessons.md`, and `tasks/015-19/notes.md` (the rule for a moved `HEAD`).
- **015-34.** While `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `REBASE_HEAD` exists, or a rebase is under way (`rebase-merge/`, `rebase-apply/`), a file equal to its blob at that commit marks no edit, as `src/core/code/pass/head.ts` does for a moved `HEAD`. Lead: extend `head.ts`. Write the D6 amendment text in your notes.
- **015-35.** Find why a new worktree's first registration reads `0 functions over 20` (`src/core/status/code-status.ts`, around the D6 guard, and what the registration reads before the first count starts). Until the first count ends, the line says counting is under way.
- **015-36.** A too-big line is told only for an edit to that file after the session registered; a recount, a first count or a resumed session tells none (`src/core/delivery/code-delta.ts`).
- **015-37.** Find why the recount summary was told twice at one revision; the transaction that tells it compares and sets the consumer's seed.
- **Owns.** `src/core/code/pass/head.ts`, `src/core/status/code-status.ts`, `src/core/delivery/code-*.ts` and their tests. Wave 2b's 015-12 adds new kinds to the same delivery and status files: change only the functions these rows need, and add no new state kind.
- **Done when.** Each row's done-when on the board is a test, red first. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## W2: 015-38, transitions from a pull

Use /worker. Shape: slice. Starts from `int/015f-r1` (0.1.295 with waves 1d and 2b, no build commit; lands after 0.1.297). Outcome: a pull no longer tells a session `PASS` or `RESOLVED` for code it never heard about, and still tells a `FAIL`.
- Read `spec.md` D5 and D6 with their 2026-10-24 amendments (015-19 and 015-34 on what a pull marks), `status.md` (the human's option (a), 2026-10-24), and `lessons.md` "Round 1 (015-10)", B5.
- **The rule.** A `PASS` or `RESOLVED` for complexity, `crap` or `uncovered` at a revision whose change to that file a pull, merge, rebase, cherry-pick or revert brought (the files 015-19 and 015-34 mark as no edit) is taken into the consumer's view by count and not told, when the session was never told the function's `FAIL`. A `FAIL` from a pull is told as before; a `PASS` for a function the session was told about is told as before.
- **Lead.** Carry 015-19's and 015-34's pulled paths into the transition or the delivery step (`src/core/code/pass/head.ts`, `src/core/delivery/code-deliver.ts`), and read the view's told marks there.
- **Owns.** `src/core/code/pass/**`, `src/core/delivery/code-*.ts` and their tests. Leave `src/core/code/crap/**` alone: a repair of 015-12 runs beside you.
- **Done when.** Delivery tests: a pull over an untold failing function that now passes tells nothing and leaves it out of the view; the same over a told one tells `PASS`; a pull that makes a function fail tells `FAIL`; an own edit is unchanged. Write the D6 amendment text in your notes. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

**W2 addition (2026-10-24, review 0.1.297 B5).** The same worker also repairs B5 of `reviews/0.1.297.md`: a real edit to a too-big file at a revision that also recounts is hidden by `f.revision === recount.revision` (`src/core/delivery/code-deliver.ts`). Keep the file's edit revision apart from the recount's row-write revision (`src/core/code/pass/pass.ts`), so a recount-only row tells nothing and a real edit tells once even when its revision recounts. Test both in one recount, keeping the resume and once-per-session cases. Commit it apart from 015-38, naming B5. R6 (`wave-2.md`) owns `src/core/code/pass/index.ts` and `src/core/code/crap/**`: leave them alone. 015-38 now lands in the repaired 0.1.297 and its re-review.
