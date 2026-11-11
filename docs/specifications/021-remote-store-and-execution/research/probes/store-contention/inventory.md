# Lock failures on record (Q1), throwaway collation

Gathered 2026-11-11 by a sub-agent of researcher a1540808 from `gh issue view` (read-only) and the repository at `0fa197e09`; spot-checked against `issue-162.md`, `issue-158.md`, `issue-176.md`, `001-141/notes.md` and #1 comment 12. Paths: `R` = `docs/specifications/011-core/research/`, `S1` = `docs/specifications/001-core-loop/`, `B` = `docs/board.md`, `BA` = `S1/board-archive.md`. "cN" = comment N of the issue.

## A. One-shot CLI write, short busy timeout, no retry

| Incident | Date, version, load | Operation, timeout | User saw | Reproduced, fixed |
|---|---|---|---|---|
| #86 | 10-23, 0.1.278 | `retry` → `askRetry` (`R/issue-86.md:128`), 2,000 ms, uncaught | `ERR_SQLITE_ERROR` errcode 5 | Synthetic 4 s holder on 0.1.279: throws after 2,006 ms (`R/issue-86.md:120`); holder "not determined" (`:135`). Fixed by 011-212 in 0.1.319 (`B:1299`) |
| #1 c3, c4 | 10-21, 0.1.235 and 0.1.245, load 62.67 | `retry`, same path | `Error: database is locked` | Same fix |
| #158 | 11-06, 0.1.409, load 51.37 | `stop` → stop mark, `MARK_BUSY_TIMEOUT_MS` 2,000 (`R/issue-158.md:162,191`) | `squeal: could not record the stop, so a hook may start a daemon again: database is locked`, exit 0 | 0.1.414 with a stand-in `BEGIN IMMEDIATE` holder: no mark, 2,252 ms (`R/issue-158.md:37`). Holder not determined. Open (`B:104`) |
| #158 c1, c3, c4, c5; #78 comment; #181 | 11-06 to 11-11, 0.1.403 to 0.1.429, load 26 to 60 | same | same; c4 adds a heartbeat 179 s stale | Open |
| #108 | 10-26, 0.1.359, load 57.89 | `start` → stop-mark clear, 2,000 ms (`R/issue-108.md:206`) | `squeal: could not clear the stop mark: database is locked`, exit 0 | Not reproduced (load 39.64 > 24). Deferred by the human until it recurs (`B:155`) |
| #1 c10, c11; #80; #138 c3; #108 c2 | 10-23 (0.1.278), 11-10 (0.1.426, 0.1.427), load up to 88 | same | same | The later reports the deferral waits for |
| #162 | 11-07, 0.1.407 and 0.1.41x, load 15 to 30 | `hold` → `addCommandHold`, `STATUS_BUSY_TIMEOUT_MS` 1,000 (`R/issue-162.md:78-85`) | `squeal: nothing is on hold: its Squeal store could not be written (database is locked)`; the child still runs, exit 0 | 0.1.414 isolated holder: 1,211 ms (`R/issue-162.md:33`). Open (`B:106`); four workers in one night |
| #162 c2, c3, c4; #186 | 11-10 to 11-11, 0.1.426 to 0.1.430, load about 60 | same | same | #186 closed as duplicate of #162 |

## B. Daemon writes outside the retry path

| Incident | Date, version, load | Holder | Operation, timeout | User saw | State |
|---|---|---|---|---|---|
| 011-104 | 10-21T22:15Z, about 0.1.25x, load 52 to 70 | not named | revision refinement and apply, 5 s, "nothing retries it" (`R/issue-138.md:210`) | `could not apply revision 15: Error: database is locked`; 599 of 825 files with no key (`B:1186`) | Held by the human 2026-10-22 |
| #138 | 11-02, 0.1.390 | "Neither probe identifies the original incident's lock holder" (`R/issue-138.md:139,250`) | same | `could not apply revision 2: Error: database is locked` | Reproduced on 0.1.393 source with a 100 ms timeout and a 3 s holder; attached to held 011-104 |
| #1 c10 | 10-23, 0.1.278 | — | same | `could not apply revision 1` | — |
| #1 c12 | 10-23, 0.1.278 | not identified | timers and tier | `the store was busy for 78.1 s` | longest episode in an issue |

