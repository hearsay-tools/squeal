# Wave 13av review

Candidate: `4889ba223df3b1936382c7ee595c789c36901891` (0.1.143).
Range: `5378abd3..4889ba22`.
Implementation row: 001-304. Reviewer row: 001-318.
Source: `reviews/wave-13ao.md` S1 and `docs/board.md:406`.

## Verification output

HEAD matched the assigned candidate. Node v24.21.0, git 2.43.0, Linux. Installation, lint, typecheck, build, the independent full suite, the targeted rerun and the probe all ran at that candidate with a clean tracked tree. Both plugin builds reproduced their committed bundles without drift. Only this review file was added afterward.

```text
$ git rev-parse HEAD
4889ba223df3b1936382c7ee595c789c36901891
$ git status --short
[empty]

$ npm ci
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 1s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
[exit 0]

$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.143 lint
> biome check .

Checked 973 files in 992ms. No fixes applied.
[exit 0]

$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.143 typecheck
> tsc --noEmit
[exit 0]

$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.143 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.143 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/46fb8cfb-882d-4315-b8c8-56019b8e4152

 ❯ test/cli/remove.test.ts (9 tests | 1 failed) 14450ms
   ❯ squeal remove (9)
     × deletes nothing and exits 1 while a daemon will not let go of its lock 5389ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/46fb8cfb-882d-4315-b8c8-56019b8e4152/test/fixtures/scheduler/.tmp/0ab9b19e-f870-47de-8e84-8079dc01d341/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/46fb8cfb-882d-4315-b8c8-56019b8e4152/test/fixtures/scheduler/.tmp/9f8bd276-4896-4594-9321-5b0cadb616d6/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 34929
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/cli/remove.test.ts > squeal remove > deletes nothing and exits 1 while a daemon will not let go of its lock
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/cli/remove.test.ts:137:3
    135|   );
    136|
    137|   it("deletes nothing and exits 1 while a daemon will not let go of it…
       |   ^
    138|     const repo = storedRepo();
    139|     const lock = acquireDaemonLock(lockFileFor(repo.commonDir, repo.id…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 456 passed | 1 skipped (458)
      Tests  1 failed | 3838 passed | 10 skipped (3849)
   Start at  16:13:38
   Duration  730.60s (tests 97%, import 2%, transform 1%)

    Isolate  458 workers spawned · ~191ms startup each (spawn + environment, per file)
             at least ~21.67s faster with isolate: false — reuses workers across files instead of one per file
[exit 1]

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4 test/cli/remove.test.ts -t 'deletes nothing and exits 1 while a daemon will not let go of its lock'
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/46fb8cfb-882d-4315-b8c8-56019b8e4152


 Test Files  1 passed (1)
      Tests  1 passed | 8 skipped (9)
   Start at  16:21:41
   Duration  2.71s (transform 52%, tests 38%, import 10%)
[exit 0]

$ git diff --exit-code
[empty; exit 0]
$ git diff --cached --exit-code
[empty; exit 0]
$ git status --short
[empty]
```

**The full-suite gate failed.** Its only failure was the unchanged `test/cli/remove.test.ts:137` case timing out at 5,000 ms. The same case passed on the unchanged candidate in the targeted run above. That test creates a scratch store, holds its daemon lock and calls `removeCommand` with `stopWaitMs: 300`; it starts no daemon or linked watch. Neither its implementation nor its test changed in this range. This is recorded verification evidence, not a finding against 001-304. A load-related explanation is **unverified**: host load was observed as high as 118.79 during the full run, but the rerun does not establish the timeout's cause. The targeted pass does not turn the full-suite gate green.

The full run also printed two scratch-fixture worktree-repair notices, experimental type-testing notices and cleanup of one process an earlier run left. It reported no cleanup failure. One full-suite run was performed. No model eval, release operation or human-daemon control was invoked.

An independent throwaway probe imported the freshly built `LinkedWatches` from `dist/core/watcher/linked-watch.js`. It used a scratch git repository, a symlinked target and a fake backend. It added an ignore rule rather than removing one, rejected the second subscription, and held the third subscription's promise until the probe checked that the first subscription had not closed. It then released the replacement, awaited the update and repeated an unchanged update. Assertions passed:

```json
{"direction":"narrow","attempts":3,"exclusions":[[],["gen"],["gen"]],"oldHeldUntilReady":true,"closed":[0],"errors":["once"],"freedHints":0,"stableUpdateResubscribed":false}
```

The probe closed its subscriptions, removed its scratch repository and deleted its program. It made no tracked change.

## Verdict

