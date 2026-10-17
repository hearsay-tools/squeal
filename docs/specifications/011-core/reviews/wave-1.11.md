# Wave 1.11: 011-11 and 011-12, candidate 0.1.210

FAIL `c64c4eb3dce8937785c7c0f35975559619a05e39`: **3 proven blockers, 1 proven nonblocking should-fix, 0 nits**.

## Verification

Independent review on the exact pinned candidate, on a clean tree throughout checks and probes. Product range: `4db9e06f..c64c4eb3`. Local `origin/main` is `e379086c84f52c09c3d75b8faec2b38d75a64182`; its only change from the supplied base `4db9e06f` is `docs/board.md`. The requested version check used that actual `origin/main`. No build was run, as explicitly requested. No product files changed. The review file was written only after verification.

```text
$ git rev-parse HEAD
c64c4eb3dce8937785c7c0f35975559619a05e39
$ git status --short
(no output)

$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 6s

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

> squeal@0.1.210 lint
> biome check .

Checked 1402 files in 455ms. No fixes applied.
(exit 0)

$ npm run typecheck

> squeal@0.1.210 typecheck
> tsc --noEmit
(exit 0)

$ npm run check:version -- origin/main

> squeal@0.1.210 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.209 -> 0.1.210, ok
(exit 0)
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/53120793-9011-4196-802e-635db6fa5a72/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/0844f8b0-5869-4216-ba68-b217fad8eebb/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 752256
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  698 passed | 1 skipped (699)
      Tests  5953 passed | 9 skipped (5962)
   Start at  14:17:46
   Duration  784.53s (tests 98%, import 2%)

    Isolate  699 workers spawned · ~119ms startup each (spawn + environment, per file)
             at least ~20.72s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
```

All requested independent checks passed: 698 files and 5,953 tests passed; 1 file and 9 tests skipped; Vitest exit 0. These checks do not rule out the command-proven status errors below. HEAD and the clean tree were confirmed again after the run.

The background Squeal baseline separately reported `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Neither test nor its runner source changes in this range. Wave-1.10 recorded the same background failures with a passing independent run. Those notifications are not this review's independent gate and are not findings against this wave. The independent result above is authoritative for this check.

## Blockers

### B1. Proven: a claim's advertised deadline starts at the wrong event

**Location:** `src/cli/named-files.ts:123` and `:124`; actual contract at `src/core/scheduler/claims.ts:47`.

**Contract:** C15 requires “waiting for `<worktree>`'s run of its key, at most until that claim's bound,” from the store's facts. C7 defines that bound as “when the waiter has seen it for its own `runner.timeoutMs` plus 6 s (600 s with no timeout).” The duration correctly calls `claimBoundMs`; adding it to the claimant's run start is incorrect.

**Failure:** with `runner.timeoutMs: null`, another worktree may have run for more than ten minutes before this worktree first sees its claim. Status prints an `at most until` time already past, although the scheduler has just begun its own ten-minute claim wait. With finite timeouts and different worktree policies the same mismatch can advertise an earlier deadline. The waiter first-seen timestamp is in `Claims.#seen`, not the run record.

**Command evidence:** reproduction A below seeds a real store, calls the production `Claims.holds`, and reads the production per-file reason. Claim run start `12:09:59Z`, waiter first sees it `12:20:00Z`, reported deadline `12:19:59Z`, actual waiter's earliest expiry `12:30:00Z`; `Claims.holds` still returns true after the reported deadline. The run is allowed to remain open because its configured timeout is null. This is a status honesty failure, not a request to alter scheduling.

**One-worker fix:** preserve C7's first-seen semantics and `claimBoundMs`. Publish/read the waiter's actual claim expiry if an absolute deadline is needed; otherwise express the known duration with its correct origin and omit an absolute time the store cannot establish. Never derive the waiter's deadline from the other worktree's run start. Add a regression where an unlimited claimant predates the waiter by more than 600 s and one with differing finite timeout policies. Correct the existing `test/cli/status-wait-reasons.test.ts:131` assertion, which currently pins the wrong origin.

### B2. Proven: the named claimant can be a dead worktree

**Location:** `src/core/status/open-runs.ts:56` through the return at `:62`; consumed by `src/cli/named-files.ts:121` and `src/core/status/unknown-files.ts:103`.

**Contract:** C7's claim requires a daemon heartbeat within two intervals; C15's per-file reason must name the worktree actually holding it. Vision principle 2: status cannot present an old state as current.

**Failure:** a killed daemon leaves a `running` key row with a stale heartbeat. A different live daemon subsequently claims the same key. `claimed` correctly returns true for the live daemon, but `claimantOf` then scans all worktrees and returns the first matching `running` row with any non-null daemon record, without applying liveness to that row. If the dead worktree sorts first, status says the file is waiting for that dead worktree. The unknown-file explanation uses the same helper and can name that dead daemon as running too.

**Command evidence:** reproduction A adds a stale `aaa-dead` worktree before the live `claimant`. Its heartbeat is 60,000 ms old with a 5,000 ms interval. The claim gate is true because the live claimant remains fresh; the returned claimant is `aaa-dead`, and `readNamedFiles` prints its root. A stale claim on disk after a killed daemon is sufficient; no duplicate live run is assumed.

**One-worker fix:** return the claimant identity from the same live-claim predicate/query used by `TestFileKeyRepo.claimed`, or otherwise apply exactly that shared liveness rule to each candidate before choosing it. Do not let an unrelated live claim validate a stale row. Add a real-store regression with an earlier-sorting stale claimant and a later live one, checking both named and unknown-file text, and another with only the stale row returning no claimant.

