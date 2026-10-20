# Wave 6 review: 011-25's edit cut and 001-431's recorder

Verdict: **FAIL 2b1818e0babcd78afb65327ec946f4e423e03d90**. **2 proven blockers, 0 should-fix, 0 nits.**

Range: `d12c4e28..2b1818e0`, the supplied `origin/main` base and exact `cand/0.1.229` candidate. Scope: R3 of `tasks/wave-6.md`. No product source, board or status edits by this reviewer.

## Verification output

All repository checks below ran at the exact candidate, with a clean tracked tree. `node_modules` was absent; installed from the lockfile before running checks. The independent full run took the host's full-run lock; Squeal's checkpoint was not substituted. The coordinator's supplied 770-file/6456-test passing gate is separate evidence, not this reviewer's result.

```text
$ git rev-parse HEAD
2b1818e0babcd78afb65327ec946f4e423e03d90
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
(exit 0; npm also reported six install scripts not covered by allowScripts)

$ npm run lint
> squeal@0.1.229 lint
> biome check .
Checked 1534 files in 1531ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.229 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.229 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.229 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git status --short
(no output; all four committed plugin builds match)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/bcdc57ae-ecee-4834-83dd-419e7edea579

 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 41061ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 25399ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/bcdc57ae-ecee-4834-83dd-419e7edea579/test/fixtures/scheduler/.tmp/5600fc3a-8fd8-4c36-ab00-210f9ad3978d/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/bcdc57ae-ecee-4834-83dd-419e7edea579/test/fixtures/scheduler/.tmp/b34990f2-baee-4d1e-b5de-a57c79725130/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2642732
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2278, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +43 (pid 2302086), dispose +113, input +1137, kill +2278 (pid 2302086); the held Stop's deadline: +2000
 ❯ reached test/harness/opencode/held-stop.ts:210:27
    208|     if (gone !== null) {
    209|       const message = `before ${what}, ${gone.why}\n${timeline(b)}`;
    210|       throw gone.missed ? new Missed(message) : new Error(message);
       |                           ^
    211|     }
    212|     if (Date.now() > limit) throw new Error(`${what}: not within ${BAR…
 ❯ test/harness/opencode-dispose.test.ts:172:9
 ❯ Object.afterReply test/harness/opencode-dispose.test.ts:112:7
 ❯ runOpenCode test/helpers/opencode.ts:204:11
 ❯ squealOpenCode test/harness/opencode/real.ts:75:17
 ❯ overtaken test/harness/opencode-dispose.test.ts:99:18
 ❯ test/harness/opencode-dispose.test.ts:170:21
 ❯ ordered test/harness/opencode-dispose.test.ts:66:14
 ❯ test/harness/opencode-dispose.test.ts:168:26

 ❯ test/harness/opencode-dispose.test.ts:69:17 notice
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2070, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +91 (pid 2289822), dispose +170, input +462, kill +2070 (pid 2289822); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2032, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +33 (pid 2295873), dispose +62, input +982, kill +2032 (pid 2295873); the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 769 passed | 1 skipped (771)
      Tests  1 failed | 6455 passed | 10 skipped (6466)
   Start at  15:49:35
   Duration  1154.23s (tests 97%, import 2%, transform 1%)

    Isolate  771 workers spawned · ~174ms startup each (spawn + environment, per file)
             at least ~33.41s faster with isolate: false — reuses workers across files instead of one per file
(exit 1)
```

The locked run started at 13:49:34 UTC and ended at 14:08:50 UTC. Its one-minute host load was 37.63 at start and 27.73 at end; samples during the review reached 74.03. All candidate test files other than the named failure and skip passed, including the new cut, matcher, catch-up, handover, revision-lag, recorder and key-format coverage. The failure is a missed barrier, not a completed assertion of the old-report behavior.

An isolated follow-up of the OpenCode file also failed:

```text
$ npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=1
Test Files  1 failed (1)
Tests       1 failed | 2 passed (3)
Duration    48.27s
(exit 1)
Error: before the new turn's request, the plugin killed the held Stop at +2085,
at or after its idle deadline (+2000)
```

It exhausted all three barrier attempts before the scenario under test was established. Its first two attempts missed at +2134 and +2158 ms. This isolated file ran at 14:00:28–14:01:17 UTC with one-minute host load 74.03 at start and 62.44 at end; it was not a quiet-host control. **Unverified:** that scenario's product assertion and attribution to the candidate. This is verification context, not a wave finding or a claimed pass-alone recovery. The coordinator's supplied passing gate does not make this reviewer's gate green.

### Discriminating probes

Throwaway probes ran in a `git archive 2b1818e0` scratch copy, with this checkout's installed dependencies linked in. Candidate product sources were unchanged for the candidate probes. The two explicit revert controls changed only the scratch copy. These are reproduction evidence, separate from the clean-tree repository gate.

```text
$ npx vitest run --config probe.config.ts test/review-probe.test.ts
Test Files  1 failed (1)
Tests       2 failed (2)
(exit 1; both C4 expectations fail as described in B1)

$ npx vitest run --config probe.config.ts test/review-adapter.test.ts
Test Files  1 failed (1)
Tests       3 failed | 1 passed (4)
(exit 1; new-target adapter control passes; three B2 expectations fail)

$ # Same adapter probes, only src/runners/vitest/observe.ts reverted to d12c4e28
$ npx vitest run --config probe.config.ts test/review-adapter.test.ts
Test Files  1 passed (1)
Tests       4 passed (4)
(exit 0)

$ # Outer recorder loaded into the Vitest process, as in 001-431's brief:
$ NODE_OPTIONS='--import file://<scratch>/src/runners/observe/recorder.cjs' \
  SQUEAL_OBSERVE='{"out":"<scratch-output>","root":"<scratch>","skip":[]}' \
  npx vitest run --config fidelity.config.ts -t 'names the recorder'
Test Files  2 passed (2)
Tests       2 passed | 3 skipped (5)
(exit 0; exactly the two original fidelity cases selected)

$ # Same command, 001-431's four changed TypeScript sources reverted to d12c4e28
Test Files  2 failed (2)
Tests       2 failed | 3 skipped (5)
(exit 1; both no-recorder branches fail)
```

The fidelity config includes only `test/runners/vitest/observe-fidelity.test.ts` and `test/runners/node-test/run-reads-fidelity.test.ts`; probe configs use one worker. The archive and probes never entered the reviewed tree and were deleted before this report was committed.

## Blockers

### B1. A source first discovered by the runner loses both its namesake and its direct-importer fallback

**Proven.** `src/core/scheduler/edit-cut.ts:55`, fed by `src/core/scheduler/refinement.ts:180` before the fetched closures are applied at `refinement.ts:251`.

C4 step 4 keeps, for each changed source, “the source's namesakes among the files it re-keyed, or, when it has none, the test files the runner reports as its direct importers”. Done-when 3 requires a source without a namesake to keep **every** direct importer. R3 requires this exact cut for a small revision.

`fetchEditCut` skips a changed source unless the **old** reverse index already references it. Its runner part has fetched the new closures, but those closures are not yet in that index. `applyRunnerPart` later installs them and computes the revision's reach against the updated index. The cut still has no entry for this source, so `editWork` keeps only K direct importers and demotes the rest, its own namesake included.

Concrete case: a test imports an extensionless `../src/a` which resolves to `src/a.ts`; adding `src/a.js` makes the runner resolve that import to the new path. The old closure lacks `src/a.js`. An independent real Vitest adapter control verifies that after the add/invalidate, `affected(["src/a.js"])` names the existing test directly and its refreshed closure contains `src/a.js`, while the old closure did not.

Reproduction through the public scheduler and the existing `edit-cut-fixture.ts`:

1. Complete a baseline over seven existing test files whose mutable `imports` arrays hold `src/a.ts`. Give `test/a.test.ts` a last-known duration of 9000 ms, and six other direct importers durations `[100, 200, 300, 400, 5000, 6000]`. `tierSize` is 4.
2. Change the runner's import lists to `src/a.js`, reflecting the new resolution. Add `src/a.js` and submit its single-path watch revision with `editAndRun`.
3. The result is:

   ```text
   editPaths:    test/d0.test.ts ... test/d3.test.ts
   catchUpPaths: test/a.test.ts, test/d4.test.ts, test/d5.test.ts
   ```

   The namesake must stay an edit. Repeat with `test/behavior.test.ts` instead of `test/a.test.ts`, so no namesake exists: the same three files become catch-up, although all seven direct importers must stay edits. Both assertions fail.

This makes the agent's own test cancellable backlog work and loses the promised fallback in a repository without a naming convention. The added tests initialize every source in the stored closures before exercising the cut, so they do not catch this boundary.

**One-worker fix:** form the cut's source set using the runner's fetched closures as well as the old index, or carry enough source/reach information to finish it after those closures are applied. Include the new source's namesake and, when absent, its own direct-importer fallback; retain the extra bare-source `affected` call and its bound where needed. Do not perform new runner calls inside the apply transaction or treat unrelated added paths as sources. Add both above regressions, plus a mixed already-known/new-source case. Continue demoting only through `Queue.toCatchUp(ref, keyedAt)`, preserving other revisions' reasons and named promotions.

### B2. Recorder cleanup replaces the project's own NODE_OPTIONS and drops it from the environment hash

**Proven.** `src/runners/vitest/observe.ts:71-72`, using `src/runners/observe/runtime.ts:91`; the new `injected` value is consumed by the existing `adapter.ts:164` and `environment.ts:104` boundaries.

001 D11 Fidelity: “a verdict the project's own runner would not give, caused by Squeal's additions, is a defect to fix at its source”. C3/D3 keys the resolved Vitest config. R3 explicitly requires the no-recorder repair to leave keys unchanged and preserve runs that record.

With an outer recorder in `NODE_OPTIONS`, `unobservedEnv` returns the cleaned **inherited** options. `VitestObserver.start` now passes those as a top-level Vitest `env` option. That option overrides the root project's configured `env.NODE_OPTIONS`. It is also listed as injected, so `canonicalConfig` removes the resulting field completely. This removes a project-owned config input along with Squeal's additions.

Real adapter reproduction, observation off:

```text
inherited NODE_OPTIONS: --import file://<recorder> --conditions=outer
inherited SQUEAL_OBSERVE: {"out":"<outer>","root":"<root>","skip":[]}
vitest.config.ts: test.env.NODE_OPTIONS = "--conditions=project"
test: expect(process.env.NODE_OPTIONS).toBe("--conditions=project")

candidate result: fail
error: expected '--conditions=outer' to be '--conditions=project'
resolvedConfig.env: { BASE_URL: '/', DEV: true, MODE: 'test', PROD: false }
```

A second probe gives the config `NODE_OPTIONS: "--max-old-space-size=4096"`. The plain adapter retains that in `resolvedConfig.env`; the same config under the outer recorder drops it, so the supposedly transparent cleanup changes its environment hash. A third probe uses the same config bytes with `NODE_OPTIONS: process.env.REVIEW_PROJECT_FLAGS`: alpha and beta conditions, each also in the cleaned inherited options, produce identical resolved configs with the field absent. The default allowlist does not key those inherited variables. The candidate therefore suppresses both the requested runtime behavior and its resolved-config distinction.

All four adapter probes pass when only `observe.ts` is reverted to the base. This isolates the regression to the new no-recorder injection, rather than a pre-existing observing-run behavior.

**One-worker fix:** remove only the foreign recorder while preserving the project's own env precedence. Keep `UNOBSERVED` and genuinely synthetic overrides out of the hash without discarding an explicit project `NODE_OPTIONS`. Cover a root project whose value differs from the cleaned inherited options, a same-value config across plain/nested runs, and differing resolved project values from identical config bytes; include a multi-project control. Keep the original two fidelity cases passing under the actual outer recorder, preserve the observing path, and keep ordinary runs free of new env variables.

## Should-fix

None.

## Nits

None.

## What fits

- **Honest state:** the new scheduler cut changes queue grouping through the existing settle/commit boundary; results remain tied to their keys. No new status or delivery renderer asserts that catch-up results are current. B2 is the changed validity-input seam that does break the contract.
- **Ordinary cut:** for already-indexed sources the implementation keeps edited/added tests, reached namesakes, bare sources' direct importers and the K shortest other direct importers. The second `affected` call distinguishes bare sources in a mixed revision. An unanswered initial `affected` leaves the cut absent; an unanswered bare-source call conservatively keeps all direct importers. Unknown durations sort last and ties by id, as the worker notes disclose.
- **Matchers:** one pure `namesakesOf` function implements sibling, `__tests__`, mirrored `test/`/`tests/` below `src/`, unique-name fallback and pytest patterns, excludes `index`, and stays within the source's language. The unmarked `__tests__` match is in the research definition. Taking the conventional directories together follows C4's text; it differs from the research replay's first-matcher choice as the worker notes disclose.
- **Queue and startup seams:** `demote` calls `toCatchUp(ref, keyedAt)` rather than clearing another revision's first-group reason. Promotions remain independent. `baseline` cuts each small unseen revision separately, uses the existing bound and direct-importer priorities, skips the runner cut under `lookup-only`, and seeds the handover's first/catch-up sets before cutting unseen work. A handed-over first-group file is not demoted by that cut, as R3 requires. The threshold-10 recount and wave-5 per-revision representation remain in place.
- **Revision-lag test:** the changed trigger is now the barrel's direct import, so the held tier is an edit's tier under the new rule. Its original assertions still require both later revisions to record promptly, all four checks to read pending, runner refinements to run once in order and the held tier to complete without starvation.
- **001-431's original repair:** the original two fidelity cases pass under an actual outer recorder and fail with the repair reverted. `UNOBSERVED` is recognized as foreign by the existing spawn hook and names no recording root. Ordinary unobserved runs receive no new settings; observing runs retain their existing path. node:test hashes `project.env`, independently of its sanitized inherited env. B2 is specifically the Vitest project-env override/hash seam the added helper assertions did not exercise.
- **Release:** candidate versions are 0.1.229; format 19 follows released 18 and its source pin matches the build. Reading 18 as one is appropriate for the intended queue-order and nested-recorder cleanup changes. No extra format raise is justified merely to hide B2's loss of project config. All four bundle builds leave the tracked tree clean. The cezar replay was optional in W3 and is disclosed as skipped; no new live performance claim is made here.

## Inputs for the fix wave and next wave

Dispatch two bounded repairs before landing:

1. **Scheduler owner:** `edit-cut.ts`, the `fetchRunnerPart` carrier if needed, and scheduler regressions for B1. Own the source set on the runner/closure boundary; preserve per-revision recent reasons. The existing threshold stays 10, K stays `runner.tierSize`, the extra runner query stays bounded, and no runner call enters the store transaction.
2. **Vitest/recorder owner:** `observe.ts`, the sanitization helper and environment-hash boundary as needed, plus env/fidelity regressions for B2. Preserve project-owned config before excluding injected values; test runtime behavior as well as metadata. Keep `UNOBSERVED` understood by the old outer hook and add nothing in ordinary runs.

Neither repair requires changing the namesake policy, pool grants, cancellation, slot shape, 120 s backlog budget or handover policy. The coordinator owns the candidate's version/pin/bundles and any board/status updates. Re-pin and rebuild the repaired candidate, run the combined gate, then request a re-review bounded to B1/B2 and the repair delta. The current candidate is not ready to land even if a repeated ordinary suite is green.
