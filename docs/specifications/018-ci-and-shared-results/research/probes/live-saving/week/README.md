# A week of adoptions in squawk (row 018-45): daily snapshots

One JSON file per day from `../snapshot.mjs`, named by its UTC time (`2026-11-12T16-25-00Z.json`). Throwaway measurement data for `research/week-of-adoptions.md`; not product code.

## Run it once a day

From the root of a squeal checkout that has this directory (any branch the coordinator keeps for row 018-45):

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/live-saving/snapshot.mjs \
  docs/specifications/018-ci-and-shared-results/research/probes/live-saving/week
git add docs/specifications/018-ci-and-shared-results/research/probes/live-saving/week
git commit -m "docs(018): 018-45 snapshot <UTC date>"
```

- Once a day from 2026-11-13 to 2026-11-19, at about the same UTC time (the first snapshot was 2026-11-12 about 16:25Z). The last snapshot ends the week, so take 2026-11-19's at or after that time.
- Node 22.13 or newer (`node:sqlite`); no install, no dependencies. It takes about 3 s on this host (`elapsedMs` in the file) and stops reading run reports at 110 s (`reportsSkippedForTime` counts the runs it skipped).
- It is read-only: the store opens with `readOnly: true` inside one read transaction (a write on such a handle fails with "attempt to write a readonly database", tried on a throwaway file); it runs no git, no squeal and no other program, and starts or stops no daemon. It writes only the new file in this directory.
- Run it on the same out-dir each day: the newest earlier file here gives the start of the local-run window (`since`) and the daemon versions seen before. A missed day only widens the next window. `--since <iso>` overrides the start.
- A worktree that cezar creates and removes between two snapshots appears only in `otherWorktreeRuns` (its runs survive the removal; its file states do not).

## What a snapshot holds

Per store (one: `~/projects/cezar/.git/squeal/store.sqlite`, shared by every squawk checkout):

| Field | Meaning |
|---|---|
| `imports[]` | each import present: id, `commit`, `createdAt` (the export's), `importedAt`, CI's Squeal version, source run, files, files stored at CI's key (`filesAtCiKey`) or re-keyed to a local environment (`filesRekeyed`), `newSincePreviousSnapshot` |
| `importsGoneSincePreviousSnapshot` | import ids the previous snapshot had and this one does not (pruned) |
| `worktrees[]` | one per checkout under `~/projects/cezar`, `.ai/cezar/worktrees/*` and `.claude/worktrees/*`; `registered: false` when the store has no row for it |
| `worktrees[].daemon` | the daemon's Squeal `version`, `startedAt`, `heartbeatAt`, `heartbeatFresh` (within three intervals), and `versionsSeen` carried over from earlier snapshots |
| `worktrees[].files` | test files listed now (`listed`), those with states (`withStates`); of these, `current` split into `imported` (every current state from one import), `local` (`localOwn`, `localInherited`) and `mixed`; `notCurrent` by validity |
| `worktrees[].byImport` | per import id: files current from it and CI's file-seconds for them |
| `worktrees[].adoptions[]` | per import and the revision its states were adopted at: the revision's time and trigger (`null` at a daemon's revision 0, which keeps no row), files, and `reachedByChange`: files whose static closure the revision's changed paths reach (the runs a change would have queued; `research/live-saving.md`, Q1) |
| `worktrees[].localRuns` | runs that ended in `[since, takenAt)`: runs, file-runs, file-seconds (from `report.json`; node:test runs keep none, so their surviving result rows, an undercount, also in `fromResultRowsFileSec`), checkpoint file-seconds, wall seconds, end states, and file-seconds by the daemon version that was running at the run's start (`unknown` before the first daemon start seen) |
| `worktrees[].runsInProgress` | runs started since `since` and not ended; the next snapshot counts them |
| `otherWorktreeRuns[]` | the same run totals for worktree ids that are not a checkout here now (removed worktrees) |

`host.loadavg` is the host's 1, 5 and 15 minute load when the snapshot started.
