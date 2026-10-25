# 011-199 notes: a pass checks the files committed since the last pass

Worker W2 of wave 35, 2026-10-25. Commits `0b8d07d9d` and `79b1676e0`, from main `b8708e6dc`.

## The change

A reconciliation pass listed `git status`, the stat cache and the extra files. A file added and committed while its watcher event was held is in none of them (`tasks/011-197/findings.md`, recommendation 3). Now:

- `Feed#reconcileNow` reads `HEAD` with `readGitHead` (git dir files, no spawn) just before `git status`.
- `committedSince(root, since, head)` (`src/core/watcher/candidates.ts`) adds paths to the pass's list:
  - nothing when `HEAD` equals `since`, or `HEAD` is unborn;
  - `git diff --name-only --no-renames -z <since> <head>` when `HEAD` moved;
  - `git ls-files -z --cached` when there is no `since` (the feed's first pass, or a pass that saw no commit), or when the diff fails (the commit `since` names was rewritten away and pruned).
- `Feed#passHead` takes the head only after `onBatch` resolves. A batch that fails (a busy store) leaves it, so the retry or the next pass diffs from the same head again.

`--no-renames` lists both sides of a rename. A deleted path is a candidate with a `null` stat; the reconciler ignores it when the cache never had it. A submodule's gitlink path is a directory with a `.git` entry, so `candidatesForReconcile` drops it as a nested repository.

## Why the feed keeps its own head (decision, accepted by coordinator 04a258b0)

The row's lead was the head of the last revision or `head-move` record, which only the scheduler holds. The feed's own head is the better reference, and it needs no scheduler interface:

- The scheduler reads the `HEAD` it records after the pass's `git status` (`batch.ts:47`, `head-move.ts`). A commit made between the two would be in that head, but its file would not be in the status. A diff from the recorded head would miss it. The feed reads `HEAD` before the status, so such a commit is in the next diff.
- The first pass's `ls-files` covers the daemon's start. `keys.bootstrap` lists files with `git ls-files` at scan time. The feed's watch starts only after the baseline (`createDaemonLoop`). A file added and committed in between has no event, no status entry and no cache entry. Every tracked file is a candidate on the first pass, so it is found.

Watch batches do not move the pass head; only a pass does. A pass after a rewatch (`reconcileNow("watch")`) does.

## Cost on this repository

A clone of this worktree at `b8708e6dc` in `/tmp`: 7,697 tracked files, 7,720 pass candidates. Throwaway benches run with `tsx` at `nice -n 10`, with `HOME`, `XDG_*` and `TMPDIR` under the scratch directory, and no daemon. The host's load average was 35 to 39 on 24 cores.

The added calls alone (40 runs each; `readGitHead` 1,000 runs):

| Call | When | Median | p90 |
|---|---|---|---|
| `readGitHead` | every pass | 0.04 ms | 0.07 ms |
| `git diff`, `HEAD` moved 1 commit (1 path) | a pass after a commit | 5.4 ms | 6.9 ms |
| `git diff`, 10 commits (10 paths) | | 5.1 ms | 6.2 ms |
| `git diff`, 100 commits (250 paths) | after a pull or rebase | 9.1 ms | 18.3 ms |
| `git ls-files --cached` (7,709 paths) | the first pass | 12.2 ms | 15.4 ms |
| union of those paths into the candidate set | the first pass | 0.9 ms | 1.4 ms |
| `git status`, for scale | every pass, already | 37.2 ms | 44.3 ms |

Event-loop turns, which decide a pass's time when the loop is starved (011-197): with a chain of synchronous 50 ms steps on the loop, the diff spans 3 steps and `ls-files` 5 (`git status` spans 3 to 4). 011-197 measured about 800 turns for one pass.

The candidates: the diff's paths are files the stat cache already holds, apart from a new file, so they add no stat. In a daemon, the stat cache holds every tracked file after `keys.bootstrap`, so the first pass's `ls-files` adds no candidates unless a commit landed during the start.

Whole passes, `createChangeFeed` with a silent backend and every tracked file as the tracked paths, main's sources against this branch's, 6 interleaved rounds:

| | First pass (`start`) | Idle pass | Pass after a commit |
|---|---|---|---|
| main | median 1,203 ms (724 to 1,762) | median 847 ms | median 866 ms, 7,720 candidates, without the new file |
| this branch | median 1,146 ms (961 to 1,663) | median 910 ms | median 772 ms, 7,721 candidates, with the new file |

**Is the first pass slower than at main?** By about 13 ms: the `ls-files` call and the union, about 1% of a first pass of 1.1 to 1.2 s. The whole-pass medians do not resolve that difference under this load (pass times vary by ±400 ms). A pass where `HEAD` did not move adds 0.04 ms. A pass after a commit adds about 5 ms.

## Limits and leads

- `readGitHead` reads no reftable store (git's `--ref-format=reftable`): `HEAD` reads `null` there, and the pass adds no diff, as at main. The `head-move` record (task 001-406) has the same limit. `git rev-parse HEAD` as a fallback when the read is `null` would cost one spawn per pass in such repositories.
- W1's `beforeFullSuite` pass (row 011-198) goes through `reconcileNow` too, so a `run --all` also finds a committed add.

## Tests

`test/watcher/committed-add.test.ts`, the feed wired straight into `reconcile` with a backend that never reports. Each names `test/added.test.ts` as a candidate and as an added change of a revision:

- added and committed after the first pass; on main, no candidate and no revision;
- committed before the first pass, after the stat cache was seeded (the daemon's start);
- committed after the pass's head was reset away and pruned (`reflog expire`, `gc --prune=now`);
- the first commit of a repository whose earlier pass saw an unborn `HEAD`;
- the pass after one whose batch failed (verified: with the head taken before `onBatch`, this test fails);
- and, without the cache: a pass where `HEAD` stayed lists no committed file again.

`test/watcher/change-feed.test.ts`'s start-pass test now expects `.gitignore`, which its tracked paths leave out (agreed with the coordinator).
