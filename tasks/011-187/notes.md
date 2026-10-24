# 011-187: a change of the extra files reconciles too

Worker 7c9e15db, 2026-10-25. Review `reviews/0.1.298.md` N1.

## The change

`Feed.setExtraFiles` (`src/core/watcher/change-feed.ts`) now runs `reconcileNow("watch")` when
`rebuildSpec` returns true, and its queue task retries as `watch` on a busy store, as the hint
path's task does. `rebuildSpec` keeps its meaning: true when a different spec updated the
subscription (the review's input for the next wave).

Why the pass is owed there: `rebuildSpec` recomputes the exclusions from git, so a new ignored
directory that appeared since the last rebuild is excluded by this update when the scheduler's
call reaches the queue before the directory's own debounced hint. The chokidar backend then
replaces its watcher (`update`, `nowExcluded`), and an edit in flight can be lost as in 011-183.
The later hint task finds the same spec, returns false and runs no pass. Before this row only
the 30 s idle pass found the edit.

## How often `onExtraFiles` fires here, and the choice

The brief's lead was taken as it was: no narrowing of `rebuildSpec`'s answer.

`onExtraFiles` does not fire per batch. Its three call sites in `src/core/scheduler/keying.ts`
each fire only when the extra set changes:

- `track` (closure paths and observed reads, `observed.ts`): only when `#extra` grew.
- `#watchIgnored` (lockfiles a reconciliation tracked): only when `#extra` grew.
- `#release` (from `trackUntracked`): only when an unjudged inherited path was dropped. This one
  can fire with the set unchanged (a dropped path that was not extra); `sameWatchSpec` then skips
  the update unless the exclusions changed, which is the case this row fixes.

The count on this repository, from the store (`.git/squeal/store.sqlite`, `file_hashes`, read
only) and `git check-ignore` on each cached path: three daemons of this repository that ran for
hours (worktrees `95f8346992f91e4f`, `175939465763857b` and this one, `bad24e9a1ac914bb`) each
hold exactly one extra file, `node_modules/.package-lock.json`. The scheduler finds it in the
baseline, before the feed exists, and hands it to `createChangeFeed` as `extraFiles`, so the
feed starts with it. In the steady state here `setExtraFiles` is therefore called zero times
after start; it is called again only when a closure names a new gitignored file (generated
code), an environment read names a new one, or a release drops one.

This is a count derived from the call-site guards and the stored sets, not a live counter: no
daemon log records the calls, and a source daemon with a probe counter was not run (host load).

Why not make the answer exact ("replaced or widened"):

- Under @parcel/watcher (macOS) every `update` replaces every subscription, the root one too
  (`parcel-backend.ts` `update`: subscribe all, then unsubscribe all), and the 0.1.298 review
  showed a pending event is lost on that swap. There, every changed spec is a replacement. Only
  chokidar narrows in place, and only when the extras shrink with the exclusions unchanged.
- The feed cannot know which kind of update the backend made without the backend telling it:
  `WatchSubscription.update` returning a boolean is a type change in `src/core/types/` and in
  both backends, outside this row's ownership.
- What it would save is a pass on a release that only drops an extra file under chokidar,
  which happens at most a few times per daemon life here.

## The cost per pass

Measured with a scratch probe (`createChangeFeed` from source with a stub backend that watches
nothing, so only the pass is timed: `git status`, the spec rebuild, the re-stat of every
tracked path and the extra file, the linked-directory walk), on this worktree, with this
worktree's 7,599 cached paths as `trackedPaths`, 2026-10-25 00:06 UTC, load average 18.7:

    start pass: 583 ms, 7598 candidates
    10 passes over 7599 tracked paths: median 343 ms, min 301 ms, max 522 ms

The scheduler's processing of the batch is not in this figure. The probe lived in the task's
scratch directory and is not committed.

## The test

`test/watcher/rewatch.test.ts`, "of the extra files alone is followed by a reconciliation too".
It reuses `SwapLosesEdit` (011-183): the backend's `update` edits `src/a.ts` and drops that
file's hints from then on. The case creates `build/cache/results.json` (`build/` is ignored and
new) and calls `setExtraFiles` with it in the same tick, before any hint, so this rebuild is the
one that excludes `build/`; it asserts that, then waits 10 s for a later batch holding the edit,
with the idle pass at 60 s.

Shown red and green through Squeal in this worktree: at revision 1 (only the test changed,
`change-feed.ts` as on main) it failed, "condition not met in 10000 ms"; at revision 4 (the fix)
it passed, reported FAIL -> PASS.

## For the next worker

- The coordinator drops the exception in 011's C2 (`spec.md:84`, "a change of the extra files
  alone does not yet, row 011-187") and qualifies "every watch change" in `status.md`.
- `tasks/011-183/notes.md`, named in the brief, does not exist in this tree; no `tasks/`
  directory existed before this row.
- The 0.1.298 review names linked-target updates as a separate scope; this row does not touch
  them.
