# Wave 13 fifth review: the discard rule

FAIL a04226c

Three proven blockers (B1 to B3), no should-fix notes, no nits. A touch delivered before a run clears the tested caches, but three paths still store a current PASS from other bytes: the own-write exemption, results recorded before the touch arrives, and optimizer bundles reused after a restart.

Reviewed `b36faa4..a04226c`, the exact 0.1.58 to 0.1.64 bundle landings. The starting checkout was `9d0ea80`; all verification and probes ran detached at `a04226c` with a clean tracked tree. Returned to the assigned branch only to commit this report. The spec 002/003/004 changes are considered only at 001-159's slow-lane seams. Read wave-13, wave-13b, wave-13c, wave-13d and 001-159's notes; there is no wave-13a.md. That absence is context, not a finding against the product.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3, Vite 8.3.2. Commands below ran at exact candidate `a04226c43dcf14f95f17143d138380a37da0d5dd`. The tree stayed clean. The reviewer skill and AGENTS.md require the build check; implementation briefs' no-build rule does not waive it for this reviewer. Both regenerated plugin bundles stayed byte-identical. One full gate only, with the required four-worker cap.

```text
$ git rev-parse HEAD
a04226c43dcf14f95f17143d138380a37da0d5dd

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.64 lint
> biome check .
Checked 660 files in 405ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.64 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.64 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.64 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
$ git status --short
(no output)

$ npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/scheduler/backlog-tiers.test.ts
  runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run
  expected 33569 to be less than 33546
  at test/scheduler/backlog-tiers.test.ts:89:23
  cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier
  expected 200 files in the cancelled tier, got 185
  at test/scheduler/backlog-tiers.test.ts:133:31
FAIL test/runners/node-test/graph-cost.test.ts
  re-resolves no slower than a cold build and re-parses an edit in under 5 % of it
  expected 317.687457 to be less than 312.4461309999997
  at test/runners/node-test/graph-cost.test.ts:97:32
Test Files  2 failed | 283 passed | 1 skipped (286)
     Tests  3 failed | 2165 passed | 10 skipped (2178)
Start at 14:43:11
Duration 1072.06s
(exit 1)
```

The required isolated repeats passed, one worker each:

```text
$ npx vitest run test/scheduler/backlog-tiers.test.ts -t 'runs a 200-file backlog|cancels a backlog tier' --maxWorkers=1
Test Files  1 passed (1)
     Tests  2 passed | 2 skipped (4)
Start at 15:01:48
Duration 194.30s
(exit 0)

$ npx vitest run test/runners/node-test/graph-cost.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed (1)
Start at 15:05:50
Duration 11.47s
(exit 0)
```

Install warned that esbuild and @parcel/watcher install scripts were not allowlisted; the subsequent checks completed. The full gate printed two fixture gitdir-repair notices and one earlier-run process-cleanup notice. Global teardown reported no failure. Its new touched-cache, touched-stamp, in-flight and no-relist regressions, and the changed starting-daemon tests, all passed. The loaded gate is not green; these three failures are not additional blockers of the discard slice. The node-test cost comparison is the previously noted timing case; the backlog cost comparison exceeded its bound by 23 ms, and D5's existing summed-duration budget permits selecting fewer than 200 files under load. Both backlog cases passed their isolated repeat; this does not establish a new discard-rule break. No repair is attempted here.

Separate background Squeal evidence reported 19 baseline failures, including hook/bundle timeouts at load averages about 167 to 175, handover/step-down readiness assertions, the backlog cases and a watcher timeout. Those are distinct runs. The direct gate passed their other files; no clean background full-suite checkpoint is claimed.

Independent probes ran with this checkout's `node_modules/.bin/vitest run --root <external scratch> --config <external scratch>/vitest.config.ts --maxWorkers=1`. Copied scheduler/test harness helpers had their scratch roots moved outside the reviewed checkout, with the final replay under `/tmp` and their product imports pointed at this candidate. Each fixture had its own Git repository, SQLite store and optimizer cache, plus links to installed dependencies. Final external run:

