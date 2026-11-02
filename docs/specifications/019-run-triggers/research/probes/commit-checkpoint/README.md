# Probes for topic `commit-checkpoint` (throwaway)

These scripts are throwaway evidence for `../../commit-checkpoint.md`. They are not product code, are not tested, and may be deleted once spec 019 is written.

- `hooks.sh <fresh dir>`: makes a fixture repository in that directory, installs logging `pre-commit`, `post-commit`, `post-rewrite`, `reference-transaction`, `post-checkout`, `post-merge` and `pre-merge-commit` hooks in `.git/hooks`, and runs a plain commit with partial staging, an amend, `--no-verify`, a rebase of two commits, a cherry-pick, a `--no-ff` merge, a reset, a commit in a linked worktree, a commit with `core.hooksPath` set (as husky sets it) and one with `-c core.hooksPath=/dev/null`. Output: `logs/hooks.txt` (git 2.43.0, 2026-11-03).
- `daemon.sh <fresh dir>` with `store.mjs`: makes a fixture repository with one node:test file, starts a Squeal daemon (`squeal` 0.1.392 on PATH), commits an edit the daemon already saw, waits 5 s and 40 s, then makes a partial commit, and prints the store's revisions and head-move rows from a copy of the store. Stops the daemon on exit. Output: `logs/daemon.txt`.
- `transcripts.mjs [projects dir] [project substring]`: counts the `git commit` Bash calls in this host's Claude Code transcripts (shell form, `--amend`, `--no-verify`, failed commits, hook refusals). Prints counts only. Output: `logs/transcripts.txt`.

Every fixture was made under the task's `$TMPDIR` and removed after the run.
