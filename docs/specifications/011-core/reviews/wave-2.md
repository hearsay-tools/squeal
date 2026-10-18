FAIL e25d4229c2411c0e5147874c95ed09579d701d1b

Review of spec 011 wave 2 (011-15, 011-16, 011-17) and the approved stdout-only slice of 003-47. One proven blocker, two non-blocking notes, one documentation nit. Candidate `cand/0.1.216`, baseline `origin/main` at `ba019273b5ca8c1f0944494c71bdb9bce1b3411c` (0.1.215). HEAD matched the pinned candidate and the tracked tree was clean throughout the gates and probes. No product files changed. Build omitted as the dispatch explicitly requires.

## Verification output

```text
$ git rev-parse HEAD
e25d4229c2411c0e5147874c95ed09579d701d1b
$ git status --short
(no output)

$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 9s

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
(exit 0)

$ npm run lint

> squeal@0.1.216 lint
> biome check .

Checked 1452 files in 504ms. No fixes applied.
(exit 0)

$ npm run typecheck

> squeal@0.1.216 typecheck
> tsc --noEmit
(exit 0)

$ npm run check:version -- origin/main
version bump: 0.1.215 -> 0.1.216, ok
(exit 0)

$ npx vitest run $(git diff --name-only origin/main..HEAD -- test) test/keys/key-format.test.ts --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/dde597b9-79db-4504-899a-b3605781860d


 Test Files  16 passed (16)
      Tests  140 passed (140)
   Start at  16:44:10
   Duration  45.36s (tests 94%, transform 3%, import 2%)
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/dde597b9-79db-4504-899a-b3605781860d

 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 47032ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 28735ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/dde597b9-79db-4504-899a-b3605781860d/test/fixtures/scheduler/.tmp/b637eb98-e84e-46d6-8f3e-aa5d8f83ed72/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/dde597b9-79db-4504-899a-b3605781860d/test/fixtures/scheduler/.tmp/b12bd29a-0d74-4f71-9305-776476951a54/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3804906
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2136, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +62 (pid 3646783), dispose +109, input +906, kill +2136 (pid 3646783); the held Stop's deadline: +2000
 ❯ reached test/harness/opencode/held-stop.ts:210:27
    208|     if (gone !== null) {
    209|       const message = `before ${what}, ${gone.why}\n${timeline(b)}`;
    210|       throw gone.missed ? new Missed(message) : new Error(message);
       |                           ^
    211|     }
    212|     if (Date.now() > limit) throw new Error(`${what}: not within ${BAR…
 ❯ test/harness/opencode-dispose.test.ts:172:9
 ❯ Object.afterReply test/harness/opencode-dispose.test.ts:112:7
 ❯ runOpenCode test/helpers/opencode.ts:204:11
 ❯ squealOpenCode test/harness/opencode/real.ts:75:17
 ❯ overtaken test/harness/opencode-dispose.test.ts:99:18
 ❯ test/harness/opencode-dispose.test.ts:170:21
 ❯ ordered test/harness/opencode-dispose.test.ts:66:14
 ❯ test/harness/opencode-dispose.test.ts:168:26

 ❯ test/harness/opencode-dispose.test.ts:69:17 notice
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2209, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +82 (pid 3633983), dispose +144, input +1057, kill +2209 (pid 3633983); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2137, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +52 (pid 3639861), dispose +126, input +870, kill +2137 (pid 3639861); the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 728 passed | 1 skipped (730)
      Tests  1 failed | 6148 passed | 10 skipped (6159)
   Start at  16:45:02
   Duration  913.15s (tests 97%, import 2%, transform 1%)

    Isolate  730 workers spawned · ~143ms startup each (spawn + environment, per file)
             at least ~25.99s faster with isolate: false — reuses workers across files instead of one per file
(exit 1)

$ git diff --check origin/main..e25d4229
(no output; exit 0)
$ git status --short
(no output)
```

The independent full gate is **not green**: 728 files / 6,148 tests passed, one file / one test failed, and one file / 10 tests were skipped. The OpenCode dispose case exhausted its three attempts because each missed the new-turn request before the held Stop reached its existing 2,000 ms deadline. The final attempt was killed at +2,136 ms; the earlier two at +2,209 and +2,137 ms. This is the pre-existing timing limitation named on the board, and the test uses a stand-in Stop. Host load observed just after the failure report was 46.00 on 24 CPUs. **Proven:** the fixture missed its required order, rather than observing an old report stored. **Unverified:** attribution of those misses to this candidate; no proven new break is established by that failure. There was one independent full run, with no rerun to replace its result.

Separately, Squeal's revision-0 background baseline reported the two recorder-fidelity failures documented in the 011-15 notes (`run-reads-fidelity.test.ts:116`, `observe-fidelity.test.ts:119`). They were not failures in the independent full run above. No Squeal checkpoint is substituted for the reviewer's gate.


## Blockers

### B1. A prior stale FAIL sends a file with no current-key result through the counted-failure retry path

**Proven**, `src/cli/retry.ts:172` (011-16, at the seam with 011-15). C5's 2026-10-18 amendment says a file with no result at its current key runs once at once, whatever the reason, outside the session limit, which “bounds counted failures only”; only a current result is governed by the old paragraph. C6 now excludes stale and pending failures from that count.

`askLine` chooses the new no-result path only if there is no FAIL anywhere among the file's known states. An older stale FAIL therefore bypasses it even though the current key has no result. The new `noResultText` helper already handles stale prior results, but an earlier FAIL cannot reach that branch. The reply says the FAIL stays counted, a load request waits for low load, and the record lacks `noResult`, spending the session's one retry. If that run records a current failure, the session cannot ask its ordinary failure retry.

A scratch store was populated through `createStateSink`: fail at `old-stale`, move the file to `new-stale` with no result and no run pending, refresh. This is the same valid stale shape as the mixed-validity regression. With synthetic host load 100 on 1 CPU, the public CLI command produced:

```text
$ squeal retry test/stale.test.ts --reason load
Retry queued (reason: load): test/stale.test.ts runs once more when the one-minute load average falls below the CPU count, however long that takes (load average 100.00 on 1 CPU now). Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.

request: { testFile: { project: "", path: "test/stale.test.ts" }, reason: "load" }
```

After ending that request as failed and applying a failure at `new-stale`, a same-session request at calm load produced:

```text
$ squeal retry test/stale.test.ts --reason environment
Not retried: test/stale.test.ts was already retried in this session at its current inputs (load; it failed again). The failure stands.
```

Fix sized for one worker: classify current-result versus no-result first, before deciding whether a counted current failure is retryable. Keep the new-path pending/run deduplication and mark the no-result request so it runs immediately and does not spend the session limit, including when earlier fail states exist. Add CLI and scheduler regressions for a stale prior failure at a different key, load above CPU count, one queued run, and the later current failure retaining the session's normal retry. Preserve refusal for a current passing result and existing limits for a current failing result. Rebuild the shipped bundles and refresh the key guard under the release rules.

## Should-fix and follow-up notes

### S1. A no-result request changes its reported reason from load to environment

**Proven, non-blocking**, `src/core/retry/pending.ts:40`. A no-result request stores the caller's `reason: "load"`, but `pendingRetriesOf` reports `reason: "environment"` solely to reuse immediate-run wording. The scratch probe observed both records for the same request. Running immediately is correct under C5; rewriting the reason in status loses provenance and makes JSON disagree with the stored request. Preserve the reason and represent the immediate/no-result condition separately in the pending shape and formatter. The current unit test explicitly asserts the rewritten reason and should assert the caller's reason instead. This does not block the approved scheduling outcome.

### S2. The unchanged status-wait suffix still uses the old total

**Proven, non-blocking follow-up outside the changed source range**, `src/cli/status-wait-lines.ts:272`. The mixed store produces a current-only headline followed by a conflicting unqualified total on the final line:

```text
Known failures: 1 (1 test)
Earlier failures: 2 pending rerun, 1 stale (not counted until a rerun fails)
Returned without a daemon: no daemon is running; results are as of revision 1. Worktree: known failures 4 (4 tests); checks 0 running, 2 queued (2 tests)
```

This suffix existed before the candidate, and the 011-15 notes already name it; it is not a blocker against this range. A follow-up should route it through the shared validity split so a reader retaining only the last line gets the same meaning. Keep the explicitly exempt `run --all --wait` verdict and exit codes unchanged. The unchanged recovery-collapse `still failing` total is the related follow-up named in the worker notes, not independently reprobed here.

## Nits

### N1. The referenced 011-16 worker notes are absent

**Proven**, `docs/specifications/011-core/tasks/011-16/notes.md` does not exist at the pinned candidate, although the dispatch references it. The amendment, implementation and tests suffice to review the row. Add its decisions and type changes as a docs-only follow-up; do not change the board in the reviewer branch.

## What fits

- **011-15 / C6:** the shared `splitByValidity`, `knownFailureCounts` and `earlierFailuresLines` functions drive plain status, registration and Stop. The mixed-store tests retain earlier failure entries and their validity, publish `{ current, pending, stale }` in snapshots, and keep a same-key forced retry's failure current. The `run --all --wait` verdict and exit-code implementation did not change.
- **011-16 / C5:** the unknown and never-run cases without earlier fail states queue one immediate forced run and join an already asked run. The real-daemon test recovers an unknown file with a named wait while the crashed tier's other files stay unrun. Retry-record tests preserve the session's later failure retry after a correctly marked no-result request. Existing counted-failure retry tests remain in the touched/full gates. B1 is the missing earlier-failure case.
- **011-17 / C4:** `edited` ranks between failing and other direct importers; missing duration is zero only in that class. Scenario F, ordering with all entries retained, unknown versus known edited durations, and real Vitest added-file ordering are covered. Queue group selection, four-to-one fairness, promotions, lanes and `joinSpan` were not changed. The known rollback rank-loss seam is pre-existing and assigned to 004-70 in the worker notes.
- **011-17 / why:** the no-match payload counts only this worktree's queued/running keyed files lacking a result at that key. Text says an unrun name may be in them, handles singular/plural, and accepts older payloads without the additive field. It does not assert an unrun test is absent.
- **003-47:** only the test premise diagnostic and its comments change: stdout joins exit and stderr. The assertions, deadline and runner behavior stay the same. Determining why the busy loop exits remains contingent on the next sighting, as authorized.
- **Release and key pin:** `squeal--v0.1.215` has `KEY_FORMAT_VERSION = 11` and hash `c484b236291d0c45262589e42ec67f8d602441c810841a8629cae4d435b8d960`. Candidate 12 appends `24e1d600aea10b24767be0fd5635d3230920a923e65cc61a69d98fe30613a435`; the key guard passed. All four committed CLI bundles carry version 12. The version gate accepts 0.1.215 to 0.1.216.

## Inputs for the repair and next wave

Repair B1 at the CLI's current-result/no-result classification, preserving `RetryRecord.noResult` through shared request/claim/end handling. A no-result run neither clears a known state at request time nor supplies a failure-retry provenance fact. A named wait still promotes through C15; retries do not gain a new priority. `knownFailuresLine` now takes `{ check, validity }`, not bare check ids. The additive fields are `StatusSnapshot.knownFailureCounts`, `WhyNoMatch.queuedWithoutResult` and `RetryRecord.noResult`; no database schema changed. 011-18 and 011-19 are outside this candidate. Re-review the narrow repair and its bundle/key delta against B1.

The independent probe lived under `/tmp/squeal-review-wave2-fx3cprct`, with scratch HOME and XDG directories and explicit Git author/committer identity. It used a synthetic store and synthetic load, started no daemon, ran no candidate tests and modified no product file. The output above preserves the evidence; the scratch probe is deleted before this review is committed.


## Re-review

PASS 4feb215558fb474086133cb99e8ba7292befb9b0

Re-review of B1, S1, S2 and N1 at `cand/0.1.216`, plus the first review of 004-71 against 004 D8's 2026-10-18 amendment and `tasks/wave-10.md`. No blockers, no new should-fix findings or nits. The scope remains 011-15, 011-16, 011-17 and the approved stdout-only 003-47 slice, with 004-71 added. The narrow product delta since `e25d4229` is the stale-FAIL classification, retry reason and wait count repairs, the policy-aware quiet line, and the rebuilt bundles/key pin. The candidate SHA matched HEAD and the tracked tree stayed clean through every gate and probe. `origin/main` was `0ca490008bbc2474aff0e5f739e186be3878b94d` (0.1.215). Build omitted as explicitly dispatched.

### Verification output

```text
$ git rev-parse HEAD
4feb215558fb474086133cb99e8ba7292befb9b0
$ git status --short
(no output)

$ npm ci
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
(exit 0)

$ npm run lint
> squeal@0.1.216 lint
> biome check .

Checked 1453 files in 517ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.216 typecheck
> tsc --noEmit
(exit 0)

$ npm run check:version -- origin/main
> squeal@0.1.216 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.215 -> 0.1.216, ok
(exit 0)

$ npx vitest run $(git diff --name-only origin/main..HEAD -- test) test/keys/key-format.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/df3d7f5c-d203-4c83-becc-e78256a661ca


 Test Files  18 passed (18)
      Tests  152 passed (152)
   Start at  17:20:17
   Duration  46.46s (tests 94%, transform 4%, import 2%)
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/df3d7f5c-d203-4c83-becc-e78256a661ca

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/df3d7f5c-d203-4c83-becc-e78256a661ca/test/fixtures/scheduler/.tmp/0d444d0c-a2d1-41b6-9b7c-8569ee009ab6/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/df3d7f5c-d203-4c83-becc-e78256a661ca/test/fixtures/scheduler/.tmp/17ef9100-2c71-4947-a5c2-7d52333932c7/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 605786
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  730 passed | 1 skipped (731)
      Tests  6156 passed | 10 skipped (6166)
   Start at  17:21:16
   Duration  836.71s (tests 98%, import 2%)

    Isolate  731 workers spawned · ~126ms startup each (spawn + environment, per file)
             at least ~22.93s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)

