# 001-406 notes: a revision is shown with its commit

## What changed

- **Text.** Headers, `status` and `why` print `Revision 79 · 1bc146f0 + 3, dirty`: the worktree's revision number (unchanged, still the one counter that waits, the store and checkpoints use), HEAD's first 8 hex digits, the revisions recorded since HEAD last moved, and `, dirty` when the tree was dirty. A clean tree prints no marker. Before a first commit (`head` null) the number stands alone, as before. One function renders it, `revisionText` in `src/core/state/revision-commit.ts`.
- **JSON.** `StatusHeader.commit?: RevisionCommit` (`{ head, sinceHead, dirty }`), so `status --json` and every delivered header carry it. `WhyResult.commit?` is the same. Both are additive.
- **Reader.** `readRevisionCommit(store, worktreeId, latest)` reads the store only, so hooks need no git. It uses one new repo query, `RevisionRepo.lastAtOtherHead(worktreeId, head)` (newest revision at another HEAD, `ORDER BY number DESC LIMIT 1` on the primary key).
- **A commit with no file change.** A revision records HEAD only when files change, so a commit alone left the header on the old SHA. Now a reconciliation pass that makes no revision (any trigger but `watch`: the 30 s idle pass and a `status --wait` sync) compares HEAD, read from the git dir's files with `readGitHead` and no spawn, against what is known. On a move it runs `context.head()` (`rev-parse` and `git status`) once and stores `head-move.<worktreeId>` = `{ head, dirty, revision }` (`headMoveMetaKey`, registered in `WORKTREE_META_ROWS`). `src/core/scheduler/head-move.ts`, called from `reconcileBatch`.

## Counting rule

- If the stored move is at or after the latest revision and names another HEAD, the commit is newer than every revision: `<move.head> + 0`, with the move's dirty flag. That covers both "clean at HEAD" and "a partial commit leaves `+ 0, dirty`".
- Otherwise HEAD is the latest revision's. K counts from the stored move when it names this HEAD (edits after a commit: `+ 1`, `+ 2`, ...). It counts from the revision after the newest one at another HEAD when the move came with files (a checkout's revision is `+ 0`). With every revision at one HEAD, it counts all of them.
- Dirty is the latest revision's flag, or the move's.

## Known limits

- An edit made within the same pass window as a commit, before the pass saw HEAD move, makes the edit's revision the first at the new HEAD. It reads `+ 0, dirty` instead of `+ 1, dirty`. The next edit counts on correctly.
- A commit shows within 30 s (the idle pass), or at once with `status --wait`, which syncs first. Hooks never run git.
- `shortCommit` in status's `Worktree:` line still uses 7 digits. The revision text uses 8, as the board row's example does.

## Tests

`test/state/revision-commit.test.ts` covers four format cases (clean at HEAD, edits after a commit, a partial commit, a checkout that moves HEAD), plus the all-one-HEAD and stale-move cases and the null-HEAD form. Against a real git repo, it also checks that `recordHeadMove` runs `git status` only on a move, records a partial commit as dirty, and does not record it twice.
