# 004 wave 1.5 re-review

## Verification

Candidate: `e9758a6ba849fcfcfd8d93b59c0a6f3fb293518b`, version 0.1.48.
Range: `8c473c4..e9758a6`. Reviewed `ca5be87` (003-39), `34db923`, `05c4793`, `9ad061b` (004-20), and their 0.1.48 bundles. The intervening 001-146 and 001-147 commits are out of scope. This is the bounded second review of `reviews/wave-1.md`: B1, B2 and S1, then risks opened by their fixes.

The supplied HEAD was `3ab9f33`. Its only difference from the candidate is the review brief's corrected range. All executable verification below ran detached at the exact candidate with no tracked changes. The build left the tracked tree clean, including both plugin bundles. The worker branch was restored before writing this review. See N1.

Node `v24.21.0`, except the explicitly named Node `v22.23.3` probes. Commands and output:

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.48 lint
> biome check .
Checked 603 files in 338ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.48 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.48 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.48 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)
```

`npm ci` also warned that the optional watcher and esbuild installation scripts were not covered by `allowScripts`. All verification commands could run.

The committed regression files replayed the original review scenarios before the full suite. Independent probes also checked them:

```text
$ npx vitest run test/scheduler/slow-trigger.test.ts \
  test/harness/stop-slow.test.ts \
  test/runners/node-test/adapter-attribution.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  3 passed (3)
     Tests  12 passed (12)
  Duration  6.89s
exit 0

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
  /home/agent/.nvm/versions/node/v22.23.3/bin/node \
  node_modules/vitest/vitest.mjs run test/scheduler/slow-trigger.test.ts \
  test/harness/stop-slow.test.ts \
  test/runners/node-test/adapter-attribution.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  3 passed (3)
     Tests  12 passed (12)
  Duration  16.68s
exit 0
```

Independent B1, B2 and header-snapshot probes used a temporary Vitest config and source imports. They passed on both Nodes: `Test Files 1 passed (1); Tests 3 passed (3)`, 2.49 s on Node 24 and 2.80 s on Node 22. Independent adapter probes ran two node:test files concurrently in each of eight fixtures per Node. All completed with two passing results. The measured ownership and the old-recorder controls are recorded below. Probes used fixture stores and a private slow-slot directory, never this repository's store or the cezar repository. Owned scratch was removed before committing; no product code changed.

One full suite was run:

```text
$ npx vitest run
Test Files  2 failed | 241 passed | 1 skipped (244)
     Tests  2 failed | 1915 passed | 10 skipped (1927)
  Duration  130.86s
exit 1
```

| Failure | Full-suite evidence | Rerun alone, original timeouts |
| --- | --- | --- |
| `test/runners/node-test/graph-cost.test.ts:97` | Re-resolve 347.12 ms was not below cold build 260.97 ms | 1 file, 1 test passed; 2.74 s |
| `test/daemon/step-down.test.ts:130` | Released 0.1.31 daemon's successor did not serve within 60 s; teardown also exceeded its 10 s hook timeout | 1 file, 3 tests passed; 23.85 s |

```text
$ npx vitest run test/runners/node-test/graph-cost.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
     Tests  1 passed (1)
exit 0

$ npx vitest run test/daemon/step-down.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
     Tests  3 passed (3)
exit 0
```

The load average was 55.05 near the suite's end. Both failures are outside the changed source boundaries; neither has a proven cause in this slice. The handover fixture declares no slow tier. Passing alone does not make the full-suite gate green. Node 22 has focused coverage above; its full-suite gate is **unverified**, not a second full proof.

Background Squeal status at revision 4 separately showed `Known failures: 0`, 772 passed checks, 170 test files pending without checks, and no completed full-suite checkpoint. A later status on the restored worker branch with this review uncommitted, at revision 7, showed 2,161 passed checks, no running or queued checks, 10 skipped, no known failures, and the last full-suite checkpoint at revision 2. These are not substituted for the failed direct full-suite run at the clean candidate.

## Verdict

**PASS `e9758a6`: 0 blockers, 2 proven nonblocking should-fix notes, 1 proven informational nit.**

The prior B1 and B2 are closed. The prior S1's two relative preload probes are closed. Two additional forms of test-owned loading are now assigned to the project environment, causing unrelated files to rerun. These are notes under the bounded re-review rule; no missed rerun or falsely current result was demonstrated.

## Blockers

None.

## Closure of the prior findings

### Prior B1: closed, proven

Locations: `src/core/scheduler/slow-tier.ts:147`, `:159`, `:200`.

`#candidate` and the post-guard `#select` now use the same `#trigger` predicate. Its alternatives remain idle or absent consumers, an open slow request, or membership in the active run-all checkpoint. The file-specific checkpoint check remains intact. `#select` also rechecks fast work, queue membership and slow classification before selection.