$ git diff --check origin/main..4feb215558fb474086133cb99e8ba7292befb9b0
(no output; exit 0)
$ git status --short
(no output)
```

The independent full gate is green: 730 files and 6,156 tests passed, one file and ten tests skipped, exit 0. One full run was performed; no rerun replaces its result. Host one-minute load observed during the gate ranged from 7.72 to 42.12 on 24 CPUs. The fixture repair and cleanup messages above were not test failures.

Separately, the revision-0 Squeal background baseline reported a 20 s idle-wake timeout in `test/e2e/pi.test.ts`, then automatically recovered it under the same inputs (`Flaky: FAIL -> PASS`). It also reported the same two recorder-fidelity failures named in the first review (`run-reads-fidelity.test.ts:116`, `observe-fidelity.test.ts:119`). These background results are distinct from the independent full gate above; no checkpoint replaces it.

### Prior findings

- **B1 closed, proven.** `src/cli/retry.ts:173` selects the counted-failure path only for a current FAIL. The scratch store was seeded through `createStateSink`: four failures at old keys, then one current (same-key forced rerun queued), two pending at new keys and one stale at a new key with nothing queued. At synthetic load 100 on 1 CPU, retrying the stale file with `--reason load` stored exactly one request with `noResult: true`, reported stale provenance and an immediate run. A repeated request stored no second request. Calling the production scheduler's `takeRetries` with that store and a recording ledger queued one forced run despite the load; another call queued none. After ending that request as failed and applying a current failure at its new key through the sink, the same session's ordinary `environment` retry was accepted and stored without `noResult`. This directly repeats the original counterexample and its later-session-limit check.
- **S1 closed, proven.** `src/core/retry/pending.ts:39` keeps the caller's `load` reason and exposes the additive `noResult: true`; `src/core/status/format-status.ts:112` uses the flag for immediate-run wording. The scratch snapshot and plain rendering agreed with the stored request. It printed `(load, no result at its inputs): runs at once`.
- **S2 closed, proven.** `src/cli/status-wait-lines.ts:291` splits the known failures by validity for the shared worktree suffix. The committed CLI over the mixed scratch store printed one current failure in both the headline and final line, retaining two pending and one stale on the separate earlier-failures line. This helper also serves named waits; the full-suite checkpoint verdict/exit-code implementation is unchanged.
- **N1 closed, proven.** `tasks/011-16/notes.md` now records the classification, immediate no-result scheduling, deduplication, session budget and additive `RetryRecord.noResult` / `PendingRetry.noResult` types. No schema change.

Representative scratch output:

```text
Known failures: 1 (1 test)
Earlier failures: 2 pending rerun, 1 stale (not counted until a rerun fails)
Returned without a daemon: no daemon is running; results are as of revision 2. Worktree: known failures 1 (1 test); checks 0 running, 2 queued (2 tests)

