# The Pi idle wake not armed in time (board row ci-43987606521)

Researcher, 2026-11-17, for coordinator 4d2ecbfc. Squeal at `a9061f90d`, Pi 1.0.4 (`node_modules/@earendil-works/pi-coding-agent`). Probes: `probes/idle-wake/`.

**Verdict.** The wake is lost, not late. In all nine CI sightings, the wait did not hold its lock even once in 10 s or 20 s. In the probe, a normal arm holds it 21 ms after `agent_settled`. A wider test bound would not fix this. The logs cannot show which step lost the wake: the tests print no Pi stderr, no lock history and no consumer list, and CI keeps no artifacts. Two causes are ruled out by experiment: the tests' own lock probe, and one 2 s deadline miss before the arm. One way to lose the wake was reproduced: the arm is single-shot. A wait that ends with no answer is never re-armed. The defect is not new. The first sighting was on 2026-10-15, the day after the e2e test landed. Row 009-30 has tracked it since 2026-10-17.

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Arm path: Pi awaits the extension's `agent_settled` handler, then prints the event. The handler runs `endTurn` if needed, then `armWait`, which posts a `wait` to the delivery worker. The worker opens the store context, then takes the SQLite waiter lock. Both tests wait for "a registered consumer, and its lock held". | read in source code |
| 2 | Not determined from the logs, because they hold only the deadline message and timings. Timings: the integration case took 13,040 ms (it passes in 1,011 ms on re-run), so about 2 s of extra time came before the 10 s wait. | read in CI logs; inferred |
| 3 | First sighting: 2026-10-15, run 38713491647, main `89cc58a9c`, Node 24, one day after `199be59b7` added the test. Nine sightings in all, eight of them e2e. Not a regression: the brief's candidate range (0.1.524 to 0.1.534) is a month later, and no wake-path file changed after 2026-11-12. | read in CI history and git |
| 4 | A real product loss, not a tight bound. Which event loses the wake in CI is not determined. One mechanism reproduced: if the worker dies with the wait, the wake is lost and nothing re-arms it. Ruled out: the tests' lock probe (0 of 3,300 lost) and one late answer before the arm (6 of 6 armed in about 21 ms). | verified by experiment |
| 5 | Re-scope row 009-30 (spec 009, D5). Step 1: make a timeout self-describing (test-side), plus a host trace that is off by default. Step 2: re-arm a wait that ends `null` without a cancel. Do not widen the bounds. | inferred |

## 1. What arms the wake (read in source code)

1. Pi `AgentSession._emitAgentSettled` awaits `_extensionRunner.emit({ type: "agent_settled" })`, then emits the RPC event (`dist/core/agent-session.js:687-688`, Pi 1.0.4). So when the test's `land` runs, the handler has returned. `drive` (`test/helpers/pi.ts`) calls `land` once the `agent_settled` line appears.
2. The extension's `agent_settled` handler (`src/harness/pi/extension.ts`). If no settle ended the turn, it first asks `endTurn` (2,000 ms deadline). Then it calls `armWait`. `armWait` returns silently in these cases: the context is stale (`ctx.mode` throws), the session is unknown, the host is shut down or absent, or the mode is not `tui` or `rpc`.
3. `host.wait()` (`src/harness/pi/host.ts`) posts `{ kind: "wait" }` to the current worker and starts one if there is none. The wait has no deadline. It resolves `null` on cancel, on worker `exit` or `error`, or when a call's deadline miss discards that worker. `armWait` treats `null` as "nothing to say" and does not re-arm (`if (text === null || shutDown) return`).
4. In the worker, `handle` calls `idleWait` (`src/harness/pi/run.ts`). `idleWait` calls `locate(cwd)`, which spawns no git, then `waitIdle` (`src/harness/shared/waiter.ts`). `waitIdle` calls `withContext`, then `openContext`, which returns `null` when the store does not open (1,000 ms busy timeout). A throw answers `ok: false`, which also resolves `null`. Then `acquireWaiterLock` runs `BEGIN EXCLUSIVE` with `busy_timeout = 0` and returns `null` if another connection holds the lock. Then `waitForDelta` holds the lock until news, expiry, cancel, or an unregistered consumer. A consumer that was never registered gets a 10 s grace period with the lock held. A consumer that was seen and then dropped releases the lock at once and deletes the lock file.
5. What each test waits for:
   - `test/integration/pi-wake.test.ts` `armed()` (`:63-69`) polls `lockState(r)` every 20 ms for 10 s. `lockState` is `null` unless the worktree has exactly one registered consumer (`piConsumer`).
   - `test/e2e/pi.test.ts:197-205` polls every 150 ms for 20 s (`until`, `test/e2e/support.ts:43`). It looks for a session registered in the store after the run started, then for `waiterLockState(...) === "held"`.
   - So both report "not armed" in either case: the wait never held the lock, or the session's consumer was missing or doubled.

