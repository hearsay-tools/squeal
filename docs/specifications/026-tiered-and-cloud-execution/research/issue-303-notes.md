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

Review 0.1.662 B2 (repair R2): `ls-files -s` and `--index-info` drop the
intent-to-add flag (`git add -N`). The index hash now also covers `git diff
--cached --name-status -z`, which omits an intent-to-add path and lists a
staged empty file. Options fix renames, colour, external diff and
submodules against user config. `stagedIndex` reads the flag from `git
ls-files --debug` (`CE_INTENT_TO_ADD`, `0x20000000`). `INDEX_SCRIPT` takes
those paths in a second section and marks them with `git reset -q -N HEAD
--pathspec-from-file`, with literal pathspecs. That command changes only
the index: no working-tree file is written. Known limit: an intent-to-add
path that is also in HEAD (`git rm --cached p; git add -N p`) comes back as
HEAD's entry there. The hashes then differ, so the machine stays not
current: it never claims a wrong index as current. A remote Git whose
`diff --cached` treats intent-to-add differently from the local Git gives
the same safe result.

## Cost of the freshness read (measured, R2)

`localGitState` runs at every `gitKeeper.sync`, including `sync(null)` in
`refreshGit` before each lane tier split, and at wake. Median of 21 calls
on 2026-11-27, on this host (16 CPUs, load average 3.3 to 4.0, not a quiet
host), Git 2.43.0, Node 26.13.0, script `/tmp/ed28-measure.mts` (not kept):

| Index | Refs only (before 026-39) | + `ls-files -s` hash (first round) | `localGitState` now (+ staged diff names) |
| --- | --- | --- | --- |
| this repository, 20,435 entries | 8.2 ms | 25.8 ms | 34.0 ms |
| synthetic, 100,000 entries, clean | 5.2 ms | 52.6 ms | 63.2 ms |
| synthetic, 99,671 entries, about 330 staged changes and one intent-to-add | 4.6 ms | 49.9 ms | 62.2 ms |

The added cost grows with index entries: the listing adds about 0.5 to
0.9 ms per 1,000 entries, the staged diff 0.1 to 0.4 ms per 1,000 (it uses
the cache tree). This is local CPU time per tier split, with no SSH. No
paired boat.dev benchmark ran: the wave brief names no benchmark cells.
The review asks for one under process step 6c; that is the coordinator's
call.

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