### B3. Proven: the unlisted countdown invents a total revision deadline

**Location:** `src/cli/named-files.ts:149` and `:150`; text in `src/cli/named-file-lines.ts:68`.

**Contract:** C15 requires an unlisted-revision explanation with the runner part's bound when known. C4 states that each runner call is bounded on its own and “no total is imposed across calls that answer.” The shared `runnerPartBoundMs` computes the correct per-call duration, but revision creation is not the start of every call.

**Failure:** `invalidate` answers after 650 s, within its default 666 s bound. The following `affected` call gets its own fresh 666 s. At revision age 667 s, that call has run only 17 s. Status subtracts the whole revision's age from one per-call duration and says `at most 0 s more`. The revision can legitimately remain unlisted for another 649 s in that call alone. A later queued revision also has its own calls still to begin. The fixed claim in the wording that a run in flight holds the runner is not established either; the reproduced slow runner has no run in flight.

**Command evidence:** reproduction B calls the production `fetchRunnerPart` and `readNamedFiles` with Node's mock clock, not a reimplementation of their bound. Output: revision age 667,000 ms; active call age 17,000 ms; active call bound 666,000 ms; `finished:false`; reason ends `at most 0 s more`. The first call answers before its timeout, so the second call is valid and receives a fresh bound.

**One-worker fix:** report the bound at its actual scope. An exact remaining countdown needs the active call's start and cannot be subtracted from revision creation; do not promise the whole revision settles within one call's bound. Where the store lacks that timing, describe the known per-call bound without an invented total countdown, and say a run holds it only when that is known. Add the two-call regression above, not just a single revision-age arithmetic fixture. Keep using `runnerPartBoundMs`, not copied constants.

## Should-fix

### S1. Proven, nonblocking: the verdict reason list has no overall bound

**Location:** `src/cli/named-file-lines.ts:90` and `:102`; appended by `src/cli/status-wait-lines.ts:162`.

Grouping by claimant root still permits one group per selected file. Reproduction A runs the real `reasonGroups` with 10, 100 and 1,000 distinct claimant roots: **688, 6,988 and 70,888 characters**. Lane groups are few, but claimant roots are not capped. Thus the brief's bounded-verdict check is not satisfied. This is not made blocking: C15 and the row's done-when do not state an overall character/group cap for this CLI line; the C5 delivery cap is not a status-output cap.

A worker-sized follow-up should cap the number of reason groups or their rendered length and summarize the remainder by count. Keep the worktree verdict/count suffix, bounded class previews, full selected failure details and complete per-file JSON. Add a many-claimant formatter test.

## Nits

None. The three `references/commands.md` copies are byte-identical (SHA-256 `6530bfce21409fecd39cbdc3c7c86fbf82fe66b3154944d47f06f7bf70c3e0a6`). Their class-label examples elide the printed `(N)` counts but correctly describe output order and semantics; that is not a product defect.

## What fits

- **Promotion's scope and lifetime:** `Promotions` is daemon memory only, holds through queued claims and running files, expires on the daemon clock, and drops once no selected file is queued or running, before a later queue addition can reuse it. `clear` drops it on install. Ranking affects queued files only; no cancellation/split path was added. `hasRecent` and `isRecent` retain their edit-only roles, so promotion neither cancels a backlog tier nor exempts a claimed key.
- **Selection and request seam:** `ownPathFiles` promotes only selected test files whose own paths were named. The CLI sends once at the first decided, still-open read, with the remaining duration; settled/unmatched/expired reads do not promote. The front desk carries `(testFiles, withinMs)` in that order on both thread paths; handlers tolerate unsupported requests, and an old daemon's unknown reply is ignored. `Scheduler.promote` adds the duration to its daemon clock under its lock and pumps. Tests cover the socket, optional handler, both front desks, sync timing and mixed source/test paths.
- **Tier rules:** `selectTier` checks free lanes and claims, keeps comparable-duration joining, counts promoted tiers toward four first-group tiers before the backlog turn, and does not bypass unlisted runner work. The scheduler probe shape A running, B/Z queued produces A/Z/B; without promotion A/B/Z; the cross-worktree claimed file runs once. Queue tests exercise fairness, expiry, re-queue while another selected file remains open, slow order, and clear. **A queued promoted fast file defers the slow tier as edit-caused work does**, through `#editPending` using `hasFirstGroup`; promoting a slow file does not grant slow-tier eligibility.
- **Status activity and lanes:** status uses the live daemon's `runs.inFlight` to count pending checks and fresh files as running after a re-key. Old-daemon and ended runs do not count. A named file's new key remains queued behind its old tier, which is the right wait reason even though the snapshot counts the old run's activity. `runsOpen` prevents a false idle line. `laneOf` and named reasons share `laneFor`; policy ownership supplies the runner lane. No second copy of claim-duration arithmetic was added.
- **Per-file output:** `fileClassOf` is shared by verdict counts and entries. JSON adds `state`, optional `verdict` and `reason` to existing project/path entries, and adds optional `runsOpen` to snapshots. Current/stale results keep their pass/fail/skip verdicts; no clean settled verdict prints class previews. Without a verdict, classes print before the final verdict; each class previews ten then counts the remainder, while JSON retains all selected files. The eleven-file text/JSON fixture covers failures and four classes. Unknown reasons retain keyed records, check summaries, setup failure, unkeyed and lookup-only facts; B2 limits claimant-derived reasons. Discovery/Idle conditions and their advancement commands match the store facts; an open live run suppresses idle.
- **Eval follow-up:** `test/evals/evidence-squeal.test.ts` now sends real `waitText`/`namedText` output, including the new timeout/class form, through every existing hook-JSON wrapping and snapshot variant. Selected file/failure credit is also wrapped. This closes wave-1.9's parser-matrix coverage note; no parser logic changed.
- **Key format and versions:** `KEY_FORMAT_VERSION` stays 11; only its guarded-source hash changes to `9e7d4046a39159604049567d6a03b21447d57fe6a5edf605df33149edc43356c`. The version check accepts 0.1.209 -> 0.1.210. `git ls-remote --tags --refs origin 'squeal--v*'` lists the same twelve release tags present locally. Inspecting every tag's key-format source finds versions 1 through 10 or no such file; **no release tag carries 11**. The newest tag, 0.1.199, carries 10. This in-place re-pin therefore replaces no released key format.
- **Wave-1.10 R2:** the asynchronous null-baseline adoption now re-reads and compares the mark inside one store transaction before writing or deleting. The new test clears through the production `clearStoppedMark` while Git is awaited and asserts false/null. An independent real-Git/store command also checked replacement during the print: clear returns `held:false, mark:null`; replacement returns `held:true` and preserves `{at:2000,tree:"new-stop-print"}`. The original mark-resurrection finding is closed. This does not reopen wave-1.10's accepted repeated-print cost or its unrelated scratch-test coverage note.

