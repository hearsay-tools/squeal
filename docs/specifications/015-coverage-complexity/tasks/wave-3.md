# 015 wave 3: the coverage measures follow D6 and D7

Briefed by coordinator 52e58f23 on 2026-10-24, after 0.1.297. One worker. Sources: the residue in `tasks/015-12/notes.md` and `tasks/R6/notes.md`, `reviews/0.1.297-r2.md` N1, `research/child-processes.md` (015-33).

## W1: 015-39, 015-40, 015-33

Use /worker. Shape: slice. Starts from main at 0.1.297. Outcome: a session hears about `crap` and `uncovered` as it hears about complexity, and a too-big edit is told only when it is the session's.
- Read `spec.md` D5, D6, D7 and D9 with their 2026-10-24 amendments, `status.md` (the coordinator's 015-40 wording line), and the board rows 015-33, 015-39 and 015-40.
- **015-39.** Keep each too-big file's edit revision apart from recount row writes (B5's `RecountRecord.tooBigEdits`), so delivery compares the edit's revision with the session's bound and a second recount keeps the first one's edits. Lead: `src/core/code/pass/pass.ts` and `newTooBig` in `src/core/delivery/code-deliver.ts`.
- **015-40.**
  - **STILL FAIL.** The coverage step marks the edit when a judged function's body hash moved (lead: `judgeFiles` in `src/core/code/crap/`, `markEdited`), so D6's first-edit rule and 015-21's text apply.
  - **Blocking.** `wentOverSince` takes the measures (`src/core/delivery/code-since.ts`). Stop's text names each function's measure (`src/harness/shared/stop-code.ts`). The status line stays complexity only.
  - **Told.** The told line and `squeal code --told` count the coverage measures (`code-told.ts`, `code-format.ts`, `src/cli/code*.ts`).
  - **Summary.** A `crap.threshold` change gets a summary line (`recountLine`).
  - Keep every complexity-only text byte-identical.
- **015-33.** `test/runners/observe/recorder.test.ts` ignores `NODE_V8_COVERAGE`.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/**`, `src/core/delivery/code-*.ts`, `src/harness/shared/stop-code.ts`, `src/cli/code*.ts`, `recorder.test.ts`, and their tests. Leave `src/core/scheduler/**` and `src/harness/shared/stop.ts` alone.
- **Done when.** Each row's done-when on the board is a test, red first, and each row is its own commit. Write the D6 and D7 amendment text in `tasks/015-40/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.
