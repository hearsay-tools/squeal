# Wave 13bs: candidate 0.1.187, row 001-368

FAIL `36c975413b0f765cd59c6ef736825a0ccfe3731b`: **1 blocker, 2 should-fix, 0 nits**. Review row 001-398; range `209dd922..36c97541`. Product files were not edited.

## Verification output

All checks below ran at the pinned SHA on a clean tracked tree. `npm ci` preceded the build. Build produced no tracked drift. The independent suite used the requested environment and the host full-run lock, not Squeal's checkpoint.

```text
$ git rev-parse HEAD
36c975413b0f765cd59c6ef736825a0ccfe3731b
$ git status --porcelain
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 8s
32 packages are looking for funding
found 0 vulnerabilities
(exit 0; npm also printed the node-domexception deprecation and six install-script approval notices)

$ npm run lint
> squeal@0.1.187 lint
> biome check .
Checked 1240 files in 376ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.187 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.187 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.187 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git diff --exit-code
(no output; exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/4008c0fb-2dfc-465c-9063-f3d856585748

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/4008c0fb-2dfc-465c-9063-f3d856585748/test/fixtures/scheduler/.tmp/2b8f75a5-8bc5-4fc5-8235-21423d611065/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/4008c0fb-2dfc-465c-9063-f3d856585748/test/fixtures/scheduler/.tmp/da0f43b4-3435-4b03-963b-84ee8362a73f/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 1269054
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  594 passed | 1 skipped (595)
      Tests  4897 passed | 8 skipped (4905)
   Start at  05:10:08
   Duration  644.60s (tests 98%, import 2%)

    Isolate  595 workers spawned · ~108ms startup each (spawn + environment, per file)
             at least ~15.93s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)

$ git rev-parse HEAD
36c975413b0f765cd59c6ef736825a0ccfe3731b
$ git status --porcelain
(no output)
$ git diff --exit-code
(no output; exit 0)
```

The full run started after the host lock became available. At the coordinator's request, draft findings were committed as `045100d2` while waiting; the queued command was stopped during that commit, and the checkout was restored to a clean detached `36c97541` before it continued. The completed suite and its final clean-tree check were both at the candidate SHA. No file failed the full run, so no failure-only isolation run was needed. The suite reported one skipped file and eight skipped tests. Fixture gitdir repairs, experimental typechecking notices and a dead earlier-run process sweep appeared in the output above; none failed the gate.

The focused probes imported the candidate's freshly built `dist/` modules from throwaway Node scripts. Each made a fresh temporary directory and set **HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR** beneath it before importing product modules. Their SQLite stores and sockets were temporary. The old-protocol probe additionally disabled Git's global/system config. No probe used the real home. The scripts and fixtures were removed after recording their results.

## Blockers

### B1. Proven: a joining session lets a second live daemon claim the same file/key

**Where:** `src/core/retry/records.ts:173`, `src/core/scheduler/retries.ts:64`; forced tiers bypass ordinary shared-run claims in `src/core/scheduler/tiers.ts:282`.

**Contract:** D6: “One run ends every pending request at the key”; a pending request is “run by whichever daemon at that key claims it first.” Notes decisions 2 and 6 require one run for joining sessions, with takeover when the claimant dies. The once-per-file/key/session budget must not turn joining requests into parallel retries.

`claimRetries` filters eligibility separately for each session's record. It does not first exclude a file/key already owned by another live daemon. Once A has claimed session s1, session s2 can append an unclaimed record at the same key. B cannot take s1, but can take s2 and returns `true`; both schedulers queue a forced run. Ordinary D8 running-key claims do not rescue this, because a forced tier skips them. If both runs start before either finishes, both run; either result can overwrite the other. The first run also ends both sessions' records, so the later run can replace the shared result without a matching retry outcome.

**Probe:** seed a real temporary shared SQLite store with live heartbeat records for A and B; give two lightweight ledger fixtures the same file/key and a current failed result. Call `askRetry(s1)`, `takeRetries(A)`, `askRetry(s2)`, `takeRetries(B)`. Each fixture records the actual `enqueue` arguments, including `forced: true`. Both heartbeat records remain live throughout. Output:

