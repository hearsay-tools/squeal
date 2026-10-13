# Wave 13bj: 001-351 third review

Candidate: `90fa864b1888ef003c1eb60fd2f2ac811e1f6483` (0.1.156). Scope: 001-340, 001-345 and 001-350 only, bounded by `reviews/wave-13bh.md`. Unrelated commits in `d4bb5eaa..90fa864b` are excluded.

## Verdict

FAIL `90fa864b1888ef003c1eb60fd2f2ac811e1f6483`: **1 proven blocker, 1 proven should-fix note, 0 new nits**. Original wave-13bh B1/B2 reproductions are repaired and their regressions distinguish the fixes, but a failed final version read still allows an older waiter to serve. The independent full suite has one fixture-precondition failure, recorded below; no rerun to green.

## Verification output

HEAD matched the exact candidate, checked out detached, with a clean tracked tree. All commands used a temporary HOME, CODEX_SESSION_ID unset, GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1. CODEX_HOME, CLAUDE_CONFIG_DIR and XDG directories also pointed inside that HOME. No agent CLI or eval runner was invoked.

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
  @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
  esbuild@0.28.2 (postinstall: node install.js)
exit 0
$ git status --short
[empty; no deleted node-test fixture symlinks]

$ npm run lint
> squeal@0.1.156 lint
> biome check .
Checked 1000 files in 282ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.156 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.156 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.156 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
$ git status --short
[empty; both plugin distributions reproduced]
```

Routine npm notices omitted. An independent `npx vitest run --maxWorkers=4` started, but a Codex stream disconnect ended the worker and removed its scratch logs. Its outcome is **unverified**, not a candidate failure. The resumed reviewer must run the required independent suite again.

### Independent full suite

After the stream disconnect, the required suite was restarted at the exact detached candidate with a new temporary HOME. It remained clean before and after the entire run. The full suite preceded every temporary source rollback. No Squeal result replaced this reviewer gate. The build was already complete and drift-free; no product source changed during the run.

```text
$ env -u CODEX_SESSION_ID HOME=<private-home> CODEX_HOME=<private-home>/.codex \
  CLAUDE_CONFIG_DIR=<private-home>/.claude XDG_CONFIG_HOME=<private-home>/.config \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/2ba14549-84bf-4550-87ce-5244423b593a

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2ba14549-84bf-4550-87ce-5244423b593a/test/fixtures/scheduler/.tmp/673b9632-372d-4e6b-9b87-59ec456414aa/main/.git/worktrees/staged/gitdir
 ❯ test/daemon/handover-gap.test.ts (2 tests | 1 failed) 8790ms
   ❯ a late older spawn in a step-down's stop gap (review 001-344, B2) (2)
     × a late spawn of the stopping daemon's version may win, the successor exits silently, and the next newer boundary steps it down 1868ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2ba14549-84bf-4550-87ce-5244423b593a/test/fixtures/scheduler/.tmp/e6a5437a-c312-4d70-9e5b-0aaa80813124/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 2452327
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/handover-gap.test.ts > a late older spawn in a step-down's stop gap (review 001-344, B2) > a late spawn of the stopping daemon's version may win, the successor exits silently, and the next newer boundary steps it down
AssertionError: the stopping daemon holds its lock: expected 'none' to match /WRITE\s+2398572\s/

- Expected:
/WRITE\s+2398572\s/

