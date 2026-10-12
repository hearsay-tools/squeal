# 001-300 notes: linked directory targets get their exclusions

Worker notes, 2026-10-12. Read with `research/nested-worktree-watch.md` R3 and spec 001 D2 (amended in place, 2026-10-12).

## What changed

- `src/core/watcher/linked-exclusions.ts` (new): `linkedExclusions(root, links, target, dirs?)` walks the target one directory level at a time. It leaves out a directory that holds a `.git` entry, and one that git ignores as `link/dir/` under every link to the target. The question goes through `ignoredAsDirectories` (`links.ts`, unchanged). Its scratch tree copies each `.gitignore` above the asked path, so `root/lib/sub/.gitignore` is read through the link: the target's own ignore files apply where git would apply them if the link were a directory. The walk makes one git call per level and does not descend into a directory it leaves out, nor follow a link inside the target.
- `src/core/watcher/linked-watch.ts`: each target's watch spec takes those exclusions instead of `excluded: []`. They are recomputed:
  - on every `update`, which is every reconciliation;
  - on a `.gitignore` hint in the target;
  - for each directory hinted as added, and for the parent of a `.git` that appears.

  Queued hints join one pending step. A change of exclusions replaces the subscription: the new one is ready before the old one closes. A directory no longer left out is sent to the feed as an `unknown` hint under each link, and the feed walks it.

## Seams found

- **chokidar 5 `unwatch(dir)` keeps the watches below `dir`.** `_closePath` and `_closeFile` close only that path's own closers. Measured with a scratch probe: 502 inotify watches on a directory holding `nm/` (50 directories of 9 files), 501 after `unwatch([nm])`. `chokidarBackend.update` therefore cannot release a directory it starts excluding once it is watched. This row replaces the subscription instead. The coordinator forwarded the finding to 001-299 (`update()`).
- **Classification is unchanged (coordinator's option a).** `checkIgnored` and the link walks in `candidates.ts` keep D2's rule: a path beyond a non-ignored link takes the link's class. So `lib/node_modules/**` are still candidates, each reconciliation walks them, and a change there is found by the pass, not the watch. `node_modules` never enters a closure (`closure.ts`). A later row could classify `link/<ignored-as-dir>/**` as ignored if a closure is ever seen to read there; that change would also change the key format. `linked-files.ts` (the start seed) is unchanged on purpose: it must match the reconciliation walk.
- **Several links to one target**: only what every link ignores is left out, so no link loses a path its own rules keep.

## Cost

A full recompute walks the target's kept directories, as the reconciliation's own walk does, and makes one `check-ignore --no-index` per directory level. It runs on each `update`, which is each reconciliation; at most one step is queued per target.

## Tests

`test/watcher/linked-exclusions.test.ts`:
- Linux only, counting `inotify wd:` lines in `/proc/self/fdinfo`, with a 2,000-path install. The watch delta stays within the root's and the target's own paths plus 10 in four cases: an ignored `node_modules` (root rules), directories the target's own `.gitignore` files name, a repository inside the target, and an install made after the watch started. A write to a tracked file is still reported under the link, and a directory is reported and watched again once the target's `.gitignore` stops naming it. All five Linux tests were red at `40d05958` (2,014 watches against a bound of 24).
- On every platform, `linkedExclusions` alone: what it leaves out, the intersection across links, and the walk from given directories.
