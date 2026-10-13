# Wave 13bh: 001-347 review

Candidate: `5889105d81f66376e0f23524ba39ac9338b41af3`. Scope: 001-335, 001-337, 001-340 and 001-345, against amended spec 001 D9 and D10. No later commits reviewed. The cancelled 001-344 produced no findings file; its B1 and B2 probes are explicit review inputs.

## Verification output

Initial HEAD is exactly the candidate. `git status --short` was empty before and after the following checks; node-test symlinks were present.

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
exit 0
```

```text
$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.153 lint
> biome check .

Checked 998 files in 656ms. No fixes applied.
exit 0
```

```text
$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.153 typecheck
> tsc --noEmit
exit 0
```

```text
$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.153 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.153 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
```

### Independent full suite on the pinned, clean candidate

The initial verification was committed on the report branch before the long run. To keep this proof at exactly the candidate, this worktree then checked out detached `5889105d`, and report-only commits were written in a separate temporary worktree on `cez/987c1f61`. Product sources and tracked files stayed clean throughout the full run and the probes. After the run, `git rev-parse HEAD` still reported `5889105d81f66376e0f23524ba39ac9338b41af3` and `git status --short` was empty. One full suite run, no reviewer test reruns.

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/987c1f61-9394-4532-91f3-2d5dd106e11b

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/987c1f61-9394-4532-91f3-2d5dd106e11b/test/fixtures/scheduler/.tmp/d8765dce-3a86-40c1-9289-2751fd5a281f/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/987c1f61-9394-4532-91f3-2d5dd106e11b/test/fixtures/scheduler/.tmp/bc7979f1-47db-4bb2-b43c-1796565977ad/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 270420
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  468 passed | 1 skipped (469)
      Tests  3929 passed | 10 skipped (3939)
   Start at  23:08:28
   Duration  737.72s (tests 97%, import 2%, transform 1%)

    Isolate  469 workers spawned · ~192ms startup each (spawn + environment, per file)
             at least ~22.31s faster with isolate: false — reuses workers across files instead of one per file
exit 0
```

No independent-run failures. The two fixture-repair messages, dead-run process sweep and experimental type-testing notices are retained above. The reviewer’s independent run includes the CLI lock/reused-pid cases, open/lock waits, concurrent starts, step-down and handover, both handover-gap cases, both plugin stop-gap cases, scheduler timeout/discard cases and key-format guard.

### Actual 30 s CLI bounds on the pinned candidate

```text
$ node --disable-warning=ExperimentalWarning /tmp/reviewer-001-347-stop-bound.mjs
{"case":"unchecked","code":0,"ms":30057,"stdout":"Stop requested; the daemon for /tmp/reviewer-001-347-bound-FTm1A6/root closed its socket, and whether it still holds its lock could not be checked after 30 s: unable to open database file\n"}
{"case":"held","code":0,"ms":30049,"stdout":"Stop requested; the daemon for /tmp/reviewer-001-347-bound-FTm1A6/root closed its socket but still holds its lock after 30 s\n"}
exit 0
```

Both cases keep the pinged pid alive and its lock held throughout. The unreadable-file case says unchecked; the readable busy-lock case says held.

### Background Squeal report (not the independent verification)

Squeal reported baseline failures at its revision 2 while the independent suite was still running. These are **unverified as candidate gate evidence**: this is its background/cache path, not the prescribed reviewer run on the pinned clean HEAD. All reported messages are retained here; none was silently rerun to green:

| File and location | Message |
| --- | --- |
| `test/daemon/step-down.test.ts:80` | expected `[ 'alive' ]` to deeply equal `[ 'spawned' ]` |
| `test/e2e/stop-gap.test.ts:47` (Codex) | the stalled daemon holds its lock: expected `none` to match `/WRITE\s+311500\s/` |
| `test/e2e/worktrees.test.ts:27` (Codex) | expected `2399.906062000009` to be less than `2000` |
| `test/harness/session-start.test.ts:52` | Test timed out in 5000ms; load 83.29 |
| `test/harness/starting-daemon.test.ts:66` | Test timed out in 5000ms; load 83.29 |

Squeal later reported FAIL -> PASS under the same inputs for all five, marking them flaky. The reviewer did not request those reruns and retains the original failures above.

These messages are not additional blocking findings against the selected wave. The stop-gap message means that run never established its frozen-lock precondition; it does not demonstrate a stopped assertion returning early while a lock is held.

## Verdict

