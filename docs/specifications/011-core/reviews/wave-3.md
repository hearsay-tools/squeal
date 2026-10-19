# 011 wave 3: cand/0.1.223 review

**FAIL 79f1d5febdcfa1ceac6afe2c65f46ffb92dd9433**. One proven blocker, one proven non-blocking should-fix, zero nits. Reviewed 2026-10-19, W2 of `tasks/wave-3.md`.

## Verification output

Pinned candidate and range: `origin/main..79f1d5febdcfa1ceac6afe2c65f46ffb92dd9433`; local `origin/main` was `9f068159635c07e94dfa10cbe0a644955446f11d`. HEAD matched the pin. `git status --porcelain=v1` was empty before installation, after build, and after the independent suite. All commands below exited 0 at that clean candidate, before this review file was written.

```text
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
```

```text
$ npm run lint
> squeal@0.1.223 lint
> biome check .

Checked 1464 files in 688ms. No fixes applied.
```

```text
$ npm run typecheck
> squeal@0.1.223 typecheck
> tsc --noEmit
```

```text
$ npm run build
> squeal@0.1.223 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.223 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
```

`git diff --exit-code` and `git status --porcelain=v1` after build printed nothing and exited 0. All four committed plugin bundles stayed unchanged.

The independent full run took the host lock once, with four outer workers, as the reviewer gate requires. The one-minute load was 8.76 at start, was observed as high as 78.13 during the run, and was 12.82 when the command finished (24 CPUs). No file failed this gate, so no isolated gate-failure rerun was needed.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/9d7a74d8-2165-4002-90ab-67b845014791

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/9d7a74d8-2165-4002-90ab-67b845014791/test/fixtures/scheduler/.tmp/3fb16216-f54d-45f2-9744-647b6df05395/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/9d7a74d8-2165-4002-90ab-67b845014791/test/fixtures/scheduler/.tmp/a3ecf260-5272-4347-bde8-bf88d5f1a710/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2030623
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  736 passed | 1 skipped (737)
      Tests  6305 passed | 10 skipped (6315)
   Start at  17:58:57
   Duration  996.03s (tests 98%, import 2%)

    Isolate  737 workers spawned · ~148ms startup each (spawn + environment, per file)
             at least ~27.07s faster with isolate: false — reuses workers across files instead of one per file
```

Separately, Squeal's baseline at revision 0 reported the two recorder-fidelity failures named in the brief: `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Both passed in this independent gate. It also observed `test/scheduler/backlog-wall.test.ts:105` timing out at 5 s/load 63.53, `test/watcher/parcel-root.test.ts:212` timing out at 5 s/load 54.23, and `test/daemon/busy-edit.test.ts:127` taking 1308 ms against 1000 ms. Each of those three later recovered under the same inputs in Squeal, and each passed this gate. These are verification observations, not additional wave findings. Squeal's checkpoint was not substituted for the independent run.

## Blockers

### B1. Proven: one lane is not one concurrently scheduled runner part

Locations: `src/core/daemon/composite-runner.ts:114`, `src/core/scheduler/tiers.ts:178`, `src/core/daemon/node-test-runners.ts:145`, `src/core/daemon/pytest-runners.ts:169`.

C4 step 5 says the tier takes “one per worker it will run with” and bounds its estimated wall time by 120 s, or half the runner timeout. The research's recommendation and done-when 7 carry that bound into an edit's wait behind node:test. The new composite width hook assumes “one lane, so one owner's files.” A lane is keyed by adapter name (`composite-runner.ts:91`), however, and both daemon runner factories create one adapter per configured project with the same name. A tier can contain several node:test projects, or several pytest projects. The composite awaits those owners **in sequence** (`composite-runner.ts:125`), so their workers cannot fill one shared round.

Concrete failure: eight node:test projects with one 60 s file each, `runner.tierSize = 4`, sufficient capacity, and unchanged known durations. The selector takes five files: `300 / 4 + 0.75 × 60 = 120 s`. Those five owners run serially for 300 s. Only one worker is busy, although the tier holds/states a width of four. An edit to a file in this lane just after the tier starts waits about 300 s before its own run, rather than `max(120 s, 60 s)`. This is deterministic runner topology, not an unknown duration, slowdown, or process-start allowance. The prior serial selector did not make this parallelism assumption.