```text
A queues first request: true
B queues joining request while A live: true
claims: [{"session":"s1","claim":"a"},{"session":"s2","claim":"b"}]
forced queues: 1 1
second session ended by A before B runs: failed
```

**One-worker fix:** make ownership a decision for the whole `(testFile, key)` inside the existing `BEGIN IMMEDIATE`. An existing other live owner prevents a second forced queue; newly joining records belong to the same run. Keep dead-owner takeover and same-worktree restart. Add a gated two-scheduler test with two live heartbeats: hold A's retry, append s2, ask B, and assert exactly one runner invocation and one result ending both records. Include a second connection to the same SQLite store so the test exercises the transaction boundary.

## Should-fix

### S1. Proven: removing a claimed file strands its pending retry behind a live daemon

**Where:** new release integration in `src/core/scheduler/retries.ts:98` and `src/core/scheduler/ledger.ts:195`; file retirement is `Ledger.removeFile` at `src/core/scheduler/ledger.ts:144`.

Release is wired through `settle` for key changes. Removing a test file bypasses `settle`, deletes its local `FileState`, and drops its queued run without releasing the new shared retry claim. `takeRetries` cannot revisit a file absent from the ledger. Another worktree still at the old key cannot take it while the removing worktree's daemon keeps heartbeating. A queued slow retry, or a retry behind another busy lane, makes this reachable without a run already in flight. This note concerns the new retry state at an existing removal boundary, not a pre-existing defect in file retirement.

**Probe:** use a real `Ledger` with a temporary store, add a file at K, ask and claim its retry for A, then call `ledger.removeFile(file)`. B remains live at K; A's daemon remains live. Output, alongside the ordinary key-change control:

```text
moving key gives back claim: true null
removed file claim retained: a
live B takes removed file request: false
dead A taken over: true
```

**One-worker fix:** release this worktree's pending claims as part of removing a retry-bearing file, leaving the shared requests available to another worktree. Add a queued-retry removal test with another live worktree at K. Keep the current key-move test, but add a case where a claim was actually acquired; its current high-load case never claims.

### S2. Proven: a later ordinary recovery receives an older retry's successful outcome

**Where:** `src/core/retry/recorded.ts:30`, `src/core/delivery/attribution.ts:204`.

`passedRetry` searches all retained successful requests at the key; it does not tie the request to the recovering result's run. After a successful retry, a subsequent failure and ordinary forced recovery at unchanged inputs get the old “Retry asked (...) at these inputs: it passed” annotation. It even skips a newer retry that failed. The historical success happened, but the annotation does not identify the retry that produced this recovery. Counts and the current PASS remain correct; this is a provenance note.

**Probe:** at K, end s3's retry as passed, then s4's as failed. Record a later FAIL -> PASS flaky note for an ordinary run. Pass that recovery through the public `annotate` function. Output:

```text
later ordinary recovery retry note: {"reason":"environment","outcome":"passed"}
newest actual retry outcome: failed
```

**One-worker fix:** retain the completing retry's run id (or another identity linked to the recovering result) and attach the reason only when that run produced the recovery. Add a delivery test covering retry-pass, later retry-fail, ordinary forced recovery at the same key; it must not attribute the ordinary recovery to the older successful retry.

## Nits

None.

## What fits

