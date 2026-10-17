# Wave 1.10: 011-08, candidate 0.1.209

FAIL `4de3838933cde4c8b0ef45561d0e0d8e9533664f`: **2 proven blockers, 1 plausible should-fix, 1 proven documentation nit**.

## Verification

Independent review on the pinned candidate, initially and throughout verification a clean tree. Base reference: `origin/main` = `276fbaf005b127d3a126d97fc6a1c4c5f803a1e8`; product range: `git log origin/main..4de38389 -- src test plugins`. The requested coordinator fix `047b1783` is present as `27fe4d7d` in this candidate. No build was run, as this brief explicitly excludes it. No product files changed.

```text
$ git rev-parse HEAD
4de3838933cde4c8b0ef45561d0e0d8e9533664f
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

$ npm run lint

> squeal@0.1.209 lint
> biome check .

Checked 1389 files in 587ms. No fixes applied.

$ npm run typecheck

> squeal@0.1.209 typecheck
> tsc --noEmit


$ npm run check:version -- origin/main

> squeal@0.1.209 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.208 -> 0.1.209, ok

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a/test/fixtures/scheduler/.tmp/75ce9d24-78a0-49e6-bac0-383c450ad5b8/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a/test/fixtures/scheduler/.tmp/3d0900ac-bd49-4890-b703-249fb4b41c2e/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3747946
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  691 passed | 1 skipped (692)
      Tests  5875 passed | 9 skipped (5884)
   Start at  13:21:05
   Duration  770.40s (tests 98%, import 2%)

    Isolate  692 workers spawned · ~121ms startup each (spawn + environment, per file)
             at least ~20.82s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
```

All requested independent checks passed. Vitest: 691 files and 5,875 tests passed; 1 file and 9 tests skipped; exit 0. These checks do not cover the two stopped-mark cases reproduced below. The background Squeal baseline separately reported two recorder-fidelity failures in unchanged tests; both files passed this independent run. Neither baseline result is used as the independent gate or as a wave finding.

The command probes below also ran at the clean pinned candidate. Their repositories and scripts were outside the worktree; no test or implementation was added to the candidate.

## Blockers

### B1. Proven: the no-daemon mark is bypassed when that worktree has no registration row

**Locations:** `src/core/delivery/stopped.ts:64` and `:92`; caller `src/harness/shared/ensure.ts:55`; writer `src/cli/stopped-mark.ts:45`.

**Contract:** C9: “It is written once no daemon serves, and also when the stop found none running; it is not written when there is no store.” Also: “While the mark holds, no hook boundary of any harness ensures a daemon,” registrations included. The 011-08 outcome is stopped until the next edit or explicit start.

**Failure:** a repository already uses Squeal in its main checkout. Create a linked worktree, stop that root before its first daemon runs, then open a session there without an intervening edit. The shared store exists, so `stopCommand` exits 0 and writes a valid `{at, tree}` mark. Only a daemon registration creates that root's `worktrees` row (`src/core/daemon/daemon.ts:362`); the stop writer creates no row. `heldStop` returns null solely because the worktree record is absent. SessionStart calls `ensureDaemon` and its header also omits the stopped explanation. Post-tool boundaries use the same bypass.

**Evidence:** the shared-store probe below reports `stopExit:0`, `rowPresent:false`, `tree:"hash"`, `ensures:1`, `markAfter:"kept"`. Its only daemon dependency is a recording `ensureDaemon` that returns `unavailable`, so it proves the forbidden call itself without starting a process. No file changes between stop and registration.

**One-worker fix:** make a stopped root's identity/root available to the mark check even before a daemon has registered. Either record the missing root safely alongside its mark, or use the hook's known root/id when reading a mark without a worktree row. Preserve the no-store/no-mark rule and heartbeat invalidation; make header and status agree. Add a regression with a shared store and an unregistered linked worktree, exercising stop, SessionStart, PostToolBatch/PostToolUse and Stop through both hook plugins; none ensures until an edit or `squeal start`. The present `test/cli/stop-mark.test.ts:119` case seeds a worktree row and therefore misses this seam.