## Inputs for the fix wave

The three blockers share one bounded status-reason seam and may be one worker: `named-files.ts`, `open-runs.ts`, the shared claim lookup if needed, and discriminating status/CLI tests. Preserve scheduling, C7's waiter-relative expiry, promotion request/lifetime/fairness, slow-tier eligibility, and queued/running key semantics. Read facts in the existing status read transaction. Share `laneFor`, `claimBoundMs` and `runnerPartBoundMs`; do not copy their rules. Older daemons/stores must retain an honest duration or omit unknown absolute times. An optional published timestamp must be additive and scoped to the actual daemon/waiter/call that owns it. Resolve B1/B3's representation together so neither path invents a total deadline. S1 can accompany that row as a formatter-only follow-up if the coordinator includes it.

After the repair, re-pin the still-unreleased key format if guarded sources changed and rebuild all committed bundles at the candidate's reserved version. Re-review these three findings and the repair delta, with one independent locked suite. No promotion code repair, cancellation/split feature, or 011-13 publication of the word `promoted` is requested.

## Reproduction commands

All probes ran at the clean pinned candidate. They create and remove scratch stores outside the worktree; no throwaway file was added to the candidate. Run each from the repository root with the command shown. Node's mock clock in B avoids a real eleven-minute wait.

### A. Claim bound, claimant identity, verdict growth

Save as `/tmp/review-011-claim.mjs`:

```js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const load = p => import(pathToFileURL(join(process.cwd(), p)).href);
const { openStore } = await load('src/core/store/index.ts');
const { readPolicy } = await load('src/core/daemon/policy.ts');
const { Claims, claimBoundMs } = await load('src/core/scheduler/claims.ts');
const { readNamedFiles } = await load('src/cli/named-files.ts');
const { claimantOf } = await load('src/core/status/open-runs.ts');
const { reasonText, reasonGroups } = await load('src/cli/named-file-lines.ts');
const root = mkdtempSync('/tmp/review-011-claim-');
const commonDir = join(root, '.git'); mkdirSync(commonDir);
const store = openStore(commonDir);
try {
 let now = Date.UTC(2026,9,17,12,20,0);
 writeFileSync(join(root,'squeal.config.json'), JSON.stringify({runner:{timeoutMs:null}}));
 const policy = readPolicy(root);
 const bound = claimBoundMs(policy.runner.timeoutMs);
 const startedAt = now - bound - 1000;
 const ref = {project:'',path:'test/a.test.ts'};
 for (const id of ['waiter','claimant']) {
  store.worktrees.upsert({id,root: id === 'waiter' ? root : root+'/other',commonDir,isMain:id==='waiter',registeredAt:1,
   daemon:{socketPath:'/tmp/'+id+'.sock',startedAt:startedAt-1000,heartbeatAt:now,heartbeatIntervalMs:5000,squealVersion:'0.1.210'}});
  store.testFileKeys.upsertMany([{worktreeId:id,testFile:ref,key:'same-key',revision:1,pending:id==='waiter'?'queued':'running'}]);
 }
 store.runs.start({id:'claim-run',worktreeId:'claimant',revision:1,testFiles:[ref],checkpointId:null,logDir:'/tmp/claim-run',startedAt});
 const claims = new Claims({store,worktreeId:'waiter',now:()=>now,policy});
 const holdsAtFirstRead = claims.holds('same-key');
 const entry = readNamedFiles(store,'waiter',root,[ref],{state:'alive'},now)[0];
 assert.equal(entry.pending.kind,'claim');
 const advertisedUntil = entry.pending.until;
 now += 1000;
 const holdsAfterAdvertisedBound = claims.holds('same-key');
 assert(holdsAtFirstRead && holdsAfterAdvertisedBound && advertisedUntil < now);
 console.log(JSON.stringify({scenario:'claim-bound',claimRunStarted:new Date(startedAt).toISOString(),firstSeen:new Date(now-1000).toISOString(),reason:reasonText(entry.pending,'squeal'),advertisedUntil:new Date(advertisedUntil).toISOString(),actualWaiterEarliestExpiry:new Date(now-1000+bound).toISOString(),holdsAfterAdvertisedBound}));
 const dead = {id:'aaa-dead',root:root+'/dead',commonDir,isMain:false,registeredAt:1,daemon:{socketPath:'/tmp/dead.sock',startedAt:startedAt-1000,heartbeatAt:now-60000,heartbeatIntervalMs:5000,squealVersion:'0.1.210'}};
 store.worktrees.upsert(dead);
 store.testFileKeys.upsertMany([{worktreeId:dead.id,testFile:ref,key:'same-key',revision:1,pending:'running'}]);
 const chosen = claimantOf(store,'waiter',ref,'same-key',now);
 assert.equal(chosen.worktree.id,dead.id);
 console.log(JSON.stringify({scenario:'claimant-identity',claimed:store.testFileKeys.claimed('waiter','same-key',{now,graceIntervals:2}),chosen:chosen.worktree.id,chosenHeartbeatAgeMs:now-chosen.worktree.daemon.heartbeatAt,liveClaimant:'claimant',namedReason:reasonText(readNamedFiles(store,'waiter',root,[ref],{state:'alive'},now)[0].pending,'squeal')}));
 const files = n => Array.from({length:n},(_,i)=>({testFile:{project:'',path:'test/'+i+'.ts'},state:'pending',pending:{kind:'claim',worktree:'/worktrees/'+i,until:now+bound}}));
 const lengths = [10,100,1000].map(n=>({files:n,verdictReasonChars:reasonGroups(files(n),'squeal').length}));
 console.log(JSON.stringify({scenario:'verdict-bound',lengths}));
} finally { store.close(); rmSync(root,{recursive:true,force:true}); }
```