A throwaway probe outside the worktree used the candidate's actual `BacklogWall` and `createCompositeRunner`, eight same-name adapters with distinct project ownership, each reporting the same 1 s duration it slept. At `B = 2 s`, `W = 4`, it printed:

```json
{
  "lanes": ["node-test"],
  "selected": 5,
  "estimateMs": 2000,
  "reportedMs": 5000,
  "elapsedMs": 5005,
  "maxActive": 1,
  "events": [
    "start nt0", "end nt0", "start nt1", "end nt1",
    "start nt2", "end nt2", "start nt3", "end nt3",
    "start nt4", "end nt4"
  ]
}
```

The probe took no real pool permits and used no user store or session. Its timing corroborates the strictly ordered start/end trace; the failure does not rely on host speed. Pytest has the identical factory/composite boundary; the experiment exercised the node:test-shaped composite, not Python processes.

**One-worker fix:** preserve the sequential runner-part boundary when selecting a backlog tier. A conservative repair selects only one owning runner part per backlog tier, then applies the existing round and wall rule within it, stopping at the next owner rather than skipping it; alternatively explicitly budget sequential parts separately, without treating their idle workers as a common round. Carry the same boundary into grant trimming and lease demand. Keep edit ordering, slow tiers and the single-flight-per-lane rule. Add a scheduler/composite regression with multiple same-name project adapters and fixed durations, showing that serial parts cannot consume one parallel round, plus an edit-wait case. Do not fix this by enabling extra concurrent lanes without a separate spec decision.

## Should-fix

### S1. Proven: the grant-race test does not assert the ordered prefix it promises

Location: `test/scheduler/backlog-wall.test.ts:58` to `:63`.

Research done-when 3 requires “the started tier is the prefix that fits at the grant, the rest stays queued in order.” The test checks the first tier's **length**, its grant, and the union of all paths. It would pass if the trimmed prefix contained different files, if the tail were reordered, or if paths ran twice while the same set was eventually covered. Source inspection shows the current `splice` retains the prefix and leaves the tail queued; this is a coverage gap, not a demonstrated product break, and does not block.

**One-worker fix:** assert the first tier's paths equal the expected shortest-first prefix and the flattened later paths equal its exact remaining suffix. Assert the held pool mark's demand/grant while the runner is gated, as the sibling test currently checks `RunOptions.workers` rather than the published demand.

## Nits

None.

## What fits

- `BacklogWall` implements one round, then `sum / W + (1 - 1/W) × longest`, with unknown durations as zero, and tracks the narrowest selected file's width. The timeout cap remains `min(120000, runner.timeoutMs / 2)`. Single-runner-part tiers fit the amended rule.
- `offer` and `acquire` share the same `#share` arithmetic. The offer only reads marks and local lease state; it takes no permits, publishes no demand and creates no claim. Actual acquisition still accounts for occupied permits and older waiters, so its smaller grant is handled separately.
- Acquisition precedes `startTier`'s transaction. Waiting for capacity returns before running phases/claims are written. A lower grant replays the same rule over the picked prefix; the untouched queue retains the tail. `startTier` shrinks the lease after the transaction's last lookups, and the `finally` returns it when no tier starts.
- For one node:test or pytest runner part, `tierWidth` reports live `runner.tierSize` and the request/`widthLease` cap grant demand at `min(files, runner.tierSize)`. The recovering runner, composite, after-run, and slow-instance wrappers all forward the new hook. B1 is the multiple-part exception.
- Vitest's reported width uses the original project ceiling and the existing run-width function: offer 23/project ceiling 4 gives 4, offer 1 gives 2, and an explicit ceiling of 1 stays 1. The run and the reported width use the same ceiling source.
- Edit tiers retain the existing size, duration-sharing and fairness code paths and take no capacity lease. Slow selection is unchanged. The existing Vitest cancellation test still exercises a 200-file tier. Timeout splitting and stability/result-recording boundaries are unchanged.
- The seven research done-when cases are mapped to tests in `tasks/001-366/notes.md`: heavy width 23; width 4 and the bound; a smaller actual grant; real Vitest project ceilings; node:test width and a second lane; 600 light/unknown files; and real node:test edit latency plus existing Vitest cancellation. The half-timeout test replaces the serial-duration assertion correctly. The claimed red-on-main cases match the old serial selector by inspection; I did not rerun the whole main suite or claim a new main-tree red measurement. The multi-project seam in B1 is absent from this coverage.
- Released `squeal--v0.1.222` has `KEY_FORMAT_VERSION = 13`; candidate uses 14. The source guard verifies the new hash. Rebuilding all four plugins produces no tracked changes, and version 0.1.223 is consistent with the candidate release.
- The research explicitly leaves Vitest `sequence.groupOrder` modelling open. That documented open question is not a second finding here. B1 concerns the unaccounted composite runner-part barrier instead.

