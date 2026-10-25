# Findings 011-197: two FAILs kept current after the edit that fixed them

**Verdict:** this is a defect in revision latency, not in keying or the lookup. The daemon cut no revision for the fixing edits for 23.5 minutes. Its change feed did not complete a pass while the main thread was busy with coverage work. Then `run --all` planned its checkpoint without a pass and certified revision 23 as "all current". The history rewrite plays no part. A stale PASS results the same way.

Worktree `35f92bc7` (id `855eb07205812fa5`), daemon 0.1.301 (PID 2613358, started 00:15:08Z). Sources at main `50b7e2822`: `src/core/watcher`, `src/core/scheduler/revision.ts`, `src/core/revision`, `src/core/code` and `keying.ts` are unchanged since `squeal--v0.1.301`. Store copies: `/tmp/r197/store` (01:25Z), `store2` (01:29Z), `store3` (01:44Z), `code` (01:31Z). All times are UTC. The tree's reflog mixes +02:00 and +01:00 because DST ended that night.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why did the two FAILs stay current? | The FAILs were correct for revision 23's content. No revision 24 existed until 01:27:24.858, although the fixing edits were on disk from 01:03:50 | read in store copy, verified on disk |
| 2 | Which part is at fault? | The change feed's latency: watcher plus reconciliation. Its pass needs about 800 event-loop turns, and coverage work made each turn cost about a second. Second fault: `run --all` sends no sync. Keying, lookup and revision 24's change list are correct | inferred from store, transcript, source and experiment |
| 3 | Did the history rewrite play a part? | No. `git diff aab479dbd f6fa304d4` is empty. The 01:18:22 rewrite used `commit-tree` with a temporary index and wrote no worktree file, and `git status` is clean | verified by experiment |
| 4 | Can a stale PASS result the same way? | Yes. Nothing re-keys without a revision, so a breaking edit leaves the PASS current. `run --all --wait` would then exit 0 | inferred from source |
| 5 | Does coverage play a part? | Yes, as the load: the coverage writer and the code pass's coverage step run synchronously on the daemon's main thread | measured in part, rest inferred |
| 6 | Smallest fix and test | Fix 1: `run --all` reconciles before it plans. Fix 2: cap the main-thread share of coverage work. See "Recommendation" | proposal |

## Evidence