Run queued: test/stale.test.ts has no result at its inputs (stale: its last result is at other inputs). It runs once now at its normal priority, whatever the reason; that is its one run at these inputs, and it spends no retry of this session. squeal status --wait 60000 test/stale.test.ts waits for its result and moves it ahead in the queue.
request: { reason: "load", noResult: true, end: null }
pending status: { reason: "load", noResult: true, requests: 1 }
  test/stale.test.ts (load, no result at its inputs): runs at once
B1 scheduler at load 100/1: one forced run queued, second take queues none

Retry queued (reason: environment): test/stale.test.ts runs once more now. Its FAIL stays counted until a retry passes; squeal status lists the retry while it is pending.
```

### 004-71 first review

**Conforms, proven.** `src/cli/status-wait-lines.ts:144` uses `slowTier.stopWaitMs`, the same policy projection as the existing slow-tier header. That value is present exactly when `stop.requireSlowSuite` is on. Only the quiet line's wording changes; absent tiers and fully current tiers still add no clause. The policy-on string is unchanged, including singular/plural and the command that runs and waits. There is no broader policy-on exemption and no preparation command. `run --slow --wait` still uses its own held-file wording, and the precondition/Stop code is unchanged.

The shipped Claude Code CLI was exercised over a second scratch store and a stand-in socket. At revision 4, one fast file was re-keyed by a README edit and completed after sync; two slow files had never run. The socket published real re-key moves with its daemon incarnation. Both policy values returned quiet after that fast file settled, leaving both slow files not current. Each was run in plain and `--json` mode. Plain stdout's final line and JSON mode's stderr line matched; stdout in JSON mode parsed, had `wait.outcome: "quiet"`, `slowTier.notRun: 2`, and `stopWaitMs` only with policy on:

```text
# policy off, plain and --json stderr
Returned on quiet: nothing the edits since revision 4 re-keyed is pending (1 test file) at revision 4 after 0.3 s; 2 slow files are not current; this repository does not require them before you finish (`squeal run --slow` runs them). Worktree: known failures 0; checks 0 running, 0 queued