+ Received:
"none"

 ❯ stepDownIntoGap test/daemon/handover-gap.test.ts:66:74
     64|   try {
     65|     expect(gone, "the socket went away").toBe(true);
     66|     expect(lockHolders(repo.root), "the stopping daemon holds its lock…
       |                                                                          ^
     67|       new RegExp(`WRITE\\s+${first.pid}\\s`),
     68|     );
 ❯ test/daemon/handover-gap.test.ts:113:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 468 passed | 1 skipped (470)
      Tests  1 failed | 3946 passed | 10 skipped (3957)
   Start at  00:26:25
   Duration  679.70s (tests 98%, import 2%)

    Isolate  470 workers spawned · ~178ms startup each (spawn + environment, per file)
             at least ~20.72s faster with isolate: false — reuses workers across files instead of one per file

npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
exit 1
$ git rev-parse HEAD
90fa864b1888ef003c1eb60fd2f2ac811e1f6483
$ git status --short
[empty]
```

The two fixture gitdir repairs, dead-run process cleanup and experimental type-checking warnings are retained above. The lone failure is S1 below. It does not exercise the same-version handover because its frozen-lock precondition failed first. The new direct same-version regression passes; this full run does not supply a completed fresh proof of the entire accepted handover scenario.

### Required fix-removal controls

The tests stayed at the candidate. After the full suite, only src/cli/stop.ts was temporarily replaced with d27480a4^'s source and src/core/daemon/open.ts with febcbce2^'s source. These are the exact two fixes removed; no bundle, test, key pin or board changed. Both files were then restored from 90fa864b. The red run is deliberately on modified source and is not candidate gate evidence. The restored green run has exact candidate source and an empty tracked status.

```text
$ npx vitest run --maxWorkers=4 test/cli/stop-lock.test.ts \
  test/daemon/vacant-wait.test.ts \
  -t 'a lock directory it cannot search|a lock waiter decides again'
# Candidate, before rollback:
Test Files  2 passed (2)
     Tests  5 passed | 5 skipped (10)
  Duration  4.15s
exit 0

# Both fixes removed, tests unchanged:
stop-lock.test.ts:194: expected { state: 'free' } to match { state: 'unchecked', error: Any<String> }
stop-lock.test.ts:216: expected 8.395256000000018 to be greater than or equal to 550
vacant-wait.test.ts:87: expected RunningDaemon to match { reason: 'lost-lock', code: 0 }
vacant-wait.test.ts:114: expected RunningDaemon to match { reason: 'lost-lock', code: 0 }
Test Files  2 failed (2)
     Tests  4 failed | 1 passed | 5 skipped (10)
  Duration  2.36s
exit 1

# Both fixes restored from the candidate:
Test Files  2 passed (2)
     Tests  5 passed | 5 skipped (10)
  Duration  2.27s
exit 0
$ git status --short
[empty]
```

Both d27480a4 regressions are red without its fix and green with it; both febcbce2 newer-version regressions are red without its fix and green with it. The same-version case stays green in both states. The five skipped cases are outside the focused test-name filter. No full-suite rerun followed its failure.

### Original blocker probes

All probes ran at the clean candidate against private fixture repositories and a private HOME. They imported the candidate's freshly built dist; no third-party agent tooling or eval runner ran. The stable source snapshot is [probe.mjs](/p/squeal/tasks/2ba14549-84bf-4550-87ce-5244423b593a/files?artifact=9aa69259-2a0b-4a81-b879-96fcef00b245). Run from a built candidate checkout with the isolation variables above: node --disable-warning=ExperimentalWarning <snapshot> b1, b2 or busy. The script cleans its fixtures, children and locks in finally.

```text
$ node --disable-warning=ExperimentalWarning <probe.mjs> b1
B1 directory {"exists":false,"check":{"state":"unchecked","error":"unable to open database file"},"holderLock":["78: POSIX  ADVISORY  WRITE 2340533 fd:01:2119723 1073741824 1073742335"]}
B1 public stop {"code":0,"ms":30041,"stdout":"Stop requested; the daemon for /tmp/rev351-iTmqPf/root closed its socket, and whether it still holds its lock could not be checked after 30 s: unable to open database file\n","stderr":"","holderStillLocked":true}
exit 0
$ node --disable-warning=ExperimentalWarning <probe.mjs> b2
B2 SIGSTOP {"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-f6ODDO/root"},"stderr":""}
B2 released true
exit 0
$ node --disable-warning=ExperimentalWarning <probe.mjs> busy
B2 busy-store {"mode":"vacant","holdMs":1000,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-H3FQPv/root"},"ms":1083,"ping":null}
B2 busy-store {"mode":"vacant","holdMs":6500,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":"serving","ms":7022,"ping":{"schemaVersion":1,"ok":true,"type":"ping","pid":2356815,"worktreeId":"61e8937481b1da20","root":"/tmp/rev351-O2fLvX/root","squealVersion":"0.1.156","phase":"starting","startedAt":1791930524112}}
B2 busy-store {"mode":"successor","holdMs":1000,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":{"reason":"lost-lock","code":0,"message":"another daemon serves /tmp/rev351-dV8jSI/root"},"ms":1083,"ping":null}
B2 busy-store {"mode":"successor","holdMs":6500,"last":{"startedAt":7,"squealVersion":"999.0.0"},"result":"serving","ms":6743,"ping":{"schemaVersion":1,"ok":true,"type":"ping","pid":2356815,"worktreeId":"6cd7f3e53c50dea1","root":"/tmp/rev351-IYU3EE/root","squealVersion":"0.1.156","phase":"starting","startedAt":1791930532915}}
exit 0
```

The discriminator above keeps the candidate's WAL mode throughout and covers both waiter modes with 1 s and 6.5 s contention. Its SQLite holder uses locking_mode=EXCLUSIVE and BEGIN EXCLUSIVE. This deliberately blocks store reads; it does not assert that an ordinary WAL write transaction does so. The script changes no daemon version or decision and does not intercept store reads.

## Blockers

### B1: a failed post-acquire version read permits an older daemon to serve

**Proven, blocking.** `src/core/daemon/open.ts:114`, `:231`, `:238`, `:135`. The new final check treats an unreadable/busy store as no prior version. It uses 5 s, but the next store open uses 120 s, so failure of the first read does not imply failure of the second.

D10 requires the waiter to read the last recorded daemon again under its acquired lock and exit without a note while that daemon is newer. A retained `999.0.0` identity instead gives way to a serving `0.1.156` in both vacant and `--await-lock` paths.

Candidate-only probe: create a private fixture repository, write and clear the newer registration, hold its daemon lock, and have a separate SQLite connection hold an exclusive lock on its WAL store for 6.5 s. Start a waiter while the daemon lock is still held; release that daemon lock at 50 ms. The final read times out after 5 s and becomes null; the 120 s integrity/store open succeeds after the SQLite holder releases. Public `startDaemon` returns a running daemon and its socket ping names 0.1.156. Nothing changed the newer row before this start. The control with the same store lock held for 1 s exits lost-lock instead, in both paths. Every lock, child, socket and fixture is cleaned up. No journal-mode conversion, product edit, live repository store or agent CLI is involved.

```text
vacant, WAL lock 1000 ms: lost-lock, code 0, 1083 ms, no ping
vacant, WAL lock 6500 ms: serving, 7022 ms, ping squealVersion 0.1.156
successor, WAL lock 1000 ms: lost-lock, code 0, 1083 ms, no ping
successor, WAL lock 6500 ms: serving, 6743 ms, ping squealVersion 0.1.156
last recorded before each start: {startedAt: 7, squealVersion: "999.0.0"}
```

This is a remaining B2 correctness gap in 001-350, not the accepted same-version residue. The probe imposes exclusive SQLite contention; it does not claim that an ordinary WAL writer blocks readers. The task notes' claim that the subsequent store open fails on the same store is disproved by its longer timeout.

One-worker fix: distinguish an unknown read from absence. Under the daemon lock, get a successful last-version decision before any integrity/create/recovery open or serving registration. On inability to decide, release the daemon lock and exit honestly, or retry within a stated finite budget without treating unknown as absent. Preserve the same-version acceptance, loser note behavior and bounded detached waits. Add the busy-first-read/later-readable regression for both modes.

## What fits

The bounded review covers the requested 001-340 commits, the listed 001-345 repair commits and status restore, and d27480a4/febcbce2/1f3d0557/90fa864b. It does not review 001-343, spec 005 or other intervening rows.

- Original wave-13bh B1 is repaired. Under uid 1001, the fixture's locks directory is chmod 000 while the same live PID keeps its SQLite WRITE lock. existsSync remains false, but lockFreed returns unchecked with an error. Public stopCommand waits its real 30 s and prints could not be checked. /proc/locks still identifies the holder afterwards. The older unreadable-file and pid/replacement tests remain.
- Original wave-13bh B2 is repaired. An actual child waiter checks before registration, is SIGSTOPped, and resumes only after a 999.0.0 daemon identity is recorded and cleared and the fixture holder releases. It exits lost-lock/code 0, stderr empty, and the lock can be acquired afterwards. The direct vacant/successor regressions preserve no-note assertions.
- The same-version residue is deliberate. The new vacant-wait test permits the stopping daemon's own version to serve. handover-gap also pins that late winner, the silent losing newer successor and a later newer hook stepping it down. No stronger version promise is inferred for the expressly accepted pre-0.1.34 and 0.1.152 releases.
- Lock ownership remains SQLite BEGIN EXCLUSIVE with locking_mode=EXCLUSIVE. Every failed attempt closes its own connection. Serving startup remains behind the daemon lock; no simultaneous-serving break was proved. The new post-acquire check releases on a successful newer-version decision, before an integrity/create open or a serving registration.
- ensureDaemon still spawns detached with ignored stdio and unref. Neither the 30 s vacant wait nor the 120 s successor wait is awaited by a hook. A timer deadline bounds the retry loop, with 10 ms attempts and 250 ms give-up checks. Normal timeouts retain one note/code 0/lock-wait-timed-out; ordinary loser paths write no note.
- npm run build reproduced all committed plugin dist files without drift. Root package.json, plugins/claude-code/package.json, plugins/claude-code/.claude-plugin/plugin.json and plugins/codex/.codex-plugin/plugin.json all say 0.1.156. KEY_FORMAT_VERSION is 9; the current committed pin is 461e7c4506005a5de73ff650f691ca67cd67e7c133d747d3f3f9077e411abd0d. The 120a40... pin in the worker's notes predates the candidate re-pin; it is historical evidence, not the candidate's current pin.
- wave-13bh S1 is resolved: e7a08e95 restores the 231 removed status lines, and the candidate retains the stage and earlier amendments. Its N1 board observation remains partly visible: 001-335/337 still point to the cancelled 001-344 and 001-350 says running. These are coordinator records, outside this product re-review; no board edit was made.

### D10 conformance of the reviewed sentences

| Sentence/contract | Candidate implementation and evidence |
| --- | --- |
| Hook returns after detached spawn; only daemon waits | ensure.ts:191-197, unchanged spawn behavior and hook/stop-gap tests |
| Take singleton before serving store; losers never integrity-check | open.ts:102-118 precedes :135; open.test.ts counts five concurrent starts and timeout losers |
| Normal failed acquisition waits 30 s, retries on separate connections every 10 ms | VACANT_LOCK_WAIT_MS; lock.ts fresh acquisition/close each attempt and performance.now deadline |
| Give up without note on fresh heartbeat, newer retained version or missing root | servedElsewhere plus lost-lock return; original newer-record control and new vacant-wait tests |
| Final newer-version decision under acquired lock, before integrity open | Correct for a successful read; B1 proves an unknown read bypasses this requirement |
| Timed-out vacant/successor wait writes one note, code 0 and lock-wait-timed-out | lockWaitTimedOut and existing open/lock-wait tests; note write is best effort if store itself is unavailable |
| Retained start time/version survives setDaemon(null) | worktrees.ts:109-144 and actual B2 probes; recordedDaemon sees only socket-bearing records, lastDaemon sees cleared records |
| Successor uses 120000 ms, gives up on replacement/equal-or-newer recorded daemon, preserves same-version late winner | takenOver; handover-gap and vacant-wait tests, subject to B1's unknown final read |
| Stop waits 60 s for socket then 30 s for release; never infers release from unreadable lock | stop.ts:42-67, :86-139; actual 30 s permission probe, pid-gone/replacement and held-lock tests |
| Lookup absence is ENOENT/ENOTDIR, other lookup failures prove nothing | lstatOrNull/isMissing; lstat cannot emit the read-specific EISDIR branch of isMissing; inaccessible directory probe returns unchecked |
| Accepted same-version residue, legacy pre-0.1.34 and 0.1.152 exceptions | Strict isNewerVersion comparison, both same-version regressions; unchanged accepted exceptions in D10 |

Earlier lifecycle sentences untouched by these rows remain covered by wave-13bh; they were not re-prosecuted. “Before opening the store” here means before the serving/create/integrity connection: the version lookup itself uses openStore(create:false) without integrity checking. There is no read handle-free way to read the store row in this implementation. B1 concerns the missing successful version decision, not this shorthand.

## Should-fix

### S1: the same-version handover test can miss its frozen-lock premise

**Proven, non-blocking test reliability note.** test/daemon/handover-gap.test.ts:63-70, :113, introduced by 001-345. This independent clean-candidate run failed at :66: “the stopping daemon holds its lock: expected 'none' to match /WRITE\s+2398572\s/”. The assertion runs after observing socket unlink and SIGSTOPping the child. Observing unlink does not make the later signal atomic with the child's lock release. Here there was no lock left when the test checked it, so the test never began its intended same-version contention and says nothing against the accepted behavior.

One-worker follow-up: establish a deterministic pause inside the stopping child at socket unlink while it still holds the lock, or an equivalent explicit handshake. Keep the /proc/locks assertion before starting the waiters and every successor/next-boundary assertion. Do not remove the premise, increase a timeout or silently retry the test to make this run green. This is recorded as a note in the bounded re-review, not a second product blocker.

## Nits

None new. The prior board observation is recorded above for the coordinator.

## Inputs for the next wave

One repair row owns src/core/daemon/open.ts and regression coverage of a failed final version read that later succeeds, for both vacant and --await-lock modes. Keep the acquired singleton throughout a successful decision, or exit and release on unknown. A longer timeout alone cannot prove absence. Never create/recover the store or serve on an undecided last version. Keep same-version acceptance, no-note newer-version losers, detached hooks, existing retry connections and stated finite budgets.

This is a third-round proven blocker and goes to the human through the coordinator. Build/version/key-pin maintenance follows any guarded product fix. Do not merge the candidate as passing on the strength of green tests: the original repair regressions do not cover B1.
