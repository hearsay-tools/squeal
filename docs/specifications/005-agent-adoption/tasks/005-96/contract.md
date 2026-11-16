# 005-96: the read-side contract of the scheduler's edit timings

Written by coordinator 4d2ecbfc for coordinator 4c0bbe28, who owns row 005-96 (the write side) and briefs it. Row 005-97 (late and caught-up messages) reads this record. The reader exists on `origin/wip/005-93`: `readEditTimings` in `src/core/scheduler/edit-timings.ts`, used by `src/core/delivery/late-timings.ts` (`worktreeMedians`, `pastBound`). Reviews: `../../reviews/0.1.530.md` B2 and B3 (why a hook needs these facts), `../../reviews/0.1.530-r2.md` R2-B1 (why the write on that branch is wrong).

## The record

One `meta` row per worktree, key `worktreeMetaKey("editTimings", worktreeId)` (prefix `edit-timings:`, owner `scheduler/edit-timings` in the registry of `src/core/types/store.ts`). JSON:

| Field | Type | Meaning |
|---|---|---|
| `tierSize` | number | `runner.tierSize` at the last edit tier's start. |
| `widths` | `{ [project]: { width: number, part: string } }` | For each project of a file an edit tier held: the width its files run with at `tierSize` (`RunnerTraits.tierWidth`) and their runner part (`tierPart`). Kept across tiers; a later tier overwrites its own projects. |
| `firsts` | `{ revision: number, delayMs: number }[]` | Newest first, at most 20. One entry per edit revision: its first edit tier's start less the revision's `createdAt`, never below 0. A later tier at the same revision adds none. Backlog, slow, turn and focused tiers add none. |
| `tiers` | `{ runId: string, estimateMs: number }[]` | Newest first, at most 20. Each edit tier's run and the scheduler's own wall estimate at its grant (`estimateMs` of `tier-width.ts`). |

The names and the shape may change if the write side needs it; then `readEditTimings` and its users change in the same row, and 005-97 follows.

## What the reader does with it

- Who reads: a hook, at a tool boundary only, for a consumer with owed test files, and only when the oldest owed edit is older than twice the files' own stored durations (so most boundaries read nothing).
- `startMs` is the median of `firsts[].delayMs`. `overheadMs` is the median, over `tiers`, of the run's wall time (`store.runs.get(runId)`: `endedAt - startedAt`, completed runs only) less `estimateMs`. Both floor at 0.
- A file's width and part come from `widths[file.project]`; a project with no entry runs one at a time (width 1), so the bound is never shorter than the real wait.
- No row, a row that does not parse, or a field of another type reads as "nothing recorded": tier size 4 (the default policy's), width 1, medians 0. The reader never throws.

## What the reader needs from the write side

1. **Freshness**: after an edit tier's start is committed, the record holds that tier (a lost sample under contention is acceptable; a stale record only makes the late message later or earlier by one sample).
2. **No stranded launch**: a failed write loses at most the sample (R2-B1's two-connection probe as the regression).
3. **The start is the step's reading** (row 011-372), the one the tier's start stamp uses.
4. **Bounded**: 20 entries per list; one row per worktree; removed with the worktree's other meta rows.
5. **Only edit tiers** write `firsts` and `tiers`.

## Tests that exist on the wip branch and should pass on the new write side

- `test/scheduler/edit-timings.test.ts`: `pastBound` at width 1 and at tier size 2; more than 20 tiers at one revision, then a later edit: the first start stays 1 s, then the median is 2 s.
- `test/delivery/late-bound.test.ts`: the pure bound (one worker: 80,000 ms for four 10 s files; tier size 2: 60,000 ms; parts one after another).
- `test/store/worktree-meta.test.ts`: the key in the registry.

## Not in this row

The late state, the texts and the delivery paths (`late.ts`, `late-format.ts`, `tellEdits`): row 005-97, coordinator 4d2ecbfc.
