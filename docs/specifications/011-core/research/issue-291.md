# Issue 291: focused request held behind daemon startup

2026-11-26. Recommendation: keep this as a proposed startup diagnosis and recovery row; preserve the `unsynced` verdict guard.

## Verdict and scope

The reported behavior is supported by source and a small synthetic experiment. It is not evidence of a false pass. Both a focused run and a status synchronization wait behind daemon startup. A remembered run request is not yet scheduler acceptance. The original startup bottleneck, its duration and whether a restart helps remain **not determined**, because the issue supplies no daemon log, startup trace or store snapshot.

Source checkout: `724cc76b45095272326f81323a462eff1b536e05`, package 0.1.643. Reported and installed CLI: 0.1.641; release tag `squeal--v0.1.641` resolves to `c4b7c21babb4e8acfd51e9cfcc422e5e14ae6802`. The five production files exercised or cited for the main mechanism are byte-identical between that tag and this checkout (command below). Node v26.13.0; pnpm pin 12.15.0. No product, spec, status, board or skill change.

| Question | Answer and evidence tag |
| --- | --- |
| Can a focused request remain unaccepted throughout its wait during startup? | **read in source code**, 0.1.641/0.1.643: yes, `Daemon.#requestGroup` reports the startup holder and awaits `#starting` before calling the scheduler. **verified by experiment**, current source: request bookkeeping retains a synthetic blocked request, then accepts it once its gate opens. |
| Why can a current/pass file coexist with `unsynced` and exit 3? | **read in source code**, same versions: file state describes stored evidence; the selection additionally requires the daemon's pass over edits preceding the read. `#requestSync` also awaits startup. **verified by experiment**: a synthetic current file with pending sync yields `none/unsynced`, code 3. |
| What held the original startup for 93 seconds? | **inferred**, issue/runtime 0.1.641: the startup holder identifies the lifecycle phase, not its internal cause. Not determined from supplied evidence. |
| Is this a demonstrated new regression or duplicate? | **inferred**, issue/runtime 0.1.641: neither is established. Existing real-daemon test already specifies startup timeout behavior; original incident was not replayed. Coordinator reports overlap with #176, #271 and #287, but no proven common cause. |

## Findings

1. **read in source code**, 0.1.641/0.1.643: `src/core/daemon/daemon.ts:1471` through `:1508` gates both `#requestGroup` and `#requestSync` on the same startup promise. Startup opens runners (`:1053`), starts the loop (`:1224`), records the scan mark and changes phase to ready (`:1265`). The issue's text alone cannot distinguish runner opening, reconciliation, baseline work, store waits or another startup step. Removing the gate without replacement evidence could violate revision/selection correctness.

2. **read in source code**, same versions: `src/core/daemon/run-group.ts:245` records the request ID immediately and tracks `requested: null` until its callback resolves. `recorded()` exposes pending narrow requests. `src/cli/group-pending.ts:143` prints the deadline message and suggests waiting again on the group. This is an existing recovery instruction, but it supplies neither a bounded startup remedy nor the missing internal startup step. The original report's expectation of acceptance within 60 seconds is not a guarantee found in C9/C15: a wait deadline bounds waiting, and startup can outlive it.

3. **read in source code**, same versions: `src/cli/verdict.ts:304` checks synchronization before current-file classes; `:328` delegates to `src/cli/wait/synced.ts:23`, where pending sync never counts as reached. Thus a stored current/pass row at revision 7 does not verify edits the daemon has not reconciled. The subsequent revision-8 discovery notice is compatible with catch-up, but does not prove eventual success. The exact JSON serializer was not exercised by this probe.

4. **read in source code**, checkout 0.1.643: `test/cli/run-group-daemon.test.ts:62` already holds a real daemon in its Vitest config and expects the same startup timeout text and exit 3. This is existing coverage, not a test run in this investigation. The probe below tests the smaller bookkeeping/verdict boundary only. No full suite or real-daemon fixture was run.

## Bounded synthetic experiment

**verified by experiment**, checkout 0.1.643 with relevant sources unchanged from 0.1.641. The host had 16 online CPUs. Initial one-minute load was 1.22; immediately before the probe it was 1.48 (five/fifteen-minute loads 1.25/2.11). Both were below the skip threshold. This probe creates no daemon, socket, runner, store or alternate home, and performs no benchmark. Heavy or isolation work would require boat.dev per the shared notes; none was needed.

Exact commands from the repository root (the launcher's home is written as `~` per repository style):

```sh
gh issue view 291 --repo hearsay-tools/squeal --json title,body,url,comments
git rev-parse HEAD
git rev-parse squeal--v0.1.641
node --version
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks
git diff --stat squeal--v0.1.641 -- src/core/daemon/run-group.ts src/core/daemon/daemon.ts src/cli/verdict.ts src/cli/wait/synced.ts src/cli/group-pending.ts
pnpm exec tsx docs/specifications/011-core/research/probes/issue-291/probe.ts
```

`git diff --stat` printed nothing. `squeal checks` reported installed CLI 0.1.641, default `tests` after each edit, **0 test files now**, and excluded e2e/typecheck/build. This is discovery state, not evidence that project tests pass. The synthetic probe is not covered by that test selection; it ran directly and exited 0 with all assertions passing:

```json
{"phase":"pending","requested":null,"holder":{"kind":"startup","heldMs":93000,"step":null},"message":"it waits for the daemon's startup, which has run for 1 min 33 s","recorded":1,"schedulerCalls":0}
{"phase":"stored-current-pass-snapshot","result":"none","reason":"unsynced","code":3}
{"phase":"released","requested":{"revision":8,"queued":1},"holder":null,"schedulerCalls":1}
```

The 93 seconds are **virtual time**, seeded as 33 seconds of startup plus 60 seconds of waiting. The probe mirrors the startup promise boundary; it does not execute `Daemon.#requestGroup`, reproduce CLI wall time, or recover the original incident. The synthetic scheduler accepts the same request once; no test result is produced.

## Recommendation and remaining evidence

**inferred**, from the evidence above: approve a bounded diagnosis of the startup step that blocks focused requests and an actionable recovery path. Keep C2's revision reconciliation, C4's result validity, C6's honest incomplete status and C15's named selection gates intact. C9 owns startup sequencing. Spec 019 D6 also owns narrow group-run requests and their recovery text. Early acceptance/execution is a design option requiring those contracts to hold, not a repair proved necessary here.

Needed to settle root cause: the affected daemon's startup log/step timings and runtime identity, plus a later sync result or a controlled retry after it becomes ready. No restart was performed; no success after the original timeout is known. Related issues are overlap candidates only, so do not close this as a duplicate on this evidence.

Sources: [issue #291](https://github.com/hearsay-tools/squeal/issues/291), the pinned source files and existing test cited above, `docs/specifications/011-core/spec.md` C2/C4/C6/C9/C15 and its `status.md` (including the 2026-11-20 C15 startup-listing amendment), and [throwaway probe](probes/issue-291/probe.ts).

Final scoped status command:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-291.md docs/specifications/011-core/research/probes/issue-291/probe.ts
```

It exited 3 at revision 2: neither named path is in any test file's closure.
Worktree counts were known failures 0, with 124 of 2302 test files not current
(1 running, 123 unknown). These unrelated incomplete checks are not a suite pass;
the direct probe's assertions are the experimental verification for this report.
