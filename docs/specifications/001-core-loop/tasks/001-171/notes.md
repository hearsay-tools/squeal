# 001-171 notes: where a new failure is re-run

Seam map for whoever continues (builds on `tasks/001-170/notes.md`).

- The rule: `src/core/scheduler/rerun.ts`. `holdsNewFailure` reads, per stored fail, the worktree's known state (`knownStates.get`, before the ledger's commit writes the new one) and the row the key held before (`storeResults` now returns it). New means: the known state here was not a fail, and the row under the key was not a fail. The second excludes a confirmed inherited fail (001-170): two runs already failed.
- Called from `recordTier` (`tiers.ts`) for a file whose results become current (`growth === undefined && file.key === key`); collected per tier, then `queueReruns` after `rerunFirstSeen`.
- `queueReruns` skips a forced run's failure (`run --all --force`, and the re-run itself, which is queued forced so its lookup does not take its own fail), a key already re-run (`FileState.rerunKey`, in memory), and a slow file. Above `context.rerunCap` (`SchedulerOptions.rerunCap`, default `RERUN_CAP`, unbounded) it re-runs none and writes a note.
- The re-run's pass replaces the row: `storeResults` records the flaky note and `applyResults` delivers `FAIL -> PASS`, which `attribution.ts` marks flaky. Nothing new was needed for that half.

Decisions taken on this row:

- Slow files are not re-run (coordinator, 2026-10-09): a slow run can cost minutes to an hour. In D6 as a limit.
- The per-tier cap exists as a parameter, unbounded, while the human decides a number (coordinator, 2026-10-09). `test/scheduler/backlog.test.ts` runs with `rerunCap: 0`: its 199 intentionally failing files would double its baseline (115 s measured with re-runs).

Known gaps, not fixed here:

- A file whose results go through observed growth (`growth !== undefined`, stored under the grown key and applied by `settle`) is not considered for a re-run.
- A re-run queued forced stays forced if an edit moves the file's key before it runs: it runs at the new key without a lookup, and its result there, forced, is not re-run.
- `rerunKey` is in memory: a daemon restarted between the fail and its re-run does not re-run it (its result is current, so nothing queues it).
- The re-run keeps the file `pending` until it lands, so a Stop hook's idle wait includes it.
- `squeal why` says nothing about a re-run in flight; the transition history shows the fail and, on a pass, the flip.