## 2. What the failed jobs show

- Integration (43987606521, Node 22 (1/3), `bb8c83bbe`): the case took 13,040 ms, and the other three cases passed. On the re-run the same case took 1,011 ms (Node 22) and 1,130 ms (Node 26). So about 3 s passed before the 10 s wait, against about 1 s for the whole case when it passes. That fits one 2,000 ms deadline miss, or a slow runner (inferred).
- e2e (43946095378, Node 26, 29,265 ms; 43992379130, Node 22, 30,678 ms): on re-run the case took 16,116 ms and 14,235 ms. That leaves 9 to 10 s before the 20 s wait, but the logs do not split that time between the baseline run and the run itself.
- Started and late, started and exited, or never started: **not determined, because** a throw inside `land` discards Pi's stderr and events (`runPi` removes the run directory and rethrows). The tests record no lock-state history and no consumer list. The workflow uploads no artifacts (the artifact lists of 43987606521 and 43992379130 are empty). `SQUEAL_DEBUG_CONTEXT`, which prints a `withContext` throw, is not set in CI.

## 3. When it started

`ci-scan.sh` read the failure annotations of every failed attempt among 1,600 `ci.yml` runs (2026-10-15 07:45Z to 2026-11-17). 184 of those runs failed and 1,356 passed.

| Run | Date (UTC) | Ref, commit | Job | Test |
|---|---|---|---|---|
| 38713491647 | 2026-10-15 09:30 | main `89cc58a9c` | Node 24 | e2e |
| 39024572231 | 2026-10-17 10:21 | main `5fe789539` | Node 22 (2/3) | e2e |
| 39621661176 | 2026-10-21 14:59 | main `8a42a1c74` | Node 22 (2/3) | e2e |
| 39659860143 | 2026-10-21 19:14 | cand/0.1.245 `1be8585cd` | Node 22 (2/3) | e2e |
| 43340285158 | 2026-11-13 00:50 | main `39bfe8f88` | Node 22 (2/3) | e2e |
| 43946095378 | 2026-11-16 20:05 | cand/0.1.526 `fbaf4c1b5` | Node 26 (2/3) | e2e |
| 43987606521 | 2026-11-17 00:26 | cand/0.1.534 `bb8c83bbe` | Node 22 (1/3) | integration, the first time |
| 43988875490 | 2026-11-17 00:35 | cand/023-03 `f94f09f71` | Node 26 (2/3) | e2e (not in the brief) |
| 43992379130 | 2026-11-17 01:01 | main `35630aa4d` | Node 22 (2/3) | e2e |

- The e2e case landed in `199be59b7` (2026-10-14). Its wake lines have not changed since then. The only later change to the file was an import refactor (`8201b4059`, 2026-11-07). The integration case dates from `67759797c` (2026-10-14).
- The run list reaches back only to 2026-10-15 07:45Z, so a sighting on 2026-10-14 is **not determined**.
- `git log --since=2026-11-12` shows no commit to `src/harness/pi`, `src/harness/shared/{waiter,hook,context}.ts` or `src/core/delivery/{sent-store,daemon-writer,sending-connection}.ts`. The brief's candidates (rows 005-89 to 005-93 and 011-371 to 011-389) therefore did not start it.
- Pi stays pinned at 1.0.4 (`CHECKED_VERSION`). A runner-image change was **not determined**: I did not check it, and the defect predates the cluster anyway.
- Rate (inferred, rough): 8 e2e sightings in about 1,540 completed runs, each running the file in two or three Node jobs. That is about 0.3% of executions. The cluster of four in five hours on 2026-11-16/17 is not explained.

## 4. Product race or tight bound

**A tight bound is unlikely (inferred).** The probe's normal arm holds the lock 21 to 23 ms after `agent_settled` (below). The bounds are 10 s and 20 s, 500 to 1,000 times that. The failed integration case shows only about 2 s of extra delay before its wait.