```text
Test Files  1 passed (1)
     Tests  14 passed (14)
Start at 15:06:49
Duration 67.92s
(exit 0)
```

These assertions deliberately require the bad states below and the discriminating fresh controls, as well as the working touch-before-run, watcher and replacement controls. Early copied CSS probes had fixture string paths rebased incorrectly; those copies were corrected before the final 14-case run. They are not product findings. No independent probe started a daemon or used this worktree's store.

## Blockers

All three break vision principle 2 and spec goal 3, “Everything the agent is told is true at the moment it is told.” D5 says a stored result must represent stable inputs of its key. These are reproduced remaining gaps in the guarantee 001-160 explicitly asks to judge, not claims that this patch introduced every underlying cache. The first two follow the worker's recorded decisions; the experiment shows why those decisions do not preserve the goal.

Every probe used the real adapter, scheduler, state sink and an isolated SQLite store. Source files were explicitly declared with `inputs`, so an omitted runtime read is not the explanation. The fixture's restored source exports `which = "old"`, its transient source exports `"new"`, and both the virtual and ordinary test expect `"new"`. The virtual plugin declares `src/mod.ts` with `addWatchFile`; its ordinary import gives that input a restored transform of its own, reproducing the prior review's settled cache class. Fresh adapter controls fail on restored disk.

### B1, proven: writing a path does not prove the run executed its restored bytes

`src/runners/vitest/adapter.ts:414`, `src/runners/vitest/observe.ts:89`.

D4's new exception is “A path the run itself wrote ... does not count: a fresh run of the same bytes writes it too.” Writing the same bytes is compatible with executing an older cached transform. The filter removes the only evidence that would withhold that run.

Independent scheduler proof:

1. During the first closure walk, warm the scheduler's own adapter's virtual test on transient `NEW`; restore `OLD`; fetch the ordinary test's closure on `OLD`. This is the same cached virtual-input counterexample as wave-13d B1, now protected only by the touch rule.
2. The scheduled virtual test rewrites `src/mod.ts` with its existing `OLD` bytes, writes an ignored started flag and waits. It has already imported the cached virtual module containing `NEW`.
3. Hand the restore/rewrite batch to the scheduler and wait until `invalidate(kind: "touch")` is called. Only then release the held test. The touch was heard during the actual run, so this is not B2's delivery window.
4. Observation on records the self-write. The filter removes the touched path, and the scheduler stores the virtual test's PASS as current under the key naming `OLD`. A fresh adapter runs the same self-writing test and fails.

```text
observe=true, touch heard while held:
  stored: plain current FAIL; virtual current PASS
  report.failure: null
  fresh restored-disk run: plain FAIL; virtual FAIL
observe=false, identical timing:
  stored: []
  report.failure: src/mod.ts was written during this run and ended as it was ... task 001-159
  fresh restored-disk run: plain FAIL; virtual FAIL
```

The run's idempotent write does not create new source bytes. Even that narrow case defeats the exemption; an agent's concurrent write of the same path is also indistinguishable in the current union of written paths, but no concurrent-agent race is needed for this finding.

Fix for one worker: do not use membership in the written set as proof of executable cache validity. Keep withholding a run that heard a touch unless independent evidence proves the executed consuming transforms correspond to the keyed bytes. The conservative repair is to remove the exemption and resolve fixture-writer scheduling separately, without publishing uncertain results. Add this held virtual-input case with observation on/off and the fresh control. Preserve the harmless fixture-rewrite test, but do not make its liveness assertion override result honesty.

### B2, proven: a late touch clears the instance but leaves the false PASS current indefinitely

`src/core/scheduler/scheduler.ts:194`, `src/core/scheduler/refinement.ts:124`, `src/core/scheduler/refinement.ts:199`.