**Timeline** (store copies, file mtimes, the worker's transcript `~/.claude/projects/*35f92bc7*/f43bb582….jsonl`):

| Time | Event |
|---|---|
| 00:40:36.103 | Revision 23: head `aab479dbd`, clean, trigger `interval`, change `016-15/notes.md` |
| 00:40:53 | Commits reordered to `f6fa304d4`, same tree. A pass with no revision recorded this head (meta `head-move`: `f6fa304d4`, revision 23) |
| 00:40:19 to 01:03:16 | `run --all` checkpoint `4f926655`, 864 files, coverage on. The last three tiers have 200, 200 and 167 files |
| 00:54:02, 01:03:16 | The FAILs: checks 9759 (`compare.test.ts`, key `567d8799…`) and 10299 (`key-format.test.ts`, key `48b41ada…`), revision 23, commit `aab479dbd`. At that content `accept.ts` is blob `9dc377d1`, a stub without `runnerOf`: the FAILs were true |
| 01:03:50 | The worker edits `accept.ts` in place (adds `runnerOf`). More edits follow 01:13:41 to 01:17:59, `columns.ts` new from about 01:13:30 |
| 01:03:56 | `squeal status --wait 300000` on the two files. After 300.3 s: "the daemon has not stored its pass over the edits made before the wait; results are as of revision 23; the daemon's heartbeat went 15 s stale while its socket showed it alive" |
| 01:18:22 | Plumbing rewrite: `b50b6ce96`, then `e1e67019a`. Worktree files unchanged |
| 01:18:37.7 | `squeal run --all --wait`. Checkpoint `f905079a` is written at 01:18:43.511, revision 23, 0 files: "completed at revision 23: 6 known failures … 1072 already current". **A false verdict** |
| 01:27:24.858 | Revision 24: head `e1e67019a`, clean, trigger `interval`. One change list holds all 8 edits (`accept.ts` `9dc377d1`→`ec274efc`), but not `columns.ts`. Both keys move (`b8e7273f…`, `b266b440…`) and are queued. At 01:44 both checks PASS, current |

**Where the feed stopped** (read in source):
- `requestFullSuite` takes the scheduler's FIFO `Mutex` and returned at once at 01:18:43. So the feed's held task was not inside `handleBatch`.
- Each edit's hint becomes a `watch` batch, yet revision 24 is `interval` with all edits in one list. So the interval pass that cut it was queued before the 01:03:50 hint, and the 01:03:56 sync joined it (`Feed.reconcile` joins a pending pass).
- `columns.ts` was untracked from about 01:13:30 to 01:18:22, so any `git status` in that window lists it. Revision 24 lacks it, so that pass read `git status` after 01:18:22.
- So one feed task ran from before 01:03:50 to after 01:18:22 (at least 14.5 min), and the pass after it took up to 9 min.

**The load** (passive `/proc` reads, `code.sqlite` copy):
- The daemon's main thread used 2,009 s of CPU in its first 72.5 min (46% of one core). RSS was 1.87 GB at 01:27, with a 2.72 GB peak (VmHWM).
- The coverage writer stored 41 records between 01:04 and 01:09 (about 8 s each), 95 to 357 s after their results.
- A trivial `run --all` took 5.8 s to be planned, CLI start included.

Experiments (`/tmp/r197/bench`, throwaway; main's sources bundled with esbuild, run at `nice -n 10` with `HOME`, `XDG_*` and `TMPDIR` under `/tmp/r197`; no daemon was started):
- **One coverage step** (`readLoaders` plus `runCoverageStep` on writable copies of both stores, 1,072 test files, 1,263 code files): `readLoaders` took 1,522 ms cold and 121 to 169 ms warm. `runCoverageStep` took 1,383 ms cold (judged 20, `more`) and 256 to 295 ms warm. `STEP_BUDGET_MS` (50) bounds only the judging. The loaders are read again at every step, with no bound. A step that ends with `more` queues the next one with `setImmediate`, and `soon()` follows every stored record and every stored result.
- **One change-feed pass** (`createChangeFeed` on a clone at `e1e67019a`, 7,684 candidates, silent backend): 1.3 to 1.9 s unloaded. With a `setImmediate` chain of 300 ms synchronous steps it took **242.4 s over 804 steps**. At about 1.1 s per turn, 800 turns are about 15 minutes.
- **chokidar's watcher replacement** (a new ignored directory): 0.8 s unloaded, 5.3 s over 45 steps of 100 ms. This is a minor cost next to the pass.

**Not determined:** what loaded the loop from about 01:09 to 01:27, after the writer had drained. The candidates are the code pass's `more` chain and `soon()` per result. An event-loop-delay note in the daemon (`perf_hooks.monitorEventLoopDelay`) would decide it. So would a repeat run with coverage on, but that needs a full Squeal-sized suite, held for host load.

**Second gap in the change list** (verified by experiment): a pass reads only `git status`, the stat cache and the extra files. A file added *and committed* while its hint was still queued is in none of them. On the clone, a committed `test/added-between.test.ts` was not a candidate, and an untracked one was. Here `columns.ts` reached the stat cache later through its closure (`trackUntracked`), with no revision, so keys stayed right. For a new test file, no listing would move (inferred).

## Recommendation for Squeal

1. **Smallest fix: `run --all` syncs first.** The scheduler gets an option, for example `beforeFullSuite`, that `createDaemonLoop` wires to `feed.reconcile("interval")`. `requestFullSuite` awaits it before taking the lock, as `#requestSync` already does (lessons defect 30). A lagging feed then delays the checkpoint but can no longer certify a stale revision.
   Test that fails on main, in `test/scheduler/daemon-loop.test.ts`:
   - Set up a loop whose backend's `watch` returns a subscription that never reports, with `reconcileIntervalMs: 60_000`.
   - Start it and wait until idle, then write `src/math.ts`.
   - `const record = await loop.scheduler.requestFullSuite()` (the call `Daemon#requestFullSuite` makes).
   - Expect `record.revision` above the start revision, `test/math.test.ts` in `record.testFiles`, and `src/math.ts` in the newest revision's changes.
   - On main the checkpoint completes at once, at the start revision, with no files.
2. **Root fix for the lag: cap the coverage work's share of the main thread.** Keep the loader map in the code pass until keys or results change, and count its read inside `STEP_BUDGET_MS`. After a step that took `d` ms, the next code-pass step and the next writer job wait `setTimeout(d)`, not `setImmediate`. The feed then gets at least half of every window.
   Test, timing-based and skipped when `LOADED` like the other timing tests: a reconciliation pass of a fixture with about 2,000 tracked files finishes within 3× its unloaded time while the writer maps payloads that each take 200 ms or more. On main it takes about turns × 200 ms. Moving `map` (`JSON.parse` of a whole V8 payload) into a worker thread would remove the 8 s turns too, at more cost.
3. **Close the committed-add gap.** When `HEAD` moved since the last revision or `head-move` record, add `git diff --name-only <recorded head> HEAD` to the pass's candidates. Test: the experiment above, made a feed test. On main the committed add is no candidate.

Fix 1 alone removes the false verdict. Fix 2 removes the lag that `status` (without `--wait`) still shows as "current". Fix 3 is independent of this incident.

## Open questions

- What loaded the loop from 01:09 to 01:27 (see "Not determined" above).
- Should `status` say when the feed's last completed pass is older than twice the idle interval? It said "all 1072 test files current" for 23 minutes. `status --wait` already refused a verdict in that state.

## Sources

- Store and code store copies under `/tmp/r197/` (tables `revisions`, `results`, `known_states`, `test_file_keys`, `checkpoints`, `runs`, `meta`, and `coverage` in `code.sqlite`).
- `git -C <tree> reflog`, `git diff aab479dbd f6fa304d4`, `git diff f6fa304d4 e1e67019a`, `stat` of the 9 edited files, `/proc/2613358/{stat,status,fdinfo/36}`.
- The worker's transcript, entries 00:40 to 01:30.
- Source at `50b7e2822`: `watcher/change-feed.ts` (`reconcile`, `armIdle`, `enqueue`), `watcher/candidates.ts` (`candidatesForReconcile`), `scheduler/scheduler.ts` (`#handleBatch`, `requestFullSuite`), `scheduler/batch.ts`, `scheduler/head-move.ts`, `daemon/daemon.ts` (`#requestSync`, `#requestFullSuite`, the coverage wiring), `code/coverage/writer.ts`, `code/pass/index.ts` (`coverageStep`, `soon`), `code/crap/step.ts`, `code/crap/loaders.ts`, `cli/run.ts`.
- Spec 011 `spec.md:84` (D2 pass: "bounds the damage of a lost event to latency, never to a false 'current'") and its D5 rule that a revision never waits on the runner.
- Benches: `/tmp/r197/bench/{step,feed,rewatch,added}.ts`.
