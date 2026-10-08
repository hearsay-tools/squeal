# Wave 13 review

FAIL e55ccd6fb8ef73883aaaf1f2f13bd7b82fde2058

Two proven blockers, two should-fix notes, one nit. Reviewed `75c2fbf..e55ccd6`; `d68c6eb` is the 001-140 product landing. The 0.1.45 and 0.1.48 changes are considered only at these rows' boundaries. 001-144's fix (`1357022`) is already in the base and was checked as the brief requests.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3. All commands below ran at the candidate, with a clean tracked tree. Required build verification takes precedence over the implementation briefs' prohibition on workers rebuilding bundles. The build changed no tracked file. No product or board edits.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.49 lint
> biome check .
Checked 603 files in 713ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.49 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.49 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.49 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ git status --short
(no output)
```

```text
$ npx vitest run --maxWorkers=4
RUN  v5.0.3
Test Files  245 passed | 1 skipped (246)
     Tests  1921 passed | 10 skipped (1931)
  Start at  01:29:19
  Duration  551.01s (tests 98%, import 1%, transform 1%)
   Isolate  246 workers spawned · ~200ms startup each (spawn + environment, per file)
```

The gate also printed worktree-repair notices and a notice that one process from an earlier test build was stopped. No failed check or suite was reported. The background daemon separately reported a handover baseline failure (`alive` rather than `spawned`); this direct candidate gate passed that file. That separate report is not a reproducible new blocker.

The install also reported that esbuild and @parcel/watcher install scripts were not yet allowlisted. The subsequent build and checks ran. Only one full gate was requested, with `--maxWorkers=4` as the brief requires. Background Squeal messages are separate evidence and do not replace this gate.

## Blockers

### B1, proven: a sweep in progress can kill the next run of another lane

`src/core/daemon/escaped.ts:189`, `src/core/scheduler/scheduler.ts:375`.

D12: "a run that ends while another is in flight stops nothing". That prevents a sweep at the moment the run count is checked, but not during the sweep's awaits. `afterEachRun` decrements `inFlight` to zero before awaiting `children.afterTier(since)`. A new run can start in another lane while that await is pending. It carries the same daemon token and starts after the old `since`, so the old sweep stops its live worker. The scheduler still considers the finished run's lane busy while sweeping, but the other lane is available to a newly refined revision or a queued tier.

Probe, using the real `EscapedChildren` and a unique token: wrap `afterTier` with a barrier before delegating to the real scan. Let lane A finish and enter that barrier. Start lane B; its runner spawns a detached marked Node sleeper and waits for a separate gate. Release A's scan, without releasing B. Output:

```text
second lane worker alive before sweep: true
stopped 1 process a test left running after its tier: 2742263 .../node -e setTimeout(()=>{},600000)
second lane worker while its run is held: { exitCode: null, signalCode: 'SIGTERM' }
```

The barrier represents time in `snapshot`, `#workersGone`, or environment reads, all awaited in the real sweep. This is distinct from the existing overlap test, which starts both runs before either enters its final sweep.

Fix for one worker: prevent a run from starting while the final global sweep is in progress, then take its mark and increment its count after the sweep. Keep genuinely overlapping runs concurrent. Alternatively, implement independent per-lane tokens and sweep ownership, coordinated with 004-18. Add the barrier regression with a real marked child; lane B must stay alive until it completes, and then be swept itself. Keep the cleanup barrier through rejection too.

### B2, proven: a separately configured Vitest project can store a false current PASS

`src/runners/vitest/adapter.ts:118`, `src/runners/vitest/sources.ts:85`.

001-146's outcome: "whatever sequence of edits lands on disk, a stored result was produced by the bytes its key names, or it is not stored as current". A plugin passed in the root `createVitest` overrides does not reach a project with its own Vite server. Such a project's cached transforms have no source stamp. `SourceStamps.stale` silently excludes them. The inline `projects` fixture in `sources.test.ts` does not exercise this configuration.

