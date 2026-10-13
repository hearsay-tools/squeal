# Wave 13az: second review of 001-317 after 001-323 (row 001-325)

## Verdict and verification

**PASS `c1ed4ede4b5e82779b77e361fe267d8d1372c0ca`**. Zero blockers, zero should-fix findings, zero nits. Repair range: `27bb50d2..c1ed4ede`. This re-review is bounded by B1 in `wave-13ax.md`, with the repair delta and every `stopText` branch checked. Evidence below was collected at the clean candidate before this findings file existed. No product or board edits; no evals.

`git rev-parse HEAD` returned the assigned candidate:

```text
c1ed4ede4b5e82779b77e361fe267d8d1372c0ca
```

`npm ci` (exit 0):

```text
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
```

npm warned about its unknown `store-dir` option and install scripts not yet covered by `allowScripts` for `@parcel/watcher@2.6.0` and `esbuild@0.28.2`. Neither prevented installation or verification. The `store-dir` warning also appeared on the npm gates.

`npm run lint` (exit 0):

```text
> squeal@0.1.147 lint
> biome check .
Checked 983 files in 879ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
> squeal@0.1.147 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
> squeal@0.1.147 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.147 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

`git status --short` after build was empty; `git diff --exit-code` returned 0. Both committed plugin trees reproduce.

Independent full-suite gate, as assigned:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
```

Exit 1. Complete output:

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/52ee528e-b37a-4474-bc45-0001cc7a0914

stdout | test/scheduler/backlog-tiers.test.ts > scheduler: backlog work runs in machine-wide tiers (D5, defect 25) > runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run
001-124: direct vitest run 6906 ms; baseline 14157 ms in 1 tiers; backlog after a config edit 15245 ms in 1 tiers

 ❯ test/scheduler/backlog-tiers.test.ts (4 tests | 1 failed) 106535ms
   ❯ scheduler: backlog work runs in machine-wide tiers (D5, defect 25) (4)
     × runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run 43924ms
 ❯ test/harness/stop-slow-wait.test.ts (25 tests | 1 failed) 32020ms
   ❯ Stop waits for its slow tier, codex (004 D9 as amended) (12)
     × another session in the worktree without the waiting entry keeps the old block (001-297) 13394ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/52ee528e-b37a-4474-bc45-0001cc7a0914/test/fixtures/scheduler/.tmp/b9892e5c-d924-4fde-9725-07bf40bc9e59/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/52ee528e-b37a-4474-bc45-0001cc7a0914/test/fixtures/scheduler/.tmp/76cf9930-6160-49de-a339-aafbf0d3fecf/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 787978
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/stop-slow-wait.test.ts > Stop waits for its slow tier, codex (004 D9 as amended) > another session in the worktree without the waiting entry keeps the old block (001-297)
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/stop-slow-wait.test.ts:100:3
     98|   });
     99|
    100|   it("another session in the worktree without the waiting entry keeps …
       |   ^
    101|     const r = await repo(harness, { requireSlowSuite: true });
    102|     const marked = mainConsumer(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/scheduler/backlog-tiers.test.ts > scheduler: backlog work runs in machine-wide tiers (D5, defect 25) > runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run
AssertionError: expected 15245 to be less than 13812
 ❯ test/scheduler/backlog-tiers.test.ts:89:23
     87|     expect(baselineTiers).toBeLessThanOrEqual(3);
     88|     expect(tiers.length).toBeLessThanOrEqual(3);
     89|     expect(backlogMs).toBeLessThan(2 * directMs);
       |                       ^
     90|   });
     91|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed | 457 passed | 1 skipped (460)
      Tests  2 failed | 3864 passed | 10 skipped (3876)
   Start at  18:13:38
   Duration  818.86s (tests 96%, import 2%, transform 1%)

    Isolate  460 workers spawned · ~249ms startup each (spawn + environment, per file)
             at least ~28.41s faster with isolate: false — reuses workers across files instead of one per file
```

Both failures are in unchanged code outside the repair range. The Codex Stop case exceeded its default 5000 ms test timeout (`test/harness/stop-slow-wait.test.ts:100`); the backlog assertion compares 15245 ms with a 13812 ms limit (`test/scheduler/backlog-tiers.test.ts:89`). Neither failed assertion concerns `stopText`. All changed tests and the key-format guard passed in this run. The full gate remains recorded as failed, not green.

A targeted re-check at the same clean candidate selected only those cases (the Stop case in both harnesses):

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/scheduler/backlog-tiers.test.ts test/harness/stop-slow-wait.test.ts -t 'runs a 200-file backlog|another session in the worktree without the waiting entry' --maxWorkers=1
```

Exit 0. Complete output:

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/52ee528e-b37a-4474-bc45-0001cc7a0914


 Test Files  2 passed (2)
      Tests  3 passed | 26 skipped (29)
   Start at  18:27:28
   Duration  32.66s (tests 89%, transform 9%, import 2%)
```

All three selected cases pass without changing the candidate or their timeouts. A timing effect under parallel host load is plausible; its root cause is not established. This does not turn the original full gate green. These unchanged tests are outside the repair range and add no wave finding. After both runs `git rev-parse HEAD` still returned the candidate and `git status --short` was empty.

Discriminating real-scheduler probe, also on the clean candidate:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --config /tmp/squeal-review-13az-probe.config.mjs --maxWorkers=1
```

Exit 0. Its temporary test and config were outside the worktree; it used the repository's real scheduler, Vitest adapter, SQLite store and standard cleanup. Output:

```text
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/52ee528e-b37a-4474-bc45-0001cc7a0914

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  18:15:20
   Duration  6.54s (tests 64%, transform 30%, import 6%)
```