D4 documents that a run ending before the touch is heard is stored, and says the debounce bounds that window to about a batch. It bounds when the false result can be created, not how long it remains current. There is no correction when the batch finally arrives.

Independent scheduler proof, observation off and on:

1. Plant the same virtual `NEW` transform, restore `OLD`, and let the scheduled tier finish before forwarding its watch batch. The store records plain current FAIL and virtual current PASS.
2. Hand the real stat/hash batch for `src/mod.ts` to `handleBatch`, wait for the adapter's touch invalidation and the scheduler to settle. The restored file has the old content hash, so no revision or key changes.
3. The touch rebuilds the instance and refetches the referencing closure. `ledger.settle` looks up the unchanged key and retains the previously recorded PASS. No corrective scheduled run follows. Fresh execution fails.

```text
observe=false and observe=true:
  before touch: plain current FAIL; virtual current PASS
  after touch, scheduler idle: plain current FAIL; virtual current PASS
  touch invalidations: 1
  key unchanged: true
  virtual adapter runs: 2 (one warm-up, one scheduled run)
  fresh restored-disk run: plain FAIL; virtual FAIL
```

The controlled batch delivery models a run finishing during debounce or while earlier feed/runner work holds notification. No dropped event is required. Separate real-watcher and lost-hint controls confirm that a revert/restore emits a touch and that an interval can recover it; receipt alone does not undo the bad result.

Fix for one worker: make result publication account for touched-unchanged writes over the run's interval, rather than only touches the adapter has already received. A completion reconciliation barrier before recording is one bounded route; carry its touches into the in-flight run's decision before publishing. If repairing already-recorded results instead, retire the suspect shared result rows and queue a forced rerun; merely marking this worktree unknown lets the same shared key promote or inherit the bad PASS again. Retain the no-relist choice and add the late-delivery regression, including a result lookup after the touch and an inheritance control.

### B3, proven: optimizer output survives the lifetime in which its touch would have been heard

`src/runners/vitest/adapter.ts:142`, `src/runners/vitest/adapter.ts:162`.

An initial adapter start has an empty `#touched`, so `forceOptimizeDeps` is false. Closing an instance preserves the optimizer's on-disk bundle. Its next instance can therefore execute transient project bytes without any transient module graph or stamp surviving in memory. A checkpoint forced after a restart still cannot repair it.

Independent proof with the supported `local-pkg -> src/mod.js` alias and `deps.optimizer.ssr/client.enabled: true`, observation off and on:

1. The source is a declared input. Start with `OLD`, then build the optimizer bundle while it contains `NEW` (remove only this fixture's optimizer cache and recreate while transient bytes are on disk). Warm the test and restore `OLD` before its scheduled run.
2. Let that run finish without delivering the restore's touch, then close both scheduler and adapter. Keep the fixture's cache directory. This represents shutdown before a queued batch is consumed; no unrelated daemon is stopped.
3. A newly created adapter on restored disk reports PASS. Start a new real scheduler on the same isolated store and force its full-suite checkpoint. It executes the cached bundle again and stores current PASS.
4. Close that run, remove only the fixture's `node_modules/.vite`, and repeat with a new adapter. The rebuilt bundle reports FAIL on the same source, test and configuration.

```text
observe=false and observe=true:
  first scheduler: current PASS
  new adapter, optimizer cache kept: PASS
  restarted scheduler, forced checkpoint: current PASS
  new adapter, optimizer cache removed: FAIL
```

This extends beyond B2: neither a fresh in-memory instance nor a forced run reads the restored project source. Startup reconciles source hashes but carries no touch obligation into the first optimizer start. The worker's notes name the cache lifetime; this probe proves its result consequence.

Fix for one worker: rebuild potentially project-derived optimizer output on initial instance creation too, or persist and verify the source evidence for every such bundle across starts. For the conservative discard approach, force optimization on every start that could reuse unverified project output, then measure the cost. Add close/reopen and forced-checkpoint regressions, with a fresh uncached control; never depend on a live daemon having heard the prior touch.

## Should-fix

None beyond the blockers.

## Nits

None.

## What fits

- **Prior wave-13d B1/B2 and S1 closed when the touch arrives before the run, proven independently.** External scheduler probes plant the virtual-module input, processed CSS `@import` input and alias optimizer on transient passing bytes, restore disk, forward the touch, then execute. With observation off and on, the stored test states are current FAIL. The warm-up's PASS is asserted. This verifies the trigger's repair, not the absence of the three paths above. The gate covers CSS both with and without declared inputs.
- **Watcher receipt and recovery, proven independently.** A real Linux change feed with its default timing emits one watch batch for an immediate `NEW`/`OLD` round trip, and the scheduler hands `src/mod.ts` to the adapter as `touch` with no error. A second feed with a silent backend delivers the same touch on an explicit interval reconciliation. Merely coalescing a same-file round trip does not erase this signal. Ignored paths outside the known/declarable watched set retain the D2 boundary; no new coverage claim is made for them.
- **Touch during replacement, proven independently.** Wrap the real `createVitest`/`standalone` boundary. During the second start, warm transient source, restore disk and deliver another touch before `standalone` returns. The adapter starts a third instance and executes restored FAIL with `report.failure: null`. It preserves the later touch instead of clearing it with the first start's `heard` prefix.
- **In-flight withholding works without the exception, proven independently.** The B1 held-run control with observation off stores neither file and carries the expected touch reason. This isolates the observed write filter as the difference.
- **The no-relist decision has a valid bounded purpose.** The touched bytes do not change the test-file listing. `refinement.ts` refetches closures referencing the touched path without claiming a project recreation; the candidate regression then hands a newly added test file its own batch and requires a new revision and one run. Keep this behavior while repairing publication of prior suspect results. Refetching a closure alone is not result revalidation (B2).
- **Slow-lane seam, read in source and covered by the candidate gate.** `withSlowInstance.invalidate` forwards touches to a live slow adapter at once and queues ordinary changes until its next run. The touch receipt itself is synchronous in the real adapter; neither lane waits for a live run to hear it. The slow in-flight regression covers every file in its now parallel tier. Initial slow-instance optimizer reuse still shares B3's startup boundary.
- **Wave-13d S2 closed.** The starting-daemon cases use spawn/heartbeat ordering and a lower settle bound; the strict total wall-clock upper bounds are gone. The gate verifies the rendered starting/validating states. No liveness behavior was changed to satisfy those assertions.
- The previously settled process-marker, store, recorder, per-container/per-module and gate-overlap findings were not re-prosecuted. Neither was the already accepted interval between Squeal's separate source read and Vite's read.

## Inputs for the next wave

1. This fifth review sends blockers to the human, as row 001-160 directs. The coordinator chooses whether to repair or explicitly accept these proven limitations; the reviewer edits no product or board file.
2. Treat touch provenance and stored-result validity as one contract. The adapter's synchronous touch receipt is useful, but it is not a scheduler result-publication barrier. A shared result known to have executed other bytes must not remain a lookup hit.
3. The own-write filter needs evidence about executed cache inputs, not only a record of writing the physical path. Keep separate observation on/off controls; the default observed case must not be less truthful than the unobserved case.
4. The discard must span persistent caches as well as the current fast/slow instances. Startup and slow-instance creation cannot assume that a previous instance processed all filesystem events before exiting.
5. Preserve 001-150's overlapping runner-part/run gates, per-module/container evidence, and the live slow instance's immediate touch delivery. Keep the no-relist addition regression. No fix needs to restore a listing on each touch merely to mark previous results suspect.

All external probe scripts, fixture repositories, stores, optimizer caches and logs were removed after their evidence was recorded. No independent probe started a daemon or used this repository's store. Only this report is committed.
