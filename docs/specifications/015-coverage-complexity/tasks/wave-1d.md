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
