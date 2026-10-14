# Wave 13bk: 001-357 narrow review of 001-356

Candidate: `a83065fea1fc720ea8753977ccdc31b61f16df18` (0.1.157). Range: `8b6fe681..a83065fe`. Scope is repair 001-356 and wave-13bj B1 only. This review does not reopen 001-340, 001-345 or 001-350 outside that boundary.

## Verdict

PASS `a83065fea1fc720ea8753977ccdc31b61f16df18`: **0 blockers, 1 proven should-fix documentation note, 0 nits**. Wave-13bj B1 is repaired. The original four-case probe no longer serves over 999.0.0, all three new regressions are red without the repair and green with it, and no new product break was proved in the repair scope. The required independent full suite has one unrelated hook-test timeout; its full output and limits are below. PASS is the narrow repair judgment, not a claim that the full suite passed.

## Verification output

All npm/Vitest/build commands and product probes used a temporary HOME, CODEX_SESSION_ID unset, GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1. CODEX_HOME, CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_RUNTIME_DIR and TMPDIR also pointed into private scratch. No agent CLI, eval runner, real HOME, live store or other worktree was used. Probes imported only this candidate's freshly built dist and created their own fixture repositories.

The review scope was committed early as `8aa5bf9b`, then the tree was detached back to the exact candidate before any gate. HEAD was `a83065fea1fc720ea8753977ccdc31b61f16df18` and tracked status was empty before npm ci, after npm ci, after the build and throughout the full suite. npm ci deleted no tracked node-test symlinks. Reviewer verification uses independent Vitest, as required by the reviewer skill and task; no Squeal result substitutes for it. Only one full suite was requested.

```text
$ npm ci
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice

exit 0
```

```text
$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.157 lint
> biome check .

Checked 1000 files in 318ms. No fixes applied.

exit 0
```

```text
$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.157 typecheck
> tsc --noEmit


exit 0
```

```text
$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.157 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.157 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts


exit 0
```

```text
$ git status --short
[empty after npm ci and npm run build; both committed plugin distributions reproduced]
$ git rev-parse HEAD
a83065fea1fc720ea8753977ccdc31b61f16df18
```

### Independent full suite

The required single independent suite completed before any temporary source rollback. The detached HEAD and tracked status were checked again immediately afterwards: exact candidate and empty status. The output is retained in full, including the fixture gitdir repairs, own-worktree test cleanup, experimental type-checking warnings and failure.

```text
$ npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee

 ❯ test/harness/starting-daemon.test.ts (10 tests | 1 failed) 17627ms
   ❯ SessionStart after spawning a daemon (6)
     × says nothing at the boundary after the starting daemon's first heartbeat 6530ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee/test/fixtures/scheduler/.tmp/c910aed7-07bd-4f71-9b07-19d953709226/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee/test/fixtures/scheduler/.tmp/2913792c-c102-43cb-bb54-a2de67eac1bf/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3604712
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/starting-daemon.test.ts > SessionStart after spawning a daemon > says nothing at the boundary after the starting daemon's first heartbeat
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/starting-daemon.test.ts:90:3
     88|   });
     89|
     90|   it("says nothing at the boundary after the starting daemon's first h…
       |   ^
     91|     const { r } = await startedAtT();
     92|     r.daemon("alive");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 468 passed | 1 skipped (470)
      Tests  1 failed | 3951 passed | 10 skipped (3962)
   Start at  08:26:12
   Duration  728.48s (tests 97%, import 2%, transform 1%)

    Isolate  470 workers spawned · ~159ms startup each (spawn + environment, per file)
             at least ~18.48s faster with isolate: false — reuses workers across files instead of one per file


exit 1
```

**Proven verification failure, outside this repair's execution path.** The only failed test hit Vitest's 5000 ms timeout at test/harness/starting-daemon.test.ts:90. That test's `deps()` injects ensureDaemon (lines 28 to 41), and it calls hook registration/delivery with a synthetic fixture heartbeat. It never calls startDaemon/openDaemon, so it does not execute the changed post-acquire path. The test and those executed modules are unchanged in 001-356. A shared-host scheduling delay is plausible, not proved. The full suite is red and is not described as passing. This bounded review records the failure as evidence without adding a product finding outside its scope or rerunning the suite to green. All three new tests and the key-format guard passed within this run.

### Original B1 busy probe

