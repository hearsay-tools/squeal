# Wave 13bi: 001-353 reviews 001-343 (0.1.155)

Candidate: `ea63bddb611e6a56405f2ab2b39abdc90b4303e3`. Range: `02dc8106..ea63bddb` (the five commits named in the brief).

Verdict: **PASS**. 0 blockers, 1 should-fix suggestion (plausible), 1 nit (proven). No correctness break of the changed read-stamp paths was proven. The independent full suite passes. No product or board file was edited by the reviewer.

## Verification output

The required verification commands ran on the clean, exact candidate with a temporary HOME, `CODEX_SESSION_ID` unset, `GIT_CONFIG_GLOBAL=/dev/null`, and `GIT_CONFIG_NOSYSTEM=1`. No deleted fixture symlinks appeared in the initial `git status --short`. The check logs below precede this review-only commit.

### npm-ci

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 3s

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

### lint

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.155 lint
> biome check .

Checked 1002 files in 618ms. No fixes applied.
exit 0
```

### typecheck

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.155 typecheck
> tsc --noEmit

exit 0
```

### build

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.155 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.155 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

exit 0
```

`git status --short` after the build: empty. Both plugin bundles match the build.

### Independent full suite

After the parent explicitly released the load hold, ran exactly one full suite at the clean, exact candidate. The runner used an isolated HOME, unset CODEX_SESSION_ID, and disabled user/system Git configuration. No other full suite or stress run was started by this reviewer.

Command (plus the isolated HOME/config/cache directories):

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
```

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56/test/fixtures/scheduler/.tmp/fb1afb4d-2294-452a-8b7b-1affa2532627/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56/test/fixtures/scheduler/.tmp/8c4a462a-f4e5-4823-a77b-03a5a27c10e5/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 1631698
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  468 passed | 1 skipped (469)
      Tests  3942 passed | 10 skipped (3952)
   Start at  23:41:54
   Duration  509.53s (tests 98%, import 2%)

    Isolate  469 workers spawned · ~120ms startup each (spawn + environment, per file)
             at least ~13.99s faster with isolate: false — reuses workers across files instead of one per file

exit 0
```

`git rev-parse HEAD` immediately before and after: `ea63bddb611e6a56405f2ab2b39abdc90b4303e3`. `git status --short` before and after: empty. No fixture symlink deletion or bundle drift. There were no failed tests and no unhandled-error summary. The three known open cases named in the brief did not fail in this run. One suite was run; there was no rerun to green.

## Blockers

None. Both new regressions are red with their matching source fix removed and green on the candidate. The independent full suite passes.

## Discriminating checks

Original worktree checks ran on the clean, exact `ea63bddb` candidate after temporarily detaching HEAD; the review-only branch commit remains separate. Scratch mutations are experiments, not whole-tree verification. Each experiment uses the isolated HOME from Verification.

### overlap-green

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56


 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  23:34:34
   Duration  11.31s (tests 92%, transform 6%, import 1%)

exit 0
```

### overlap-red-inflight

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/tmp/846e35c0-c084-4c9d-b606-ba9fc44bfb56/squeal-review-353-rguqye00/candidate

 ❯ test/runners/vitest/overlap.test.ts (8 tests | 1 failed | 7 skipped) 841ms
   ❯ vitest adapter: the runner part beside a run (001-150) (8)
     × drops a file whose run read bytes a mid-run invalidate dropped while their transform was in flight (001-343) 839ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/runners/vitest/overlap.test.ts > vitest adapter: the runner part beside a run (001-150) > drops a file whose run read bytes a mid-run invalidate dropped while their transform was in flight (001-343)
AssertionError: expected [ { project: '', …(1) } ] to deeply equal []

- Expected
+ Received