- D6's amended setup scope is respected. The CLI explains that a global setup has no keyed inputs. Retrying failed global setup itself remains row 001-397, explicitly outside this blocker set.
- `askRetry` enforces file/key/session identity. Pending and passed/failed requests spend the budget; unknown and cancelled requests free it. A second session has its own budget. The focused unknown probe returned `queued` after `endRetries(...unknown)`; the added store and scheduler suites cover the other cases.
- The basic single-request claim is transactional. Live-owner exclusion, dead-owner takeover and same-worktree restart work for a single existing request. The joining-session seam is B1.
- Load admission is strict `< cpus`, including the equality boundary; unknown load permits a retry. Start, request handling and `handleBatch(trigger: "interval")` take the requests; the watcher default is 30,000 ms. There is no separate retry timer. The scheduler test lowers the load then sends an interval batch.
- An ordinary key move clears `retryKey` and releases the claim, retaining the request at the old key. The focused release control returned `null` for the claim. Removal is S1.
- Retry results use `storeResults`, replacing the shared check/key rows. Its heal updates other worktrees' states; the added cross-worktree test asserts the asking worktree becomes PASS after the other worktree's retry. A failed retry leaves the counted FAIL.
- Stop uses current known-state validity, not the forced queue as pending work; retry admission does not alter that rule. The added Stop test pins it. Pending retry records do not enter daemon owed work.
- Both shared meta entries retain at most 1,024 items and survive worktree removal. The focused load probe wrote 1,025 distinct runs and returned `run load cap: 1024 oldest: r1`. Retry retention uses `slice(-1024)` and has a 1,025-request regression; the removal test names both shared constants.
- The old-protocol probe used `parseRequest`/`errorResponse` from base commit `209dd922` behind a real temporary socket and called the new `retryCommand`: `older parser/socket: ["ping","unknown request type \"retry\""]`, `exit: 0`, `fallback text: true`, `request stays pending: true`. An older daemon's rejection does not erase the request or pretend it took it.
- The shared primer includes retry guidance for every harness. With a 700-character command-path segment, Vitest/node:test/slow coverage was 1,409 characters; adding pytest was 1,466. Both retained the retry sentence and the complete not-covered closing sentence, below 1,500. The Codex retry reference folds to “the CLI's”.
- Registration reports recording worktree, revision, load and retry history as facts. Normal retry recovery includes the flaky line and reason. It does not decide whether the failure is environmental. S2 bounds the historical-success association.
- Key format remains 10, explicitly unreleased; its hash was re-pinned in the candidate. The guard result is included in the independent suite. All four plugin builds reproduce committed files.

## Inputs for the fix wave

Repair B1 before landing this candidate. Keep the shared `retries` and `failed-run-loads` meta names, their 1,024 caps and worktree-removal retention. Claim one file/key in one transaction, then queue one forced run at normal D5 priority; keep the FAIL current until a result changes it. A joining session spends its own budget on that same run. Return claims when their file leaves the key, and allow takeover after a dead claimant. Preserve strict load admission through reconciliation, the unknown/cancel refunds, and Stop's zero retry wait.

B1's done-when is one invocation with A held and B seeing a newly joined request, then both requests ending from A's result; after A dies or releases, B must instead take over. S1 and S2 can be dispatched as separate small follow-ups. Keep failed-global-setup retry with 001-397. No product code, board, status, prior reviews or lessons were changed by this review.

---

## Second-round addendum: ff4c3191, row 001-398

PASS `ff4c319134f05210a1559950fb1b8b2faffae95e`: **0 blockers, 0 should-fix, 0 nits**. B1, S1 and S2 above are resolved in this candidate. This judgment supersedes the first round's verdict for the rebuilt candidate only. Product files were not edited.

### Verification output

All commands and probes below ran with HEAD at the requested candidate, on a clean tracked tree. `npm ci` preceded `npm run build`; the build left **every tracked file, including every plugin's dist files, byte-identical**. The only subsequent tracked edit is this addendum.

```text
$ git rev-parse HEAD
ff4c319134f05210a1559950fb1b8b2faffae95e
$ git status --short
(no output)

$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
added 196 packages, and audited 197 packages in 7s
32 packages are looking for funding
found 0 vulnerabilities
(exit 0; npm also printed six install-script approval notices)

$ npm run build
> squeal@0.1.187 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.187 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git diff --exit-code
(no output; exit 0)
$ git status --short
(no output)

$ npm run lint
> squeal@0.1.187 lint
> biome check .
Checked 1253 files in 1117ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.187 typecheck
> tsc --noEmit
(exit 0)

$ npx vitest run test/retry/records.test.ts test/scheduler/joined-retry.test.ts test/scheduler/retry-claims.test.ts test/scheduler/retry-delivery.test.ts test/daemon/escaped.test.ts test/keys/key-format.test.ts --maxWorkers=2
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/6b713756-b550-403a-8012-dd930a9d7d9c
 Test Files  6 passed (6)
      Tests  50 passed (50)
   Start at  06:41:02
   Duration  25.71s (tests 84%, transform 12%, import 4%)
(exit 0; npm also printed an update notice)

$ git rev-parse HEAD
ff4c319134f05210a1559950fb1b8b2faffae95e
$ git status --short
(no output)
$ git diff --exit-code
(no output; exit 0)
```

