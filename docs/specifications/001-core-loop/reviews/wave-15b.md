# Wave 15b review: 001-426 (001-424)

## Verification

Candidate: `9cbf461dd01b36894888770ea055b85eaf1aa1d5` (`cand/0.1.199`). Base: `b0830050`. Reviewed range: `b0830050..9cbf461d`. HEAD matched the candidate and the tree was clean. Product files and `docs/board.md` were not edited. The build left all committed bundles unchanged.

```text
$ git rev-parse HEAD
9cbf461dd01b36894888770ea055b85eaf1aa1d5
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
```

Exit 0. npm also reported the existing `node-domexception` deprecation and six install scripts not covered by `allowScripts` (`@google/genai`, `@parcel/watcher`, `esbuild`, `msgpackr-extract`, `opencode-ai`, `protobufjs`).

```text
$ npm run lint
> squeal@0.1.199 lint
> biome check .
Checked 1352 files in 4s. No fixes applied.

$ npm run typecheck
> squeal@0.1.199 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.199 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.199 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts

$ git status --short
<empty>
```

All exited 0. The independent full run used the required host lock and four workers, rather than Squeal's checkpoint:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/24470a0e-9dbd-4b5c-94ca-c44435073b1b

 ❯ test/scheduler/environment-growth-same-revision.test.ts (1 test | 1 failed) 26753ms
   ❯ status --wait over a growth at the revision of a sibling's result (task 001-196) (1)
     × holds for the regrown sibling until its re-run's result 26752ms
 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 166256ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 60794ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/24470a0e-9dbd-4b5c-94ca-c44435073b1b/test/fixtures/scheduler/.tmp/10c73c43-9f02-4913-af08-80b7ef440a3a/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/24470a0e-9dbd-4b5c-94ca-c44435073b1b/test/fixtures/scheduler/.tmp/684289f5-d339-4a7e-b41a-305f50bc5efa/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 4034331
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2622, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +182 (pid 3586494), dispose +334, kill +2622 (pid 3586494); the held Stop's deadline: +2000
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
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2055, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +135 (pid 3559636), dispose +315, input +1754, kill +2055 (pid 3559636); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +5505, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +232 (pid 3572998), dispose +295, input +1296, kill +5505 (pid 3572998), disposed +5518; the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/scheduler/environment-growth-same-revision.test.ts > status --wait over a growth at the revision of a sibling's result (task 001-196) > holds for the regrown sibling until its re-run's result
AssertionError: expected null not to be null
 ❯ test/scheduler/environment-growth-same-revision.test.ts:157:28
    155|     await expect.poll(() => pending(B), { timeout: 60_000 }).toBeNull(…
    156|     expect(runsOfA).toBe(1);
    157|     expect(pending(A)).not.toBeNull();
       |                            ^
    158|     // a's result under its previous key was observed at the revision …
    159|     const observedA = store.knownStates

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed | 661 passed | 1 skipped (664)
      Tests  2 failed | 5611 passed | 10 skipped (5623)
   Start at  23:58:42
   Duration  1700.85s (tests 97%, import 2%, transform 1%)

    Isolate  664 workers spawned · ~315ms startup each (spawn + environment, per file)
             at least ~52.02s faster with isolate: false — reuses workers across files instead of one per file
```

Exit 1. The build and the complete independent test run finished at the pinned candidate, with a clean tracked tree. Both new regression files and the key-format guard passed; neither is among the failures.

The full run's failures and their relation to the range are discussed here, separately from findings against the candidate. A targeted check of the scheduler file, without an edit, completed as follows:

```text
$ npx vitest run test/scheduler/environment-growth-same-revision.test.ts --maxWorkers=1 --reporter=verbose
✓ holds for the regrown sibling until its re-run's result 13136ms
Test Files 1 passed (1)
Tests 1 passed (1)
Start at 00:12:50
Duration 25.36s (tests 57%, transform 39%, import 4%)
```

Exit 0. The full run used a shared 24-CPU host with observed one-minute load samples from 35.49 to 130.53; the isolated check started at 118.10. The scheduler test exercises the node:test preload-growth path. Its test, node:test runner and scheduler code are unchanged by this range; the key-format constant stays 10, and only its guard pin changes. In the full run, `pending(A)` was already null at line 157 when the test expected it pending. The isolated pass proves the failure is not deterministic in this checkout; its exact race remains unverified. The OpenCode failure is the already-recorded `opencode-dispose` idle-deadline case on the board (010-16 and Later), also outside the changed execution paths. These failures do not establish a break introduced by 001-424, and the full run is not claimed green.

Squeal's separate background baseline also reported two OpenCode idle-deadline failures, then retried them: one recovered under the same inputs and one remained failing. That background evidence does not replace the independent run above.

## Verdict

**PASS 9cbf461dd01b36894888770ea055b85eaf1aa1d5**. Zero blockers, zero should-fix items and zero nits in the reviewed range. Two nonblocking notes and the requested coverage limits follow. The independent suite completed with two failures in unchanged execution paths, documented above; this verdict does not claim a green full suite.

## Blockers

None found.

## Should-fix

None.

## Nits

None.

## What fits

- **Proven by source and experiment: setup closures, D3 and D4.** `projectInputs` walks both setup closures transitively, then expands every missing target with the project's resolution extensions. `projectEnvironment` lists those candidates; the core hashes absent paths as absent. The new client-environment tests cover adding the target alone and writing the importer and target together in a new directory. The daemon cases require the add's revision and a settled result with the failure gone, without touching any file again.
- **Proven by experiment: depth and project isolation.** A throwaway probe used the public adapter and two `node` projects sharing a test file, with setup only in project `affected`. The chain was `test/setup.ts -> src/a.ts -> src/b.ts -> ./markdown` (missing). The environment contained the unresolved target, each extension candidate and every index candidate. Hashes from the real `environmentHash` differed from the old existing-files-only representation only for `affected`. After adding `src/markdown.ts`, only `affected` changed hash, `affected()` returned only that project's file, `invalidate()` recreated no project, and both tests passed. A second probe used the same chain from `globalSetup`; the failed setup recovered on its next run after the add.
- **Proven by source: no loss from `isProjectInput`.** `resolutionCandidates` returns the original target first (`graph.ts:265`). Therefore the new `inputs.missing` is a superset of both old `setup.missing` and `globalSetup.missing`; config files and existing setup/global-setup closure files retain their old checks (`project.ts:48`). The helper extracted into a test file's `closure()` is equivalent to its old loop; the snapshot and path filters remain.
- **Proven by source and build: keys and shipped code.** Key format 10 is re-pinned, as authorized for the unreleased format; the last release tag `squeal--v0.1.168` has format 9. No adapter-version bump is needed to make the added setup candidates change an affected environment hash. Projects with no missing setup input retain their file lists. Versions and bundled code are 0.1.199, and rebuilding produced no tracked drift.

## Nonblocking notes and next-wave inputs

### N1. A global-setup candidate hit recreates the whole instance

**Proven; accepted cost, not a blocker.** `project.ts:64` and `adapter.ts:286`. `recreateTriggers` now includes every missing global-setup candidate, including the unresolved path itself. A hit waits for the run lane, closes the old instance, starts a new one and returns every old/new project name, including projects whose own environment is unchanged. The scheduler consequently rereads environments and listing and resolves every recreated project's closures (`core/scheduler/refinement.ts:105`). In the two-project probe above, adding the missing leaf returned:

```text
{"recreatedProjects":["affected","clean"]}
elapsed: 422 ms
```

This is a tiny-fixture observation under shared-host load, not a large-project bound. Setup-file-only missing imports take the ordinary structural invalidation path. The existing design caches global setup per instance, so expanding its triggers is consistent with D4. Any future optimization must retain the run-lane exclusion and rerun global setup before recording results.

### N2. The daemon regression's intermittent baseline recovery is still unexplained

**Unverified recovery path; nonblocking.** `test/integration/setup-missing-import.test.ts:47`, worker `tasks/001-424/notes.md`, section "Cases ruled out". To check the test independently, an isolated archive of baseline `b0830050` used the same installed dependencies and copied only the new client fixture and tests. The unmodified daemon integration test was run twice:

```text
$ npx vitest run test/integration/setup-missing-import.test.ts --maxWorkers=1 --reporter=verbose
run 1: Test Files 1 failed (1); Tests 2 failed (2); Duration 51.15s
run 2: Test Files 1 failed (1); Tests 2 failed (2); Duration 16.29s
```

All four cases reached line 62 with the original resolve-import failure still `current` after the add. Neither failure was a timeout or setup error in the test harness. This independently reproduces the stale-result bug, but two runs do not disprove the worker's observed intermittent recovery on main or establish a dependable failure rate. Do not claim this daemon test alone fails on every pre-fix run. The adapter-level guard supplies the deterministic assertion:

```text
$ npx vitest run test/runners/vitest/client-environment.test.ts --maxWorkers=1 --reporter=verbose
Test Files 1 failed (1)
Tests 2 failed | 2 passed (4)
Duration 5.14s
```

Both setup cases fail at line 56 because the old environment lacks `src/markdown.ts` or `src/fresh/uses-md.ts`; the existing test-import cases pass. If a future wave needs to harden the daemon guard further, instrument its initial settled result, run completion and runner-part/reconciliation boundaries to identify the reported recovery before adding timing sleeps. No production change is requested from an unverified race theory.

### Coverage limits

**Unverified; explicitly nonblocking in the brief.** Browser mode and a `projects` config mixing client and SSR projects were not exercised. The isolation probe above used two SSR projects. Browser mode's separate Vite server and differing client/SSR resolution conditions remain distinct follow-up probes; this review makes no claim about them.