Probe configuration, a normal supported project file:

```ts
// vitest.config.ts
export default defineConfig({ test: { projects: ['./vitest.unit.config.ts'] } });
// vitest.unit.config.ts
export default defineConfig({ test: { name: 'unit', include: ['test/*.test.ts'] } });
```

`test/mod.test.ts` statically imports `src/mod.ts` and expects `which` to be `new`. On disk `mod.ts` exports `old`, so the test should fail. Start a real adapter and scheduler with the real store, state sink and default policy, observation explicitly on. Wrap the adapter's first `closure` call: write `new`, await the real closure walk, then restore `old`. The scheduler's bootstrap hashed `old`, and the stability checks see `old`. The graph has cached `new`. The adapter's run serves that transform, completes the file, and the scheduler stores both file-level and test-level PASS as current:

```text
disk expected to fail, stored known states:
  { kind: 'file', validity: 'current', outcome: 'pass' }
  { name: 'restored bytes', kind: 'test', validity: 'current', outcome: 'pass' }
fresh restored-disk run: [ 'fail' ]
```

The inverse probe caches `old` during a closure walk, restores `new`, and returns a completed false FAIL. The root-project control returns PASS after that sequence; inline projects, atomic rename replacement and an import through a file symlink also return PASS. Thus this is missing coverage of a separate project server, rather than failure of the general invalidation mechanism. Runtime observation does not repair a transform Vite cached in its own process.

Fix for one worker: stamp loads in every project server and environment whose cached transforms the adapter can execute. If a supported server cannot be instrumented, report the affected files unknown with a reason rather than silently treating its unstamped cache as trustworthy. Add a separately configured project fixture and the false-PASS scheduler regression, with observation both enabled and disabled. Keep the root and inline-project controls.

## Should-fix

### S1, plausible: the child-marker test can sweep another invocation's sleepers

`test/runners/vitest/child-env.test.ts:31`, `test/runners/vitest/child-env.test.ts:43`.

Every invocation uses the literal `marker-142`, although production uses a random daemon token. Concurrent invocations on the shared host therefore have indistinguishable worker and sleeper environments, and either scan may stop both. This is a concrete alternative to start-time granularity for the gate's two-sleeper report. The historical pids were not available for attribution, so that incident's cause is not established. The one-second lookback in `mark()` is deliberate, much larger than USER_HZ granularity; it can include another invocation's recently started sleeper with this same token.

Use one random token per test invocation and interpolate it into the fixture assertion and adapter options. The two pools within that test should share that token. Check two concurrent invocations on distinct fixtures and require each sweep to stop only its own sleeper. This note concerns test isolation, not production tokens.

### S2, plausible: the first SIGTERM does not recheck the process identity

`src/core/daemon/escaped.ts:201`.

D12 says each stop is identified by pid and start time. The scan records both, but `terminate` awaits command-line reads and then sends SIGTERM using only the pid. Only the subsequent survivor and SIGKILL paths verify start time. A target exiting and its pid being reused between the scan and that first signal could receive another process's command line and signal it. No live pid-reuse experiment was attempted; this is not a blocker.

Recheck `(pid, start)` before collecting a command line and before the first signal. Preserve that identity through termination and repeated rounds; consider a pidfd if the stronger atomic guarantee is required. A controlled process-table fixture can verify that an identity change causes no signal without churning host pids.

## Nits

### N1, proven: the handover test's header still describes the wider promise

`test/daemon/handover.test.ts:12` says the successor serves "before an older hook's spawn can take the lock". The changed case deliberately waits until the successor reaches the lock before launching the older boundary, consistent with the amended D10 limit. Update the comment to name that precondition. The test still asserts current service and no timeout after the accepted handover; its new wait does not prove the eliminated startup window is closed.

## What fits