### B2. Proven: recovery from a failed stop-time print clears the stop without an edit

**Locations:** `src/core/delivery/stopped.ts:93`–`:96`; nullable baseline written by `src/cli/stopped-mark.ts:25`–`:30`.

**Contract:** C9 says the mark holds until the next edit or explicit start and “a Git failure honours the stop.” A different tree print is evidence of an edit only when there is a prior print to compare.

**Failure:** Git temporarily fails, is missing from the stop command's PATH, or exceeds the stop-time 10 s print budget. `stopTree` returns null; stop still exits 0 and writes `{at, tree:null}`. At the next hook Git works again. Its non-null print is unequal to null, so `stopHolds` deletes the mark and calls `ensureDaemon` with no edit or explicit start. This is independent of B1: the probe creates a real worktree row first.

**Evidence:** the `missing-print` probe below hides Git only during `stopCommand`, restores PATH before the hook, and makes no worktree edits. Output: `stopExit:0`, `rowPresent:true`, `tree:null`, `ensures:1`, `markAfter:"cleared"`.

**One-worker fix:** distinguish an absent baseline from a demonstrated tree change. A successful Git read alone must not clear a null-baseline mark. Keep the stop honoured; if the fallback establishes a first usable baseline, preserve the stop on that boundary and require a later change, or retain the unknown mark until an explicit start. Add regressions for stop-time failure followed by successful reads without an edit, repeated boundary-time failure/timeout, and explicit start clearing the mark. Keep the existing valid-baseline edit and edit-during-shutdown behavior.

## Should-fix

### S1. Plausible: the per-boundary scan can consume the Stop budget on a large dirty tree

**Locations:** `src/core/delivery/stopped.ts:105`–`:119`; `src/harness/shared/stop.ts:112`–`:120`.

A clean temporary Git repository printed in 11/6/6 ms. With 100 directories of 1,000 one-byte untracked files each, three prints took **449/400/449 ms**, all successful, with `timeoutMs:1000`. Each held-stop boundary repeats `git status --untracked-files=all`, then synchronously stats and hashes every listed path. The 1 s timer bounds the Git children, not that stat loop. Stop then retains its independent wait of up to 1,500 ms; this new cost was not deducted from its 2 s hook budget. A timeout at a loaded/large tree can also repeatedly honour an old mark despite edits, as the approved fail-closed rule requires.

This is a measured cost and a plausible budget risk, not a proven budget violation on this candidate. The sample stayed below the budget with default policy; no blocker is inferred from extrapolation. A worker-sized follow-up should give the whole comparison a deadline (including stat work), charge elapsed time against Stop's remaining wait, and test a large dirty/untracked fixture with nonzero `stop.waitMs`. Preserve the agreed rule that an unavailable comparison honours the stop; do not substitute a cached print that can miss an edit.

## Nits

### N1. Proven: the board still promises a no-store sidecar mark

**Location:** `docs/board.md:726` (011-08 scope; the same wording remains on `origin/main`). The row says “in the store's `meta`, or beside the daemon record when there is no store,” whereas amended C9 and `status.md` expressly say no store means no mark. The candidate implements the amended decision correctly. The coordinator should align the board's scope with C9; no product fix or sidecar is requested. The row's older running status in this pinned snapshot is already updated to review on `origin/main` and is not a separate finding.

## What fits