```text
$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-claim.mjs
{"scenario":"claim-bound","claimRunStarted":"2026-10-17T12:09:59.000Z","firstSeen":"2026-10-17T12:20:00.000Z","reason":"waiting for /tmp/review-011-claim-TGXUOU/other's run of its key, at most until 14:19:59","advertisedUntil":"2026-10-17T12:19:59.000Z","actualWaiterEarliestExpiry":"2026-10-17T12:30:00.000Z","holdsAfterAdvertisedBound":true}
{"scenario":"claimant-identity","claimed":true,"chosen":"aaa-dead","chosenHeartbeatAgeMs":60000,"liveClaimant":"claimant","namedReason":"waiting for /tmp/review-011-claim-TGXUOU/dead's run of its key"}
{"scenario":"verdict-bound","lengths":[{"files":10,"verdictReasonChars":688},{"files":100,"verdictReasonChars":6988},{"files":1000,"verdictReasonChars":70888}]}
```

Clock text is local (Europe/Warsaw); the timestamp fields are UTC. Scratch-root suffixes vary.

### B. Runner-part bound

Save as `/tmp/review-011-unlisted.mjs`:

```js
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
const load = p => import(pathToFileURL(join(process.cwd(),p)).href);
const { openStore } = await load('src/core/store/index.ts');
const { readPolicy } = await load('src/core/daemon/policy.ts');
const { fetchRunnerPart } = await load('src/core/scheduler/refinement.ts');
const { readNamedFiles } = await load('src/cli/named-files.ts');
const { reasonText } = await load('src/cli/named-file-lines.ts');
const { refinedMetaKey } = await load('src/core/types/index.ts');
const root = mkdtempSync('/tmp/review-011-unlisted-');
mkdirSync(join(root,'.git'));
const store = openStore(join(root,'.git'));
const base = Date.UTC(2026,9,17,12,0,0);
mock.timers.enable({apis:['setTimeout','Date'],now:base});
try {
 const policy = readPolicy(root);
 const ref={project:'',path:'test/a.test.ts'};
 const revision=store.revisions.append({worktreeId:'w',createdAt:Date.now(),head:null,dirty:false,trigger:'watch',changes:[{path:'src/a.ts',oldHash:'a',newHash:'b'}]});
 store.meta.set(refinedMetaKey('w'),'0');
 store.testFileKeys.upsertMany([{worktreeId:'w',testFile:ref,key:'k',revision:1,pending:'queued'}]);
 let finishInvalidate; const invalidate = new Promise(r=>finishInvalidate=r);
 let finishAffected; const affected = new Promise(r=>finishAffected=r);
 let affectedStarted=false;
 const keys={index:{reverse:{referencing:()=>[]}},isDeclaredInput:()=>false};
 const context={policy,keys,runner:{invalidate:()=>invalidate,affected:()=>{affectedStarted=true;return affected;}}};
 const ledger={broken:false,listingFailed:false,files:new Map()};
 let finished=false;
 const work=fetchRunnerPart(context,ledger,revision,{environment:false,rekeyed:[]},[]).then(()=>{finished=true});
 // invalidate is slow but within its own 666 s bound.
 mock.timers.tick(650000); finishInvalidate({recreatedProjects:[]});
 for(let i=0;i<12;i++) await Promise.resolve();
 assert.equal(affectedStarted,true);
 // The next call has its own fresh 666 s bound; the revision is now 667 s old.
 mock.timers.tick(17000);
 const f=readNamedFiles(store,'w',root,[ref],{state:'alive'},Date.now())[0];
 assert.equal(f.pending.kind,'unlisted'); assert.equal(f.pending.leftMs,0); assert.equal(finished,false);
 console.log(JSON.stringify({scenario:'unlisted-bound',revisionAgeMs:Date.now()-base,activeCallAgeMs:17000,activeCallBoundMs:666000,finished,reason:reasonText(f.pending,'squeal')}));
 finishAffected({direct:[],transitive:[]}); await work;
} finally {mock.timers.reset();store.close();rmSync(root,{recursive:true,force:true});}
```

```text
$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-unlisted.mjs
{"scenario":"unlisted-bound","revisionAgeMs":667000,"activeCallAgeMs":17000,"activeCallBoundMs":666000,"finished":false,"reason":"revision 1 not listed yet, because the runner part waits for the run in flight, at most 0 s more"}
```