## Inputs for the repair and next wave

1. Repair B1 before landing this candidate. Own the scheduler selection/trim boundary, composite runner-part identity if needed, corresponding tests, and worker notes. The coordinator owns any spec clarification and the release/key re-pin.
2. Retain `offer(want)` → pick within the real execution boundary → `take(min(files, usable width))` → replay at a smaller grant → `startTier` → `shrinkTo(startable files)` → run → release. Never claim keys while waiting for capacity. Node:test and pytest demand remains at most `runner.tierSize`; slow and edit behavior remains unchanged.
3. Retain B = `min(120000, timeoutMs / 2)` (120000 when unbounded), the mandatory first round, unknown duration zero, Vitest ceiling/floor behavior, C4 queue priority, timeout caps, and the transaction's second claim/result check.
4. Fold S1 into the repair's tests. The bounded re-review should verify B1, inspect the repair delta and the regenerated bundles/key pin, and preserve the settled single-part behavior above.
5. Streaming lanes (011-21/001-381) remain separate research. This review authorizes no per-file storage, extra lanes or interruption change. The coordinator still needs to update the running board row when this candidate eventually lands; it is correctly running at review time.

## Re-review

**FAIL dc3135bc00ce8a6ce9457ef28d9494443c9eea13**. One proven blocking remainder of B1 (R1 below), zero new should-fix items, zero nits. S1 is closed. Reviewed 2026-10-19, W2r, bounded by the first review and `tasks/wave-3.md` W2r. Repair range: `79f1d5fe..dc3135bc`.

### Verification output

HEAD exactly matched the supplied pin. The worktree was clean before installation, after build, and after the focused checks and probes, before this appendix was written. `npm ci`, lint, typecheck, build, and the three-file focused run below all exited 0 on that clean candidate. Rebuilding all four plugin bundles left no tracked changes.

```text
$ git rev-parse HEAD
dc3135bc00ce8a6ce9457ef28d9494443c9eea13
$ git status --porcelain=v1
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

$ npm run lint
> squeal@0.1.223 lint
> biome check .

Checked 1461 files in 488ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.223 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.223 build
> tsc -p tsconfig.build.json && npm run build:plugin

> squeal@0.1.223 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts

$ git diff --exit-code
(no output)
$ git status --porcelain=v1
(no output)

$ npx vitest run test/scheduler/backlog-wall.test.ts test/daemon/tier-width.test.ts test/keys/key-format.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/301d425b-3b64-429a-9671-3b0a35bb9513

 Test Files  3 passed (3)
      Tests  37 passed (37)
   Start at  18:33:03
   Duration  9.52s (tests 55%, transform 39%, import 7%)
```

**Full-suite provenance:** W2r explicitly makes a repeat independent full run conditional on reason to doubt the coordinator's gate on this SHA (736 files passed, one skipped, 803 s). No repeat was run. The repair changes a narrow estimator seam, the focused checks pass, and R1 is an uncovered input case, not evidence that the reported full-suite result is inaccurate. A repeat of the unchanged suite would not discriminate R1. The coordinator's reported gate is supplied evidence, not a new independent result from this reviewer. No Squeal checkpoint replaces it here.

**B1 regression red/green:** The focused run above is green at the candidate. In an isolated scratch copy of candidate `src/`, `test/`, package and config files, with the same installed dependencies, I replaced only `src/core/scheduler/backlog.ts` with its `79f1d5fe` contents. The candidate regression then failed as intended:

```text
$ npx vitest run test/scheduler/backlog-wall.test.ts -t 'sums the estimates of parts' --maxWorkers=4
FAIL test/scheduler/backlog-wall.test.ts:120
AssertionError: expected [ 5, 3 ] to deeply equal [ 2, 2, 2, 2 ]

 Test Files  1 failed (1)
      Tests  1 failed | 6 skipped (7)
   Duration  1.74s
(exit 1)
```

That mutation was never made in the candidate worktree. The additional R1 probe below used restored candidate sources in scratch and was deleted after inspection. Its failing assertion is evidence of a missing case, not a failure of a committed test or a claim that the candidate's suite was red.