**Ruled out by experiment** (host load 13 to 44 on 24 vCPUs during the runs; other sessions' load, none added on purpose):

- *The tests' lock probe steals the lock.* `waiterLockState` itself takes `BEGIN EXCLUSIVE` for a moment, and the waiter uses `busy_timeout = 0`, so the two could collide. `race.ts` acquired a fresh lock 3,300 times while a second process probed it every 20 ms, as `armed()` does. 0 acquisitions were lost (p95 acquisition time 0.57 ms, maximum 28 ms; load 17 rising to 44).
- *One deadline miss before the arm.* `arm.probe.ts` ran the real host and worker bundle with a stub Pi. In separate cases it delayed the answer to `start`, `run`, `boundary` or `settle` by 2,500 ms. Each time the host discarded worker 1, started worker 2, and the wake held its lock 21 to 23 ms after `agent_settled`. The failure landed after that was delivered as the wake (load 21 to 24). A late `settle` answer makes the extension also send `endTurn` to worker 2, after `settle` already ended the turn in worker 1. This was harmless here.

**Reproduced: the arm is single-shot (verified by experiment).** With `ARM_EXIT=wait`, worker 1 ends when the wait arrives. The lock was never held in 10 s. The failure that landed afterwards was never sent, because Pi's sent list held only the registration. No worker started again until `session_shutdown`. So for one settle, an agent's wake is lost whenever its wait ends `null` without a cancel. By the source (step 4), that happens when the worker dies, the store context does not open, a call throws, or the lock is lost. Spec 009 D5 accepts a best-effort wake: the news comes with the next prompt. Nothing records the loss. Which of these happened in CI, or whether Pi skipped `armWait` or the consumer was missing (step 5), is **not determined**.

A real-Pi reproduction was not tried. At about 0.3% per run, it would take hundreds of real-Pi runs as `squeal-e2e` to see one failure, which breaks the brief's load limit.

Related: row 009-24 (TUI and RPC wakes missed in dogfooding, cause open, "a missed end-of-turn deadline" among the suspects) is probably the same kind of silent loss (inferred).

## 5. Recommendation for Squeal

Re-scope **row 009-30** (owner spec 009, D5; one worker) and close ci-43987606521 into it:

1. **Make the next sighting name the step (test-side, plus an optional trace).**
   - On an arm timeout, both tests throw with what they saw: the sequence of lock states, the registered consumers, the RPC events so far, and Pi's stderr. To do this, `land` keeps the error and lets `runPi` return the run instead of discarding it.
   - Run Pi with `SQUEAL_DEBUG_CONTEXT=1` in these two cases.
   - If the coordinator accepts a product change: add an env-gated host trace that is off by default. It records each request kind, each deadline miss, each worker exit, and each wait that ends `null` without a cancel. It writes to Pi's stderr only on request, following the rule that debug output is given only on request.
2. **Re-arm a wait that ends without a cancel (product, D5).** `PendingWait` tells "cancelled" apart from "ended". After an end with no news, `armWait` re-arms a bounded number of times (for example, 3 tries 1 s apart) while the session is still idle and not shut down. This covers worker death, a context that did not open, and a lost lock. It does not cover a skipped `armWait` or a missing consumer, so step 1 is still needed.
3. **Keep the bounds** at 10 s and 20 s. A wider bound waits longer for a wake that will not come.

**Proof.**

- The probe's `ARM_EXIT=wait` case holds the lock after the retry, and Pi receives the failure.
- A stub-Pi test with a fake worker whose first wait ends `null` without a cancel sees a second `wait`.
- The real-Pi tests stay green on Node 22, 24 and 26.
- "Three green runs in a row" proves nothing at 0.3%. Accept the row instead when step 1's diagnostics name the step on the next sighting. If none comes, count the e2e executions: about 1,000 clean executions would be needed for the rate to look confirmed lower.

## Open questions

- Which step loses the wake in CI: a worker death, a context or lock `null`, a skipped `armWait`, or a missing consumer. Step 1 answers this at the next sighting.
- Why four sightings fell within five hours on 2026-11-16/17. Runner load or image was not checked.
- Whether a sighting happened on 2026-10-14, before the run list's reach.

## Sources

- Code at `a9061f90d`: `src/harness/pi/{extension,host,worker,run}.ts`, `src/harness/shared/{waiter,hook,context}.ts`, `src/core/waiter-lock/waiter-lock.ts`, `src/core/delivery/{expiry,sent-store}.ts`; tests `test/integration/pi-wake.test.ts`, `test/e2e/pi.test.ts`, `test/e2e/support.ts`, `test/helpers/pi.ts`.
- Pi 1.0.4: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:681-700`.
- CI: `gh run view <id> --attempt 1 --log-failed` for 43946095378, 43987606521 and 43992379130; `gh run view 43987606521 --attempt 2 --log` for the re-run timings; `gh run list --workflow ci.yml --limit 1600`; check-run annotations through `probes/idle-wake/ci-scan.sh`. Runs at https://github.com/hearsay-tools/squeal/actions/runs/<id>.
- Board: rows 009-24 and 009-30 (`docs/board.md`); spec 009 D5 and its `status.md` amendments of 2026-10-14.
- Probes: `probes/idle-wake/race.ts`, `prober.ts`, `arm.probe.ts`, `delay-worker.mjs`, `ci-scan.sh`, `README.md`.