---

## Re-review: candidate 1a5ae371 (0.1.210)

FAIL `1a5ae371b171de23383daa61bd5301196f35e30d`: **1 proven blocker remains (B1); B2 and B3's countdown are repaired.** S1 remains the previously proven, nonblocking follow-up, now assigned to 011-13. No new blocking finding.

### Verification

This is a bounded re-review of B1–B3 and the repair delta from `c64c4eb3`, including the bundles, against the amended C15 and status log. The candidate was checked out at the exact requested SHA; the tree stayed clean throughout checks and production probes. The original review is restored above only after verification because the rebased candidate does not carry the review commit `6c8d4e52`. No build was run, per the explicit brief. The version check used local `origin/main`; at the completion read that ref was `01f20a26273bc7a6ef20f634f22de4dd1eb69476`, differing from the original review's `e379086c` only in `docs/board.md`.

```text
$ git rev-parse HEAD
1a5ae371b171de23383daa61bd5301196f35e30d
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

> squeal@0.1.210 lint
> biome check .

Checked 1402 files in 517ms. No fixes applied.
(exit 0)

$ npm run typecheck

> squeal@0.1.210 typecheck
> tsc --noEmit

(exit 0)

$ npm run check:version -- origin/main

> squeal@0.1.210 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.209 -> 0.1.210, ok
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/77659af1-2380-4098-bc49-c3222357b8e5/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/735c3890-bb5b-48eb-8e4f-ed2deeb7239b/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 1312539
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  698 passed | 1 skipped (699)
      Tests  5954 passed | 10 skipped (5964)
   Start at  14:47:39
   Duration  794.98s (tests 98%, import 2%)

    Isolate  699 workers spawned · ~119ms startup each (spawn + environment, per file)
             at least ~20.65s faster with isolate: false — reuses workers across files instead of one per file

(exit 0)
```

All required independent checks passed. The locked suite completed in 794.98 s, exit 0: 698 files and 5,954 tests passed; 1 file and 10 tests skipped. The coordinator-reported low-priority test failure did not reproduce in this run. HEAD and the clean tree were confirmed again after all checks and probes. The green suite does not rule out the production-command counterexample below.

### B1 remains proven: the run-start term uses the waiter's timeout to bound a different daemon's run

**Location:** `src/cli/named-files.ts:126`–`:131`; actual wait semantics remain in `src/core/scheduler/claims.ts:47`–`:57`.

The null-timeout waiter case is repaired: the production probe now reports `12:30:00Z` when that waiter first sees the claim at `12:20:00Z`. `now + claimBoundMs(waiterTimeout)` is a conservative bound on its first-seen wait, as the coordinator explains.

The second term still is not an upper bound. `policy` comes from `readPolicy(root)` for the **waiter**. A finite waiter timeout does not establish that the **claimant's** run has that timeout, or any timeout. C15 now permits the run-start term “for a bounded run”; this condition tests the wrong worktree. C7 explicitly defines the waiter's own timeout, not an equality between worktree policies. Vision principle 2 and 011-12's requirement that reasons and bounds come from store facts still apply.

**Concrete command-proven case:** waiter `runner.timeoutMs = 1000`, claimant `runner.timeoutMs = null`, fresh daemon heartbeat, same queued/running key. The claimant's run started at `12:19:30Z`, the waiter first sees it at `12:20:00Z`. Production `readNamedFiles` advertises `at most until 14:19:37` (Europe/Warsaw, `12:19:37Z`), already 23 seconds past. Production `Claims.holds` returns true at `12:20:00Z` and `12:20:01Z`; its 7-second bound runs from the first sighting, to `12:20:07Z`. The claimant is permitted to keep running with its null timeout. The same issue occurs with a sufficiently larger finite claimant timeout.

Different policies can legitimately share a key: `WorktreeKeys.setPolicy` (`src/core/scheduler/keying.ts:282`–`:312`) does not change keys/environments for `runner.timeoutMs`, and the environment encoding excludes that policy field. Existing `test/scheduler/claims-expiry.test.ts` test 10 already exercises a 1-second waiter against a claimant using the default timeout. Each daemon passes its own policy timeout to `runner.run` (`src/core/scheduler/tiers.ts:312`). Thus the seeded real-store state does not depend on an impossible same-key pairing.

**One-worker fix:** retain the conservative `now + claimBoundMs(waiterTimeout)` bound. Only use a claimant run-start term if the actual timeout governing that particular run is known; today's waiter policy or a claimant's newly reloaded policy cannot establish it. Omitting that term needs no store/schema change. Add the finite-waiter/unlimited-claimant regression and a larger-finite-claimant case, keeping a fresh heartbeat and a run old enough that the erroneous deadline is past. Preserve C7 scheduling and the shared bound helper. Correct the amended description with the chosen representation; this finding is against the code's false deadline, not against the spec folder.

### Repairs that fit

- **B2 closed.** `claimantOf` applies the same heartbeat inequality as the store's `LIVE` predicate to each candidate. The real-store probe now chooses the live `claimant` over earlier-sorting stale `aaa-dead`; a heartbeat exactly two intervals old remains eligible, one millisecond older is excluded, and only-dead rows return null. The added test discriminates the old implementation. Unknown-file consumers use this same corrected helper.
- **B3 countdown closed.** `unlistedReason` retains `runnerPartBoundMs`, publishes `callBoundMs`, and the formatter explicitly says “each of its calls bounded at N s”. Re-running the original production `fetchRunnerPart` probe with the corrected assertions gives an unfinished `affected` call at revision age 667 seconds after a 650-second `invalidate`, with its own 666-second bound and no invented zero countdown. The new fixture checks the per-call wording. The phrase “because the runner part waits for the run in flight” remains in both spec and formatter although this probe has no open run; that previously recorded wording limitation is not a new blocker in this bounded re-review.
- **S1 tracked.** Board row 011-13 explicitly carries the total reason-group cap and its many-claimant formatter test. No cap was added in this repair; the original note remains in force.
- **Unchanged conclusions remain settled.** No promotion, fairness, slow-tier, C7 scheduling, R2 stopped-mark, parser-matrix, key-pin or commands-reference source changed in the repair delta. The four CLI bundles carry the revised bound/per-call code and the hook bundles carry the liveness repair. No new parallel-module interface is introduced. Those original accepted checks are not re-prosecuted here.