The independent reproduction registered an idle consumer, held the guard at an injected load of 4 per CPU, entered a turn without a file batch, then dropped the load to zero. On both Nodes:

```json
{"heldInTurn":true,"slotReleased":true,"stillQueued":true,"turns":["idle"]}
```

No runner call began in-turn. The file retained its queued key; another holder could acquire the private slot during the deferral. Ending the turn let it run once, idle. The committed control also passed on both Nodes: an explicit slow request made during the wait still ran in-turn. The guard's `finally` retains its remaining budget, and trigger loss neither clears it nor removes the file. The pump's next candidate pass arms the existing bounded retry timer, so trigger loss does not strand the file.

### Prior B2: closed, proven

Locations: `src/harness/shared/stop.ts:188`, `src/core/state/header.ts:104`, `:153`.

Stop's wait reads `slowPending` with the policy predicate and polls `isFastPending`. It subtracts slow checks from `counts.pending` and slow files without checks from `testFilesWithoutChecks.pending`; unapplied runner work still waits. Aggregate status and the silent Stop's idle snapshot retain the slow files.

The independent real shared-Stop reproduction had one queued slow file, no fast work, no failure or news, and `stop.waitMs: 400`:

```text
Node 24: elapsedMs 4, stdout empty, exitCode 0, idle snapshot [slow.test.ts], key slow1
Node 22: elapsedMs 3, stdout empty, exitCode 0, idle snapshot [slow.test.ts], key slow1
```

Both harnesses' committed slow-only and mixed fast/slow tests passed on both Nodes. The mixed case returned after the fast result while the slow file stayed in the idle snapshot; the fast-only control still waited.

The torn-read probe committed a writer transaction from a second connection immediately after the reader's `knownStates.list`: it made the pending check current and added a queued slow file without checks. The caller used exactly Stop's `readTransaction(() => readHeader(..., undefined, undefined, isSlow))`. On both Nodes the first header retained the old snapshot and the next header saw the new snapshot:

| Snapshot | `counts.pending` | `testFilesWithoutChecks.pending` | `slowPending.checks` | `slowPending.testFilesWithoutChecks` |
| --- | --- | --- | --- | --- |
| Reader spanning the writer commit | 1 | 0 | 1 | 0 |
| Next read | 0 | 1 | 0 | 1 |

`isFastPending` was false in both. Aggregate and slow counts derive from the same arrays; the actual Stop caller reads those arrays inside one transaction.

### Prior S1: original probes closed, proven; broader ownership has notes below

Locations: `src/runners/node-test/runtime/recorder.cjs:34`, `src/runners/node-test/run/observed.ts:63`.

With `--require ./scripts/setup.cjs` or `--import ./scripts/setup.mjs`, the preload used `createRequire(process.cwd() + "/package.json")` to require a computed `./scripts/marker.cjs`. On both Nodes, two concurrent files completed; `environment().files` held the preload and marker; each test closure held only its own test file. These independently reproduce both prior S1 probes. Adapter version 8 separates the changed key semantics from version 7's cached results. The existing direct test-owned createRequire and spawned-CLI controls also passed.

## Should-fix

The IDs continue after the prior review's closed S1.

### S2. Proven, nonblocking: an eval worker's own loads become project preload inputs

Locations: `src/runners/node-test/runtime/recorder.cjs:34` to `:40`, `src/runners/node-test/run/observed.ts:63`.

An eval worker starts with `preload = true` because it is not the main thread. Its synthetic entry never supplies the parentless absolute resolution that ends that phase. This test-owned load is consequently tagged `preload`:

```js
// test/a.test.mjs, slow node:test project
const worker = new Worker(`
  const { createRequire } = require('node:module');
  const req = createRequire(process.cwd() + '/package.json');
  req('./lib/' + 'own.cjs');
`, { eval: true });
// Await the worker's exit. test/b.test.mjs is unrelated and empty.
```

Both Nodes returned:

```json
{"environment":["lib/own.cjs"],"closures":[["test/a.test.mjs"],["test/b.test.mjs"]],"affected":["test/a.test.mjs","test/b.test.mjs"]}
```

The helper's recorded edge had parent `package.json`, specifier `./lib/own.cjs`, and `preload: true`. The same fixture run with the recorder from `ca5be87^`, keeping the candidate's runner and collector, put the helper in `a`'s observed paths and left `preloadPaths` empty. A file-backed worker is a passing control: its helper stays file-owned and affects only `a`.

Spec 003 D3 separates per-file observed inputs from project preload inputs. The new phase inference violates that boundary here. Nonblocking: the helper is still keyed, but its edit now reruns unrelated files; no stale pass was proven.