### Blocker

#### R1. Proven: B1 remains when C4 order returns to the first part after another part joined

Locations: `src/core/scheduler/backlog.ts:93` and `:94`; reached by `src/core/scheduler/tiers.ts:180` and its grant-trim replay at `:204`. This is inside the repair, in B1's sequential-part budgeting and first-round exception.

The eight-distinct-owner case from B1 is repaired, but the first part's unconditional round can resume after another part has already consumed budget. `firstRound` asks only whether this is the first part and its count is below its width. It does not account for another serial part already being selected, and bypasses the whole summed estimate at line 94.

Concrete input, all in the same node:test lane, `runner.tierSize = 4`, sufficient capacity, known durations, no edit-caused work:

| C4 order | Owner | Last-known duration |
| --- | --- | --- |
| 1 | A | 60 s |
| 2 | B | 60 s |
| 3 | A | 100 s |

At B = 120 s, A's first file is taken unconditionally; B's first file fits the sum (60 + 60 = 120). A's second file is then admitted unconditionally because A's count is still below four. The resulting estimate is `160 / 4 + 0.75 × 100 + 60 = 175 s`. The composite actually runs A's two files together (100 s) and B's file afterward (60 s), for 160 s even with perfectly accurate known durations and no startup overhead. Its longest file is 100 s, so both exceed C4's stated `max(120 s, its longest file)` bound and the research's done-when 7 latency premise. This tier contains two serial parts, so it is not the one-round-only exception of a single part.

Two cheap checks independently establish selection and execution. The scheduler uses only its fixture's private store and permit directory; the composite probe takes no permits. Neither uses a user store or session:

1. A throwaway test uses the candidate `wallSide` scheduler fixture, durations `[600, 600, 1000]`, `hostSlots: 4`, `timeoutMs: 2400` (B = 1200 ms), width four, and part B only for `fileName(1)`. It expects tier sizes `[2, 1]`, preserving C4's prefix. It fails on candidate sources:

   ```text
   $ npx vitest run test/scheduler/w2r-first-round.test.ts --maxWorkers=4
   {"selected":[["test/f00.test.ts","test/f01.test.ts","test/f02.test.ts"]]}
   AssertionError: expected [ 3 ] to deeply equal [ 2, 1 ]
    Test Files  1 failed (1)
         Tests  1 failed (1)
      Duration  2.30s
   (exit 1)
   ```

2. An inline probe imports the candidate's actual `BacklogWall` and `createCompositeRunner`. Two same-name adapters own A and B, with those three files. Each adapter sleeps for the maximum duration of its selected files and reports that duration, matching one parallel round. The estimator selects by the composite's actual `tierWidth` and `tierPart` hooks at the same scale, then the composite runs the selection:

   ```json
   {
     "budgetMs": 1200,
     "width": 4,
     "selected": ["A/a1", "B/b1", "A/a2"],
     "parts": ["0:", "1:", "0:"],
     "summedEstimateMs": 1750,
     "longestMs": 1000,
     "reportedMs": 1600,
     "elapsedMs": 1602,
     "events": ["start A", "end A", "start B", "end B"]
   }
   ```

The trace and durations establish a serial-part selection error, not a plausible host-speed race. This reopens B1's same scheduler/composite boundary; no settled unrelated behavior is re-prosecuted.

**One-worker fix:** stop granting the unconditional first-part round once another serial part has joined, or conservatively keep the tier within its first owner. Every subsequent pick must respect the sum of the parts' estimates; keep C4 order and stop at the first non-fitting file. Preserve the complete first-round allowance for single-part tiers, including a round whose files exceed B. Exercise A/B/A selection, a first part over B, single-part behavior, and the same replay after a smaller grant. Use the actual same-name composite seam in a regression as well as the estimator/selector. Do not add lanes or change edit, slow, claim, or completion behavior.

### Closed and settled