### Re-run production probes

Both commands ran on the clean pinned candidate, use production modules and a real scratch store outside the worktree, assert their results, and exit 0. Their scratch stores are removed. The claim probe repeats original reproduction A with both null and 1-second waiter timeouts, writes and reads the claimant's null-timeout policy, expects the corrected live claimant, and checks the liveness boundary. The runner-part probe repeats original reproduction B, replacing `leftMs === 0` with `callBoundMs === 666000` and absence of `leftMs`.

```text
$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-rereview-claim.mjs
{"scenario":"claim-bound","waiterTimeout":null,"claimantTimeout":null,"claimRunStarted":"2026-10-17T12:09:59.000Z","firstSeen":"2026-10-17T12:20:00.000Z","reason":"waiting for /tmp/review-011-claim-O6FTd4/other's run of its key, at most until 14:30:00","advertisedUntil":"2026-10-17T12:30:00.000Z","actualWaiterEarliestExpiry":"2026-10-17T12:30:00.000Z","holdsOneSecondAfterFirstRead":true}
{"scenario":"claimant-identity","claimed":true,"chosen":"claimant","chosenHeartbeatAgeMs":1000,"liveClaimant":"claimant","namedReason":"waiting for /tmp/review-011-claim-O6FTd4/other's run of its key, at most until 14:30:01"}
{"scenario":"claimant-live-boundary","inclusive":true,"deadOnly":null}
{"scenario":"claim-bound","waiterTimeout":1000,"claimantTimeout":null,"claimRunStarted":"2026-10-17T12:19:30.000Z","firstSeen":"2026-10-17T12:20:00.000Z","reason":"waiting for /tmp/review-011-claim-JkqlAj/other's run of its key, at most until 14:19:37","advertisedUntil":"2026-10-17T12:19:37.000Z","actualWaiterEarliestExpiry":"2026-10-17T12:20:07.000Z","holdsOneSecondAfterFirstRead":true}
{"scenario":"claimant-identity","claimed":true,"chosen":"claimant","chosenHeartbeatAgeMs":1000,"liveClaimant":"claimant","namedReason":"waiting for /tmp/review-011-claim-JkqlAj/other's run of its key, at most until 14:19:37"}
{"scenario":"claimant-live-boundary","inclusive":true,"deadOnly":null}
(exit 0)

$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-rereview-unlisted.mjs
{"scenario":"unlisted-bound","revisionAgeMs":667000,"activeCallAgeMs":17000,"activeCallBoundMs":666000,"finished":false,"reason":"revision 1 not listed yet, because the runner part waits for the run in flight, each of its calls bounded at 666 s"}
(exit 0)

```

The standalone B1 script below was also run, exit 0:

```text
{"advertisedUntil":"2026-10-17T12:19:37.000Z","stillHeldAt":"2026-10-17T12:20:01.000Z","reason":"waiting for /tmp/claim-bound-rereview-cWLgQT/other's run of its key, at most until 14:19:37"}
```

To reproduce the remaining B1 without relying on the original `/tmp` scripts, save this as `/tmp/claim-bound-rereview.mjs` and run `node --disable-warning=ExperimentalWarning --import tsx /tmp/claim-bound-rereview.mjs` from the candidate root:

```js
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const load = p => import(pathToFileURL(join(process.cwd(), p)).href);
const { openStore } = await load('src/core/store/index.ts');
const { readPolicy } = await load('src/core/daemon/policy.ts');
const { Claims } = await load('src/core/scheduler/claims.ts');
const { readNamedFiles } = await load('src/cli/named-files.ts');
const { reasonText } = await load('src/cli/named-file-lines.ts');
const root = mkdtempSync('/tmp/claim-bound-rereview-');
mkdirSync(join(root, '.git'));
mkdirSync(join(root, 'other'));
const store = openStore(join(root, '.git'));
try {
  writeFileSync(join(root, 'squeal.config.json'), JSON.stringify({runner:{timeoutMs:1000}}));
  writeFileSync(join(root, 'other', 'squeal.config.json'), JSON.stringify({runner:{timeoutMs:null}}));
  assert.equal(readPolicy(join(root, 'other')).runner.timeoutMs, null);
  let now = Date.UTC(2026,9,17,12,20,0);
  const firstSeen = now;
  const startedAt = now - 30000;
  const ref = {project:'', path:'test/a.test.ts'};
  for (const id of ['waiter', 'claimant']) {
    store.worktrees.upsert({id, root:id === 'waiter' ? root : join(root,'other'),
      commonDir:join(root,'.git'), isMain:id === 'waiter', registeredAt:1,
      daemon:{socketPath:'/tmp/'+id+'.sock', startedAt:startedAt-1000,
        heartbeatAt:now, heartbeatIntervalMs:5000, squealVersion:'0.1.210'}});
    store.testFileKeys.upsertMany([{worktreeId:id, testFile:ref, key:'same-key', revision:1,
      pending:id === 'waiter' ? 'queued' : 'running'}]);
  }
  store.runs.start({id:'claim-run', worktreeId:'claimant', revision:1, testFiles:[ref],
    checkpointId:null, logDir:'/tmp/claim-run', startedAt});
  const claims = new Claims({store, worktreeId:'waiter', now:()=>now, policy:readPolicy(root)});
  assert.equal(claims.holds('same-key'), true);
  const entry = readNamedFiles(store,'waiter',root,[ref],{state:'alive'},now)[0];
  assert.equal(entry.pending.kind, 'claim');
  assert.equal(entry.pending.until, firstSeen - 23000);
  now += 1000;
  assert.equal(claims.holds('same-key'), true);
  console.log(JSON.stringify({advertisedUntil:new Date(entry.pending.until).toISOString(),
    stillHeldAt:new Date(now).toISOString(), reason:reasonText(entry.pending,'squeal')}));
} finally { store.close(); rmSync(root,{recursive:true,force:true}); }
```