FAIL `5889105d81f66376e0f23524ba39ac9338b41af3`: **2 proven blockers, 1 proven should-fix, 1 proven nit**. The independent full suite passes. The original B1 and B2 controls are repaired, but the new B1/B2 scenarios below still violate amended D10. No plausible or unverified blocker. Background failures are recorded separately as verification observations.

## Blockers

### B1: inaccessible lock directory is still read as a free lock

**Proven, blocking.** `src/cli/stop.ts:95`: `!existsSync(path)` returns `free` before `probeLock` can classify a failure. Node returns false for an inaccessible ancestor as well as a missing file.

D10: “it says the daemon stopped only once the lock is free (taken and released at once), the process the daemon’s ping named is gone, or the store records a daemon of another start time than the ping’s”; “a probe that cannot open the lock proves nothing.”

Independent Linux probe on the clean candidate, uid 1001: acquire the fixture lock, keep the pinged pid alive, no replacement record, then `chmod 000` on the lock directory. `existsSync(lockPath)` becomes false. `lockFreed(root, {pid: process.pid, startedAt: 7}, 200)` returns `{state: "free"}`. A fake daemon answers `ping` and `stop`, closing its socket on stop; calling public `stopCommand` returns code 0 and `Squeal daemon stopped for <root>`. Before and after, `/proc/locks` shows the same live pid’s POSIX WRITE lock. Permissions restored and the fixture removed in finally. Throwaway probe scripts were removed after recording the evidence.

```text
$ node --disable-warning=ExperimentalWarning /tmp/reviewer-001-347-stop-probe.mjs
original B1, file chmod 000: {state: "unchecked", error: "unable to open database file"}
lock directory chmod 000: pathVisible false; {state: "free"}
CLI stop: code 0; Squeal daemon stopped for <fixture root>
/proc/locks after CLI: POSIX ADVISORY WRITE 72521 ... 1073741824 1073742335
exit 0
```

Worker-sized fix: distinguish actual ENOENT from EACCES or other lookup failures (and retain the pid/replacement-record proof); permission failures must use `unchecked` and the honest past-bound message. Add a regression with an inaccessible lock directory, not just an inaccessible lock file.


### B2: a waiter can acquire after its version decision became obsolete

**Proven, blocking.** `src/core/daemon/open.ts:107` calls `awaitDaemonLock`, which returns a successful acquisition before calling `giveUp` (`src/core/daemon/lock.ts:69`). The newly waiting normal-spawn path has no final version check before opening the store and serving.

D10: a vacant-lock waiter “exits as a loser, with no note ... while the last daemon the worktree’s row records ... is newer than itself.” This is distinct from the accepted same-version late hook: the waiter is older than the last recorded daemon.

Independent clean-candidate probe through public `startDaemon`:

1. A fixture holder takes the lock before its daemon registration exists, as during startup. A normal 0.1.153 spawn fails the lock and completes its first vacant-lock check against no record. The injected clock returns real `Date.now()` and sends an IPC observation when that check begins.
2. After 100 ms, SIGSTOP deschedules the waiting spawn. The holder records daemon 999.0.0, then clears it with `setDaemon(id, null)` during shutdown, preserving `{startedAt: 7, squealVersion: "999.0.0"}`.
3. Release the holder’s lock and SIGCONT the waiter. Its next lock attempt succeeds, bypassing `giveUp`. `startDaemon` binds the socket and its ping reports 0.1.153. The still-current last-daemon version immediately before acquisition was 999.0.0.
4. Stop the spawned daemon, close the fixture store and remove the fixture. The original B2 control with the newer cleared record present before the waiter’s first check exits `lost-lock` without a note.

```text
$ node --disable-warning=ExperimentalWarning /tmp/reviewer-001-347-open-probe.mjs
original B2: {reason: "lost-lock", code: 0, message: "another daemon serves <root>"}
first-check-before-registration case:
  lastRecorded: {startedAt: 7, squealVersion: "999.0.0"}
  result: serving
  ping: {ok: true, type: "ping", pid: 262311, squealVersion: "0.1.153", phase: "starting"}
exit 0
```

Before 001-340 this normal spawn exited on its first failed acquisition; it could not live through the newer holder’s registration and shutdown. A quick startup followed by explicit stop, or a descheduled spawn spanning registration and step-down, supplies the sequence. Worker-sized fix: a vacant-lock waiter that finally acquires must validate the last recorded version under its acquired lock before becoming a serving daemon, release and exit silently on a newer record, and preserve the accepted same-version case. Add a controlled check-before-registration / resume-after-shutdown regression; the existing handover test places the newer record before the first check and cannot distinguish this path.

## Should-fix and nits

### S1: the candidate deletes the status and amendment history