The original wave-13bj script was run unchanged in its `busy` mode. It keeps WAL, records and clears 999.0.0, holds the daemon lock, blocks reads with a separate connection's `locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE`, then releases the daemon lock at 50 ms. `successor` is its `--await-lock` case. All four results are losers; no serving object or socket ping appears.

```text
$ node --disable-warning=ExperimentalWarning /home/agent/projects/squeal/.ai/cezar/tmp/87218933-9f1d-4390-9e07-76b12fad3a41/wave-13bj-probe.mjs busy
B2 busy-store {"mode":"vacant","holdMs":1000,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-C62OYd/root"},"ms":1035,"ping":null}
B2 busy-store {"mode":"vacant","holdMs":6500,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-CYDo3b/root"},"ms":6944,"ping":null}
B2 busy-store {"mode":"successor","holdMs":1000,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-q4yiwV/root"},"ms":1228,"ping":null}
B2 busy-store {"mode":"successor","holdMs":6500,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-bB2OOy/root"},"ms":6527,"ping":null}

exit 0
```

### Private missing/schema/corrupt/I/O checks

A throwaway source-free probe held each fixture's daemon lock for 550 ms before releasing it, exercising the 250 ms in-wait checks as well as the final decision. It covered both waiter modes. The I/O case is a directory at store.sqlite, which causes a real SQLite open error. A wrapper counted actual PRAGMA integrity_check preparations; it did not change any result or decision. All exits left an immediately acquirable singleton. Corrupt bytes remained unchanged and no recovery backup appeared. Only a proven missing store reached the serving open and its integrity check. These public openDaemon probes stop before serving registration.

```text
$ node --disable-warning=ExperimentalWarning /tmp/squeal-357-l105oi_v/edges.mjs
edge {"mode":"vacant","kind":"missing","result":"opened","ms":961,"integrityChecks":1,"corruptBackups":[],"lockFree":true}
edge {"mode":"vacant","kind":"newer-schema","result":{"reason":"store-newer","code":1,"message":"daemon exited: store schema 2 is newer than this Squeal (supports 1)"},"ms":635,"integrityChecks":0,"corruptBackups":[],"lockFree":true}
edge {"mode":"vacant","kind":"corrupt","result":{"reason":"lock-wait-timed-out","code":0,"message":"a daemon gave up: it took the lock but could not read the last daemon recorded within 1000 ms (store corrupt); the next hook boundary starts one"},"ms":564,"integrityChecks":0,"corruptBackups":[],"lockFree":true}
edge {"mode":"vacant","kind":"io-error","result":{"reason":"lock-wait-timed-out","code":0,"message":"a daemon gave up: it took the lock but could not read the last daemon recorded within 1000 ms (unable to open database file); the next hook boundary starts one"},"ms":605,"integrityChecks":0,"corruptBackups":[],"lockFree":true}
edge {"mode":"successor","kind":"missing","result":"opened","ms":780,"integrityChecks":1,"corruptBackups":[],"lockFree":true}
edge {"mode":"successor","kind":"newer-schema","result":{"reason":"store-newer","code":1,"message":"daemon exited: store schema 2 is newer than this Squeal (supports 1)"},"ms":584,"integrityChecks":0,"corruptBackups":[],"lockFree":true}
edge {"mode":"successor","kind":"corrupt","result":{"reason":"lock-wait-timed-out","code":0,"message":"a daemon gave up: it took the lock but could not read the last daemon recorded within 1000 ms (store corrupt); the next hook boundary starts one"},"ms":566,"integrityChecks":0,"corruptBackups":[],"lockFree":true}
edge {"mode":"successor","kind":"io-error","result":{"reason":"lock-wait-timed-out","code":0,"message":"a daemon gave up: it took the lock but could not read the last daemon recorded within 1000 ms (unable to open database file); the next hook boundary starts one"},"ms":580,"integrityChecks":0,"corruptBackups":[],"lockFree":true}

exit 0
```

### Production decision-budget probe

The default 120000 ms decision window was exercised against a private store held exclusively for 140 s. A separate private process retried only this fixture singleton and timestamped its acquisition. The decision released it before the 5 s note attempt finished; the still-busy store prevented persistence of a note. The retained 999.0.0 identity was verified after cleanup.