- The coordinator fix prints once before asking the daemon to stop. Both `response === null` and the socket-gone path pass that same value to the writer; neither reprints after shutdown. An edit during shutdown therefore differs from a valid baseline. The no-daemon path uses the same capture, subject to B1/B2.
- The lock-gap e2e still freezes the daemon after socket unlink with its lock held, checks that stop has not returned while frozen, resumes it, requires stop success, requires a different serving daemon and verifies its next validation. The added edit is before the registering hook and after the stop's print, so it authorizes the successor without removing the 001-340/001-367 lock assertions.
- The bad-config lifecycle scenario still proves one policy note, default validation, deliveries, no duplicate note across additional sessions, and no duplicate after a real restart. It now asserts the stopped registration and restarts explicitly through `squeal start`, matching C9. Separate dead-daemon cases retain the SessionStart replacement proof.
- All harnesses use the changed shared `ensure`/`ensureIfStale`; Pi and OpenCode registrations also use `ensureToRegister`. A valid held mark blocks registrations as well as tool/Stop boundaries. An edit clears that worktree's mark, and a later daemon heartbeat voids it. Worktree-scoped meta registration includes `daemonStopped`, so removal cleans it by exact key.
- The print covers HEAD, NUL-delimited status and each listed path's size, mtime and inode. Moving to a different commit makes it differ; changing only a branch name at the same commit does not change the agreed print. Gitignored edits stay excluded. Ignoring submodule content is consistent with C1's separate-worktree boundary.
- A stop refused or still serving beyond its socket bound returns before writing a new mark. Once the socket is gone, the mark is written even if lock/leftover checks later fail, as C9 specifies; that mark still ends on a known edit/start/heartbeat. No mark or store is created where there is no store. Store-write errors say that hooks may restart.
- `runGit` uses a timer only when requested, sends the Git process its termination signal and destroys stdout/stderr at expiry. Its promise rejects without waiting for an inherited-pipe child. An isolated caller running `runGit(root, ["-c", "alias.nap=!sleep 5", "nap"], {timeoutMs:100})` rejected in 104 ms and exited in 0.28 s (exit 0 under an outer `timeout 2s`); the 5 s inherited pipe did not keep the caller alive.
- `git ls-remote --tags --refs origin 'squeal--v*'` listed 12 release tags, all present locally. All local `squeal--v*` tags were inspected with `git show <tag>:src/core/keys/key-format.ts`: versions present are 1–10, or tags before that file existed; **no tag contains 11**. The newest release tag, `squeal--v0.1.199`, has 10. Re-pinning unreleased 11 therefore does not overwrite a released key format. The key-format guard also passed in the independent full run.

## Inputs for the fix wave

Repair B1 and B2 in the stopped-mark seam; they can be one bounded worker because they share `stopped.ts` and its tests. Do not change cancellation, socket/lock/leftover bounds, session-root ownership or the policy contract. Capture the tree before sending stop; persist only once no daemon serves, including the no-daemon path; the hook must check the mark before step-down or ensure. A registration alone is neither an edit nor start. Keep the 1 s Git bound, Git-error stop preservation, per-worktree isolation, heartbeat invalidation and explicit start. Rebuild all shipped bundles with the candidate's patch version before the fix candidate's independent gate. Re-review B1/B2 and the actual delta; S1 remains nonblocking.

## Reproduction command for B1 and B2

From this candidate's repository root, save the following as `/tmp/review-209-evidence.mjs`, then run:

```sh
node --disable-warning=ExperimentalWarning --import tsx /tmp/review-209-evidence.mjs
```

