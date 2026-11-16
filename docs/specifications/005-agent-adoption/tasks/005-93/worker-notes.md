# 005-93 worker notes (wave 15)

Worker session 3501dac2, 2026-11-16. Seam map and choices the design left open.

## Seam map

- `src/core/delivery/late-bound.ts`: the pure bound, `LATE_FACTOR` (2), `median`. Tiers of
  `tierSize`, shortest first, one worker per file.
- `src/core/scheduler/edit-timings.ts` (review 0.1.530 B2, B3): the scheduler's own record,
  written at each edit tier's start (`TierKind` "edit", from `tier-start.ts` `act`), meta row
  `edit-timings:`: `runner.tierSize`, each project's width at it and runner part, each edit
  revision's first start (later tiers at that revision never replace it), each edit tier's run
  and its wall estimate (`estimateMs` at its grant). Newest 20 of each list.
- `src/core/delivery/late-timings.ts`: the hook's reads. `worktreeMedians`: start = median of
  the recorded first starts; overhead = median over recorded tiers of a completed run's wall
  (`runs.get`) less the recorded estimate. `pastBound` estimates the owed files per tier at the
  recorded tier size, each part at its narrowest recorded width (a project never recorded runs at
  width 1). `RunRepo.recentTimings` and its validity case were removed with it: no store line
  changes against the base.
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
- Width and tier size come from the scheduler's record (review 0.1.530 B2). Before any edit tier
  is recorded, tier size is the default 4 and every project runs at width 1.
- Medians are floored at 0. With nothing measured (no duration stored for any owed file and no
  stored run) the bound would be 0; `FEED_LATE_MS` (2 × the watcher's reconcile interval, 60 s)
  stands in. The `unlisted` form waits at least `FEED_LATE_MS` too.
- `unread` (the feed's own late rule) needs an edit after the count began (`revision > since`);
  an edit the feed never read cannot be known.
- No late message while a hold is on (row 011-73), and no late form at all with no test group at
  `edit` (row 019-49, review 0.1.530 B5).
- A file that ran with no result is said in the own count (`; 1 with no result (unknown).`) and
  read as unknown by the evals parser, as caught up's count is (review 0.1.530 B4).
- Since moves (edits count again) when a delivery shows every file run and no late state is
  open, or at caught up, or when a failure ends the late state.
- The 001-224 line, when every file already ran, is `Squeal saw your edit; passing results stay
  silent.`; beside the edit's own result with nothing pending it is still left out (001-396).

## The late state on every delivery path (review 0.1.530 B1)

`late` is the per-consumer slot (`edits-late:`), the revision a late message named. `since` is
the edit state's revision the own count counts from. "Moves" means `since` becomes the latest
revision. All cells are in `test/delivery/late-paths.test.ts` unless named.

| Path | Says late / caught up | A delivered new failure | Other news, late open | `since` |
| --- | --- | --- | --- | --- |
| Tool boundary, refined revision | yes / yes, once each (`late.test.ts`) | ends late; no caught-up after (`late.test.ts`) | caught up when nothing owed | moves when all ran and late is closed, at caught up, or with a failure |
| Tool boundary, unrefined revision | unlisted late after the bound / never | ends late (`at a boundary while the latest revision is not refined`) | kept | unchanged |
| Stop, quick and waiting (`onToolBoundary` with `stop`) | never | ends late (`at Stop`) | kept; next boundary says caught up (`a recovery at Stop`) | moves only when late is closed |
| Stop waiting at another revision (`atRevision`) | never | nothing delivered, nothing written (`a Stop that waited for another revision`) | — | unchanged |
| Stop's end of the turn (`endTurn`) | never | — | late kept (`the end of a turn`) | unchanged |
| Peek | never | ends late (`by peek`) | kept (`a recovery by peek`) | unchanged (no edit notes) |
| Idle waiter | never | ends late (`from the idle waiter`) | kept (`a recovery from the idle waiter`) | moves only when late is closed |
| UserPromptSubmit (`startTurn`) | never | ends late (`when the turn starts`) | kept (`a recovery by peek or the turn start`) | moves only when late is closed |
| Registration | never | — | a new registration starts `since`; leaving forgets late (`a session that leaves`) | set to the registration revision |
| Hold on validation | late never (`quietFor`; `hold-told.test.ts` sees no delivery while held) / caught up allowed | ends late | kept | as the boundary |
| Daemon down, stopping, stopped | late never (`late.test.ts`) / caught up allowed, beside the liveness line (`caught up is said with the daemon down`) | ends late | kept | as the boundary |
| No test group at `edit` | never, any form (`no late form with no test group at edit`) | ends late | kept | as the boundary |
| Late with nothing to count (revision affects no file) | closes silently at the boundary (`closes a late state with nothing to count`) | — | — | unchanged |

## Left for others

- `SKILL.md` still says "those files and non-zero counts only" (pinned by `skill.test.ts`);
  005-94's wording pass.
- `plugins/codex/seed/skills/squeal/references/reports.md` is an older copy that already
  differed; left alone.
- Bundles are not rebuilt here: the bundle drift tests fail until the coordinator builds.