```text
$ node --disable-warning=ExperimentalWarning /tmp/squeal-357-l105oi_v/budget.mjs
production-budget {"result":{"reason":"lock-wait-timed-out","code":0,"message":"a daemon gave up: it took the lock but could not read the last daemon recorded within 120000 ms (database is locked); the next hook boundary starts one"},"elapsedMs":125231,"lockFreeObservedMs":120244,"noteAttemptAfterRelease":true,"last":{"startedAt":7,"squealVersion":"999.0.0"}}

exit 0
```

Supplemental probe snapshots: [edges.mjs](/p/squeal/tasks/0e71eaec-bf3d-4539-a819-de459bb30cee/files?artifact=4b6b9c87-be18-4b5e-94b6-d55a39ee7596), [budget.mjs](/p/squeal/tasks/0e71eaec-bf3d-4539-a819-de459bb30cee/files?artifact=fed66dd0-a71b-4026-a4a7-8f1da0412f74). Run either with node --disable-warning=ExperimentalWarning from the built candidate checkout under the same isolated environment. Their runtime database and lock paths are unique private fixtures, and cleanup touches only those fixtures and children. The original B1 probe is the unchanged snapshot linked in wave-13bj and the task-provided wave-13bj-probe.mjs.

### Exact repair-removal controls

After the full suite completed on a clean candidate, only src/core/daemon/open.ts was temporarily replaced by `git show 672261a8^:src/core/daemon/open.ts`. The three tests stayed at the candidate. This deliberately dirty source run is a discrimination control, not candidate verification. It used `-t 'a lock waiter that cannot yet read'`; the log's command display joins argv without shell quoting. No bundle, test, key pin or board was changed. The candidate file was then restored with git restore --source=a83065fe, producing an empty tracked status, and the six tests in that file were run.

```text
$ npx vitest run --maxWorkers=4 --reporter=verbose test/daemon/vacant-wait.test.ts -t a lock waiter that cannot yet read
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee

 ↓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a vacant-lock waiter exits as a loser, no note, when a newer daemon came and went
 ↓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10)
 ↓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a successor exits as a loser, no note, when the last recorded daemon is newer than itself
 × test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a vacant waiter reads again and exits as a loser, no note, once the store is readable 7751ms
   → expected { …(6) } to match object { reason: 'lost-lock', code: +0 }
(6 matching properties omitted from actual)
 × test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a --await-lock waiter reads again and exits as a loser, no note, once the store is readable 7152ms
   → expected { …(6) } to match object { reason: 'lost-lock', code: +0 }
(6 matching properties omitted from actual)
 × test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0 2597ms
   → expected { reason: 'lost-lock', code: +0, …(1) } to match object { reason: 'lock-wait-timed-out', …(1) }
(1 matching property omitted from actual)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a vacant waiter reads again and exits as a loser, no note, once the store is readable
AssertionError: expected { …(6) } to match object { reason: 'lost-lock', code: +0 }
(6 matching properties omitted from actual)

- Expected
+ Received

  {
-   "code": 0,
-   "reason": "lost-lock",
+   "exited": Promise {},
+   "ready": Promise {},
+   "root": "/home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee/test/fixtures/scheduler/.tmp/11824482-14fa-420e-98ae-90580b5eec89/main",
+   "socketPath": "/tmp/sq-j3IYKO/squeal-6612e0524f1e4b6c.sock",
+   "stop": [Function stop],
+   "worktreeId": "6612e0524f1e4b6c",
  }

 ❯ test/daemon/vacant-wait.test.ts:180:22
    178|       // The premise: the first read under the lock found the store bu…
    179|       expect(elapsed).toBeGreaterThanOrEqual(DAEMON_BUSY_TIMEOUT_MS);
    180|       expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
       |                      ^
    181|       expect(readNotes(repo)).toEqual([]);
    182|       const lock = acquireDaemonLock(lockFile(repo));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a --await-lock waiter reads again and exits as a loser, no note, once the store is readable
AssertionError: expected { …(6) } to match object { reason: 'lost-lock', code: +0 }
(6 matching properties omitted from actual)

- Expected
+ Received

  {
-   "code": 0,
-   "reason": "lost-lock",
+   "exited": Promise {},
+   "ready": Promise {},
+   "root": "/home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee/test/fixtures/scheduler/.tmp/494bd8fb-5e42-4517-ba04-2efcd90b2789/main",
+   "socketPath": "/tmp/sq-dNo41s/squeal-98b6ad20460de32c.sock",
+   "stop": [Function stop],
+   "worktreeId": "98b6ad20460de32c",
  }

 ❯ test/daemon/vacant-wait.test.ts:180:22
    178|       // The premise: the first read under the lock found the store bu…
    179|       expect(elapsed).toBeGreaterThanOrEqual(DAEMON_BUSY_TIMEOUT_MS);
    180|       expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
       |                      ^
    181|       expect(readNotes(repo)).toEqual([]);
    182|       const lock = acquireDaemonLock(lockFile(repo));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0
AssertionError: expected { reason: 'lost-lock', code: +0, …(1) } to match object { reason: 'lock-wait-timed-out', …(1) }
(1 matching property omitted from actual)

- Expected
+ Received

  {
    "code": 0,
-   "reason": "lock-wait-timed-out",
+   "reason": "lost-lock",
  }

 ❯ test/daemon/vacant-wait.test.ts:203:20
    201|       result.store.close();
    202|     }
    203|     expect(result).toMatchObject({ reason: "lock-wait-timed-out", code…
       |                    ^
    204|     expect((result as { message: string }).message).toMatch(/could not…
    205|     expect(readNotes(repo)).toHaveLength(1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 3 skipped (6)
   Start at  08:38:32
   Duration  18.22s (tests 97%, transform 2%)


exit 1
```

