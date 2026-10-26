# 011-201 notes: a pass reads HEAD from git when the git dir reader cannot

Worker W1 of wave 45, 2026-10-26. Commit `50976ff37`, from main `eb417c9b1`.

## The change

- `passHead(root)` (`src/core/watcher/candidates.ts`) returns `readGitHead(root)` when that is not `null`. Otherwise it runs `git rev-parse --verify -q HEAD` (exit 1 is accepted, for an unborn `HEAD`) and returns its output, or `null` when the output is empty.
- `Feed#reconcileNow` (`change-feed.ts`) calls `passHead` where it called `readGitHead`. The call is still before `git status`, so the 011-199 rule holds: a commit made between the two is in the next diff.
- `readGitHead` (`src/core/status/git-head.ts`) did not change. It stays synchronous and spawns nothing, because status reads it.

## Decision: the fallback sits at the head read, not in `committedSince`

The brief's lead put the fallback in `committedSince`. But `committedSince` runs after `git status`, and the head it gets is also the head that the feed stores as `passHead`. A fallback inside `committedSince` would read `HEAD` after the status, and the stored head would stay `null`, so every pass would list every tracked file (`ls-files`). So the fallback is a separate function that the call site uses before the status. It is in `candidates.ts`, next to `committedSince`.

## Why a reftable repository gave `null`

Git writes `.git/HEAD` as `ref: refs/heads/.invalid` and `.git/refs/heads` as a regular file. The reader looks for `refs/heads/.invalid` as a loose ref, gets `ENOTDIR` (which `isMissing` treats as missing), then finds no `packed-refs`, so it returns `null`. Before this change, `committedSince` returned `[]` on every pass, the first pass included.

## Cost

One `git rev-parse` spawn per pass, only where the file reader gives `null`: in a reftable repository, and in an ordinary repository while `HEAD` is unborn (no commit yet). Where `HEAD` resolves from files, nothing changes. 011-199's benches measured a `git diff` spawn at about 5 ms. `rev-parse` does less work than that.

## Tests (`test/watcher/committed-add.test.ts`)

- A reftable fixture: added and committed after the first pass, with the hint held. The next pass names the file as a candidate and as an added change. It is skipped with the reason where `git init --ref-format=reftable` fails (Git before 2.45). This host has Git 2.43.0, so the case was skipped here and is **unverified on a real reftable store**.
- The "HEAD stays" case runs a second time with `readGitHead` mocked to `null` (`vi.mock` with a pass-through flag), for any Git. On main it fails at the first pass (`[]` instead of `["src/a.ts"]`). It shows the three properties: the first pass lists the tracked files, a pass where `HEAD` did not move lists no committed file (the stored head is the `rev-parse` head), and a commit then lists the added file.
- The existing first-commit case (unborn `HEAD` on the pass before) now goes through the fallback's exit-1 path on every Git.

## Limits and leads

- The `head-move` record (task 001-406) and status's `HEAD` line (`src/core/scheduler/head-move.ts`, `src/core/status/identity.ts`) still use `readGitHead` alone, so they still read `null` in a reftable repository. They are outside this row's files.
- A CI job on a Git of 2.45 or later would run the reftable case. The CI image's Git version was not checked here.
