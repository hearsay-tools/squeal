# 011-51: a running tier yields, worker notes (2026-10-21)

Brief W2 of `../wave-7.md`; spec 011 C4 step 5 and C15 as amended 2026-10-21; `../../research/running-tier-yields.md`. Base `44790d62`. Commits `fdac3ed4` and `22bbd0cb` touch `src/core/types/standing.ts`, `src/core/types/store.ts` and `src/core/status/standing.ts` by the coordinator's agreement of 2026-10-21; `0eac5159`, `e3ac50cb`, `fdb11548` and `57f4176e` are the row.

## Seam map

- `src/core/scheduler/yields.ts`: `TierYields`, the one decision for every tier in flight: supersession, `cancelsBacklog` for a backlog tier, the yield. It holds the marks of files a yield cut (by `testFileId`, at the key cut) and publishes the `yields` meta row (`{ at, tiers }`, by run id; dropped when no tier is in flight). `publishedYields` is the status side's reader, trusted only from the live daemon's start on. `YIELD_REMAINDER_MS` is 30 s.
- `src/core/scheduler/tiers.ts`: `TierKind` (`backlog`, `turn`, `edit`, `slow`), `Tier.kind` and `Tier.startedAt`, both optional so that the key-format harness's `Tier` literal (`test/keys/validity/store-traced.ts`) compiles; an absent kind counts as an edit's. `startTier` takes the kind. A tier but a slow one gets a cancel when its runner cancels (`cancels`: no `backlogSlot`). `recordTier`'s re-queue now keeps `recent`, so a cut file goes back with its class.
- `src/core/scheduler/scheduler.ts`: `#cutTiers` replaces `#cancelBacklogs`. It runs after a revision's content part, after a runner part (`RunnerWork.applied`) and after `promote`, over every tier in flight. A tier's standing goes in `#record` and `#requeue`. `#editPending` reads `kind`, not `cancel`.
- `src/core/scheduler/slots.ts`: `busyLanes` reads `kind === "backlog"`, not `cancel !== null`. Before this row a cancel meant a backlog tier; it no longer does.
- `src/core/scheduler/queue.ts`: `hasRecentAfter(revision, where)` (an edit's work that came during the tier, by `recentBy`) and `hasPromoted(where)`.
- `src/core/status/standing.ts`: reads the row once per `standingsOf` call; `yields` on a promoted queued file's standing behind a tier, and on `unlisted` only when the run yields.
- `src/core/status/next-step.ts`: `; the tier yields`, or `; the tier does not yield: ` and the reason; `; the run yields` on an unlisted revision. No row (an older daemon) keeps the old wording.

## Decisions the spec did not settle

1. "Whose module has not ended": the scheduler sees no module end before the run's report, so every file of a tier counts as unfinished. Supersession needs every file of the tier re-keyed by the revisions during its run (`Tier.changes`). A tier where one short file ended and the rest are re-keyed is cut by the yield rule instead, when its remainder is over 30 s and no file of it is marked.
2. An edit's work triggers a yield only when a revision after the tier's own made it recent (`recentBy`). An edit's tier selected with more edit work queued behind it does not yield to that work.
3. "The lane's runner part waits for the run": the adapters expose no such signal. The trigger is a revision that changes an environment input of a project with a test file in the tier's lane (`keys.isEnvironmentInput`, then `stabilityPaths` of one file per project). Vitest recreates the instance for that change, and the recreate waits for the run (`Gate.exclusive`). It is read only at the revision.
4. The remainder is the largest last-known duration among all the tier's files, unknown counting 0, less the time since `startTier`. A backlog tier uses this formula too, not its wall estimate.
5. A yield marks every file of the tier at its key. A mark goes at the next check when the file's result lands at that key or its key moves.
6. A `runner` reason, not in the spec's list: a tier whose runner cannot cancel (node:test and pytest edit tiers, backlog slots) says "its runner runs each tier to its end".
7. A backlog tier also yields to promotions and to a runner part's wait; `cancelsBacklog` still cancels it as before.
8. No `schemaVersion` raise: `yields` is an additive optional field of the `--json` entry, as `promoted` was.

## Facts found on the way

- `scheduler/keying.ts`, `store-decision.ts` and `types/store.ts` are in the key-format alarm's bundle; `tiers.ts` and `queue.ts` are not. The row needed only `WORKTREE_META_ROWS` there (one line, the `yields` row). `projectsReading` stays private; `isEnvironmentInput` and `stabilityPaths` answer the same question.
- `test/store/worktree-meta.test.ts` allows a row's prefix literal only in `types/store.ts`, comments included.
- Red before: tests 1, 2, 3, 5 and 6 fail on the base at the cancel poll; tests 7 and 9 fail at `expect(signal?.aborted).toBe(true)`; test 8 has no module to import; test 4 (both cases) pins "no yield" and passes on the base by nature.
- Test 8 uses `cancels: false` on the catch-up fixture, so a tier that yields stays in flight while the test reads its standing.

## Open for later rows

- A promoted file that waits on another worktree's claim of its key still makes a tier yield. The cut runs nothing sooner; the mark bounds it to one cut per file and key.
- `CANCELLED` in `src/runners/vitest/run.ts` still says "an edit arrived during a backlog tier" for every cancel.
- `standing-groups.ts`'s `groupId` does not read `yields`: a group's line shows its first file's. It matters only for an unlisted group that mixes promoted and other files.
- Test 10 (the cezar replay) is the coordinator's.