```text
$ git restore --source=a83065fea1fc720ea8753977ccdc31b61f16df18 -- src/core/daemon/open.ts
$ git status --short
[empty]
$ npx vitest run --maxWorkers=4 --reporter=verbose test/daemon/vacant-wait.test.ts
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/0e71eaec-bf3d-4539-a819-de459bb30cee

 ✓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a vacant-lock waiter exits as a loser, no note, when a newer daemon came and went 44ms
 ✓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10) 654ms
 ✓ test/daemon/vacant-wait.test.ts > a lock waiter decides again once it holds the lock (review 001-347, B2) > a successor exits as a loser, no note, when the last recorded daemon is newer than itself 344ms
 ✓ test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a vacant waiter reads again and exits as a loser, no note, once the store is readable 7104ms
 ✓ test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a --await-lock waiter reads again and exits as a loser, no note, once the store is readable 7105ms
 ✓ test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0 2681ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  08:39:09
   Duration  18.67s (tests 97%, transform 2%)


exit 0
$ git status --short
[empty]
$ git rev-parse HEAD
a83065fea1fc720ea8753977ccdc31b61f16df18
```

Both busy-then-readable tests failed on their result assertion at line 180, after the >=5000 ms premise at line 179 passed. They returned RunningDaemon instead of lost-lock. Their red test durations were 7751/7152 ms; their restored green durations were 7104/7105 ms, with the unchanged lower-bound assertions passing again. The shortened-budget test returned lost-lock without the repair, then lock-wait-timed-out with exactly one note and a free lock with it. The green run also retains the accepted same-version winner and both ordinary newer-version no-note losers. All six passed. No extra full suite was run.

Squeal's background results separately observed the deliberate rollback failures, then all seven reported checks recovered after restoration (three regressions, bundle drift and three guard assertions). Its revision-2 header reported 4432 current, 0 pending, 0 stale, 0 unknown; all 54 re-keyed files current and still failing: 0. This recovery explains the rollback reports and does not replace or erase the independent full-suite timeout above.

## Blockers

None proved within the narrow repair scope. Wave-13bj B1 is repaired by the original probe and the regression rollback controls above.

## Should-fix

### S1: widen the timeout-reason documentation

**Proven, non-blocking documentation note.** `src/core/types/daemon.ts:328` describes only a successor finding the lock still held when its wait ends. `src/core/daemon/open.ts:298` also says the lock wait ran out with the lock still held. The new use at `open.ts:144` follows a successful acquisition and an explicit release at `:123`; it also covers a vacant waiter. Both comments are now narrower than their callers. One worker can update the comments to cover either an acquisition timeout or failure to decide whether an acquired lock permits serving. No new reason or runtime behavior is needed. The type file is unchanged by this repair, and this requested comment audit is a follow-up note rather than a product blocker.

`rg -n 'lock-wait-timed-out|DaemonExitReason' src test` found the union, `openDaemon`'s exit producer, type plumbing and tests. No production consumer branches on this literal. `src/cli/daemon.ts:43` prints `daemon.message` and returns `daemon.code` for every startup exit. Reusing the reason therefore preserves code 0, best-effort one note, and the next-boundary retry, as amended D10 explicitly requires. It does not make a consumer infer that a lock remains held.

## Nits

None new.

## What fits