- **001-141, verified by probe:** 512 prunable rows, two delete batches. A second connection makes `key-512` live before batch two. Prune removes 511 results and preserves that key. A new store reports `auto_vacuum = 2`. Each batch's protection predicate is re-evaluated under `BEGIN IMMEDIATE`; opening an existing store no longer writes `auto_vacuum`.
- **001-142/001-140, verified by probe outside B1:** overlapping runs present when the final count is checked are protected by the in-flight counter. Shutdown orders scheduler close, runner close, sweep, then temp removal. The pipeline exclusion and marker exclusion from the environment hash remain covered by their tests. PID reuse remains S2.
- **001-144/001-147, verified by probe:** a child with inner recorder settings spawns a grandchild that reads `data.txt`; the read is attributed to `nested.test.ts` in the inner output, and the outer output does not get that descendant read. A separate Worker reads the file then posts its terminal message; immediate termination preserves its outer attribution. The message-loop tests discriminate disk writes from path coverage, and retain the per-parent-message flush guarantee.
- **001-145, read in source:** `successorAtLock` looks for the successor's lock-database descriptor, not merely for the old daemon's death. The final service assertion remains. The historical ten-run proof is in the worker's notes and was not repeated as another full proof here.
- **001-146, verified by probe outside B2:** root and inline-project restore sequences, an atomic rename of the source, and a source reached through a symlink execute restored bytes. The transform-count test now measures cache retention directly rather than relying on a hidden edit staying cached. The integration test requires the planted old load and the absence of a revision naming it; retrying only watcher-split attempts does not relax that assertion.
- **001-140, verified by scheduler probe:** with non-serial runner parts, B refines and stores a current FAIL while A's earlier tier is held, with `runnerPartPending: false`. A changes from 1 to 2 and back to 1 while held; its old FAIL is discarded and the prior matching-key PASS becomes current. A later crash of B makes only B unknown; A stays current. The probe uses the actual scheduler, hasher, state sink and store with a controlled runner, so it proves scheduler bookkeeping, not removal of the real Vitest adapter's serial queue.

## Inputs for the next wave

1. Repair B1 before increasing concurrency again. A new run must exclude an in-progress global sweep; 004-18's lane tokens must cover Vitest workers and node:test descendants and be omitted from environment keys. Keep the final sweep before returning the last run's report.
2. Repair B2 in the Vitest adapter and source-stamp seam. Preserve conservative unknown results for uncertain executed bytes. Stamp coverage must follow the project servers, not assume inline `projects` and separate config files have the same server.
3. **001-150 remains necessary.** The real Vitest adapter serializes `invalidate`, `affected`, `closure` and enumeration behind its own `run`; the composite fans out with `Promise.all`, so a node:test-only revision still waits for that Vitest runner part. D5 and the amendment explicitly accept this remaining slice. The existing first lane test uses `runnerPartBesideRun` to bypass the recording wrapper's gate. It does not prove the real adapter can refine while a Vitest worker is executing. Add a real held-worker test; protect recreates and the `config.related` window as the notes explain, and keep 001-146's stamps effective.
4. 004-18 should reuse per-tier `changes` sets and run marks. Slow selection still requires no tier in flight; fast tiers of another lane may overlap a running slow file. Keep the slot and guard, trigger recheck, fast-work precedence, and no-artifact inheritance rule. A real slow-daemon fixture must set `slow.maxLoadPerCpu` high on this host.
5. The source-stamp read followed by Vite's separate read, the unstamped `fsModuleCache` case, and a closure obtained during a transient import rewrite remain bounds already named in D4/001-146's notes. They were not established as new blockers by this review. Avoid broadening the success claim beyond the tested server paths.
6. The historically reported extra child in the 0.1.49 gate is unverified as to ownership. S1 removes the test's shared-token ambiguity; it does not establish what those two historical pids were.

All probe files and fixture directories were outside the repository and removed after their outputs were recorded here. Only this report is committed.
