# Wave 13bp: release 0.1.180, row 001-382

## Verification and verdict

**FAIL `f8f972523d39d6591fe849a5a013a026eeb67bb6`. Four proven blockers, zero should-fix findings, zero nits.** Reviewed `668e6dfd..f8f97252` for row 001-388. The findings concern 001-382's implementation; incidental eval and release changes were inspected too. The candidate was checked out detached before verification. `git rev-parse HEAD` matched the supplied candidate. The tree was clean before and after the build, throughout the independent suite and the external probes. No candidate code was edited.

Commands and captured output at the candidate:

```text
$ git checkout --detach f8f97252
HEAD is now at f8f97252 build(plugin): rebuild the plugins for 001-382; version 0.1.180; key format 10 re-pinned (unreleased); D4 to D7 amended
$ git rev-parse HEAD
f8f972523d39d6591fe849a5a013a026eeb67bb6

$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 8s

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
exit 0

$ npm run lint
> squeal@0.1.180 lint
> biome check .
Checked 1186 files in 652ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.180 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.180 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.180 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --porcelain
(no output)

$ npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/3a91d010-19c5-4efb-8f40-ef7a1ea62285

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/3a91d010-19c5-4efb-8f40-ef7a1ea62285/test/fixtures/scheduler/.tmp/a5516541-29ca-45dc-a84c-783b814e4ee5/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/3a91d010-19c5-4efb-8f40-ef7a1ea62285/test/fixtures/scheduler/.tmp/0ea208ef-f72f-4cdb-88af-4674ccd45d50/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2113633
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  562 passed | 1 skipped (563)
      Tests  4638 passed | 94 skipped (4732)
   Start at  23:48:58
   Duration  942.22s (tests 97%, import 2%, transform 1%)

    Isolate  563 workers spawned · ~235ms startup each (spawn + environment, per file)
             at least ~32.86s faster with isolate: false — reuses workers across files instead of one per file

npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
exit 0
```

The Vitest invocation above is the reviewer's independent full suite, required by the brief and reviewer skill, rather than Squeal's checkpoint. It ran with a fresh temporary `HOME` and `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME`. The throwaway probes used separate temporary homes and fixtures, imported the candidate's freshly built adapter and scheduler, and touched no other worktree, store or daemon. They were run outside the tracked tree and removed before this report was committed. Their relevant code and output are preserved below.

## Blockers

### B1. Proven: timeout cancellation drops the rejection marker and keeps the poisoned instance

**Location:** `src/runners/vitest/adapter.ts:428` and `src/runners/vitest/run.ts:58` (the new rejection contract), with the timeout mapping at `run.ts:69`.

**Contract:** D4: “A run whose `runTestSpecifications` rejects closes its instance, and the next call starts a new one”. Brief check (1) explicitly requires every rejected-run path to close.

**Failure:** `execute` adds `rejected` to the runner's rejection, but its timeout branch constructs a replacement `{ end: "timed-out", failure, hung: false }`, dropping that marker. A setup that rejects during either cancellation grace therefore reaches the adapter with `rejected === undefined`, `hung === false` and no broken-module error. The instance is retained. Vitest already marked global setup initialized, so later files execute without it.

**Probe:** A real global setup appends `call\n` to a fixture-local log, waits 150 ms, and always throws `new Error("bootstrap")`. Run the one passing test with `timeoutMs: 50`, then run it again with `timeoutMs: 10000`, on the same adapter. No files are edited between calls.

```json
{"mode":"timeout","calls":1,"runs":[{"end":"timed-out","completed":0,"failure":"run exceeded timeoutMs (50 ms)"},{"end":"completed","completed":1,"failure":null}]}
```

The second run must retry and fail setup; instead it completes with the call count still one.

**Worker-sized fix:** Preserve rejection information through both timeout grace outcomes and make instance disposal depend on the underlying rejection even when the outward end is `timed-out`. Add a real-adapter regression for rejection during cancellation grace; the second call must retry setup and complete no file. Keep existing timeout/cancel end semantics and graces.

### B2. Proven: a null rejection throws during attribution before the instance is closed

**Location:** `src/runners/vitest/startup.ts:45`, called at `src/runners/vitest/adapter.ts:432` before its disposal branch.

**Contract:** The same D4 rule and brief check (1). D5 also requires a failed start to become unknown files with a setup failure rather than disappearing as an internal conversion error.