- B1's hook plumbing is present: `RunnerAdapter.tierPart` names sequential parts; the composite prefixes the owning adapter's index and preserves any nested part; recovering, after-run and slow-instance wrappers forward it. Both initial selection and a smaller-grant replay pass it to `BacklogWall`. The former eight-one-file-project counterexample now selects `[2, 2, 2, 2]` at B = 2 s. R1 is the remaining first-round interaction, not missing hook propagation.
- S1 is closed: the grant-race test asserts the first tier's exact shortest-first prefix, the exact remaining suffix (including order and multiplicity), and the held mark's `grant: 5` and `want: keep` while the runner is gated. This is stronger than the former length/set assertions. The candidate focused run passes it.
- For absent or constant `tierPart`, the estimator's one-entry map reduces to its previous count, sum, longest and narrowest-width rule. The comparison uses the same prospective width and sum. The focused suite retains heavy first-round, light/unknown, half-timeout, single-part grant trim and demand checks. This repair adds no edits to pool arithmetic, claim ordering, edit/slow selection or result barriers. Those first-review conclusions stand.
- `KEY_FORMAT_VERSION` remains 14, the unreleased candidate's value, against released 13 at `squeal--v0.1.222`. Its new pin is `156f4319405276c35ece1ea65c36847656fb43413dcc154370bbb1e83c1a8fe5`; the candidate key guard passes. All four committed bundles reproduce from the tree with no diff. A further guarded repair will require another re-pin and rebuild before the next gate.

### Should-fix, nits, and later inputs

No new should-fix items or nits. No findings outside the repair were added. Preserve the first review's settled behavior and downstream inputs. Dispatch R1 within `backlog.ts`, its selection/trim tests and the composite regression; the coordinator owns the key re-pin, bundles and any clarification of C4's first-round exception. The streaming-lane work remains separate. This is the second FAIL; `docs/process.md` step 6 sends that decision to the human through the coordinator.


## Third round

**PASS d8394cdde2c5bdc51d6156435439ede4ac7bf7f5**. Zero blockers, zero should-fix items, one proven non-blocking nit. R1 is closed. Reviewed 2026-10-19, W2r2, the human-approved third round bounded by `tasks/wave-3.md` and Re-review R1 above.

### Verification output

HEAD exactly matched the supplied pin. The worktree was clean before installation, after build, and after the focused checks and scratch experiments, before this appendix was written. The requested delta is `4b8a12ae..d8394cdd`: it adds the scheduler regression, regenerated bundles and the brief. R1's source repair (`60d201dc`) already precedes `4b8a12ae`; I also compared `dc3135bc..d8394cdd` to inspect that repair and the key re-pin. No candidate source or test was edited during review.

All of the following candidate-tree commands exited 0:

```text
$ git rev-parse HEAD
d8394cdde2c5bdc51d6156435439ede4ac7bf7f5
$ git status --porcelain=v1
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
> squeal@0.1.223 lint
> biome check .

Checked 1461 files in 613ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.223 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.223 build
> tsc -p tsconfig.build.json && npm run build:plugin

> squeal@0.1.223 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts

$ npx vitest run test/scheduler/backlog-wall.test.ts test/daemon/tier-width.test.ts test/keys/key-format.test.ts --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/68f2e914-709f-4c3a-941c-05924dd2f33f

 Test Files  3 passed (3)
      Tests  39 passed (39)
   Start at  19:13:14
   Duration  4.45s (tests 56%, transform 37%, import 5%)

$ git diff --exit-code
(no output)
$ git status --porcelain=v1
(no output)
$ git diff --check
(no output)
```

**Full-suite provenance:** no repeat independent full run. The supplied coordinator gate on `29320d5f` reports 736 files passed, one skipped, 6308 tests passed, 801 s, load 2 to 17 on 24 CPUs. `d8394cdd` adds only the review brief to that code. This narrow condition and test addition give no reason to doubt that gate; the discriminating checks below address R1 directly. The supplied gate is not a fresh full-suite result from this reviewer. No Squeal checkpoint substitutes for it.

Squeal's separate `status --wait 60000` returned on quiet at revision 0, with zero known failures but 720 test files still pending in its baseline (200 running, 520 queued). That incomplete baseline is not evidence of a passing suite. The clean-tree focused run above is this reviewer's candidate test evidence.

### R1 closed

