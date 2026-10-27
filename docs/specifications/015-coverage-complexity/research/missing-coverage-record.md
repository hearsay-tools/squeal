# A completed passing result with no coverage record (015-79, dogfood C2)

Researcher 8813a5db, 2026-10-27. The brief is `tasks/wave-19.md`, W2. Baseline `776712148`. Vitest 5.0.3 in this worktree. The daemons on this host were 0.1.347 to 0.1.359. The probes are in `probes/missing-coverage-record/`, marked throwaway. No product file changed.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Which exact writer path drops a completed file? | Proven for about half of the gaps whose time can be measured. `keep` in `src/core/code/coverage/writer.ts:136-149` calls `coverage.put`. That throws `database is locked` when another connection holds the shared code store's write lock for longer than the 1 s busy timeout (`DEFAULT_BUSY_TIMEOUT_MS`, `src/core/store/open.ts:39`). `step`'s catch (`writer.ts:177-180`) then deletes the payload, logs one line and drops the record. There is no retry. A second, instant drop path covers most of the other measured gaps. Its cause is not determined. | experiment; source; store data |
| 2 | Can a small fixture reproduce the 0.1.349 gap on this baseline? | Yes, for the busy path. A second process holds the code store's write lock for 6 s. The writer then stores no record for the first 3 of 12 completed files whose results exist. It logs `coverage: t00.test.js: Error: database is locked` for each one, 2.0 s apart. The control round stores 12 of 12. The 0.1.349 case (`backlog-slots-overhead.test.ts`, run `62afa686`) ended inside a 25.8 s host-wide pause in record writes. A rerun of that 123 s test was not needed and was skipped (load 37 to 51 on 24 CPUs). | experiment; store data |
| 3 | What diagnostic belongs at the owner, and what regression tells the causes apart? | The writer owns every drop. Today its only trace is `options.log`. A hook-started daemon sends that to `/dev/null`. The writer should count each completed file it stored no record for, by cause, where status can read it. A busy store should cost a retry, not the record. The regression test holds the code store lock across a job and then frees it: today no record (red); repaired, the record arrives. | source; experiment |

## Findings

**F1. The writer drops a record when the code store is busy.** Verified by experiment (`writer-busy.ts`, this baseline) and read in source code. The step is `job.record ??= await mapOf(...)`, then `pace.measure(() => keep(job, key))`. A busy `put` throws inside `pace.measure`. That holds the main thread for the 1 s busy wait, and the pace then gives back that 1 s before the next job. So each failing job costs 2.0 s plus its map. Probe output:

```
== held: lock held 6000 ms; records by queue position: XXX......... (X = none)
   log 1.36 s coverage: t00.test.js: Error: database is locked
   log 3.41 s coverage: t01.test.js: Error: database is locked
   log 5.44 s coverage: t02.test.js: Error: database is locked
== control: lock held 0 ms; records by queue position: ............ (X = none)
```