Worker-sized follow-up: end the eval worker's phase before its body executes while retaining genuine worker preload ownership. Cover computed createRequire in an eval worker beside an unrelated file, plus the file-worker control, on Nodes 22 and 24. Its helper must enter only `a`'s closure and affect only `a`. Keep both repaired project-preload probes green; bump the adapter version if ownership changes again.

### S3. Proven, nonblocking: a preload chosen by a test's spawned Node enters the whole project's environment

Locations: `src/runners/node-test/runtime/recorder.cjs:34` to `:45`, `src/runners/node-test/run/observed.ts:63`.

The tag says a load preceded that process's entry, but the collector interprets it as belonging to the node:test project's preloads. A slow test can choose a preload for its own child, independently of the project's argv:

```js
// Inside test/a.test.mjs; child inherits the slow project's recorder.
spawnSync(process.execPath, ['--require', './child-preload.cjs', './bin/cli.cjs']);

// child-preload.cjs
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/package.json');
req('./lib/' + 'own.cjs');
```

With an unrelated `b`, both Nodes returned:

```json
{"environment":["child-preload.cjs","lib/own.cjs"],"closures":[["bin/cli.cjs","test/a.test.mjs"],["test/b.test.mjs"]],"affected":["test/a.test.mjs","test/b.test.mjs"]}
```

The old-recorder control kept the child preload, helper and CLI in `a`'s observed paths, with no preload paths. Ordinary `node -e` and `node --require ./child-preload.cjs -e ''` are passing controls: the main thread has no script, so their helpers stay file-owned.

Spec 004 D5 says a spawned process's loads join the file's observed closure; spec 003 D5 similarly assigns the file's run processes to it. The new tag lacks the origin needed to distinguish project startup from a test-owned child startup. Nonblocking: dependencies remain keyed, but a single file's child now broadens the whole project's environment; no missed rerun was proven.

Worker-sized follow-up: preserve whether a phase tag comes from project startup or a test-owned child, without losing genuine project NODE_OPTIONS preloads. Add the spawned relative-require probe beside an unrelated file on both Nodes. Its child preload and helper must stay in `a`'s closure and affect only `a`; rerun both original S1 probes and existing slow spawned-CLI coverage. Coordinate recorder metadata and the adapter-version change with S2.

## Nits

### N1. Proven, informational: supplied HEAD was the brief correction, not the candidate

The supplied `3ab9f33` changes only `tasks/wave-1.5.md` relative to `e9758a6`. Product code and bundles match. Verification was detached at the named candidate; no repair is required. Keep the candidate SHA distinct from this review's commit.

## What fits

- Both trigger checks share one predicate. No copy diverged on request or run-all membership. Fast work, queue membership, slow classification, result lookup and stability remain checked at their original boundaries. No proven new trigger blocker was found.
- Stop's added counts are subsets of the existing totals, using the same check identity and keyed-file rules. Missing `slowPending` preserves the old pending predicate. The actual Stop polling transaction remains intact. The slow predicate includes both `slow.include` and slow node:test projects.
- The original preload repairs, ordinary test createRequire, file-backed workers, spawned `node -e`, and existing slow spawned-CLI loads preserve their intended ownership in the measured controls. Concurrent files do not exchange file-owned helpers.
- An absolute project `--require` ends phase marking early: its computed preload helper still enters each file's closure rather than the environment. This is the exception explicitly recorded in amended spec 003 D5 and its status. The probe confirmed it on both Nodes; the helper remains keyed. A test's own helper still affected only that test. It is not a reopened blocker.
- The exact candidate builds both committed plugins without drift. The full suite passed the slow scheduler, shared Stop and preload regression files. The full-suite failure and isolated recoveries remain distinct evidence.

## Inputs for the next wave

1. No fix wave is required for prior B1 or B2. Keep the post-guard trigger check, slot release on rejected selection, queued file and remaining guard budget. Explicit requests override consumer turn state, never fast pending work.
2. 004-15 can use `StatusHeader.slowPending` and `SlowPendingCounts`, but ordinary status callers do not yet populate them. Pass the policy's slow predicate and read aggregate and slow counts in one transaction. Keep slow work in status and idle snapshots; use `isFastPending` only for ordinary Stop waiting. `stop.requireSlowSuite` is still 004-15's policy gate.
3. Route S2 and S3 to the node:test owner as ownership follow-ups, potentially one row with recorder and collector ownership. Retain the original CJS/ESM project-preload tests, add the worker/child cases with an unrelated second file, and change the adapter version when keys change. These notes do not require a third review of the closed blockers.
4. 004-18's separate slow runner lane, low priority and concurrency remain planned, as the prior review settled. This fix range does not provide those guarantees or alter the existing in-flight-one-file delay.
5. Preserve the failed full-suite evidence for integration. Both failing files recovered alone, but this review does not claim an all-green full-suite gate or a Node 22 full proof.