- At `src/core/scheduler/backlog.ts:95`, the first-round exception now requires both the first part and `#parts.size <= 1`. A second part must fit the summed estimate before it joins; once it joins, a return to the first part also has to fit. A rejected file never mutates the map. This closes the A/B/A bypass while retaining the full round for a single part, even above B.
- The committed scheduler regression at `test/scheduler/backlog-wall.test.ts:133` uses durations `[600, 600, 1000]`, B = 1200 ms, W = 4 and owners A/B/A. It selects `[2, 1]` in the candidate run above. Both initial selection and the smaller-grant replay still call the same `BacklogWall.take` with the runner's part and the width at the relevant grant (`src/core/scheduler/tiers.ts:180`, `:204`). Queue order and the tail splice are unchanged.
- Red/green was checked in an isolated scratch copy with the candidate test and dependencies. Replacing only `src/core/scheduler/backlog.ts` with its `dc3135bc` contents makes the committed scheduler regression fail:

  ```text
  $ ./node_modules/.bin/vitest run test/scheduler/backlog-wall.test.ts -t 'selects A, B' --maxWorkers=4
  FAIL test/scheduler/backlog-wall.test.ts:142
  AssertionError: expected [ 3 ] to deeply equal [ 2, 1 ]
   Test Files  1 failed (1)
        Tests  1 failed | 8 skipped (9)
     Duration  4.33s
  (exit 1)
  ```

  Restoring the candidate estimator, the complete backlog-wall file plus three scratch probes passed: two files, 12 tests, 5.34 s. The controlled old-source failure is experimental evidence, not a failed candidate verification command.
- The three scratch probes exercised the real scheduler fixture with its own temporary store and permit directory. Single-part durations `[2000, 3000, 4000, 5000, 6000]`, W = 4, B = 1200 ms retain the entire over-budget first round, then the remaining file (`[4, 1]`). Giving only the last file to B also yields `[4, 1]`, so the over-budget round cannot admit another part.
- The third probe forces the smaller-grant replay: durations `[600, 600, 1000, 1000]`, owners A/B/A/A, B = 1700 ms, offer 23 and 20 permits occupied without a mark. All four fit at the offer (summed estimate about 1670 ms). Acquisition grants three workers; at that width, A/B/A would estimate 1800 ms. The candidate starts exactly `f00, f01`, then runs exactly `f02, f03` as the suffix, preserving order and multiplicity. With only the old estimator substituted, the same probe instead starts all four with three workers and fails the prefix assertion. After restoring candidate source, all three probes passed again:

  ```text
  $ ./node_modules/.bin/vitest run test/scheduler/w2r2-probe.test.ts -t 'replays A B A' --maxWorkers=4
  {"replayFirst":["test/f00.test.ts","test/f01.test.ts","test/f02.test.ts","test/f03.test.ts"],"workers":3}
  AssertionError: expected [ 'test/f00.test.ts', …(3) ] to deeply equal [ 'test/f00.test.ts', …(1) ]
   Test Files  1 failed (1)
        Tests  1 failed | 2 skipped (3)
     Duration  1.64s
  (exit 1, old estimator only)

  $ ./node_modules/.bin/vitest run test/scheduler/w2r2-probe.test.ts --maxWorkers=4
   Test Files  1 passed (1)
        Tests  3 passed (3)
     Duration  3.65s
  (exit 0, restored candidate estimator)
  ```

  The scratch copy and probes were deleted before committing. The candidate worktree stayed clean throughout these experiments.
- `KEY_FORMAT_VERSION` remains the unreleased 14 against released 13 in `squeal--v0.1.222`. Its new hash is `0e1b67d720a9cddb5891ab0b1fc5be8a48c89cce4569a701461d90a07cc7cd78`; the guard passes. All four committed plugin bundles reproduce from the candidate with no diff. No version, pool arithmetic, claims, edit/slow selection or completion behavior changed in this repair. The first review and re-review's settled conclusions stand.

### Blockers and should-fix

None. R1 needs no further repair. No finding outside R1 was opened.

### Nit for a later row

**N1, proven, non-blocking:** `test/scheduler/backlog-wall.test.ts:125` gives incorrect arithmetic in the new explanatory comment. A single 60 s file's estimate at W = 4 is `60/4 + 3/4 × 60 = 60 s`, so A then B is `60 + 60 = 120 s`, and the attempted A/B/A tier is `115 + 60 = 175 s`. The comment says `45 + 45` and `115 + 45`. The assertions and selection are correct; this does not break R1 or the row's done-when. A one-worker correction changes only those two comment values.

### What fits and inputs for the next wave

R1 is closed at the supplied pin. Retain the first-part-only round, summed sequential-part estimate, C4 prefix order and the same estimator for selection and grant replay. Single-part rounds above B, the lower-grant prefix/suffix behavior, key pin and bundle reproducibility were checked here; do not re-prosecute them without a new change. No product fix wave is required by this round. N1 can be folded into a later test edit. The coordinator owns the landing decision; streaming lanes remain separate.