### Inputs for the next repair

One status-reason worker can finish B1 in `named-files.ts` and its discriminating tests without touching promotion or claim scheduling. Keep B2's exact live-row predicate and B3's per-call wording/helper. Do not reintroduce a countdown from revision age. Use only a bound whose owner and timing are known. Rebuild committed bundles after the fix, retain the candidate's reserved version, and recheck the unreleased key pin if guarded sources move. Re-review only this remaining B1 and the resulting delta. S1 stays in 011-13.

---

## Third round: B1 only, candidate 432f0a7b (0.1.210)

PASS `432f0a7b010ca2f2d397cfcef405a71752453392`: **B1 closed; 0 blocking findings, 0 new notes or nits in this round.** The earlier B2/B3 conclusions remain settled. S1 remains a nonblocking 011-13 follow-up, outside this round.

### Verification

Scope is the human-authorized final B1 re-review: the prior B1 finding and `git diff 1a5ae371 432f0a7b -- src test plugins`. That product diff contains exactly `src/cli/named-files.ts`, the claim expectation in `test/cli/status-wait-reasons.test.ts`, and the same calculation in four CLI bundles. No other product source, test or plugin file changed. C15 and status.md now describe the conservative waiter-relative bound. Local `origin/main` was `aff752fbd7927f1837d33c01119f3118290e3ee7` at the initial read; changes since the previous review's main reference are docs only.

The first `npm ci` attempt could not finish removing an existing Vitest cache (`ENOTEMPTY`, exit 217). Lint and typecheck then lacked their executables (`biome: not found`, `tsc: not found`, exit 127); those attempts are unverified, not findings. A second `npm ci` completed, followed by successful fresh lint/typecheck. The version check ran successfully on the same pinned clean candidate. No build was run, per the explicit brief.

```text
$ git rev-parse HEAD
432f0a7b010ca2f2d397cfcef405a71752453392
$ git status --short
(no output)

$ npm ci # first attempt
npm error code ENOTEMPTY
npm error syscall rmdir
npm error path /home/agent/projects/squeal/.ai/cezar/worktrees/***/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709
npm error errno -39
npm error ENOTEMPTY: directory not empty, rmdir '/home/agent/projects/squeal/.ai/cezar/worktrees/***/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709'
npm error A complete log of this run can be found in: /home/agent/.npm/_logs/2026-10-17T14_16_38_370Z-debug-0.log
(exit 217)

$ npm run lint # before the successful install

> squeal@0.1.210 lint
> biome check .

sh: 1: biome: not found
(exit 127)

$ npm run typecheck # before the successful install

> squeal@0.1.210 typecheck
> tsc --noEmit

sh: 1: tsc: not found
(exit 127)

$ npm ci # retry
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

> squeal@0.1.210 lint
> biome check .

Checked 1402 files in 437ms. No fixes applied.
(exit 0)

$ npm run typecheck

> squeal@0.1.210 typecheck
> tsc --noEmit

(exit 0)

$ npm run check:version -- origin/main

> squeal@0.1.210 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main

version bump: 0.1.209 -> 0.1.210, ok
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/4a4e603f-c81d-47e4-8185-a9be8140c59a/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/13d2cad1-c711-4881-8b00-ae4c19fef0c0/test/fixtures/scheduler/.tmp/15c341ec-9b90-4eb6-b749-83b8c12587fe/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2284235
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  698 passed | 1 skipped (699)
      Tests  5954 passed | 10 skipped (5964)
   Start at  16:17:19
   Duration  756.89s (tests 98%, import 2%)

    Isolate  699 workers spawned · ~114ms startup each (spawn + environment, per file)
             at least ~19.77s faster with isolate: false — reuses workers across files instead of one per file

(exit 0)
```

The independent locked suite passed: **698 files and 5,954 tests passed; 1 file and 10 tests skipped; exit 0**, in 756.89 s. All required checks completed successfully after the installation retry. HEAD and the clean tree were confirmed again after checks and probes. Only then was the prior review restored and this append written. The background Squeal notifications still name the same two recorder-fidelity results from revision 0 already recorded above; they are not the independent run and do not reopen this B1-only review.

### B1 closed: the bound belongs only to the waiter

At `src/cli/named-files.ts:127`, the reason now uses `now + claimBoundMs(policy.runner.timeoutMs)` with the waiter's policy, and never reads the claimant's run start to calculate its expiry. The amended C15 describes this as a conservative upper bound. For the policy governing the wait, a first sighting `s` no later than the read `t` gives `s + bound <= t + bound`; an earlier result or dead heartbeat can only release the claim sooner. It intentionally does not promise an exact remaining countdown. The status read neither changes `Claims.#seen` nor alters C7 scheduling.