The notes `a daemon gave up: the lock was still held after 30000 ms` in #138 are the daemon's own worktree lock, not the store's write lock (`R/issue-138.md:223`).

## C. Daemon startup

| Incident | Date, version, load | Holder | Operation, timeout | User saw | State |
|---|---|---|---|---|---|
| 004 dogfood defect 9 / 001-161 | 10-09, 0.1.56, load 69 | **Named**: `Ledger.commit` of a 4,165-result tier; a second case behind `beginTier`; tier records took 11 to 67 s on a copy (`S1/tasks/001-161/notes.md:9-30`) | startup, 5 s | `daemon exited: could not start: database is locked` | Fixed in 0.1.66: 120 s start timeout (`BA:263`) |
| 005-53 / 001-362 | 0.1.159 | the test's own writers | `#register` `BEGIN IMMEDIATE` failed after 120,571 ms (`S1/tasks/001-362/notes.md:7`) | test failure | test repaired |
| #176 | 11-10, 0.1.427, load 31 to 58 | not determined (`R/issue-176.md:37,106`) | registration `BEGIN IMMEDIATE`, 120 s (`R/issue-176.md:50-55`) | `deadline passed before the daemon took request ...; main thread sent no heartbeat for 3 min 13 s` | Open; a 4 s lock recovers on 0.1.430 (`R/issue-176.md:32`) |

## D. Daemon writes that stopped the pump or held the event loop (fixed)

| Incident | Holder | Fix |
|---|---|---|
| 003 dogfood defect 5 (10-08, 0.1.31, load 40 to 160) | **Named**: the prune 60 s after a second daemon's start; 15.1 s, the `DELETE` alone 12.4 s, plus 1.4 to 3.6 s `incremental_vacuum` (`S1/tasks/001-141/notes.md:7-15`) | 001-141 in 0.1.44 |
| 001-412 (10-15, 0.1.168, load 40 to 145) | not named (`S1/tasks/001-412/notes.md:42`) | 0.1.198 |
| #1 body (10-15, 0.1.168, load 60 to 75) | not identified | 001-422: 250 ms slices and retry, 0.1.203, shipped 0.1.222 |
| gh-12 (about 10-16, 0.1.199) | not determined (`docs/specifications/004-slow-suites/research/issue-12.md:18,99`) | 004-66 in 0.1.206 |
| 011-126 (review, no production incident) | the test's 12 s writer; event loop held 10,015 ms | 0.1.273 |
| 001-346 (CI, 0.1.152) | two 7 s test writers | planned |

## E. Reads (fixed)

| Incident | Mechanism | Fix |
|---|---|---|
| #8 (10-16, 0.1.199) | only an exclusive file lock reproduces it; holder not determined (`S1/research/issue-8-contention.md`) | 011-01 in 0.1.204 |
| #7 | `why`'s `UPDATE last_used_at` turns a read into a write, which gets BUSY at once without the busy handler | 011-01 in 0.1.204 |
| 011-113 (CI) | same upgrade in `attribution.ts:132`, gave up at 3 ms | 0.1.266 |
| #77 | not reproduced; holder unknown | — |

## F. Code store (`code.sqlite`)

015 dogfood C2 (10-25 to 10-27, 0.1.347 to 0.1.359): one connection held 19 to 72 s, code-store prune inferred (`docs/specifications/015-coverage-complexity/research/missing-coverage-record.md` F3); coverage writer at 1,000 ms dropped records; fixed by 015-79 in 0.1.365 with a paced retry.

## Holders named before 2026-11-11

Prune (15.1 s), tier record (11 to 67 s), `beginTier`. Every production incident after 2026-10-09 says the holder is unknown: #1, gh-12, 001-412, 011-104, #8, #77, #86, #108, #138, #158, #162, #176, #181, #186, coverage C2.
