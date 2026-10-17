# Wave 18 review: 001-437, candidate 0.1.211

Verdict: **FAIL**. One proven blocker, one plausible should-fix note, no nits. Two pre-existing limitations are recorded separately and do not count against this wave.

Candidate: `cand/0.1.211`, pinned to `8a19bbeb2d4df51b2aeb7a074cce9315f383a8e1`. Reviewed the ten commits in `git log origin/main..8a19bbeb`, principally `src/core/daemon/low-priority.ts`, its callers and tests, D11 Priority and the final amendment in `001-core-loop/status.md`, and `tasks/001-437/{notes.md,probe.test.ts.txt,bench.test.ts.txt}`. No candidate code was changed.

## Verification

All primary commands ran at the pinned SHA with a clean tracked tree. Probe scripts, copied tests and the draft review lived under `/tmp`; no candidate file was edited to test the old implementation. `npm run build` was omitted as explicitly instructed in the brief. Bundle rebuild reproducibility is therefore unverified by this review; the checked-in CLI changes were inspected against the source change.

`git rev-parse HEAD`, exit 0:

```text
8a19bbeb2d4df51b2aeb7a074cce9315f383a8e1
```

`npm ci`, exit 0:

```text
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 7s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

`npm run lint`, exit 0:

```text
> squeal@0.1.211 lint
> biome check .

Checked 1405 files in 397ms. No fixes applied.
```

`npm run typecheck`, exit 0:

```text
> squeal@0.1.211 typecheck
> tsc --noEmit
```

`npm run check:version -- origin/main`, exit 0:

```text
> squeal@0.1.211 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.210 -> 0.1.211, ok
```

Independent full run, on Node 24.21.0, under the host turn:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

Exit 0. Verbatim output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/d9da3b5f-062e-4187-93ac-fdc6fc3b0791

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/d9da3b5f-062e-4187-93ac-fdc6fc3b0791/test/fixtures/scheduler/.tmp/c5f4d1b0-2f79-4560-8ca8-538582d41f05/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/d9da3b5f-062e-4187-93ac-fdc6fc3b0791/test/fixtures/scheduler/.tmp/784c4bb5-c6cb-4d2c-b96f-2cc53a650575/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3330326
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  698 passed | 1 skipped (699)
      Tests  5956 passed | 10 skipped (5966)
   Start at  16:58:49
   Duration  766.70s (tests 98%, import 2%)

    Isolate  699 workers spawned · ~120ms startup each (spawn + environment, per file)
             at least ~20.77s faster with isolate: false — reuses workers across files instead of one per file
```

The coordinator's unchanged `test/harness/opencode-dispose.test.ts` failure did not recur in this independent run. Its OpenCode fixture was available (confirmed with `opencodeUnavailable()`), so that file was not skipped for a missing installation. There were no failing tests.

Squeal separately reported its known recorder-fidelity baseline failures at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Row 001-431 already records them. Those daemon results are not substituted for the independent run above.

## Blocker

### B1. Proven: a late descendant can become an orphan while its root carrier lives and remain at nice 0

Changed boundary: `src/core/daemon/low-priority.ts:69-78`, especially `walk(carrier.pid)` at line 76 and replacing `seen` at line 78. Recovery seam: `src/core/daemon/escaped.ts:187-192`.

D11 now promises: "a lowered worker's descendants are walked again on every look for its first second, then once a second while it lives, and a child forked late is lowered within a second of being listed."

A live marked worker W has a marked child P which is cloning C across a look. That walk sees P and lowers it, but C copied nice 0 before that lowering and is not yet listed. P then exits before the next walk. C is now the system reaper's child, so later walks below W cannot find it. The daemon has reaped no direct child: P was W's child. The `cminflt` trigger consequently requests no new orphan scan. The root remains live at nice 10 while C remains live at nice 0 for the rest of that run, however many times W is walked. Making the cadence faster does not restore the missing ancestry.

The deterministic probe below uses the candidate's fifth-argument seam exactly for the clone visibility window, as its new regression tests do. It hides C only on the first walk; all later walks use the real `/proc` tree. It uses real `EscapedChildren`, real processes in the daemon stand-in's own group, real inherited lane marks, real parent exit/reparenting, and real OS priorities. No process removes its mark or changes group. Two observational executions and the final asserting command gave the same outcome, after 3.3 seconds and twelve walks. The asserting command exits 1, `0 !== 10`:

