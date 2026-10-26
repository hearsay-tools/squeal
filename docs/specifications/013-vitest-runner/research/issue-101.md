# Issue 101: a cancelled Vitest run and a test's detached child

Triage reproduction for [hearsay-tools/squeal#101](https://github.com/hearsay-tools/squeal/issues/101), 2026-10-26, researcher 5e470fdc. Reproduction only: no design.

**Verdict.** Reproduced at the adapter. When the Vitest adapter cancels a run and the running test does not finish its teardown within the 1 s grace, the forced cancel kills the worker process only. A child that the test started in its own process group lives on, also after `adapter.close()`. The cancel cause does not change this. The original incident is not reproduced: no record shows that the scheduler cancelled that run. Source reading makes it likely that the daemon's leftover sweep could not find the incident's holder either, because the test's supervisor drops Squeal's child marker from the environment.

**Setup.** Squeal 0.1.332 source at `219879482` (branch `cez/5e470fdc` from main); the installed CLI reports 0.1.331. Vitest 5.0.3, default pool (forks: the worker had an IPC channel in every run). Load before live work: 10.69 (05:17:01) and 13.98 (05:19:12) on 24 CPUs. Load after the last run: 25.25 (05:20:37), so live work stopped there. The incident ran 0.1.328.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does an adapter cancel leave a test's detached, SIGTERM-ignoring child alive? | Yes, when the test's teardown does not finish within 1 s: a blocked test, or a teardown that waits longer than 1 s. No, when the teardown finishes in the grace. | verified by experiment (0.1.332) |
| 2 | Does the cause matter (supersession, stop)? | No. Both leak in the blocked case. `execute` treats every abort cause alike except a step-down's result keeping; a timeout takes the same two cancels. | verified by experiment (supersession, stop); read in source code (other causes) |
| 3 | Does `adapter.close()` reach the child? | No. The holder was alive after `close()` in every leaking run. | verified by experiment |
| 4 | Does the issue's evidence (parent pid 1049, group leader gone) prove a stop? | No. The holder had parent 1049 and a leaderless group before any cancel, in every run, because the leader exits by design. | verified by experiment |
| 5 | Would the daemon's leftover sweep (011 C13) stop the incident's holder? | Probably not. The sweep finds carriers of `SQUEAL_DAEMON_CHILD` and orphans of the daemon's own process group. Cezar's supervisor spawns with a curated env that has no `SQUEAL_` entry, and the holder's group is its own. Not run against a daemon. | read in source code (Squeal 0.1.332, cezar `e10fcebb`); inferred for the incident |
| 6 | Did scheduler supersession stop the incident's run? | Not determined, because the incident recorded no `squeal status`, revision or run log. | not determined |

## Findings

**1. The adapter cancel path** (read in source code, 0.1.332). `src/runners/vitest/run.ts` `execute`: on an abort it calls `vitest.cancelCurrentRun` once, waits `GRACE_BEFORE_FORCE_MS` (1,000 ms), calls it again, waits `GRACE_AFTER_FORCE_MS` (5,000 ms), then marks the instance hung; `adapter.ts:599` then calls `abandon` (an unawaited `close()`). In Vitest 5.0.3 (`node_modules/vitest/dist/chunks/index.DpLw24bj.js`), the second cancel is a forced pool cancel (`const force = this._isCancelling`, line 11570). A forks worker's `stop()` sends `fork.kill()` (SIGTERM) to the worker's pid and SIGKILL after `SIGKILL_TIMEOUT` = 500 ms (lines 11060 to 11127). No step signals a process group or walks the worker's descendants.

**2. The probe** (verified by experiment). `research/probes/issue-101/probe.ts` copies `test/fixtures/vitest/basic` to the git-ignored `test/fixtures/vitest/.tmp/`. It adds one test that spawns `sh -c "node holder.cjs … & echo $! > holder.pid; exit 0"` with `detached: true`. The holder ignores SIGTERM, writes a ready mark, and exits after 60 s. The test's `afterEach` sends SIGKILL to the group. The probe runs the file through `createVitestAdapter` and `adapter.run(…, { signal })`, aborts once the holder is ready, and reads `/proc` for the holder. Commands, from the repository root, each under `timeout 150`:

```text
npx tsx docs/specifications/013-vitest-runner/research/probes/issue-101/probe.ts <mode> <cause>
```

| Mode, cause | Test at the abort | Run returned | Teardown | Holder 1 s after the run and after `close()` |
|---|---|---|---|---|
| control, none | waits on a timer loop, released at once | 0.02 s after start mark, `completed`, pass | began, finished | gone |
| await, supersession | waits on a timer loop | 0.03 s after abort, `run cancelled: the revisions during it changed…`, no completed files | began, finished | gone |
| slow-teardown, supersession | as await; teardown sends SIGTERM, waits 2 s, then SIGKILL | 1.03 s after abort, same failure | began, cut | **alive**, ppid 1049, own pgid |
| block, supersession | event loop blocked | 1.02 s after abort, same failure | never began | **alive**, ppid 1049, own pgid |
| block, stop | event loop blocked | 1.03 s after abort, `run cancelled: squeal stop` | never began | **alive**, ppid 1049, own pgid |

Output of the blocked supersession run (`out-block-supersession.txt`, paths shortened):

```text
[1.53s] holder before abort 2980976 {"alive":true,"state":"S","ppid":1049,"pgid":2980975,"cmd":"node …/holder.cjs --lifetime 60000 --tag squeal-issue-101-42e6a635 --ready …"}
[1.53s] abort supersession
[2.55s] run returned {"end":"completed","failure":"run cancelled: the revisions during it changed an input of every file that had not ended","completed":[],"results":[]}
[2.55s] teardown began: false teardown finished: false
[2.55s] worker after run 2980884 {"alive":false}
[3.55s] holder 1 s after run returned 2980976 {"alive":true,"state":"S","ppid":1049,"pgid":2980975,…}
[3.56s] holder after adapter.close 2980976 {"alive":true,"state":"S","ppid":1049,"pgid":2980975,…}
[3.56s] cleanup: SIGKILL owned holder 2980976
```

The run returned about 1 s after the abort in every leaking case. So the first cancel did not end the run, and the forced cancel killed the worker. The run did not reach the hung path. In the await case the first cancel ended the test at once, and its `afterEach` ran inside the grace.

A first slow-teardown run is kept as `out-slow-teardown-supersession-racy.txt` and is void. There, `sh` wrote the pid before node installed its SIGTERM handler, so the teardown's SIGTERM killed the holder. The holder now writes a ready mark after the handler is in place, and the test waits for that mark.

**3. Parent 1049 is not a stop's sign** (verified by experiment). In every run, before any abort, the holder's parent was 1049 (the user's subreaper) and its group had no live leader. The issue's `--leader-exits` fixture does the same: the leader exits once the holder listens. The issue's `ps` line therefore fits a normal run as well as a stopped one. What proves the run was cut is the holder's age past the old test's teardown, which the issue gives.

**4. The incident's test** (read in source code, cezar `e10fcebb`, `packages/cezar/src/preview/dev-server.test.ts`; the incident's own worktree had `--lifetime` and `--owner`, which main does not have yet). The holder test `a leader that exits on its own takes its SIGTERM-ignoring holder with it…` calls `await supervisor.stop('user')`, and `afterEach` calls `supervisor.stop('release')`. `dev-server.ts` stops a group with SIGTERM, then SIGKILL after `KILL_GRACE_MS` = 5,000 ms. Against a SIGTERM-ignoring holder, that teardown takes about 5 s, longer than the adapter's 1 s grace. This is the probe's slow-teardown shape. Inferred: a cancel at any point in that test lets the forced cancel cut the teardown.

**5. The daemon's sweep and the incident's env** (read in source code). 011 C13's process-reaping bullet: every Vitest worker gets `SQUEAL_DAEMON_CHILD=<token>:<lane>` (013 V10). After each tier, the daemon stops the token's carriers and the orphans of its own process group, and records a note with pid, command line and run. It lists as not covered: "a detached process a test starts with an env of its own". Cezar's `spawn('/bin/sh', ['-c', …], { cwd, env, detached: true })` (`dev-server.ts:152`) uses `buildCommandEnv()` (`packages/cezar/src/core/agent-env.ts`), an allowlist with no `SQUEAL_` name or prefix (`grep -c SQUEAL` gives 0). The holder inherits the leader's env. Inferred: the incident's holder carried no token and was outside the daemon's group, so the sweep could not see it, and `squeal status` could not name it. The probe ran the adapter without a daemon, so it does not exercise the sweep. A test whose child keeps `process.env` is covered by the sweep per C13; that is not verified here.

**6. Adapter evidence, incident and scheduler supersession are three things.** The adapter evidence is the table above. The incident shows that a run of the old file left a holder (the issue's own evidence). That the scheduler superseded that run is the reporter's inference. A yield, a backlog cancel, a timeout or a step-down would leave the same trace, by findings 1 and 2. `src/core/scheduler/yields.ts:266` returns `"supersession"` when the tier is superseded. This research did not reconstruct the incident's revisions.

## Recommendation for Squeal

Triage as reproduced at the adapter, with cause-independent scope. Any adapter cancel whose test cannot finish its teardown in the 1 s grace leaves detached children, and the daemon's sweep misses those that drop the env marker. The issue's two asks map onto existing seams: the cancel path (013 V7/V8, `run.ts` `execute`) and the leftover sweep and its status note (011 C13, C6). Which of these to change is the coordinator's and the human's decision. Related: #95 (node:test half), row 003-50.

## Open questions

- Was the incident's run cancelled, and by which cause? This needs the cezar task worktree's daemon run record for revisions 6 and 7 around 01:32:49. Not read: the worktree path was not recorded.
- Does the daemon's sweep stop a detached child that keeps the token, end to end? This needs a daemon probe in an isolated tree. It was not run within the time box and under the load bound.
- A threads-pool worker's child: this pool was not probed.

## Cleanup evidence

Every probe ran under `timeout 150` with a 120 s self-expiry, and every holder had a 60 s lifetime. The probe sent SIGKILL only to holder pids it had recorded whose `/proc/<pid>/cmdline` held its random token, and it removed its fixture copy. After the last run, `ps -eo pid,ppid,pgid,stat,args -ww | grep squeal-issue-101` printed nothing, and `test/fixtures/vitest/.tmp` held no `issue-101-*` directory. No full suite and no build ran.

## Sources

- Issue: `gh issue view 101 --repo hearsay-tools/squeal`, read 2026-10-26.
- Squeal at `219879482`: `src/runners/vitest/run.ts` (`execute`, `abandon`, `GRACE_*`), `src/runners/vitest/adapter.ts:560-600`, `src/core/scheduler/yields.ts:266`, `src/core/daemon/leftovers.ts`, 013 spec V1/V4/V7/V8/V9/V10, 011 spec C13 (process-reaping bullet), `test/runners/vitest/cancel-grace.test.ts` (the abort harness that the probe follows).
- Vitest 5.0.3: `node_modules/vitest/dist/chunks/index.DpLw24bj.js` lines 11060-11127 (`ForksPoolWorker.stop`), 11568-11590 (`cancel`), 21276 (`cancelCurrentRun`).
- Cezar `~/projects/cezar` at `e10fcebb` (read only): `packages/cezar/src/preview/dev-server.ts` (lines 20, 71-77, 149-152), `dev-server.test.ts` (lines 30-35, 226-237), `__fixtures__/fake-dev-server.mjs`, `src/core/agent-env.ts` (`buildCommandEnv`, `BASE_ALLOW_*`).
- Probes and outputs: `research/probes/issue-101/` (`probe.ts`, `holder.cjs`, `out-*.txt`).
