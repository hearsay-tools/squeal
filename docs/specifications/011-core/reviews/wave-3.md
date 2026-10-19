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