```text
{"walks":12,"rootNice":10,"middleAlive":false,"lateNice":0,"lateParent":1049,"carriers":[3360219]}
AssertionError [ERR_ASSERTION]: a late marked orphan must be lowered while its root stays alive
0 !== 10
```

`carriers` contains W only. C is already listed as the reaper's child. This violates the new late-child guarantee even with a surviving root carrier, without needing PID reuse or an unmarked child.

**One-worker fix:** extend repeated lowering's recovery across the disappearance of a previously observed descendant. For example, keep descendant identities and request a bounded marked-orphan rescan when an observed descendant exits or leaves the tree, rather than depending exclusively on a direct daemon-child exit. Preserve lane ownership, PID/start checks, the shared orphan-scan budget, and the once-a-second steady-state walk budget. Keep W alive in the regression: killing W would exercise an existing working recovery path and hide this failure. An implementation must account for a child which was still invisible when P exited, not only descendants already returned by the walk.

**Done when:** the probe's `lateNice` becomes 10 within the stated polling allowance while W stays alive; both existing late-listing regressions remain green at nice 0; a slow-lane version receives idle I/O priority; old lane-isolation and orphan-discovery tests still hold. Re-measure the steady-state cost if recovery changes its scan frequency.

## Should-fix

### S1. Plausible, non-blocking: descendant reuse is remembered by PID alone

`src/core/daemon/low-priority.ts:56,77-78`: carriers have PID/start identities, but `seen` has only PIDs. If a descendant exits and its PID is reused by another descendant between consecutive walks, without an intervening walk omitting that PID, the replacement is treated as already lowered. A normal replacement inherits nice 10; a replacement cloned across a lowering window can have nice 0 and be skipped on every later walk. The root's `statOf` guard does not validate descendants.

This review did not force real kernel PID reuse, so this is a plausible note and does not block. A worker can make walk results or the remembered descendants carry start times, check them before scheduling lowering, and add a controlled reused-PID regression. Keep the added reads in the cost measurement.

## Nits

None.

## What fits and measured limits

- **Proven:** the two new tests distinguish this candidate from `origin/main`'s old implementation. In disposable copies with only import paths adjusted, the candidate passed both and the old code failed both: `{ fork: 10, late: 0 }` for the first and `late: 0` for the cadence test. No live candidate file was reverted. Command: `node ./node_modules/vitest/vitest.mjs run --root /tmp/review211-tests --config /tmp/review211-tests/vitest.config.mjs --maxWorkers=2 -t '001-437'`.

```text
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 2 passed | 8 skipped (12)
   Duration  16.32s (tests 99%, transform 1%)
```

- **Proven, bounded load evidence:** twenty disposable copies of the candidate test file, selecting the two new cases and four workers, passed while the independent full run was active. Processes started at nice 0. These are twenty targeted repetitions, not twenty independent full suites. Observed one-minute load readings during the review included 4.46, 10.60 and 24.85 on 24 CPUs.

```text
 Test Files  20 passed (20)
      Tests  40 passed | 80 skipped (120)
   Duration  46.31s (tests 99%)
```

  I then repeated the **entire six-test file** twenty times under the still-running independent suite, including the originally flaky short-fork case and lane/orphan fixtures. All passed:

```text
 Test Files  20 passed (20)
      Tests  120 passed (120)
   Duration  74.45s (tests 100%)
```

  The first case takes about seven seconds because it waits for walk 16; the cadence case takes about two seconds. This evidence supports them under the observed load, not an absolute scheduling guarantee. The 12-second loop and 15-second timeout can still expire if scheduling removes most of the first second's frequent looks. Both cases become vacuous if started at nice 10, as the worker's notes correctly say; use an independent nice-0 run for their regression proof.

- **Proven:** the cost claim is real for the measured walks. I ran the supplied bench for twelve carriers for ten seconds, then the same copied source with the cadence `continue` removed to walk every look. The second `statOf` in the bench stands in for the liveness read, as described in the worker notes. Results:

