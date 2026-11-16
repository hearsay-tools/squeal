# 005-93 worker notes (wave 15)

Worker session 3501dac2, 2026-11-16. Seam map and choices the design left open.

## Seam map

- `src/core/delivery/late-bound.ts`: the pure bound, `LATE_FACTOR` (2), `median`. Tiers of
  `tierSize`, shortest first, one worker per file.
- `src/core/delivery/late-timings.ts`: the store reads. `worktreeMedians` reads
  `RunRepo.recentTimings` (new, additive: the newest 20 completed runs with no checkpoint, each
  file's duration from its own results via `results_by_run`). `pastBound` reads each owed file's
  duration with `results.newestForTestFile` and reads runs only when the age passes the
  durations-alone bound.
- `src/core/delivery/late.ts`: the late state (meta row `edits-late:`, one slot per consumer,
  the revision the late message named), `lateNotes` (late or caught up), forms `owed`, `unread`,
  `unlisted`.
- `src/core/delivery/edits.ts`: `readOwn` is the one read of the consumer's own edits (files,
  owed, unknown); `editNotes` adds `own`, `late`, `caughtUp`; `editTold` is what a delivery tells
  beside its entries (a new failure ends a late state and drops late and caught up).
- `src/core/delivery/delivery.ts`: `boundary` (a tool boundary that is not a Stop) is the only
  place late and caught up are computed; `once` makes the live header lazy and read at most once.
- `src/core/delivery/late-format.ts`: every new text. `header.ts` `newsLine` takes the own count.

## Choices the design did not settle

- Owed = the re-key record's `open` entry (no result at its key), not `row.pending`. A
  confirmation run at the same key after the edit's result owes nothing (changed the 13v B1
  tests in `edits-confirmation.test.ts`).
- Width of a tier in a hook is its file count, at `DEFAULT_POLICY.runner.tierSize` (4): a hook
  reads neither the policy nor the runner's `tierWidth`.
- Medians are floored at 0. With nothing measured (no duration stored for any owed file and no
  stored run) the bound would be 0; `FEED_LATE_MS` (2 × the watcher's reconcile interval, 60 s)
  stands in. The `unlisted` form waits at least `FEED_LATE_MS` too.
- `unread` (the feed's own late rule) needs an edit after the count began (`revision > since`);
  an edit the feed never read cannot be known.
- No late message while a hold is on (row 011-73), and no `owed` late with no test group at
  `edit` (row 019-49).
- Since moves (edits count again) when a delivery shows every file run and no late state is
  open, or at caught up, or when a failure ends the late state.
- The 001-224 line, when every file already ran, is `Squeal saw your edit; passing results stay
  silent.`; beside the edit's own result with nothing pending it is still left out (001-396).

## Left for others

- `SKILL.md` still says "those files and non-zero counts only" (pinned by `skill.test.ts`);
  005-94's wording pass.
- `plugins/codex/seed/skills/squeal/references/reports.md` is an older copy that already
  differed; left alone.
- Bundles are not rebuilt here: the bundle drift tests fail until the coordinator builds.
