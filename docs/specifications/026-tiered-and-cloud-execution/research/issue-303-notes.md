# Row 026-39 (#303): worker notes

Worker notes for row 026-39, wave 15. They record what the row changed, why
the other providers need no change, and the bounded diagnosis of the
post-commit stale `ENOENT`. Findings: [issue-303.md](issue-303.md).

## What changed

- `agent37/bootstrap.ts`: the Git state (`STATE`) ends with a third block,
  the index hash `git ls-files -s -z | git hash-object --stdin`. The state
  key is HEAD, branch or detached, tags, then `index <hash>`. `refs` is
  unchanged, so the bundle cache key (`fullBundleKey`) is unchanged.
- `ensureGitTree` sends the bundle only when `refs` differ. It then sends the
  staged index when the key still differs. A rename staged on an unchanged
  HEAD costs one SSH call with no bundle.
- `agent37/git-index.ts` (new): `stagedIndex` compares `git ls-files -s`
  with `git ls-tree -r HEAD`. For each path whose entries differ, it emits a
  mode-0 removal and then the local entries, with every stage. It also packs
  the blobs those entries name. `INDEX_SCRIPT` unpacks the pack, resets the
  index to HEAD and applies the lines with `git update-index --index-info`.
  The remote index then gives the same `ls-files -s` output, so the keys are
  equal and the next sync makes no SSH call.
- Edge cases are covered by `agent37-git-index.test.ts`: staged content in
  no commit, `git rm --cached`, `git add -N`, unstage, a commit with a
  staged rename in one sync, and a merge conflict's stages 1 to 3.
  Gitlinks are never packed. The empty blob is written on the remote by
  `hash-object -w`, because it can be absent from the local object store.

Cost: each `gitKeeper.sync(null)` (`refreshGit` before a tier split) now
also runs `git ls-files -s -z | git hash-object --stdin` locally. That is a
linear read of the index (milliseconds for tens of thousands of entries).
Not measured on a large repository.

## Other providers

`ssh` and `command` do not sync Git. Their `hasGitRepository` is a
capability the user declares (`command.ts` reads it from the hook's
answer). Squeal writes no `.git` there and defines no `syncGit` or
`gitCurrent`. The remote checkout belongs to the user, so its index is
whatever the user keeps there. No change.

## Post-commit diagnosis (bounded, read in source code)

Question: why did `squeal run tests <file>` say "current; none runs again"
for the stale `ENOENT` after the commit?

Answer, inferred from source: the result's key did not change across the
commit, and nothing reran it.

1. The test read Git's index through a `git` child process. The recorder
   (`src/runners/observe/recorder.cjs`) follows Node children only. It also
   keeps no path under `.git/`. `src/core/keys/observed.ts` hashes the
   worktree's `.git` by kind only (`gitEntryByKind`). So neither the index
   nor HEAD is a key input.
2. The failing remote run read `src/new.ts` (present) and tried
   `src/old.ts` (absent; an absent read is kept as an input). `git mv` had
   already moved the file, so these observed inputs were the same before and
   after the commit. The commit changes only `.git`, and the watcher does
   not see `.git`.
3. The run was accepted as a valid remote result. Before this row, the
   machine's `gitCurrent()` said true: the key held HEAD, branch and tags
   only, and these were unchanged. So `hasGitRepository` held, and the
   result was stored as current under inputs that the commit did not move.

With this row, `git mv` changes the key. `refreshGit` before the next split
syncs the index, or the machine counts as no Git repository until it is
synced. A new run then sees the correct index. A failure stored before this
fix stays current until one of its observed inputs changes: this row does
not re-key stored results.

Possible follow-up (a new row, not this one): make Git metadata a key input
for tests that run `git`, or invalidate remote results recorded while the
machine's `.git` was stale. Not determined: the issue's actual stored key
and lane timeline. These need a capture of the exact reported sequence.