**Failure:** The rejected value has type `unknown`, but `startupFailure` casts it to `SerializedError` without normalization. `toCheckError` immediately reads `error.stacks`. A valid JavaScript setup containing `throw null` rejects with null, so that read throws before the code sets `#vitest = null` or calls `closeRejected`. The adapter's `finally` only resets flags and the process exit code. The next run uses the poisoned instance and skips setup.

**Probe:** Replace the delayed setup above with an immediate `throw null`; make two adapter calls with a 10-second timeout.

```json
{"mode":"null","calls":1,"runs":[{"threw":"TypeError: Cannot read properties of null (reading 'stacks')"},{"end":"completed","completed":1,"failure":null}]}
```

**Worker-sized fix:** Normalize null, undefined and primitive thrown values into a contextual check error. Guarantee rejection disposal even when classification or error conversion fails, rather than placing conversion ahead of cleanup. Cover null/undefined and a string rejection; retain its diagnostic text and retry setup on the next call.

### B3. Proven: a setup file shared by projects can attribute failure outside the run and cause an immediate retry loop

**Location:** `src/runners/vitest/startup.ts:36`; the consequence crosses `src/core/scheduler/setup.ts:78` to its requeue/block logic.

**Contract:** D5: “its projects (the one whose `globalSetup` file the error names, else every project of the run) take this path … files of other projects in the run are queued again”. D5's retry is at the next revision or `run --all`, not an immediate unbounded sequence of failed starts. Brief checks (1) and (2).

**Failure:** Attribution searches every `vitest.projects` entry and takes the first matching setup path. It never restricts candidates to the projects of `specs`. With projects `a` and `b` both configuring `./setup.ts`, a run containing only `b` is attributed to `a` if `a` comes first. `failStartup` blocks `a`, creates its failure, and requeues `b` as an unaffected project. Every newly created Vitest instance repeats the same failure at the same revision.

**Probe:** Two inline projects share one always-throwing setup. In the scheduler fixture, `a` includes no test files and `b` includes one passing test. Start the real scheduler at revision zero. A wrapper lets five adapter runs execute, then substitutes a plain crashed report to stop the probe safely. The setup call log has five entries. Relevant output:

```text
run 1: files [b/case.test.ts], startupFailure.projects [a], crashed, 0 completed
run 2: files [b/case.test.ts], startupFailure.projects [a], crashed, 0 completed
run 3: files [b/case.test.ts], startupFailure.projects [a], crashed, 0 completed
run 4: files [b/case.test.ts], startupFailure.projects [a], crashed, 0 completed
run 5: files [b/case.test.ts], startupFailure.projects [a], crashed, 0 completed
known_states: setup [a] setup.ts = fail
revision: 0
```

The independent adapter probe with both projects listing the file but requesting only `b` also returns `startupFailure.projects: ["a"]` on both calls.

**Worker-sized fix:** Resolve named setup ownership only among projects actually requested by this run. Handle a setup path shared by requested projects without choosing an arbitrary owner; if attribution is ambiguous, use the run-project fallback. Add a scheduler regression with two projects sharing setup and only the later project queued. It must stop after one failed start, block the actual run project, and retry only after an explicit retry trigger.

### B4. Proven: a successful setup stays failed when the later test run starts but completes no file

**Location:** `src/core/scheduler/tiers.ts:497`.

**Contract:** D6: the setup check “becomes `pass` when a later run of the project starts”. Brief check (4) repeats this requirement.

**Failure:** The set named `started` is derived solely from `report.completedFiles`. Completion is stronger than starting. A retry that successfully runs global setup, then times out in a test without completing its file, has an empty completed list. `ledger.setups.pass` therefore leaves the old setup failure current. Status and Stop continue counting a setup failure that has already recovered.

**Probe:** One setup appends to its call log, throws on its first invocation and returns on its second. Its sole test awaits a never-resolving promise with a 60-second Vitest test timeout. The test writes a fixture-local marker before it waits. Use scheduler `runner.timeoutMs: 5000`, finish the failed baseline, then request `run --all` and wait for idle.

```text
setup calls: 2
test body started: true
baseline: crashed, startupFailure.projects [""], 0 completed
retry: timed-out, no startupFailure, 0 completed
known_states: setup setup.ts = fail
```

The later setup returned successfully; it is the test that never finished.