- The discriminant is preserved end to end: `open.ts:281` opens a non-creating lookup without integrity checking; busy/corrupt/thrown I/O errors become `unread`, not `{version:null}`. Only missing stores and the explicitly refused newer-schema path use the null sentinel. A store with no row/version is successful absence. A successful strictly newer comparison releases and returns `lost-lock`/0 without writing a note.
- Corrupt and non-busy unread decisions release at `:123` before the `lockWaitTimedOut` note attempt. Neither integrity checking, store creation/recovery nor serving registration occurs. A busy unread decision retries; on exhaustion it takes that same exit. The private checks prove no integrity/recovery for their corrupt/I/O/newer-schema paths and reacquire every lock. A later first-try start still takes D12's ordinary recovery path; the first-try branch at `:108` is untouched.
- In-wait unknown reads do not authorize serving. `newerRecorded` returns false for unread and the 100 ms lookups merely keep waiting; `awaitDaemonLock` checks about every 250 ms. `takenOver` likewise keeps waiting when its record is unread. Every acquired waiter goes through the final decision. Fresh connection per failed lock attempt is unchanged in `lock.ts:28`, `:38`, `:82`. Same-version acceptance remains a strict newer-than test, and the candidate's existing same-version regression is retained.
- The decision uses a monotonic performance.now deadline, clips each SQLite busy timeout to min(5 s, remaining), and sleeps 10 ms only between busy failures. Non-busy errors return immediately. It adds one 120 s decision window only after a waiter acquires the lock; it does not reset the deadline per retry. This is separate from the pre-existing 30 s vacant / configured successor acquisition window and the pre-existing 120 s serving-open timeout. The post-release best-effort note retains its separate 5 s busy timeout, as the notes state. These are cooperative SQLite/timer budgets, not guarantees against process descheduling or a blocking filesystem. No unbounded retry or new hook wait was found.
- Hooks are unchanged: `ensure.ts:191` still spawns detached with ignored stdio and unref and returns spawned immediately. Only detached daemon startup awaits this decision.
- Root package.json, plugins/claude-code/package.json, plugins/claude-code/.claude-plugin/plugin.json and plugins/codex/.codex-plugin/plugin.json all report 0.1.157. Build reproduces both committed distributions. KEY_FORMAT_VERSION remains the unreleased 9, pinned to `d511c6b0d80ccfebc355955bca49c4bec3e835aff9d9d32bf41e7de2a1fea54f`; the full-suite guard supplies candidate evidence for that pin. No release is performed here.

### D10 amendment, sentence by sentence

| Amended contract at spec.md:183 | Candidate implementation and evidence |
| --- | --- |
| A failed last-daemon read proves nothing and never means no daemon recorded | LastDaemon discriminant at open.ts:245, error classification at :292, unread release at :122; busy probe and corrupt/I/O checks |
| Retry while busy, with the daemon's 5 s timeout, for at most 2 minutes, the serving open's budget | lastDaemonVersion at :254 uses DAEMON_START_BUSY_TIMEOUT_MS=120000 by default, 5000 ms maximum SQLite timeout clipped to remaining time, monotonic deadline and 10 ms sleeps; production-budget probe above |
| Missing store is no record; newer schema reaches the existing refusal | Explicit branches at :284; actual missing/schema probes in both modes; newer schema is refused before integrity checking in store/open.ts |
| If still unread, release before integrity checking, creation or recovery | :123 before :144 and :151; actual corrupt/I/O probes and production-budget lock observer |
| Timed-out semantics: one note, code 0, reason lock-wait-timed-out; next hook starts one | :303 attempts one note without creating or recovering a store, then returns :318; new bounded regression checks exactly one persisted note when readable in time; persistent unreadability prevents a note and leaves the message, as the existing helper and repair notes explain |

“Before opening the store” means before the serving integrity/create/recovery open. The decision necessarily opens a lookup handle with create:false, as the prior review already settled. The timeout helper may attempt its best-effort note after release. No unrelated D10 sentence or earlier accepted residue is re-prosecuted here.

## Inputs for the next wave

No repair row is required for wave-13bj B1 on this evidence. A documentation-only follow-up can widen the two timeout comments in S1, preserving the reason literal, messages, codes and note semantics. The coordinator owns integration and board/status records. Earlier wave-13bj S1 / row 001-355 is outside this narrow review and is neither cleared nor re-reviewed. Do not infer a release approval or a fresh review of the earlier waves from this verdict.