| After the first second | Cadence in candidate | Every look |
| --- | ---: | ---: |
| Looks | 82 | 79 |
| Walks per look | 1.17 | 12.00 |
| Reads per look | 19.9 | 204.0 |
| Mean walk wall time per look | 0.264 ms | 3.172 ms |
| Walk CPU per second | 2.24 ms | 22.30 ms |
| Mean `carriers()` wall time per look | 0.761 ms | 0.768 ms |

  The candidate's first-second walk CPU was 2.564 ms per look. This supports D11's approximate 3 ms per look followed by about 2.5 ms per second. It is a **walk-cost** comparison: it excludes `carriers()` CPU, initial priority changes, asynchronous `ionice`, and most loop overhead. It is not the entire lane's CPU budget. The single-carrier sixty-second figures were not independently repeated.

- **Proven:** the normal marked, same-group root-exit path recovers a late child. In the separate carrier-exit probe, the first walk hid the child and the carrier exited ten milliseconds later. At 3.2 seconds the carrier was gone and the child was rediscovered and at nice 10. The PID/start guard prevents walking a dead or reused carrier; it does not transfer responsibility for unseen descendants.

- **Proven:** `KEY_FORMAT_VERSION` is still 11 (`src/core/keys/key-format.ts:18`); only its entry was re-pinned, to `5400009edbbebb9ddb831bef1445d3de269e1b5bd8fd1ff87acb8501dd369dc8`. All twelve local `squeal--v*` tag names matched `git ls-remote --tags origin 'squeal--v*'`, and inspecting every tagged `src/core/keys/key-format.ts` found formats 1 through 10 or no format file, never 11. The full run above supplies the guarded-source hash check.

- **Proven:** D11's first-second/steady-state cadence matches the code for a descendant which stays reachable. Its "within a second" wording needs the already-stated look/event-loop allowance: a due walk waits for the next 100 ms look and any look/event-loop time. The amendment in `status.md` states the same selected cadence. B1 is the substantive mismatch in the unqualified late-child promise.

## Pre-existing limitations observed in the requested probes

These are not findings against this wave: the unchanged lowering helper and orphan-discovery restrictions already behave this way before the range.

- **Proven, slow-lane I/O:** `low-priority.ts:107-112` batches `ionice -c 3 -p ...`. On this host `ionice` exits at the first vanished PID, leaving later live PIDs untouched. A probe returned no descendant on walk one, `[gonePid, livePid]` on walk two, and `[livePid]` thereafter. At 3.3 seconds it printed `{"walks":12,"nice":10,"io":"none: prio 0"}`. The new `seen` filtering does not retry that surviving child's I/O priority. A direct control command with a nonexistent first PID likewise exited 1 with `ioprio_set failed: No such process` and left the live process at `none: prio 0`. The helper's existing best-effort batching cannot establish the slow-lane guarantee when an earlier PID dies; a follow-up can isolate vanished PIDs or retry surviving identities on a failed batch.

- **Proven, carrier exit and marks:** the same root-exit probe with a child started using `env: {}` left that child at nice 0, reparented and unrecovered. Same-group orphan discovery during lowering requires the lane mark. Also, supplying a stale carrier entry whose PID now names a real nice-0 sleeper but whose start is different makes zero calls to `walk` yet lowers the sleeper to nice 10: the PID was pushed at line 67 before the line 71 check. The old implementation also lowers a stale `found` entry, so this does not become a new blocker. Keeping PID/start validation adjacent to all priority mutations would make the new guard's scope clear.

## Inputs for the repair wave

Keep `lowerWhile(children, lane, since, signal, walk)` and its call in `afterEachRun` compatible; it is started before `runner.run` and aborted when that run settles. `EscapedChildren.carriers(lane, since)` owns lane attribution and shared marked-orphan discovery. Recovering P's orphan must not wait for W to exit and must not lower another lane's carrier. The liveness boundary is PID plus start, including any newly remembered descendants. Carry forward the current polling allowance and the shared once-a-second orphan-scan cap; document and measure any budget change rather than silently turning every look into a global scan. The missing regression is the live-W / exiting-P / late-C seam in B1, with the existing real orphan discovery in the fixture.

## B1 reproducer

Save the following outside the repository as `/tmp/review211-nested.mts`, then run from the pinned candidate at nice 0:

```sh
setsid node --import ./node_modules/tsx/dist/loader.mjs /tmp/review211-nested.mts
```

The `setsid` is necessary: it makes the stand-in daemon lead its group, as the real daemon does. The probe cleans up all three processes. Its expected repaired result is `lateNice: 10`; this candidate prints `lateNice: 0`.

