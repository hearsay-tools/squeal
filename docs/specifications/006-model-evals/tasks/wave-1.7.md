# 006 wave 1.7: fourth repair, `reviews/wave-1.6.md` B1 and B2

Bought by the human on 2026-10-11, after the third failing review. One worker and one narrow review: the round ends at the review's verdict. Both fixes fail closed: when the grader or the scan cannot be sure, it never credits a command and never certifies output as clean.

## 006-10 repair: surviving links, failing builtins

Use /worker. Shape: repair. Read `../reviews/wave-1.6.md` first. Each blocker gives its probe, and B2 gives Bash controls. Write each one as a failing test before the fix. No subject sessions: use synthetic inputs, fake harness binaries and made-up tokens, in your own `/tmp` directory. Never print a matched value.

- **B1** (`evals/lib/scratch.mjs`, the symlink branch of `scanForSecrets` and `prune`):
  - A symlink that survives cleanup is unsupported retained evidence, whatever its target path holds. The scan reports it as unscanned, so the runner deletes the grade and fails the cell.
  - Never follow or modify the link's target.
  - Test an ordinary removable link (removed, the cell passes) and a link in a non-writable directory (the cell fails, the grade is gone). Check the retained paths, the runner's actual exit and whether the grade exists.
- **B2** (`evals/lib/shell.mjs`, `NEVER_FAILS` and `canFail`):
  - Only a bare `true` or `:` with no redirection is assumed to succeed.
  - A command with any redirection can fail.
  - `set`, `export` and `unset` can fail, so after them under errexit, later actions are indeterminate unless their own runner output establishes them.
  - Test the review's four commands (the redirection case also under `set -o errexit` and `bash -e -c`) through transcript grading and the grader CLI, each against its Bash control.
  - Keep bare `true`, subshell-local `exit`, a handled `||`, heredocs and edit-then-run ordering passing.

**Owns:** `evals/lib/scratch.mjs`, `evals/lib/shell.mjs`, and new test files under `test/evals/`. Leave every other file alone.

**Done when:** every probe in `../reviews/wave-1.6.md` is a passing test, every earlier evals test still passes, and the repository gate is green. Do not run `npm run build` in your worktree.

## 006-11 narrow review of wave 1.7

Use /reviewer. Range `286d76b0^..312fd2b9` (006-10's two commits on main). Limited to B1 and B2 of `../reviews/wave-1.6.md`, by the human's decision. For each: re-run its probe, then the nearest variants. For B1: a link to a directory, a link inside a nested unkept directory that cannot be removed, a FIFO or socket in retained evidence. For B2: other builtins with redirections, `set` forms that change errexit, `command`, `builtin`. New findings count only in the changed lines. No other area is reopened. Probes use synthetic inputs, never a real subject session. Check in a scratch copy, never by building in your worktree. Findings go to `../reviews/wave-1.7.md`.
