# 011-18 amendment draft: a first-seen failure with no baseline (gh-32)

Status: draft by the coordinator, 2026-10-18, for the human's acceptance. Source: issue #32, `../../research/issue-32.md`. The human approved the wording "no baseline result, may predate your edits" (round 6); this draft adds what that leaves open: what counts as a baseline, how to settle one, and the closure-touch line.

## Proposed C5 text

Amended 2026-10-18 (the human, gh-32, row 011-18): a failure delivered `first observed: FAIL` says what Squeal knows of the check before the session's edits. Its **baseline** is a stored result for the check at the key it had at the revision current when the session's consumer registered, in this worktree or any other through the shared store (C7), looked up and never run for this purpose:

- none: `first observed: FAIL; no baseline result, may predate your edits`;
- a fail: `first observed: FAIL; it also failed before your edits (<worktree> at commit <sha>)`;
- a pass: unchanged, the transition is `PASS -> FAIL`.

The closure-touch line stays a fact and never a cause: `its closure reads files changed here since this session started: <paths>`, replacing `touches files changed here since this session started`. Squeal does not drop it when the failure's message names other files, since a diagnostic's location need not name every input that caused it.

## The base-check command: two options

1. **No new command (recommended).** With no baseline, the line ends `to settle it, run it in a checkout of <base sha>: its result is shared with this worktree`. Any Squeal daemon at that commit stores the result in the shared store, and this worktree's next delivery reads it as the baseline. Nothing new runs code outside the agent's own worktree.
2. **`squeal baseline <file>`.** An explicit command creates a detached temporary worktree at the registration revision's commit, runs that one file there with the same runner and policy, stores the result through the shared store, and removes the worktree. It is never automatic. It costs a new C-section (worktree creation, install state, cleanup on interruption) and a full install in the temporary worktree for Node projects.

## Done when

A first-seen failure says none, fail-before or nothing extra, matching a store seeded with an absent, a failing and a passing baseline, including a broad scan test whose diagnostics name other files; the closure-touch line reads as above on registration, deliveries and `why`; under option 2, the command's own tests cover creation, the run, cleanup and an interrupted run.
