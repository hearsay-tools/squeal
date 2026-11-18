# 005 wave 29: the quality scan's slices; shared test helpers

Rows 005-122 and 005-121, the last two of the quality scan `quality/2026-11.md`. The human chose them on 2026-11-17. Coordinator: session 4d2ecbfc. Two workers.

Baseline: the candidate `cand/0.1.559` (main 0.1.557 plus rows 005-119, 005-120 and 011-392 part (d), in review) plus this brief. The line numbers in the quality file are from before 0.1.551, and several functions moved since (`header-daemon.ts`, `register.ts`, `own-count.ts`): find each place by name.

Rules for both: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report, but do not wait longer than 20 minutes for a queue under host load: then run the test files of the directories you changed directly, one at a time, `timeout 900`, and say which you ran. The bundle tests fail on drift until the coordinator builds, which is expected. Grep `test/`, `test/e2e/**`, `evals/**` and the skill copies for every sentence or name you change, and run each e2e file that pins a changed sentence. Write `~`, never a `/home/<user>/` path. Never run a script under `evals/bin`.

## W1: 005-122, slices 1 to 15 and one review note

Use /worker. Shape: slice, one commit per slice (or per pair that shares a file). Scope: `quality/2026-11.md`, section "Slices", items 1 to 15; plus note N1 of `reviews/0.1.553.md` (the comments in `src/core/delivery/view-mark.ts` still say only a registration writes the mark; an unrestricted delivery writes it too since row 005-113).

For each slice, first check that it is still true on this baseline: rows landed since the scan may have done it (slice 5: row 005-111 moved the slow-start sentence to `utcTimeText`; slices 2 to 4 and 8 touch text that rows 005-114, 005-116 and 005-119 moved). Write one line per slice in `tasks/005-122/notes.md`: done (commit), already done (by which row), or dropped (why). Slices that only move or merge code change no text. Slices 5 and 6 change text the agent reads (one time format, one duration format): give each sentence before and after in the notes. Slice 1 needs its proof test first. Slice 12: merge the two queries only if `test/keys/key-format.test.ts` still passes; the comment fix stands either way. Slice 15 is optional: skip it.

Owns: the files each slice names, their tests. Leave alone: `src/harness/shared/{session,prompt,owed}.ts`, `src/harness/pi/**`, `src/harness/opencode/**`, `src/core/presence/**` except slice 14 (`startMarked` in `marks.ts`), the test helper files W2 creates.

## W2: 005-121, one hook-text parser and one lock-and-start-mark fixture for the tests

Use /worker. Shape: slice, tests only. Scope: the board row 005-121 and the row `proposed-test-helpers-shared` in `quality/2026-11.md`. No product file changes. Replace the copies file by file; a test's assertions do not change. W1 edits some test files at the same time for its slices: keep each of your edits to the helper import and the replaced copy, so the two merge.

Owns: `test/harness/helpers.ts`, a new helper under `test/helpers/`, and the copies in the test files the row names. Leave alone: `src/**`.

Final message, each worker: the commits, one line per slice or per replaced helper, any text change with before and after, check results with their commands.