The scoped Vitest process ran with `CODEX_SESSION_ID` unset, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, and **HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR beneath one fresh temporary directory**. The probes likewise set all three directories before importing product modules. Their SQLite stores, configurations and runtime paths were temporary; none used the real HOME. Throwaway scripts and their stores were removed after recording the output.

Per the re-review brief, no second independent full-suite run or Squeal checkpoint was requested: the coordinator was already running the flock-protected gate. This round's evidence is the scoped run and probes above, not a claim that this reviewer ran the complete suite at the new SHA. The first round's full-suite evidence remains specific to `36c97541`.

`git range-diff 209dd922..edd26d54 6a16fb20..1dbc0bd8` returned twelve `=` matches, with no changed, added or omitted commits. The original 001-368 implementation and notes are unchanged picks. The new product delta is the three repairs in `9e3cdb7c`, `b792a5e7`, `d50c483a`, the key re-pin/version/bundles, plus test-only row 001-395 and its notes. Main's unrelated OpenCode/update changes were not re-prosecuted.

### B1 resolved: one claimant for the file and key

**Proven by the scoped regression, source and isolated probe.** `src/core/retry/records.ts:179` now chooses ownership across every pending request for the file/key inside the store transaction. Finding another live worktree's owner assigns joining requests to it and returns false; the second scheduler cannot queue another forced tier. The owning run still ends all pending requests together. No ordinary shared-run claim is needed to rescue this path.

`test/scheduler/joined-retry.test.ts` is adequate for the original failure: two real SQLite connections, two fresh heartbeat records, A held before its retry runner completes, a new session asking in B, exactly one retry invocation across both schedulers, and identical ends on both records. It also checks the receiving worktree heals to PASS. Its second test covers takeover after the owner's heartbeat is removed. The store unit test separately checks the joining request's claim is assigned to A rather than merely left unclaimed.

The independent probe repeated the original request/claim sequence using real ledgers and two connections, then ended A's run as failed and asked from a third session after completion. B can claim that new request. A second case seeded split records (dead A, live B, and an unclaimed request) and verified that B consolidated all three and excluded live C:

```text
B1: A queues=true; B joining while A live=false; both ended by retry-a; B joining after completion=true
B1 split takeover: dead A + live B + unclaimed records consolidate to B; live C cannot queue
```

### S1 resolved: removal and restart return claims

**Proven by the scoped regression, source and isolated probe.** `src/core/scheduler/ledger.ts:148` calls `dropRetry` on removal, before forgetting the retry-bearing file's claim. `src/core/scheduler/retries.ts:43` also returns a previous daemon's claims whose file is absent or at another key, preserving claims at the current key. `releaseRetries` re-reads ownership inside its transaction (`src/core/retry/records.ts:210`), so a stale cleanup snapshot cannot clear another worktree's newly acquired claim.

`test/scheduler/retry-claims.test.ts` is adequate for the reported removal bug: it actually acquires the forced retry first, proves B cannot take it while A is live, removes the file, and proves B can take the released request. Its key-move case now starts with an acquired claim, closing the old high-load test's gap. The absent-file successor case checks cleanup when the new daemon has no local `retryKey`.

The independent probe repeated removal and the acquired key move. It also preserved a current-key claim while returning an old-key leftover, and deliberately interleaved B's release/takeover after A's cleanup snapshot but before A's release transaction. B's live claim survived:

```text
S1: removed queued file releases claim; live B queues=true
S1: acquired key-move claim released; live B takes old K=true
S1 restart: old K released, current M preserved
S1 race: stale A cleanup snapshot cannot erase a fresh live B claim
```