```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = p => import(pathToFileURL(join(process.cwd(), p)).href);
const { stopCommand } = await load('src/cli/stop.ts');
const { openStore, isStoreOpenFailure } = await load('src/core/store/index.ts');
const { worktreeIdFor } = await load('src/core/fs/index.ts');
const { stoppedMetaKey } = await load('src/core/delivery/stopped.ts');
const { runHook } = await load('src/harness/claude-code/index.ts');
const input = JSON.parse(readFileSync('test/harness/recorded/session-start.json','utf8'));
for (const scenario of ['missing-row', 'missing-print']) {
 const dir=mkdtempSync('/tmp/review-209-evidence-');
 const main=join(dir,'main'); mkdirSync(main);
 const git=(...args)=>execFileSync('git',args,{cwd:main,stdio:'pipe'});
 let store;
 try {
  git('init','-q'); writeFileSync(join(main,'a.txt'),'a\n');git('add','.');
  git('-c','user.name=t','-c','user.email=t@t','commit','-qm','base');
  const root=join(dir,'other');git('worktree','add','-qb','other',root);
  const commonDir=join(main,'.git');store=openStore(commonDir);
  if(isStoreOpenFailure(store)) throw Error('no store');
  const worktreeId=worktreeIdFor(root);
  store.worktrees.upsert({id:worktreeIdFor(main),root:main,commonDir,isMain:true,registeredAt:1,daemon:null});
  if(scenario==='missing-print') store.worktrees.upsert({id:worktreeId,root,commonDir,isMain:false,registeredAt:1,daemon:null});
  const originalPath=process.env.PATH;
  let code;
  try {
   if(scenario==='missing-print') process.env.PATH='/nonexistent';
   code=await stopCommand([root],{cwd:main,stdout:()=>{},stderr:()=>{}});
  } finally { process.env.PATH=originalPath; }
  const before=JSON.parse(store.meta.get(stoppedMetaKey(worktreeId)));
  const calls=[];
  await runHook('session-start',JSON.stringify({...input,cwd:root,session_id:'review-stop'}),{
   env:{},ensureDaemon:async r=>{calls.push(r);return 'unavailable';}
  });
  console.log(JSON.stringify({scenario,stopExit:code,rowPresent:store.worktrees.get(worktreeId)!==null,tree:before.tree===null?null:'hash',ensures:calls.length,markAfter:store.meta.get(stoppedMetaKey(worktreeId))===null?'cleared':'kept'}));
 } finally { store?.close();rmSync(dir,{recursive:true,force:true}); }
}
```

Output on the clean pinned candidate:

```json
{"scenario":"missing-row","stopExit":0,"rowPresent":false,"tree":"hash","ensures":1,"markAfter":"kept"}
{"scenario":"missing-print","stopExit":0,"rowPresent":true,"tree":null,"ensures":1,"markAfter":"cleared"}
```


## Re-review: candidate a7c701c8

PASS `a7c701c86a5f9fca5aeccc66fcd33de329fc2546`: **B1 and B2 closed; 0 blocking findings; 2 new nonblocking notes**. N1 is closed. S1 remains accepted by the coordinator in 011 `status.md`.

### Independent verification

Bounded by the initial findings above: the B1/B2 repairs, the changed 001-433 scratch test, and `git diff 4de38389 a7c701c8 -- src test plugins`. `origin/main` is `d732e230deb2af576a6c3edd126ad37f52fc317f`. The main move from the earlier review base changed no `src`, `test` or `plugins` files. The product delta contains only `src/core/delivery/{stopped,liveness}.ts`, `src/core/status/snapshot.ts`, `src/harness/shared/ensure.ts`, `test/harness/stopped.test.ts`, `test/daemon/scratch.test.ts`, and corresponding stopped-mark changes in the four plugins' committed bundles. No package, version or key-format source changed.

The resumed worktree initially pointed at the old review commit `32ae94e8`. I preserved that branch and switched a clean checkout to the requested candidate before recording any new verification. An install begun at the old commit is excluded; `npm ci` was repeated at the candidate. The candidate does not yet contain this review file, so its initial review above is restored byte for byte from `32ae94e8`, followed by this appended re-review. All checks and probes below ran at the exact candidate with a clean tree, before restoring/appending the review. No build was run, as requested.