**Proven, non-blocking.** `docs/specifications/001-core-loop/status.md:1`. Commit 5889105d replaces 232 lines with a blank line and the new 001-345 amendment (`git diff --numstat 5889105d^ 5889105d`: 1 added, 231 deleted). It removes the shipped stage, earlier decisions, and every prior amendment including 001-340. Repository process calls this file the stage and amendment log. Restore the parent’s content and append the 001-345 entry. No product-code change required.

### N1: board statuses point to the cancelled review

**Proven, non-blocking.** `docs/board.md:433`, `:434`, `:442`: 001-335/337 still name 001-344 as running and 001-345 still says running at the candidate, despite the completed repair and cancelled review. The coordinator should reconcile these after this review. The reviewer did not edit the board.

## What fits

- The original 001-344 B1 file-permission probe yields `unchecked`, not `free`. A recorded replacement with a different start time proves the former holder released the singleton even if its numeric pid lives on. The source tests pin both pid-gone and replacement-record cases.
- The original 001-344 B2 control with a retained newer identity present at the first check returns `lost-lock` immediately. The handover-gap tests exercise SIGSTOP at socket unlink, a late older spawn, the successor, and the accepted same-version winner followed by a newer boundary. They do not cover B2 above, where the identity changes after the first check.
- The singleton remains SQLite’s held exclusive transaction. Each unsuccessful attempt closes its own connection; the CLI probe takes and releases synchronously. A transient CLI acquisition does not itself invoke a waiter’s loser rule: fresh same-version vacant waiters retry, and the successor still sees the replaced daemon’s older identity. No new simultaneous-serving path was established.
- Hook spawning remains detached, ignored stdio and unref. The 30 s delay is inside the daemon, not a hook. D9’s bounded startup registration still reports a spawn as starting, and does not claim a ready daemon before its heartbeat.
- The normal-spawn wait budget is 30,000 ms; successors retain `--await-lock 120000`, 10 ms retries, 250 ms decision checks, and a distinct timeout note. Unit coverage uses a 300 ms normal-spawn budget and checks one stored note and zero integrity checks for a timed-out loser.
- `test/e2e/stop-gap.test.ts` is the original socket/lock-gap reproduction on both shipped plugins: it proves the frozen old pid’s WRITE lock, starts another SessionStart, waits 5 s, requires stop still pending, resumes the old pid, and requires a replacement to validate an edit. It does not add an old-pid exit wait that would hide the gap.
- 001-337 changes no acceptance assertion. `daemonProcesses` reads `/proc/locks` without taking the lock, then captures `ps` asynchronously while the next operation runs. Only the caught restart-ready failure calls the evidence collector and `keep`; successful cleanup still removes the fixture. Cleanup kills daemons even when the fixture is kept. The lock-taking diagnostic runs only after failure.
- 001-335 keeps every halving, completed-files, current stored-result, hanging-file isolation, and next-batch assertion. Only timeout expectations follow the new 30 s value; `Atomics.wait` blocks the worker without burning a CPU or making cooperative cancel effective. This tests the same hard timeout as the former busy loop. Headroom over observed ordinary-file durations justifies the additional wall time; no scheduler implementation changed.
- All four version manifests say `0.1.153`: root package, Claude plugin manifest/package and Codex plugin manifest. `npm run build` reproduced both committed plugin distributions without drift. Format 9’s guarded-source pin is `8c4570eff25a4d52d705d33ce30e755ab1a220260151d12850766a856b792497`. The latest local release tag `squeal--v0.1.131` has format 8; the board and task notes consistently mark 9 unreleased. Re-pinning 9 is justified within this release history; no remote marketplace state was queried.
- D10’s two amendments describe the implemented budgets, loser and successor note shapes, pid/replacement evidence, and accepted same-version residue. B1 and B2 above are failures to uphold that amended text, not requests to reopen the accepted residue.

## Inputs for the next wave

Dispatch two independent repair rows: B1 owns `src/cli/stop.ts` and its CLI regression; B2 owns `src/core/daemon/open.ts` and its controlled waiter regression. B2 should enforce the last-version condition once it owns the lock without changing the accepted same-version handover. Preserve original B1/B2 controls and the existing 30 s / 120 s budgets. Keep every failed SQLite connection closed.

The coordinator should restore status history (S1) and reconcile the board (N1), rebuild and bump the plugin patch version for product fixes, and update the unreleased key pin if a guarded source changes. Re-review both new reproducers, the same-version residue, and bundle drift. The independent full suite passed once at the pinned candidate; the blocker probes are not covered by that suite. Known rows 001-342/343/346 remain outside the assigned range; report any failures there separately.