### S2 resolved: reason belongs to the recovering run

**Proven by the scoped regression, source and isolated probe.** The completed request now keeps the tier's `runId`. `src/core/delivery/attribution.ts:202` reads the stored result standing for the recovering check and `src/core/retry/recorded.ts:44` requires that exact run on the successful request. This also works across a heal: the other worktree reads the same shared result provenance. `recordTier` stores results, heals states and ends the retry within its outer store transaction, so a delivery cannot observe the committed heal without the corresponding retry end.

`test/scheduler/retry-delivery.test.ts` exercises the actual delivery: retry-pass with its reason, later retry-fail at unchanged inputs, then ordinary forced recovery. The last recovery retains the flaky line and has no retry line. That sequence rules out the old search for any historical successful retry.

The independent probe used real result storage, the state sink and public `annotate`, through a second store connection and receiving worktree. It confirmed both the matching retry reason after a heal and its absence after an ordinary recovery; a successful historical request with no run id also received no attribution:

```text
S2/heal: B receives load reason for retry-pass; newer retry-fail + ordinary-recovery receives no retry reason
S2 old records: successful retry without runId does not annotate a recovery
```

### Row 001-395 and its evidence

**Proven for the changed assertion.** `test/daemon/escaped.test.ts:149` allows the exact fixture fork pid without a name, or any named parent. The delimiter after the alternative prevents a longer pid sharing the fork's prefix from matching. The two stopped commands, per-child signals, ages, run ids, runner-file attribution, sleeper deaths and the daemon's own child's survival remain checked. This relaxes only the parent-name expectation for the process the fixture itself identified.

A probe extracted the actual candidate's regex template and checked both reported CI shapes, named fork/reaper controls and four incorrect unnamed parent ids. A deterministic `terminate`/`describe` probe supplied an empty parent cmdline and verified the emitted note retains the correct pid alone and matches the new assertion:

```text
001-395 actual candidate pattern: 2 CI-shaped unnamed forks accepted; named fork/reaper accepted; 4 unnamed wrong/prefix parents rejected
001-395 terminate/describe: empty parent cmdline yields its correct pid alone; candidate pattern accepts the emitted note
```

The notes' central explanation matches `terminate.ts:70` and `statOf`'s zombie exclusion: a parent's name can be unavailable while the child still names its pid. A small independent rerun of the preserved process experiment corroborated that window. With the same isolated HOME/XDG setup:

```text
$ taskset -c 0-1 node docs/specifications/001-core-loop/tasks/001-395/window.mjs 10 10 0
nice 10 hogs 0: window ms p50 10.63 p90 18.02 max 18.02; parent named "" while still the ppid in 5/10
(exit 0)
```

This proves the window exists; it does not reproduce or independently validate the notes' historical frequencies, 20-run gate, or a causal change in frequency from nice 10. The notes explicitly leave the latter unconfirmed and acknowledge that their post-fix real-daemon runs did not traverse the new regex branch. The deterministic pattern checks cover that branch. The separately documented orphan-cleanup defect already has board row 001-400; this test-only change neither causes nor repairs it, and it is not a new finding in this bounded re-review.

### D6 wording, what fits, and next-wave inputs

The amended D6 describes the implemented contracts: one claimant for all pending sessions at a file/key; a joining request uses the live claimant's run; removal or re-keying returns the local claim, including a predecessor daemon's leftovers; the retry reason accompanies only the pass stored by its own run. Its existing priority/load rules, current counted FAIL, cancellation/refund budgets and Stop's zero retry wait remain intact. Registration still reports the newest request as a historical fact, distinct from attributing a recovery to its run. No new spec-conformance finding.

No fix wave is required for B1, S1 or S2. Preserve the file/key transaction boundary and re-read ownership when releasing; preserve `RetryEnd.runId` and compare it with the recovering check's stored provenance, including across worktrees. Requests written before that field existed intentionally have no recovery reason. Failed-global-setup retry remains 001-397 and the pre-existing escaped-orphan issue remains 001-400. The coordinator owns the current full gate and landing decision. Board and status were not repaired by this review.
