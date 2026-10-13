# Wave 13ax: 001-317 landing (review row 001-321)

## Verdict and verification

**FAIL `8ac219c82c4b8f1ce83124c8b2d874ab7164c096`**. One proven blocker; zero should-fix findings; zero nits. Range: `691fe1d3..8ac219c8`. Review is against the clean candidate, not the later findings commit. No product or board edits, and no eval sessions.

Verification output opens this report. `git rev-parse HEAD` returned the exact candidate:

```text
8ac219c82c4b8f1ce83124c8b2d874ab7164c096
```

`npm ci` completed (exit 0):

```text
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
```

npm also warned about its unknown `store-dir` environment option and uncovered install scripts for `@parcel/watcher@2.6.0` and `esbuild@0.28.2`. Installation and subsequent gates were not prevented.

`npm run lint` (exit 0):

```text
> squeal@0.1.145 lint
> biome check .
Checked 975 files in 524ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
> squeal@0.1.145 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
> squeal@0.1.145 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.145 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

`git status --short` after the build was empty; `git diff --exit-code` returned 0. Both committed plugin builds reproduce. npm's `store-dir` warning also appeared on these commands.

Independent full-suite gate, as assigned:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
```

Exit 1. Complete gate output:

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/8dc4d0c7-70cd-4b95-9738-13add35593e6

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/8dc4d0c7-70cd-4b95-9738-13add35593e6/test/fixtures/scheduler/.tmp/7d4033a5-4b88-4f77-97c4-c66516e7d0fa/main/.git/worktrees/staged/gitdir
 ❯ test/harness/stop-slow-boundary.test.ts (20 tests | 1 failed) 9980ms
   ❯ the waiting Stop at its read boundaries, claude-code (13am) (10)
     × B2: a newer revision's pass after the move ends the turn silently 5006ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/8dc4d0c7-70cd-4b95-9738-13add35593e6/test/fixtures/scheduler/.tmp/7d6c120b-bc76-40cd-bcfe-fef282b85cc7/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 1244390
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/stop-slow-boundary.test.ts > the waiting Stop at its read boundaries, claude-code (13am) > B2: a newer revision's pass after the move ends the turn silently
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/stop-slow-boundary.test.ts:76:3
     74|   });
     75|
     76|   it("B2: a newer revision's pass after the move ends the turn silentl…
       |   ^
     77|     const r = await repo(harness, { requireSlowSuite: true, slowWaitMs…
     78|     const landed = setTimeout(() => landSlow(r, "pass", "slow2"), 400);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 456 passed | 1 skipped (458)
      Tests  1 failed | 3842 passed | 10 skipped (3853)
   Start at  16:42:29
   Duration  753.87s (tests 97%, import 2%, transform 1%)

    Isolate  458 workers spawned · ~225ms startup each (spawn + environment, per file)
             at least ~25.59s faster with isolate: false — reuses workers across files instead of one per file
```

The sole failure is a 5000 ms timeout at `test/harness/stop-slow-boundary.test.ts:76`, in a Stop-on case. That test and the Stop-on implementation are unchanged in the range. A focused rerun at the same clean candidate passed for both harnesses (exit 0):

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4 test/harness/stop-slow-boundary.test.ts -t "a newer revision's pass after the move ends the turn silently"
```

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/8dc4d0c7-70cd-4b95-9738-13add35593e6


 Test Files  1 passed (1)
      Tests  2 passed | 18 skipped (20)
   Start at  16:55:14
   Duration  1.67s (tests 58%, transform 35%, import 7%)
```

The full gate remains recorded as failed. A timing effect is plausible, but its root cause is not proven; this unchanged test is outside the review range and adds no wave finding.


Discriminating probe on the same clean candidate used a temporary test and config outside the worktree, with the repository's real scheduler, real Vitest adapter and SQLite store:

```sh
env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --config /tmp/squeal-review-13ax-probe.config.mjs --maxWorkers=1
```

```text
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration  3.94s
```

The successful probe asserts the counterexample and its explicit-request control described in B1. Temporary probe sources and config were deleted before the findings commit.

## Blockers

### B1. Proven: the idle-run promise is false under `baseline.onStart: "lookup-only"`

**Changed location:** `src/core/state/slow-text.ts:125`; the same assumption is added to `docs/specifications/004-slow-suites/spec.md:70`.

001 goal 3 requires: **"Everything the agent is told is true at the moment it is told"**. D6 adds: **"Wording is factual, never imperative"**. The brief also explicitly requires the new off-line to be true in every slow-tier wait state and policy. 001 D11 permits `baseline.onStart: "lookup-only"`.

The renderer chooses its new promise solely from the absence of `tier.stopWaitMs`, including slow files classified as `notRun`. A permitted lookup-only baseline does not enqueue its missing slow files: `src/core/scheduler/bootstrap.ts:176` abandons the checkpoint rather than entering the enqueue branch. A pause does not queue them either; `SlowTier.nudge()` only pumps when `ledger.orderedSlow()` is nonempty (`src/core/scheduler/slow-tier.ts:135`). Thus this is not a load or slot delay. No automatic run is pending.

**Reproduction, verified by the probe:**

1. Start a fresh fixture with `baseline.onStart: "lookup-only"`, `slow.include: ["test/strings.test.ts"]`, and default `stop.requireSlowSuite: false`. Supply a private, free slot and load 0.
2. Start the real scheduler and register a consumer. Start and end its turn, nudge the scheduler as silent Stop does, and await scheduler idle.
3. Assert the consumer is idle and `consumersIdle(...)` is true. The adapter has zero runs, and the slow file's stored key row has `pending: null`.
4. Read the shared header. Its slow line contains both `1 not run` and **"Squeal runs them when the agent pauses"**. The promised automatic run does not happen, even though the agent has paused.
5. Call `requestSlowSuite()` and await idle: this same file runs exactly once. The runner and capacity are functional; only the automatic promise was wrong.

This misleading sentence is introduced by the candidate. Lookup-only's scheduler behavior is intentional and pre-existing, not a separate finding against it. The amendment in 004 D8 repeats the false generalization, so merely matching that literal is insufficient to meet 001 D6.

**One-worker fix:** scope the off-line's scheduling claim to queued slow work, or render a truthful alternative for unqueued misses. Preserve lookup-only behavior and the unchanged Stop-on sentence. Amend 004 D8 to the qualified wording and add a scheduler-backed regression covering lookup-only, an idle consumer and explicit-request control. The state already distinguishes `pending` from `notRun`; do not change scheduling policy to make a sentence true. Rebuild the committed plugins and follow the repository's version/key-pin rules.

## Should-fix

None.

## Nits

None.

## What fits

- **Seams:** the source change is confined to shared slow-text rendering. CLI status and both harnesses consume it. No call signature, transaction, scheduler, Stop or policy contract changes; both generated plugin trees reproduce after the build.
- **Default queued work and wait states:** `SlowTier.#trigger` uses all registered consumers idle (or absent), an explicit slow request, or an explicit full-suite request. Fast edit work remains ahead of slow work; the slot retries; the load guard spends a bounded defer budget. A pause is an idle trigger, not a promise of immediate execution. The existing state clauses still name `idle`, `fast`, `slot` and `load`, and are unchanged. B1 is an unqueued policy exception, not an objection to those waits.
- **Rendering coverage:** the changed tests check off-line wording in status and delivered registration, current and pending states, all four wait reasons and null activity, stale/never-run files, and zero listed files. They prove the literal appears, but do not test whether lookup-only schedules what that literal promises.
- **Stop-on:** its source branch is byte-for-byte unchanged at `slow-text.ts:126`. The existing test keeps the exact 90-second sentence, the 600000 ms bound and off-policy absence of `stopWaitMs`.
- **004 D8:** the candidate adds a dated inline amendment naming 001-317 and the replaced sentence. B1 requires qualifying that amendment, not adding it from scratch.
- **10,000-character delivery cap:** `MESSAGE_CAP_CHARS` remains 10000 and the formatter's budgeting path is unchanged. The new regression builds a 2000-failure delta, checks the cap and verifies that the complete slow line survives it. Existing registration and smaller-cap coverage remain in the full gate.
- **Currency and provenance:** current revision/artifact claims, source-change qualifications, stale daemon activity, attribution and consumer-view handling are unchanged. No claim of eval improvement is made; no evals were run.

## Inputs for the next wave

Dispatch one wording-and-regression repair for B1. Read `readSlowTier`/`classifySlowFiles` before choosing a conditional: `current`, `pending` and `notRun` are distinct, and `notRun` is not a promise of queued execution. A silent Stop ends the consumer turn, then nudges; the nudge does not enqueue misses. `requestSlowSuite()` explicitly queues eligible noncurrent slow files and bypasses the idle trigger, while retaining fast-work priority, load and slot rules.

Keep the Stop-on text and bound, the source/artifact provenance, and the 10000-character delivery budget. Verify default queued idle work, lookup-only unqueued misses, all published wait reasons, zero listed files, and no validating daemon without implying a live run. If policy information must be added to the shared state, keep the public shape typed and document it; a qualified generic sentence may avoid that expansion. The remaining missing evidence is a regression that tests the sentence's scheduling truth under lookup-only, rather than another string snapshot.
