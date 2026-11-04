# 019-37 notes: a commit's not-determined files, and s1c's cause

Worker 3841473c, 2026-11-04. Row 019-37, lessons P11 (`../../lessons.md`, Round 2, "Proposed rows"). Two parts: `status --full` names the files, and the cause of s1c's "1 test file not determined (unstaged changes)" on a clean tree is fixed.

## The cause of s1c

cezarion's `packages/mobile/.gitattributes` has `android/gradlew.bat text eol=crlf`. A checkout writes the file with CRLF. Each commit holds it with LF. Git reads the file as unchanged, so `git status` is clean.

Squeal's stat cache hashes the bytes on disk with no git filters (spec 001 D3). `readCleanIndexHashes` (`src/core/hash/git-index.ts`) does not take the index hash for a file with a converting attribute, so the cache holds the hash of the CRLF bytes. The commit holds the LF blob. `differingPaths` (`src/core/commit/compute.ts`) compared the two, so `gradlew.bat` differed from every commit on a clean tree.

cezarion's `squeal.config.json` gives `.github/scripts/change-surface-readers.test.cjs` the input `packages/**`. That glob covers `gradlew.bat`, and no other test file's inputs do (checked with `path.matchesGlob` over every `inputs` entry). So exactly one test file was not determined. This matches s1c. Round 1's c3 had the same count. It was then put on gh-134's stray file, but this cause explains it too.

The symlink guess (`../019-33/bin/symlink.sh`) was right to be refuted: `CLAUDE.md` hashes as git stores it.

## Reproduction

In a `git bundle` copy of cezarion at `10e7a5782` (Round 1's bundle, `/tmp/dogfood-019-17/bundles/cezarion.bundle`), cloned under `$TMPDIR`. No daemon and no test ran. Nothing ran in cezarion's checkout.

- `git ls-files -s` against `git hash-object --no-filters` over every tracked file: only `packages/mobile/android/gradlew.bat` differs (blob `9d21a21`, bytes `9b42019`). `git hash-object --stdin-paths` (filters on) gives `9d21a21`.
- `bin/differing.ts <squeal worktree> <clone> old` runs Squeal's own `seedStatCache` and `differingPaths` against `HEAD` as before this row: `git status` empty, `differing: [ 'packages/mobile/android/gradlew.bat' ]`. Without `old`: `differing: []`.

## The fix

`differingPaths` collects the paths both sides hold at different blobs, with the hash each key was made of. It asks git for the blob git would store for those bytes (`storedBlobs`, `src/core/commit/stored.ts`). A path whose key's bytes git stores as the committed blob is not a difference. A tree that is the commit's asks git nothing.

Review 0.1.401 B1: the first version asked git about the file as it was at the time of the report. A file restored to the commit's bytes after its key was made then lost its difference, and the edit's result counted as the commit's (`failures: 1, notDetermined: 0`). Now git's answer counts only for the bytes the key was made of:

1. Each file is read once (no symlink followed). Its bytes must hash to the cached hash, and its stat must be outside the racy window (`isRacy`, the stat cache's own rule, 2 s).
2. One `git hash-object --stdin-paths` call hashes those files, with their attributes and `core.autocrlf` applied, bounded by the `git ls-tree` timeout (30 s).
3. A file whose stat moved across git's read (`sameStat`) is left out.

A file left out stays a difference, and so does every file when git fails. A converted file written in the last 2 s stays "not determined" until it is older. A commit report made then shows it, and a later report or update does not.

- `CommitView` has `storedBlobs(hashes)`. The daemon's view (`viewOf` in `src/core/scheduler/head-move.ts`, 019-35's file) has one more line for it, by the coordinator's agreement, in its own commit. The B1 repair changed the argument from paths to a map of path and cached hash; that line did not change.
- Only regular files are asked: git follows a symlink. A path with a newline or a leading quote is not asked.
- Cost before B1, git only: 6 ms for 1 path, 85 ms for 200 and 677 ms for 2,000, at a host load of 52.8. The B1 repair also reads each such file once in Node. The count is the number of files that differ from the commit, so a normal commit asks for none or a few.
- `core.autocrlf true` had the same defect for every text file: every test file would read "not determined". A real-git test covers it.

## Tests

- `test/commit/stored.test.ts`: a real repository with an `eol=crlf` file checked out as CRLF. The seeded cache hash is not the committed blob, and `differingPaths` gives nothing. An edit of that file still differs. The same holds under `core.autocrlf true`. `storedBlobs` skips a symlink, a missing path and a newline.
- `test/scheduler/commit-report.test.ts`, "a file git converts at checkout": a real repository and scheduler, s1c's shape. With the old behaviour (the view's `storedBlobs` stubbed to hash nothing), it failed with `test/b.test.ts` not determined through `app/gradlew.bat`. With the fix, the report is `0 known failures`. An unstaged edit of the converted file still names its reader.
- `test/scheduler/commit-report.test.ts`, "a source restored after the commit's tree is read" (review 0.1.401 B1, the reviewer's control): `committedBlobs` is wrapped to restore `src/a.ts` to the commit's bytes, a minute old, right after the real read. This runs twice, with a failing and with a passing result at the edit's key. Both give `notDetermined: 1`. Without the hash and racy checks they gave `failures: 1, notDetermined: 0` and `notDetermined: 0`.
- `test/commit/stored.test.ts`, B1 part: a file restored after its key was made stays a difference; a file inside the racy window stays a difference until it is older; a moved file, a symlink, a missing path and a newline are not asked.
- `test/commit/compute.test.ts`: `differingPaths` asks git only for paths both sides hold at different blobs, and nothing on a clean tree. `testTally` names files within the caps.
- `test/status/group-lines.test.ts`: `status --full` lists each not-determined file with its paths. Plain status names them in its `More:` line. `--json` carries them.

## Naming the files

The report keeps the first 10 not-determined test files (`NOT_DETERMINED_KEPT`). For each file it keeps up to 5 of the paths that make it so (`THROUGH_KEPT`): the environment inputs first, then the closure's paths. It also says when the working tree deleted the file. They are stored in `tests.notDeterminedFiles` of the stored report, so `head-move.ts` needed no change for them. `CommitLine.notDetermined` carries the count and the files to status. `status --full` prints, under the commit line:

```
Commit 172965e: 0 known failures; lint 1 finding; 1 test file not determined (unstaged changes)
  .github/scripts/change-surface-readers.test.cjs is not determined: packages/mobile/android/gradlew.bat differs from the commit
```

The commit line's own text is unchanged; delivered lines are the same.

## For the next worker

- Commit lint compares blobs on its own. `src/core/commit/lint.ts` compares the recorded config inputs (line 53) and the judged blob (line 127) with the committed blob. A linted file that git converts (an `eol` or `filter` attribute on a `.ts` file, or `core.autocrlf true`) would read "not determined" in the lint part on a clean tree. This row did not touch `lint.ts`. The same `storedBlobs` answer could serve it.
- Any other comparison of a stat-cache hash with a committed blob has the same edge. `commit-moment.ts` takes `differing` from `differingPaths`, so it is fixed with it.
- `andText` in `src/core/status/commit-lines.ts` is the seventh copy of "a, b and c" in `src/core` (a /quality item).