```text
$ git rev-parse HEAD
a7c701c86a5f9fca5aeccc66fcd33de329fc2546
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

$ npm run lint

> squeal@0.1.209 lint
> biome check .

Checked 1389 files in 475ms. No fixes applied.

$ npm run typecheck

> squeal@0.1.209 typecheck
> tsc --noEmit


$ npm run check:version -- origin/main

> squeal@0.1.209 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.208 -> 0.1.209, ok

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a/test/fixtures/scheduler/.tmp/c79bccd0-6688-4ef4-b5ee-444166557390/main/.git/worktrees/staged/gitdir
 ❯ test/daemon/low-priority.test.ts (4 tests | 1 failed) 5656ms
   ❯ lowerWhile: forks at nice 10 (001-393) (4)
     × lowers a fork shorter than 1 s, and its child 976ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a/test/fixtures/scheduler/.tmp/0c4ddf4e-b75f-4767-b43c-e44fe578850f/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 171833
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/low-priority.test.ts > lowerWhile: forks at nice 10 (001-393) > lowers a fork shorter than 1 s, and its child
AssertionError: expected { own: 10, child: +0 } to deeply equal { own: 10, child: 10 }

- Expected
+ Received

  {
-   "child": 10,
+   "child": 0,
    "own": 10,
  }

 ❯ test/daemon/low-priority.test.ts:97:37
     95| describe.runIf(process.platform === "linux")("lowerWhile: forks at nic…
     96|   it("lowers a fork shorter than 1 s, and its child", async () => {
     97|     expect(await shortFork("fast")).toEqual({ own: TEST_NICE, child: T…
       |                                     ^
     98|   });
     99|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 690 passed | 1 skipped (692)
      Tests  1 failed | 5877 passed | 8 skipped (5886)
   Start at  13:48:53
   Duration  733.25s (tests 98%, import 2%)

    Isolate  692 workers spawned · ~110ms startup each (spawn + environment, per file)
             at least ~18.95s faster with isolate: false — reuses workers across files instead of one per file
(exit 1)
```

The independent full suite **did not pass**: 690 files / 5,877 tests passed, 1 file / 1 test failed, and 1 file / 8 tests skipped, exit 1. The failure is `test/daemon/low-priority.test.ts:97`: the short fork had nice 10 but its child reported nice 0, expected 10. That test and `src/core/daemon/{low-priority,escaped}.ts` are byte-identical to the prior candidate; none belongs to this repair delta. The cause of this occurrence is unverified, so it is recorded as failed verification rather than attributed to this wave. The focused rerun below passed; it does not erase or replace the full-run failure. All stopped-mark regressions and the revised scratch test passed in the full run. No second full proof was run.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/daemon/low-priority.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/fa259a0a-7e6e-4567-91f3-72700e06b11a


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:01:11
   Duration  5.80s (tests 99%, transform 1%)
(exit 0)
```

The clean candidate and SHA were checked again after these runs. The background Squeal baseline's unchanged recorder-fidelity failures remain separate from the independent gate; neither is made a wave finding.

### Previously blocking findings

- **B1, proven repaired.** `heldStop` now reads by the supplied worktree id even when the row is null; `stopHolds` uses the hook's known id and root. Both live-header paths and the status snapshot pass their worktree id to `asStopped`, so the stop is also described without a row. All changed callers pass the new arguments in the implemented order. The coordinator's pre-rebase `376a0776` is `2b8348eb` here. The new regression leaves the linked worktree row absent and checks that registration and its following tool boundary ensure nothing and name the stop.
- **B2, proven repaired.** When the stop's print is null, the first successful boundary print is stored with the original `at` and returns `true`; Git recovery does not clear the mark. The next unchanged comparison holds, while a subsequent edit clears it. The coordinator's pre-rebase `227c3071` is `efda8dde` here. This is the fallback C9 now states; edits before the first successful print are not distinguishable and can be missed, as the implementation comment says. The new regression covers adoption, an unchanged repeat, and a later edit.

I extracted and re-ran the original reproduction command above without changing it. Its output on this candidate:

```json
{"scenario":"missing-row","stopExit":0,"rowPresent":false,"tree":"hash","ensures":0,"markAfter":"kept"}
{"scenario":"missing-print","stopExit":0,"rowPresent":true,"tree":null,"ensures":0,"markAfter":"kept"}
```

An extended version asserts that each first header contains “stopped by request”, the adopted baseline keeps the original stop timestamp, a second unchanged registration still ensures nothing, and writing `a.txt` after that print clears the mark and ensures exactly once. Output:

```json
{"scenario":"missing-row","initialEnsures":0,"repeatEnsures":0,"afterEditEnsures":1,"headerSaysStopped":true,"baselineRetainsStopTime":true,"markAfterEdit":"cleared"}
{"scenario":"missing-print","initialEnsures":0,"repeatEnsures":0,"afterEditEnsures":1,"headerSaysStopped":true,"baselineRetainsStopTime":true,"markAfterEdit":"cleared"}
```

**N1, proven repaired:** the board's 011-08 scope now says “in the store's `meta`; no store, no mark”. The status amendment records both repairs and acceptance of S1's repeated-print cost. The accepted cost is not re-prosecuted here.

### 001-433: what the revised scratch test proves

`test/daemon/scratch.test.ts:131` still requires a first ping with 2,000 leftover files, now requires its phase to be `starting`, and applies an unconditional 2 s bound from the daemon's own `startedAt` to that answer. It still waits for ready, requires the fresh temp directory to be empty, waits for renamed leftovers to disappear, and verifies both CLI and daemon stop and scratch removal. The new span deliberately excludes Node startup, module loading before construction, lock/store opening and the initial rename; it is an internal serving-span assertion, not a whole-spawn latency assertion.

The relevant startup source did not change. `startDaemon` opens the lock/store/scratch first, constructs `Daemon`, then `Daemon.start` awaits `#openDesk` before calling `#run`. Heavy runner imports are inside `#run`. The implementation therefore retains socket-before-runner startup order. The unchanged `prepareScratch` test separately requires files still to exist in the renamed directory immediately after the function returns, proving removal is deferred.