**Worker-sized fix:** Carry evidence that each project's execution started past global setup through the runner report, and clear the setup check from that evidence even when its tests later time out or crash. A reporter module-start signal can distinguish startup from successful file completion; do not treat an aborted-before-start run as recovery. Cover the failing-setup, successful-setup, hanging-test sequence and assert one `FAIL -> PASS` setup transition with zero remaining setup failures.

## Should-fix

None.

## Nits

None.

## What fits

- **D4 and D5, ordinary rejection:** `execute` preserves the thrown Error, `startupFailure` detects no reported modules/tests, and the ordinary rejection branch drops and closes its Vitest instance under `hold.exclusive`. Startup reports carry the run's requested files. `failStartup` blocks the failed project's queued/tier files, removes forced queue entries too, and preserves already-current files. Unaffected projects are requeued. The rejection edge cases and attribution ambiguity are B1 to B3.
- **D6 and D8, storage:** `StateSink.setupOutcome` writes `known_states` and transitions in the ledger transaction after retirements. It never calls `store.results.putMany` and the setup has no test-file key of its own. D8 inheritance reads keyed result rows, so it has no setup outcome to inherit. The codec accepts `setup`; the identity includes kind, project and setup path. `SetupFailures.restore` reloads failing setup states at baseline and an ordinarily completed later project clears them. B4 concerns evidence of starting rather than that persistence mechanism.
- **D7 and 005 counts:** `countChecks` and `checkPartsText` keep tests, file checks and setups separate. Status, delta titles, baseline/overflow renderers and collapsed still-failing counts use these shared functions. `readVerdict` adds setup failures for all projects or the selected files' projects; `failureCount` includes them. Header/snapshot per-validity counts skip setups. Stop and deny read the same known-state failures and Stop's current-failure policy includes a failed setup. The remaining defect in those views is B4's uncleared input state.
- **001-361 bounds:** Startup errors use the existing `toCheckError`: at most three cause links, first-line messages capped at 200 characters, codes retained. The known-state summary uses `describeFailure` and its 300-character cap. The run log preserves the richer error and cause text. No separate unbounded delivery formatter was added.
- **Other known-state readers and 001-373:** `why` can find setup checks from known states and round-trip their names. The ordinary setup path does not appear under a listed test-file key, so bootstrap/file refresh, wait coverage and slow-file grouping do not acquire it as a test. Review of 001-373's retained-wording paths (`checks.ts`, `delivery/format.ts`, `delivery/collapse.ts`, `cli/verdict.ts`, and command references) found no additional kind switch rejecting `setup`; the additive `global setup` count is provided by the shared formatter. Keep file-level load versus hook/setup count wording in 001-373's separate scope.
- **Test scope:** The added four tests exercise name round-trips and the real adapter/scheduler/store/delivery seams for a setup that throws once, edit-triggered recovery, explicit-checkpoint recovery and daemon restart. They lack the four edge scenarios above. Incidental a8-load-hold changes consistently use the 600-second bound and the explicit slow-run bypass; build regeneration left all committed plugin bundles unchanged.

## Inputs for the fix wave

1. Repair rejection lifetime first (B1 and B2): `RunExecution.rejected` must survive any end-reason mapping; cleanup must run independently of diagnostic conversion. Keep the existing 1-second cancellation grace and 5-second forced grace. Normalize thrown values before `toCheckError`.
2. Repair attribution (B3) against `specs` before scheduler blocking. The interface remains `StartupFailure { projects, testFiles, setupFile, error }`; every blocked project must be part of this run. Preserve requeue of genuinely unaffected projects and remove all queued forced entries for a failed project. Prove exactly one failed start per revision/checkpoint for a persistently failing shared setup.
3. Carry a separate started-project signal for B4 from reporter to `RunReport`, composite merge and `recordTier`. Clear the worktree's setup outcome through `ledger.setups.pass` before failing any fresh startup outcomes, and persist it with the normal ledger transaction. A completed file is sufficient but not necessary evidence. A run cancelled before starting supplies no evidence.
4. Do not add setup outcomes to keyed results, claims, D8 inheritance or per-validity test counts. Retain restart restoration, bounded diagnostics and the 005 formatter seam. If rejection and attribution fixes touch the same runner files, dispatch them to one owner or sequentially; a second worker can own the started-project/report/scheduler seam with an agreed report field.
5. Re-review the four blockers and inspect the delta. The ordinary storage, counting and restart paths above need no redesign. Run the four targeted regressions before one clean independent full suite and verify bundle drift after rebuilding.