The five cases re-ran the candidate's lookup-only regression and default pause control, then added a default miss observed before the pause, a reachable mixed pending/notRun state, and a Stop-on lookup-only state. Temporary probe sources and config were removed before the findings commit.

## Blockers

None. First-round B1 is fixed, proven by the lookup-only probe and explicit-request control below.

## Should-fix

None.

## Nits

None.

## What fits

### B1 is fixed without changing lookup-only policy

001 goal 3 requires **"Everything the agent is told is true at the moment it is told"**. D11 permits lookup-only; D5 makes a baseline lookup-only a real alternative to running its misses.

With a fresh lookup-only fixture, one declared slow file, a private free slot and load 0, the consumer starts and ends a turn, the scheduler is nudged, and scheduler idle is awaited. The probe verifies `consumersIdle(...) === true`, zero runs, and the slow file's key row `pending === null`. The line now reads:

```text
Slow tier: 1 test file; 1 not run at revision 1. Squeal has not queued them; `squeal run --slow` runs them now.
```

The assertion derives the revision from the header, rather than relying on the example's number. `requestSlowSuite()` followed by scheduler idle runs that same file exactly once and reports it current. A pause alone still queues nothing. The repair changes the sentence, not scheduling. The candidate retains this scheduler-backed regression in `test/scheduler/slow-off-line.test.ts:76`.

### Every stopText branch matches the state it describes

The shared state classifies a slow file before rendering (`src/core/state/slow.ts:79` and `:127`). Files with no checks but a nonnull key and queued/running phase count as pending; checked files with pending validity also count as pending. The branch checks `notRun`, not whether the file has ever run.

| Branch in `src/core/state/slow-text.ts` | Evidence and meaning |
| --- | --- |
| `stopWaitMs !== undefined`, lines 128–129 | Same Stop-on sentence as before. The probe supplies lookup-only with `stop.requireSlowSuite: true`, 90000 ms and one unqueued file; the line still says `Stop waits up to 1 min 30 s for them or holds the agent once`. It takes precedence over the off-policy counts. Existing status tests keep the 600000 ms cap and absence of `stopWaitMs` when off. No Stop logic or bound changed. |
| `notRun === 0`, line 131 | With the default `lookup-then-run-missing` policy and a consumer still in its turn, the real baseline miss is `{ current: 0, pending: 1, notRun: 0 }`, with zero runs. The exact landed 006-52 text remains, as shown below. Ending the turn and nudging runs the file once, then reports it current and keeps the same sentence. Existing status tests cover all four wait reasons, null activity, current files and zero listed files. |
| `notRun > 0 && pending === 0`, line 132 | Lookup-only's fresh misses are unqueued, so `Squeal has not queued them` is factual. This also holds after the mixed fixture's queued file runs and the other miss remains unqueued. An explicit request runs the remaining file. |
| `notRun > 0 && pending > 0`, line 133 | In a lookup-only fixture with two slow files, edit only one test file while the consumer is in its turn. The scheduler queues that file and leaves the other baseline miss unqueued: `{ current: 0, pending: 1, notRun: 1 }`. On pause only the queued file runs. The mixed sentence describes exactly that division; it does not promise a run for the untouched miss. |

The default pending miss's exact line, asserted by the probe:

```text
Slow tier: 1 test file; 1 pending, waiting for the agent to pause. Squeal runs them when the agent pauses; `squeal run --slow` runs them now.
```

The mixed state's exact scheduling clause, also asserted:

```text
Squeal runs the pending ones when the agent pauses and has not queued the rest; `squeal run --slow` runs them now.
```

Pending is not a claim of immediate capacity: the existing wait clauses still name idle, fast work, slot and load, and scheduling retains those constraints. The shared header still qualifies activity from a down daemon as `last reported`; the repair adds no live-run claim to that activity. Zero listed files still say that listing has not happened, without claiming any result.

### Delta, seams and the remaining done-when

- `stopText` remains internal, with no new arguments or state fields. CLI status, headers and both plugins render the same `SlowTierState`. No scheduler, transaction, Stop-hook, policy or public contract changed.
- 004 D8 now qualifies the automatic-run claim by pending versus notRun, names lookup-only explicitly, and preserves the Stop-on wording. It contains the dated 001-323 amendment and B1 reference.
- Updated status tests verify the unqueued sentence and the mixed sentence in a delivered registration and a capped 2000-failure delta. The complete slow line stays within the unchanged 10000-character delivery cap.
- Bundle changes reproduce from the sources. Manifests and bundled versions advance together to 0.1.147. Key format 9's re-pin is explicitly for the unreleased format; no scheduling or result-acceptance change is hidden in this repair.
- Test and source/artifact provenance, current-result claims, the command suffix and the Stop-on behavior settled by the first review remain unchanged. This review makes no claim about agent adoption or eval improvement.

## Inputs for the next wave

No B1 repair remains to dispatch. Preserve the seam: read the shared slow state in the caller's transaction, distinguish `pending` from `notRun`, then render it. Under the default policy a slow miss is queued and therefore pending, even before its first run; retain the exact landed sentence while 006-52 measures it. Under lookup-only a pause does not enqueue misses; an explicit `requestSlowSuite()` queues eligible noncurrent slow files, with fast-work priority, load and slot rules still in force.

Keep Stop-on's bound and fallback hold, the existing 10000-character cap, source/artifact provenance and liveness qualifications. The external probe demonstrates the default-before-pause and reachable mixed cases in addition to the candidate's persistent regression. Evals were deliberately not run; 006-52 owns the wording's measured effect, and the coordinator decides integration and release.