```typescript
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { getPriority } from 'node:os';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
const { EscapedChildren } = await import(process.cwd() + '/src/core/daemon/escaped.ts');
const { lowerWhile } = await import(process.cwd() + '/src/core/daemon/low-priority.ts');
const { statOf, childrenOf } = await import(process.cwd() + '/src/core/daemon/terminate.ts');
const children=new EscapedChildren();
await sleep(300);
const since=children.mark();
await children.carriers('fast',since); // establish the orphan scan before the fork
const middleCode=`const {spawn}=require('node:child_process');
const c=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});
console.log(JSON.stringify({middle:process.pid,late:c.pid}));setTimeout(()=>{},30000);`;
const root=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify(middleCode)}],{stdio:['ignore','inherit','inherit']});
setTimeout(()=>{},30000);`],{env:{...process.env,...children.envFor('fast')},stdio:['ignore','pipe','inherit']});
const lines=createInterface({input:root.stdout!})[Symbol.asyncIterator]();
const {middle,late}=JSON.parse((await lines.next()).value!);
let walks=0;
const below=(pid:number):number[]=>childrenOf(pid).flatMap(child=>[child,...below(child)]);
const settled=new AbortController();
const lowering=lowerWhile(children,'fast',since,settled.signal,pid=>{
 walks++;
 if(walks===1){setTimeout(()=>process.kill(middle,'SIGKILL'),10);return [middle];}
 return below(pid);
});
try{
 await sleep(3300);
 console.log(JSON.stringify({walks,rootNice:getPriority(root.pid!),middleAlive:statOf(middle)!==null,
 lateNice:getPriority(late),lateParent:statOf(late)?.ppid,
 carriers:(await children.carriers('fast',since)).map(e=>e.pid)}));
 assert.equal(getPriority(late),10,'a late marked orphan must be lowered while its root stays alive');
}finally{
 settled.abort();await lowering;
 for(const pid of [late,middle,root.pid!])try{process.kill(pid,'SIGKILL')}catch{}
}
```

## Re-review

Verdict: **PASS d1123963cba578d9cf48bb739f77b379565c4867**. B1 is resolved. No new blockers, should-fix findings or nits in this round. S1 and the pre-existing `ionice` batch-abort limitation remain carried to the coordinator's later 001 row; this re-review does not reopen them.

Scope: `8a19bbeb..d1123963`, against B1 and its done-when only. Fetched `cand/0.1.211`, checked out the requested SHA detached, and confirmed the tracked tree stayed clean through verification. The final commit appends only this section. No product file was edited. The optional independent full suite was not rerun, and `npm run build` was omitted as instructed. The first round's independent full-suite result belongs to `8a19bbeb`, not this repaired candidate.

### Verification output

`git rev-parse HEAD`, exit 0:

```text
d1123963cba578d9cf48bb739f77b379565c4867
```

`npm ci`, exit 0:

```text
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 7s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

`npm run lint`, exit 0:

```text
> squeal@0.1.211 lint
> biome check .

Checked 1402 files in 416ms. No fixes applied.
```

`npm run typecheck`, exit 0:

```text
> squeal@0.1.211 typecheck
> tsc --noEmit
```

`npm run check:version -- origin/main`, exit 0:

```text
> squeal@0.1.211 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.210 -> 0.1.211, ok
```

Original B1 asserting reproducer, unchanged from the first review, exit 0:

```sh
setsid node --import ./node_modules/tsx/dist/loader.mjs /tmp/review211-nested.mts
```

```text
{"walks":23,"rootNice":10,"middleAlive":false,"lateNice":10,"lateParent":1049,"carriers":[3887341,3887359]}
```

Three focused rounds under controlled CPU contention, all exit 0. Each round ran these seven files with four workers and affinity to CPUs 0 through 3, beside one nice-0 CPU hog pinned to CPU 0 and another to CPU 1. The hogs were stopped in the driver's `finally` block. This confines the contention to the test turn and does not depend on the host's one-minute load reading.

```sh
taskset -c 0-3 node ./node_modules/vitest/vitest.mjs run --maxWorkers=4   test/daemon/low-priority.test.ts test/daemon/slow-lane.test.ts   test/daemon/escaped.test.ts test/daemon/escaped-overlap.test.ts   test/daemon/escaped-identity.test.ts test/scheduler/slow-lane.test.ts   test/keys/key-format.test.ts
```