The previous production counterexample now passes: a 1-second waiter first seeing an unlimited claimant at `12:20:00Z`, after the claimant has run for 30 seconds, advertises `12:20:07Z`, rather than `12:19:37Z`. Production `Claims.holds` still holds one second after first sight; the displayed deadline now allows that wait. The null-timeout waiter case still reports ten minutes from the read.

The broader real-store probe also passes for a larger finite claimant timeout, a first sighting three seconds before status reads, a live claim without an open run record, and an unlimited waiter seeing a long-running unlimited claimant. It asserts both the exact displayed conservative formula and the production waiter's expiry with fresh claimant heartbeats. The finite claimant in the matrix remains inside its own timeout throughout the simulated wait. No case found a deadline earlier than the waiter's actual bound.

The changed CLI test expects `NOW + 606_000` rather than `STARTED + 606_000`, so the previous run-start implementation no longer satisfies it. All four committed CLI bundles contain the same corrected formula. The repair introduces no new interface or stored timing field. B2's claimant lookup, B3's per-call bound, promotion behavior and the previously accepted areas are untouched and are not re-prosecuted here.

### Production command output

The original real-store claim probe was repeated with the finite case's assertion changed from a past deadline to `firstRead + claimBoundMs(waiterTimeout)`. The additional matrix uses the same production `Claims`, `readNamedFiles`, `readPolicy` and `openStore` calls, with fresh heartbeats at the bound. All scratch stores live outside the worktree and are removed; both commands exit 0.

```text
$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-round3-claim.mjs
{"scenario":"claim-bound","waiterTimeout":null,"claimantTimeout":null,"claimRunStarted":"2026-10-17T12:09:59.000Z","firstSeen":"2026-10-17T12:20:00.000Z","reason":"waiting for /tmp/review-011-claim-MA2Vo6/other's run of its key, at most until 14:30:00","advertisedUntil":"2026-10-17T12:30:00.000Z","actualWaiterEarliestExpiry":"2026-10-17T12:30:00.000Z","holdsOneSecondAfterFirstRead":true}
{"scenario":"claimant-identity","claimed":true,"chosen":"claimant","chosenHeartbeatAgeMs":1000,"liveClaimant":"claimant","namedReason":"waiting for /tmp/review-011-claim-MA2Vo6/other's run of its key, at most until 14:30:01"}
{"scenario":"claimant-live-boundary","inclusive":true,"deadOnly":null}
{"scenario":"claim-bound","waiterTimeout":1000,"claimantTimeout":null,"claimRunStarted":"2026-10-17T12:19:30.000Z","firstSeen":"2026-10-17T12:20:00.000Z","reason":"waiting for /tmp/review-011-claim-9I5iCA/other's run of its key, at most until 14:20:07","advertisedUntil":"2026-10-17T12:20:07.000Z","actualWaiterEarliestExpiry":"2026-10-17T12:20:07.000Z","holdsOneSecondAfterFirstRead":true}
{"scenario":"claimant-identity","claimed":true,"chosen":"claimant","chosenHeartbeatAgeMs":1000,"liveClaimant":"claimant","namedReason":"waiting for /tmp/review-011-claim-9I5iCA/other's run of its key, at most until 14:20:08"}
{"scenario":"claimant-live-boundary","inclusive":true,"deadOnly":null}
(exit 0)

$ node --disable-warning=ExperimentalWarning --import tsx /tmp/review-011-round3-matrix.mjs
{"scenario":"finite waiter, unlimited claimant","waiterTimeout":1000,"claimantTimeout":null,"advertisedUntil":"2026-10-17T12:20:07.000Z","waiterBound":"2026-10-17T12:20:07.000Z","conservative":true,"releasesAfterWaiterBound":true}
{"scenario":"finite waiter, longer finite claimant","waiterTimeout":1000,"claimantTimeout":600000,"advertisedUntil":"2026-10-17T12:20:07.000Z","waiterBound":"2026-10-17T12:20:07.000Z","conservative":true,"releasesAfterWaiterBound":true}
{"scenario":"first seen three seconds before read","waiterTimeout":1000,"claimantTimeout":null,"advertisedUntil":"2026-10-17T12:20:07.000Z","waiterBound":"2026-10-17T12:20:04.000Z","conservative":true,"releasesAfterWaiterBound":true}
{"scenario":"claim without open run record","waiterTimeout":1000,"claimantTimeout":null,"advertisedUntil":"2026-10-17T12:20:07.000Z","waiterBound":"2026-10-17T12:20:07.000Z","conservative":true,"releasesAfterWaiterBound":true}
{"scenario":"unlimited waiter, old unlimited claimant","waiterTimeout":null,"claimantTimeout":null,"advertisedUntil":"2026-10-17T12:30:00.000Z","waiterBound":"2026-10-17T12:29:57.000Z","conservative":true,"releasesAfterWaiterBound":true}
(exit 0)

```

For the standalone B1 reproduction already embedded in the previous round above, the only expected-result change needed is:

```js
assert.equal(entry.pending.until, firstSeen + 7000);
```

The production probe confirms this corrected assertion without changing the scenario, the old claimant run start, or the `Claims.holds` assertions. The matrix confirms the bound may be later than the actual expiry when first sighting predates the read, which is the intended conservative behavior.

### Inputs for the next wave

No B1 fix remains. Keep the bound scoped to the waiter and sourced from `claimBoundMs`; no claimant-start arithmetic or private first-seen timestamp is needed. Preserve the previous accepted B2/B3 repairs and promotion contracts. The only previously recorded product follow-up is S1 in 011-13; this B1-only PASS does not claim that formatter cap is implemented.