**PASS. 0 blockers, 0 should-fix, 1 nit.**

Wave 13ao S1 is resolved. The candidate meets 001-304's done-when: “a replacement that fails once is retried at the next trigger and then holds the new exclusions.” This verdict concerns that bounded repair and its landing artifacts. It is not a claim that the full-suite gate passed.

## Blockers

None. Wave 13ao had no blocking findings to re-check.

## Should-fix

None.

## Nits

### N1. The board still calls the landed implementation running

**Proven, non-blocking.** `docs/board.md:406` still reads `running (worker 9c983704, opus)` for 001-304, although this candidate includes its implementation (`34aeed5a`), completed regression test (`91263dfb`), key pin (`ffa9ed30`) and plugin landing (`4889ba22`). The done-when is demonstrated by the candidate's passing regression and the independent probe. The board therefore does not describe the landed implementation's state.

Coordinator-sized fix: after deciding whether to accept this landing, update 001-304 to the appropriate landed/reviewed state and cite this verdict and the candidate. Preserve the distinction between the PASS review and the failed full-suite gate. The reviewer did not edit the board.

## What fits

### S1: installed state survives a rejected replacement

`src/core/watcher/linked-watch.ts:171-179` passes the proposed exclusions into `subscribe(path, target, excluded)` without first changing the installed exclusion list. Only a successful `await` publishes the new subscription and exclusions. Those two assignments have no asynchronous gap between them. A rejection leaves both old values intact, and `step` still reports the error through `onError`.

The next full recompute compares the filesystem's proposal with the actual installed list, so it retries instead of returning at `sameList`. `test/watcher/linked-watch.test.ts:67-85` exercises the public `update` interface: attempts are `[gen], [], []`; the rejected attempt closes nothing and reports no freed hint; success closes subscription 0 and emits `lib/gen` as an `unknown` hint; another unchanged update makes no subscription. That case passed in the independent full suite, whose sole failure is recorded above. The narrowing probe separately rules out closing the old watch before replacement readiness and verifies that narrowing emits no freed-directory hint.

### Callers, contracts and honesty

Both call sites, initial `watch` and replacement `apply`, pass the proposed absolute exclusion list to the changed private helper. The public `LinkedWatches.update(Map<relative link, absolute target>)` interface and the backend's `watch(WatchSpec, WatchListener)` interface are unchanged. Both real backends consume `spec.excluded`; link-mapped callbacks and explicit extra-file handling are unchanged.

`ChangeFeed.onBackendError` still reports the error and queues reconciliation (`change-feed.ts:193-206`). `reconcileNow` calls `linked.update(linkedDirs)` before emitting its batch (`change-feed.ts:228-234`), supplying the full recompute that retries the failed proposal. The target's existing queue serializes its exclusion work. Successful replacement still makes the new watch ready before closing the old watch, then reports directories no longer excluded under every current link.

This satisfies D2's requirement that target exclusions be recomputed “on each reconciliation” and D12's backend-error reconciliation path. No header, status, result, revision or delivery shape is changed, and no validation state is promoted by installing a watch. Goals 3 and 5 retain their honesty boundary. D1's nested-repository rules and the other spec sections' settled behavior were not reopened by this repair.

### Landing artifacts and conventions

The root package, both plugin manifests and the Claude plugin package agree on 0.1.143. Building reproduces both committed plugin distributions. The key-format guard passed in the independent suite; the range re-pins format 9, described as unreleased in `ffa9ed30`, while the status log's last recorded hub release shipped format 8. This review claims no release verification. The change introduces no dependency or public type change. The focused fake backend implements both required subscription methods, and lint/typecheck pass.

## Inputs for the next wave

- No product fix wave is required for 001-304. Wave 13ao's ordinary ignore, linked mapping and reconciliation-coalescing cases remain settled; this repair closes its S1.
- Preserve `LinkedWatches.update(Map<relative link, absolute target>)` and `linkedExclusions(root, links, target, dirs?)`. Proposed exclusions enter the private subscription helper; installed state changes only after that subscription succeeds. Keep readiness, publication, old-watch closure and freed-directory hints in that order.
- Preserve D2's 100 ms quiet / 500 ms maximum debounce and 30 s idle reconciliation. This range adds no timer, retry budget or concurrency setting.
- N1 belongs to the coordinator. The full gate's removal timeout remains an integration-check concern; any investigation should use its exact case and keep the passing isolated rerun as evidence, without attributing it to linked watches.
- Native macOS behavior remains unverified under the spec's existing v1 non-goal. There is no missing interface or product implementation for this row. The coordinator decides acceptance and any subsequent landing or release.