```text
Round 1:
 Test Files  7 passed (7)
      Tests  59 passed (59)
   Duration  17.46s (tests 95%, transform 4%, import 1%)

Round 2:
 Test Files  7 passed (7)
      Tests  59 passed (59)
   Duration  17.44s (tests 94%, transform 5%, import 1%)

Round 3:
 Test Files  7 passed (7)
      Tests  59 passed (59)
   Duration  18.22s (tests 95%, transform 4%, import 1%)
```

The coordinator separately reports its full gate at `d8d9aa97`: 5,956 passed and one failure in unchanged `test/harness/opencode-dispose.test.ts`, followed by three isolated passes. That is reported coordinator evidence, not an independent result from this round; the full-suite timeout was not independently re-tested here.

### B1 and its done-when

**Proven:** `low-priority.ts:65,76-85` passes a loss on the next look after a lowered carrier disappears or a previously listed descendant leaves the walk. `escaped.ts:151-157` retains that request as a non-matching reaped count (`NaN`) until the existing `#orphans` cap allows a scan. The original failure no longer relies on a direct daemon-child exit. The optional third argument leaves existing two-argument callers compatible.

**Proven, non-vacuous regression:** the new `wave-18 B1` case was run against disposable copies of both pre-repair modules from `8a19bbeb`, and against this candidate. Only import paths changed in those copies. At nice 0 the old version failed `expected +0 to be 10`; the candidate passed. Neither the live candidate nor its tests were reverted.

```text
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 1 passed | 12 skipped (14)
   Duration  5.99s (tests 97%, transform 3%, import 1%)
```

**Proven, live-root recovery and lane isolation:** extended copies of the original probe explicitly asserted that the late child initially had nice 0. Each also created a real marked orphan of the other lane in the same group and asserted that it stayed at nice 0. Both root workers stayed alive, their middle process exited, and the target late child recovered:

| Target lane | Initial child nice | Recovered after | Root nice | Late child nice | Other lane nice | Late child's I/O |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `fast` | 0 | 937 ms | 10 | 10 | 0 | `none: prio 0` |
| `slow:vitest` | 0 | 931 ms | 10 | 10 | 0 | `idle` |

The probes counted global `/proc` listings through a temporary wrapper of Node's built-in `readdirSync`, installed before importing the modules; the wrapper never altered the returned entries. After the initial scans, the fast run made 32 looks, observed one loss and scanned once. The slow run made 32 looks, observed one loss and scanned twice; its `ionice` children can also change the direct-child exit count. This is bounded orphan recovery, not a scan on each look. Every fixture process was cleaned up.

**Proven, shared scan cap and measured cost:** a separate real group-leader probe called `carriers` 25 times at 100 ms intervals, alternating `fast` and `slow:vitest` and forcing `lost: true` on every call. It counted only two global scans, 1,021 ms apart. Timing the two calls which actually scanned, on this host with 465 processes, gave:

```text
forcedScans: 2
scan gap: 1021.02 ms
scan-bearing call 1: 15.14 ms wall, 14.04 ms main-thread CPU
scan-bearing call 2: 11.65 ms wall, 11.62 ms main-thread CPU
```

These timings include that call's ordinary carrier reads; asynchronous filesystem work is not part of the main-thread CPU reading. They support the amendment's approximate single-scan cost, not a universal timing bound. The one-second shared cap remains in `escaped.ts:193`; setting `lost` neither resets its timestamp nor bypasses it. Stable walks do not repeatedly force scans. A run losing descendants often can now pay this scan cost at the existing cap, which is the explicit repair tradeoff.

**Proven:** D11 and the final status amendment describe this loss-triggered, capped scan. The checked-in CLI diff carries the same argument and sentinel in all four bundles. `KEY_FORMAT_VERSION` stays 11 and its new pin is `4a82c63d3072972f4294cab7025fc23c0905ea0eb253cc1d18ba24fc5fc86873`; the guarded-source tests passed in all three focused rounds. Bundle rebuild reproducibility remains unverified because this round did not run a build.

### Remaining inputs

No B1 repair work remains. Carry S1's PID-only descendant identity and the pre-existing `ionice` batch-abort behavior to the separately planned row. Preserve the shared scan cap and lane filtering there. The first round's other settled observations are unchanged by this bounded re-review.