- []
+ [
+   {
+     "path": "test/held.test.ts",
+     "project": "",
+   },
+ ]

 ❯ test/runners/vitest/overlap.test.ts:267:35
    265|   it("drops a file whose run read bytes a mid-run invalidate dropped w…
    266|     const report = await inFlightRun(true);
    267|     expect(report.completedFiles).toEqual([]);
       |                                   ^
    268|     expect(report.results).toEqual([]);
    269|     expect(report.failure).toContain("src/mod.ts changed on disk after…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 7 skipped (8)
   Start at  23:35:12
   Duration  2.59s (transform 50%, tests 41%, import 9%, worker 1%)

exit 1
```

### overlap-red-replaced

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/tmp/846e35c0-c084-4c9d-b606-ba9fc44bfb56/squeal-review-353-rguqye00/candidate

 ❯ test/runners/vitest/overlap.test.ts (8 tests | 1 failed | 7 skipped) 1594ms
   ❯ vitest adapter: the runner part beside a run (001-150) (8)
     × drops a file whose in-flight read a later load of the module in the same run replaced (001-343) 1586ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/runners/vitest/overlap.test.ts > vitest adapter: the runner part beside a run (001-150) > drops a file whose in-flight read a later load of the module in the same run replaced (001-343)
AssertionError: expected [ { project: '', …(1) }, …(1) ] to not deep equally contain { project: '', …(1) }

- Expected:
{
  "path": "test/held.test.ts",
  "project": "",
}

+ Received:
[
  {
    "path": "test/held.test.ts",
    "project": "",
  },
  {
    "path": "test/reread.test.ts",
    "project": "",
  },
]

 ❯ test/runners/vitest/overlap.test.ts:274:39
    272|   it("drops a file whose in-flight read a later load of the module in …
    273|     const report = await inFlightRun(true, true);
    274|     expect(report.completedFiles).not.toContainEqual(HELD);
       |                                       ^
    275|     expect(report.results.map((r) => r.check.testPath)).not.toContain(…
    276|     expect(report.failure).toContain("src/mod.ts changed on disk after…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 7 skipped (8)
   Start at  23:35:52
   Duration  4.15s (tests 50%, transform 42%, import 7%)

exit 1
```

### key-format

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56


 Test Files  1 passed (1)
      Tests  27 passed (27)
   Start at  23:36:47
   Duration  1.32s (tests 57%, transform 32%, import 10%, worker 1%)

exit 0
```

### integration-green

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/846e35c0-c084-4c9d-b606-ba9fc44bfb56


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  23:37:09
   Duration  5.45s (tests 89%, transform 9%, import 2%)

exit 0
```



## Should-fix

### S1 (plausible, nonblocking): keep the pending-request abort case as a regression

Locations: `src/runners/vitest/sources.ts:186` and `:265`; `test/runners/vitest/overlap.test.ts:273`.

The added reread test loads the module again after the first read has returned. Vite's `_pendingRequests` branch can replace its pending entry while the earlier promise is still live. The independent review probe confirms that the candidate covers this: the second request loads NEW, the first still returns OLD, and the end check names the earlier read; identical bytes stay valid. This is a coverage suggestion, not a demonstrated fault.

One-worker change: add the focused pending-request pair to `test/runners/vitest/sources.test.ts` using a held first transform, `invalidateFile`, then a second `transformRequest` before releasing the first. Assert both returned byte versions, stale OLD/NEW, no stale NEW/NEW, and no retained old stamp at the next check. Avoid timing thresholds or starvation loops.


## Nits

### N1 (proven, nonblocking): qualify the benchmark's scope

Locations: `docs/specifications/001-core-loop/research/revert-restore-pass-2.md:65-78` (Time and Recommendation 1); implementation `src/runners/vitest/sources.ts:256-270`.

The committed raw 2,000/5,000-module timing samples record `added: 0` in every run. The timing patch measures the first fix's scan and does not include the second fix's `#replaced` loop. These samples support the stated observed scan times, not a universal <3 ms bound for every end check. The whole end check is already reported as 27 to 155 ms. By source inspection, added work is O(S + R), S = retained stamps across active containers, R = replaced reads since the previous end check; added checks share one stat and at most one hash per file. Changed repeated loads can grow R; equal hashes add no entry. Both collections are filtered by the run's load time and the replacement list is cleared at the end check.

One-worker fix: narrow Recommendation 1 to "the measured stamp scan took under 3 ms at 5,000 modules"; state that the measurements had no uncached additions and do not bound replacement-heavy work. No latency failure or performance blocker is established. No new benchmark or stress loop was run during the load hold.


## What fits

- The candidate SHA matches the brief and the build causes no tracked drift. All four version files name 0.1.155.
- Both new overlap cases discriminate their fixes: reverting 3a9b4e56 completes the held file incorrectly; retaining that fix but reverting b033e2db lets the later load hide the held file's old bytes. Candidate overlap: 8/8.
- The new end check scans every stamped project-file read from the run, including uncached transforms; replacements with different hashes retain the earlier stamp. Equal bytes are compared by the existing stat/hash rule, so invalidation alone does not taint a run.
- Independently probed Vite 8.3.2's pending-request abort on a scratch candidate copy. It clears only the pending entry; the first promise returns its old transform, while the second returns the fresh one. The candidate detects the retained earlier hash; equal-byte reloads return no stale file. Both cases pass. The scratch probe was removed before the final review commit.
- Integration planting still requires the module's old bytes to have been loaded without a module revision after `at`. Requiring exactly one test-file revision excludes route A's empty-file key plus restored-file key, rather than accepting an unplanted trial. The test asserts planting, tries at most eight times, and keeps the no-current-pass assertion. Route B's two deterministic adapter cases are separately red before their fixes.
- Released tag squeal--v0.1.131 carries key format 8; format 9 has not shipped. Re-pinning 9 is justified for this unreleased train, and the guard's 27 tests pass. Re-pinning a released format would be unsafe.


## Inputs for the next wave

- No product fix wave is justified by this review. The independent full suite passes. S1 and N1 are optional follow-ups and do not gate this candidate.
- Keep the ordering in `VitestAdapter.run`: pre-run stale check, take `loadedSince`, execute, call the end stale check with that timestamp, then filter the report through `mayHaveRun`/`withoutFiles` before the scheduler can store it. A mid-run runner-part invalidate keeps its cached stamps before invalidation; uncached and replaced stamps supplement that hold at the run's end.
- Do not assume Vite's pending abort cancels a promise. Keep every distinct read hash the first caller may execute; the second caller's fresh stamp must not overwrite its evidence.
- The existing per-call stat/hash memoization bounds IO by distinct file paths, not by the number of stamps. Do not turn the small observed scan time into a hard deadline.
- Keep the integration test's assertion that an attempt was planted. A trial rejected because two revisions named the test file cannot be counted as evidence for route B. The two overlap regressions continue to cover route B independently of watcher batching.
- If this symptom recurs, retain the store and identify the armed run's run ID and key. The historic gate's deleted store leaves its route undetermined; the candidate's two fixes do not retroactively identify it.
- Known unrelated open cases from the brief: 001-342 `stop-slow-wait.test.ts:216`; 001-346 busy-store optimizer note; 001-352 `test/daemon/slow-lane.test.ts:57` empty started marker. None failed in this single independent run. Their open investigations remain with their owning rows.


## Background Squeal observations (supplementary, unverified for the independent gate)

Revision 2 reported 4 failing checks at host load 69.39. These are not substitutes for the independent candidate run and are outside this wave's changed product paths:

- `test/harness/starting-daemon.test.ts:130`: "says a daemon is starting, and nothing once it heartbeats": `Test timed out in 5000ms.`
- `test/harness/uncovered-edit.test.ts:113`: "counts only this worktree's listed test files, and says nothing while one has no closure": `Test timed out in 5000ms.`
- `test/harness/waiter.test.ts` (file-level): `database is not open`.
- `test/harness/waiter.test.ts:43`: "exits 2 with the formatted delta on stderr when a transition arrives": `Test timed out in 5000ms.`

Squeal subsequently reported all four as `FAIL -> PASS`, each with `Flaky: FAIL -> PASS under the same inputs`. These were automatic baseline retries, not manual reviewer reruns. The original failures remain recorded above. The independent full suite later passed these files too.

## Additional isolated probe output

### pending-abort-reset

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/tmp/846e35c0-c084-4c9d-b606-ba9fc44bfb56/squeal-review-353-rguqye00/candidate


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  23:37:55
   Duration  1.04s (transform 34%, tests 33%, import 32%, worker 1%)

exit 0
```

### route-a-forced

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/tmp/846e35c0-c084-4c9d-b606-ba9fc44bfb56/squeal-review-353-rguqye00/candidate


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  23:39:10
   Duration  8.58s (tests 90%, transform 8%, import 2%)

exit 0
```

### overlap-same-byte-reread

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/tmp/846e35c0-c084-4c9d-b606-ba9fc44bfb56/squeal-review-353-rguqye00/candidate


 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
   Start at  23:40:07
   Duration  1.11s (tests 56%, transform 36%, import 8%)

exit 0
```

Forced route A store dump: attempt 1, at 0, loaded OLD, planted false; revisions 1 (empty test) and 2 (test bytes). Attempt 2, at 2, loaded OLD, planted true; revision 3 names only the test. Known states at the assertion: `["unknown unknown", "unknown unknown"]`. This independently confirms exclusion followed by successful planting, rather than vacuous success.

The same-byte reread adapter probe completes both HELD and REREAD, with both outcomes pass. The pending-abort probe repeats the end check at the same `loadedSince` and returns no stale file the second time, proving the saved replaced read was released.

Supplementary `sources.test.ts`: 8/8, exit 0. The review-only branch was switched during that run, so this is unverified as a whole-tree candidate gate despite identical product sources; the independent full suite also passed at the exact candidate, including this file.