**R1, proven coverage limitation, nonblocking.** The added `phase === "starting"` assertion at `test/daemon/scratch.test.ts:134` does not by itself prove that ping precedes runner loading: `src/core/daemon/daemon.ts:405` imports the runner while the phase is still starting, and phase becomes ready only after `loop.start` at `:544`. A ping after those imports but before baseline startup finishes also satisfies the assertion. This is not evidence of a product order violation, and the product order is unchanged and correct on source inspection. A bounded test follow-up should assert the sequence of socket binding/answer and runner-load entry with an explicit witness, retaining the internal timing and scratch-cleanup assertions; it should fail when the two steps are reversed. The revised test is useful startup-state evidence but should not be described as a standalone proof of literal import order.

### R2: null-baseline adoption can restore a concurrently cleared mark

**Proven interleaving; nonblocking note under this bounded re-review.** `src/core/delivery/stopped.ts:104` writes the originally read null-baseline mark after awaiting Git at `:101`, without checking whether it remains current. If `squeal start` clears that mark while the print is in flight, adoption restores it with its old timestamp. A successful daemon heartbeat subsequently voids it; if start cannot bring up a daemon, later hooks again honour the restored stop despite the explicit start. An overlapping newer stop can likewise have its mark replaced by the old adoption. This is separate from the original B2 reproduction, which is closed.

A real-store command probe on this clean candidate creates an empty Git repository, calls `markStopped(store, id, 1000, null)`, starts `const pending = stopHolds(store, {id, root}, null, {state:"down"})`, calls the production `clearStoppedMark(root)` synchronously before awaiting `pending`, and reads the mark before and after. Output:

```json
{"clearResult":null,"cleared":true,"boundaryHeld":true,"restored":true}
```

The throwaway probe uses the same production clear helper as `startCommand` (`src/cli/start.ts:24`), not a mocked store; it proves the mark resurrection, not a full failed-start CLI scenario. A one-worker follow-up should atomically compare the current mark with the originally read mark before adopting, preserving a concurrent clear or replacement; add a regression for clear/replacement during the asynchronous print. Re-evaluate the current decision rather than returning a stale held result when a clear won.

### Next-wave inputs

No blocking repair remains. Keep C9's adopted-baseline fallback and id/root-based mark lookup. S1 stays an accepted nonblocking limitation; R1 is a test follow-up only; R2 is a bounded mark-adoption concurrency follow-up. This re-review does not reopen the prior runGit, key-format, lifecycle or stop-gap conclusions, whose source/tests did not change in this delta.