# policy on, plain and --json stderr
Returned on quiet: nothing the edits since revision 4 re-keyed is pending (1 test file) at revision 4 after 0.3 s; 2 slow files are not current, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them. Worktree: known failures 0; checks 0 running, 0 queued

All scratch-store assertions passed.
```

The touched tests cover policy off explicitly and by default, policy on, the docs-only edit window, slow pending/not-run states, and singular wording. JSON's line is checked independently above through the shipped CLI.

### Regression boundary and next wave

The previous review's settled findings remain settled. The repair changes no queue ranking or `why` logic, and no node:test runner or busy-loop assertion. Existing counted-failure limits, current-pass refusal, unknown/never-run retry, named wait, edited-file ordering, mixed validity, registration and Stop tests all passed in the touched gate. All four committed CLI bundles are byte-identical (`sha256 aad6abd53a434a652600b5e57f55784a6473aa39efa2c23ff50460469411d1a9`), carry key format 12 and contain the policy-aware clause; the key guard and version gate passed. The refreshed format-12 pin is `9d5b789cb813cbd5acadb2590d3cfcb88d5f4487239caf598c1a3879a38b4d2c`.

No fix wave is requested by this re-review. Preserve the additive no-result flag rather than rewriting the retry reason. The already assigned 004-70 rollback-order seam, wider 003-47 investigation after the next sighting, and planned 011-18/011-19 remain outside this scope. The probes lived entirely under `/tmp/df3d7f5c-probe`, used a scratch HOME/XDG layout and explicit Git author/committer identity, and started no actual daemon. Their throwaway source, stores and socket were removed before this review commit. No product file was changed.