**F2. Production gaps carry that time signature, while the whole host stopped writing records.** Read from the shared stores, read-only (`q13`, `q14`, `q19`). Data are runs that stored at least one record, from 2026-10-25 18:30Z, when coverage became the default here. 323 missing records lie between two stored records of the same run, in completion order (the order of the run's `vitest.log`). Their blocks split two ways:

| Cost per job between the neighbouring records | Blocks | Files | Windows of 4 s or more in which no worktree stored any record |
| --- | --- | --- | --- |
| 1.8 to 3.5 s (the busy signature) | 20 | 144 | 19 of 20 |
| under 0.5 s (instant) | 85 | 148 | none of those windows was 4 s or longer |
| 0.5 to 1.8 s, or 3.5 s and more | 7 | 31 | 1 of 2 |

Example: run `87e7a75d` (worktree e5c447c1, 0.1.357, 199 files) has no record for places 125 to 144, all in one block. The neighbouring records came 47.1 s apart, 2.24 s per job. In that 47 s, no worktree on the host stored a record. In the 60 s before, they stored 183, and in the 60 s after, 261. Runs `6014c4e2`, `9597e301` and `f20e34ed` look the same (19 to 33 s windows). The two single-file cases fit too. Run `62afa686` (0.1.349) ended inside a 25.8 s pause in every worktree's record writes; the median gap was 0.22 s (`q16`). Run `555c57b0` lost its first file inside a 72 s pause, and its other 3 records came 2.3 s after that pause ended.

**F3. What holds the lock is not determined.** It is one connection that keeps the shared `code.sqlite` write lock for 19 to 72 s. Every daemon prunes the code store 60 s after it starts and then every hour (`src/core/daemon/lifecycle.ts:238` and `:416`, `pruneCodeStoreAfter`). Each prune batch takes a write transaction. Within it, the batch selects `result_key NOT IN (SELECT value FROM json_each(?))` against all 209,976 result keys, a 14.1 MB JSON (`prune.ts:74-83`, `prune-main.ts:24`). Read-only, that selection takes 200 to 271 ms when nothing matches (`prune-scan.mjs`). Deleting 28 KiB records then adds more work. Back-to-back batches can starve a 1 s waiter, because SQLite's busy handler is not fair. One of the four windows started 65 s after daemon 95f83469 started, which is its first prune (`q15`). For the other three, the table no longer holds the start time (each restart overwrites it). Inferred, not measured. Deciding it needs the prune timed on a copy of the stores, and this host's load was too high for that.

**F4. A second path drops a record at once.** Inferred from timing. 148 bounded files cost under 0.5 s per job, so they did not wait on a lock. They are spread over many files: since coverage became the default, no file lacks a record every time (1,267 missing results over 677 files; `q21`). Code paths that fit:
- `later` runs out of result waits. It logs `coverage: no result of run …` (`writer.ts:150-155`), for example when the main store stored the result more than 36.25 s after the map.
- A map error (`writer.ts:177-180`).
- A batch that never reached the writer. Read in source and found on this host: one payload sat 27 minutes in a live cezar daemon's scratch folder (`/tmp/squeal-1001/tmp/1045f0ec…/coverage-sY1PDl/.tmp/`). It came from run `e7569824`, which stored no results at all, so it is not a C2 case. It still shows that a payload can be written and never taken.

Not determined, because those log lines are lost (F5).

**F5. The writer's diagnostics go nowhere.** Read in source code and seen on this host. The daemon logs to stderr (`src/cli/daemon.ts:26`). Hooks start it with `stdio: "ignore"` (`src/core/daemon/ensure.ts:220`). `/proc/<pid>/fd/2` of two live daemons is `/dev/null`. `close()` deletes queued payloads without any log line (`writer.ts:224-234`). Here, at most 21 missing records, in 7 runs, came from the last run of their worktree, a small share (`q10`).

**F6. Facts the data rule out.** Store data and source.
- A long test: the same file stores a record in about 63 of 65 runs since 2026-10-25 evening (`q6`).
- A fast next run: missing records follow a run started within 3 s in 1.6% of runs, against 2.0% overall (`q11`).
- An edit that re-keys the file: `62afa686` and `87e7a75d` stayed at one revision.
- `node:inspector`: no import in those closures.
- A Vitest race in giving over the payload: in Vitest 5.0.3, a file's `onAfterSuiteRun` message goes on the same channel as its done message, and before it (`chunks/index.ggMXe2IF.js:185`, `PoolRunner` in `chunks/index.DpLw24bj.js:10763`).
- Missing records are 1.5% of 82,177 passing completed results in runs that stored at least one record.

## Recommendation

A narrow repair in the writer that a worker can take now. It is not a D8 exclusion: the busy path is a defect, since the record is lost for no reason in the test.

1. **Retry a busy store, keep the record.** In `keep`, catch `isBusy(error)` (`src/core/store/index.ts:4`). Keep `job.record` and queue the job again with its own backoff, separate from the result waits. Do the `put` under `withBusySliceSync(BUSY_SLICE_MS, …)`. Then a held lock costs the main thread 250 ms per try, not 1 s plus 1 s of pace. Give up only after a bound (for example 2 minutes). Count that give-up as `busy`.
2. **A diagnostic at the owner.** The writer counts each completed file that got no record, by cause: `busy`, `no-result`, `map-error`, `store-open` and `closed` (the queue `close()` drops). It reports the counts through the daemon's persisted note (the `note` the adapter already uses), once per cause per daemon, with the last file. A stderr line alone is lost. With the counts in place, the next dogfood count can name F4's cause.
3. **Regression tests** in `test/code/coverage/`:
   - A second connection holds `BEGIN IMMEDIATE` on the code store across the first job, longer than the busy timeout, then commits. Expect every record stored and no drop counted. This is red today: the probe's `XXX.........`.
   - Contrast: a `resultKey` that never answers still drops after its waits and counts `no-result`. That test tells the two causes apart.
4. **Next research, not this row.** Time `pruneCodeStore` on a copy of a large store when the host's load allows. If it holds the lock for tens of seconds, give its batches a pause between them, or a lighter selection than an all-keys `NOT IN`. 015-85's shared parts would also cut the bytes each prune deletes.

## Open questions

- Who holds the code store lock for 19 to 72 s: prune (F3) or some other writer. Decided by timing a prune on a store copy, or by the new `busy` counts set against prune times.
- The cause of the instant drops (F4). Decided by the owner diagnostic after one day of dogfood.
- 851 more missing records have no stored record after them in their run, or lie out of order, so their time cannot be measured here. Many come from worktrees that are now removed.
- Single-file runs with no record are missing from the table in F2, because those runs stored no record at all. Run `62afa686` is one of them.

## Sources

- `src/core/code/coverage/writer.ts`, `mapper.ts`, `map-worker.ts`, `pace.ts`, `provider.mjs`, `types.ts`, `runtime.ts` at `776712148`.
- `src/runners/vitest/coverage.ts:217-248` (`coveredFiles`) and `src/runners/vitest/adapter.ts:595-735` at `776712148`.
- `src/core/store/open.ts:39`, `src/core/store/connection.ts`, `src/core/store/busy.ts`, `src/core/code/store/prune.ts`, `prune-main.ts` and `src/core/daemon/lifecycle.ts:390-415` at `776712148`.
- `src/cli/daemon.ts:26` and `src/core/daemon/ensure.ts:217-221` at `776712148`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/index.ggMXe2IF.js:181-191`, `index.DpLw24bj.js:10685`, `:10763-11010`, `:11892-11920`, `:21108-21150`.
- The shared stores `/home/agent/projects/squeal/.git/squeal/{store,code}.sqlite` and run logs `…/runs/<id>/`, read-only, 2026-10-26 23:00Z to 2026-10-27 00:30Z.
- Spec D8 and D9, `lessons.md` Round 2 C2 and Unknown states, `test/code/coverage/writer-stored.test.ts`, `test/scheduler/backlog-slots-overhead.test.ts`.
