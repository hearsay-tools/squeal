# 006 wave 1.6: third and last repair, `reviews/wave-1.5.md` B1, B2, SF1, SF2

Bought by the human on 2026-10-11, after the second failing review. One worker and one narrow review: the round ends at the review's verdict.

## 006-08 repair: nested evidence, shell termination, malformed inputs

Use /worker. Shape: repair. Read `../reviews/wave-1.5.md` first. Each finding gives its probe, and B2 gives a Bash control. Write each one as a failing test before the fix. No subject sessions: use synthetic transcripts, fake harness binaries and made-up tokens, in your own `/tmp` directory. Never print a matched value.

- **B1** (`evals/lib/scratch.mjs`, `evals/bin/run-cell.mjs`): the scan and the removal follow one policy. Every directory the scan skips, which is any `node_modules` at any depth and `.git/objects`, is removed from retained evidence under `work/` and `out/`. Anything retained is scanned. Test a token at `work/packages/a/node_modules/leak.txt`: check the bytes left on disk, not only the report. A surviving token deletes the grade and fails the cell.
- **B2** (`evals/lib/shell.mjs`, `evals/lib/commands.mjs`, `evals/lib/grade.mjs`):
  - After `exit` or `exec`, every later action in the call is unreachable.
  - After `set -e` (or `set -o errexit`, or `bash -e`), any action after a command that can fail is indeterminate, unless its own output establishes it (the rule 006-06 already has).
  - Unreachable and indeterminate actions are never credited.
  - Test the review's three commands, each through transcript grading, against its Bash control. Keep every repaired 006-06 case passing: `false &&`, heredocs, and an edit then a run in one call.
- **SF1** (`evals/lib/grade.mjs`): a Vitest report counts only when its required fields and counts agree with the per-file statuses, and every assertion has a completed status. Skipped and todo tests stay legitimate, and a completed report with failures is still read as a failure. The five count fields (`numTotalTests`, `numPassedTests`, `numFailedTests`, `numPendingTests`, `numTodoTests`) are required, and must match the per-file tallies. A report missing any of them is truth unavailable, since the pinned Vitest always writes them. The report fixtures in `test/evals/truth.test.ts` and `grade.test.ts` gain the counts in a commit agreed with the coordinator (2026-10-11). Anything else is "truth unavailable". Test through the grader CLI.
- **SF2** (`evals/lib/grade.mjs`): every numeric member the verdict reads must be a finite count of zero or more. An unsupported shape gives `supported: false`, verdict unknown, and no credit for a matching pass. Optional header fields keep their documented defaults. Test through the grader CLI with the review's object.

**Owns:** `evals/lib/{scratch,shell,commands,grade}.mjs`, `evals/bin/run-cell.mjs` (only for B1's grade-and-fail path), and new test files under `test/evals/`. Leave every other file alone.

**Done when:** every probe in `../reviews/wave-1.5.md` is a passing test, the earlier wave-1 and wave-1.5 tests still pass, and the repository gate is green.

## 006-09 narrow review of wave 1.6

Use /reviewer. Range `5912a6bc^..83cb575c` (006-08's six commits on main). Limited to B1, B2, SF1 and SF2 of `../reviews/wave-1.5.md`, by the human's decision. For each: re-run its probe, then the nearest variants. For B1: other skipped directory names and depths, symlinks inside retained evidence. For B2: `exec`, `set -o errexit`, `bash -e -c`, `exit` inside a subshell (which does not end the outer shell), and `||` after `set -e`. New findings count only in the changed lines. No other area is reopened. Probes use synthetic inputs, with at most 2 subject sessions below load 24. Findings go to `../reviews/wave-1.6.md`.
