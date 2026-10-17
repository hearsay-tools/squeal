# Wave 1 review: 011-01 and 005-67

FAIL `3c9949a858316ca26143812f006466d6af1177df`: 1 blocker, 1 should-fix, 0 additional notes.

## Verification

Reviewed the exact candidate `cand/0.1.204`, HEAD `3c9949a858316ca26143812f006466d6af1177df`. The worktree was clean throughout verification. Scope: `bf349b2b..3c9949a8`, product commits `a7ae87d0`, `9e96db73`, and bundle/version commit `3c9949a8`. Local main was `bf349b2b`; its difference from the candidate's parent `caa73e40` is documentation only. No rebase or product edit was made to the pinned candidate.

Independent checks, run here after installing from the lockfile:

```text
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.204 lint
> biome check .
Checked 1365 files in 587ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.204 typecheck
> tsc --noEmit
exit 0

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/1f3206e1-e4c8-42eb-bd00-413a8200f2e5

 ❯ test/harness/opencode-dispose.test.ts (3 tests | 1 failed) 60568ms
   ❯ a report held while dispose meets newer input (3)
     × serve: an abort of the new turn, then the old Stop's answer, stores nothing 43599ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1f3206e1-e4c8-42eb-bd00-413a8200f2e5/test/fixtures/scheduler/.tmp/3b121975-811f-44a6-867b-941dca40d727/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1f3206e1-e4c8-42eb-bd00-413a8200f2e5/test/fixtures/scheduler/.tmp/fe37d822-5cf2-4a2d-8a73-13a6aed7f506/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 4168922
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/opencode-dispose.test.ts > a report held while dispose meets newer input > serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2236, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +132 (pid 3965167), dispose +195, input +560, kill +2236 (pid 3965167); the held Stop's deadline: +2000
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
   ↳ attempt 1 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2307, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +167 (pid 3959675), dispose +232, input +596, kill +2307 (pid 3959675); the held Stop's deadline: +2000
   ↳ attempt 2 of 3 missed its barriers: before the new turn's request, the plugin killed the held Stop at +2090, at or after its idle deadline (+2000)
marks, ms since the first idle: idle +0, stop +144 (pid 3962197), dispose +211, kill +2090 (pid 3962197); the held Stop's deadline: +2000

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 674 passed | 1 skipped (676)
      Tests  1 failed | 5720 passed | 10 skipped (5731)
   Start at  09:05:09
   Duration  1075.17s (tests 98%, import 2%)

    Isolate  676 workers spawned · ~181ms startup each (spawn + environment, per file)
             at least ~30.42s faster with isolate: false — reuses workers across files instead of one per file
exit 1
```

`npm ci` also printed its deprecated `node-domexception` notice and six install-script coverage warnings. No install failure. This is the reviewer's independent Vitest run, not a Squeal checkpoint or the coordinator's result. `npm run build` was deliberately omitted per the review request; rebuild/drift verification is unverified here, not a finding against the wave.

The background Squeal baseline separately reported failures at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Both full reports were read; these are the existing recorder-sensitive failures tracked in board row 001-431, outside the candidate's changed paths. They are not counted as findings against this wave.

The independent run's one failure was `test/harness/opencode-dispose.test.ts:172`: all three attempts missed the ordered race before the new turn's request. The plugin killed the held Stop at +2307, +2090 and +2236 ms against its +2000 ms deadline. This is the existing loaded-host limitation documented in that test and the board's Later section; the failing test and OpenCode lifecycle source are unchanged by this range. Host load reached 72.18 and then 80.92 on 24 CPUs during the run. Attribution to the candidate is **unverified**, so this is verification evidence, not an additional wave finding. No isolated rerun or second full run was made. The new row regressions and `test/keys/key-format.test.ts` passed.

## Blocker

### B1. Proven: the busy-store diagnostic promises a wait behavior the CLI does not provide

Location: `src/core/status/open.ts:87`, also shipped in all four committed CLI bundles. Contract: 011-01's Done-when requires an **honest unavailable message naming the wait**. Vision: status is a factual snapshot and preserves uncertainty.

The new exhaustion suffix is:

```text
`squeal status --wait <ms>` keeps reading until it answers
```

A fresh wait deliberately ends on an unavailable first store read (`src/cli/status-wait.ts:319-321`; the named wait has the same rule in `src/cli/status-wait-paths.ts:221-222`). Under the very lock this diagnostic addresses, the recommended command therefore exits after one attempt, long before its requested deadline. It does not keep retrying until a store answer is available. Keeping one attempt is required by this brief; the defect is the new promise, not that existing wait behavior.

Independent probe on a disposable `/tmp` repository, using the committed Claude Code CLI and a second Node process holding `PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE` for 9 seconds:

```text
$ squeal why 'auth > log' --json
exit 1 after 5361 ms
{"available":false,"message":"status unavailable, store busy, waited 5226 ms; `squeal status --wait <ms>` keeps reading until it answers"}

$ squeal status --wait 60000 --json
exit 1 after 1150 ms
{"available":false,"message":"status unavailable, store busy, waited 1007 ms; `squeal status --wait <ms>` keeps reading until it answers"}
```

Each command got its own fresh 9-second lock. The fixture was seeded with the repository's `research/probes/issue-8-contention/seed.mjs` and a current `testFileKeys` row for `src/auth.test.ts`, key `k0`, revision 1. The probe and disposable store were removed; no live repository store was locked.

Worker-sized fix: change the suffix to factual advice, for example, "retry after the lock clears with `squeal status --wait <ms>`; an unreadable first snapshot ends the wait." Keep hooks and both waits at one attempt. Add a regression that checks the replacement wording against a fresh wait whose first read is blocked. Regenerate bundles and re-pin guarded sources if necessary through the normal candidate repair.

## Should-fix

### S1. Proven: the five-second retry window does not cap the final attempt's timeout

Location: `src/core/status/open.ts:81-90`. The next `readOnce` always receives the full `busyTimeoutMs`, even after the retry deadline has passed during the pause. The same probe spent 5226 ms inside the read retry despite `CLI_READ_RETRY_MS = 5000`. This is still finitely bounded and the diagnostic reports the actual elapsed time, so it does not block the row's general bounded-retry contract or hook goal 6.

Worker-sized fix: before another attempt, check the remaining retry budget and cap that attempt's busy timeout to it. Preserve the first full attempt when retries are disabled. Add one deadline-focused regression; the current exhaustion regression uses a 400 ms retry window and does not check an upper bound.

## What fits

- **011-01 lookup:** `results.byKey(key, 0)` now skips the UPDATE entirely. The store regression exercises it in a read transaction beside a writer, and verifies a normal cache hit still writes. `why` and warm-up retain their shared lookup semantics without promoting reads to writes.
- **011-01 contention:** second-process tests cover an ordinary WAL writer, partial-name evidence, a reader-blocking exclusive lock that frees within the retry window, and all three ordinary CLI commands recovering after more than one busy timeout. The independent bundle probe returned the stored partial-name evidence beside a 3-second write hold in 172 ms, exit 0.
- **011-01 exhaustion:** availability remains false, elapsed milliseconds are measured rather than invented, and the message names `status --wait`. Only the unsupported promise in B1 prevents the honest-message Done-when from being complete.
- **011-01 budgets:** only plain CLI `why`, `status` and `failures` opt into `busyRetryMs: 5000`. Hook contexts retain their existing store open and timeout. Both wait implementations pass only `busyTimeoutMs`; no retry policy or hook timeout is widened. The bundled wait probe confirms one attempt on the first blocked read.
- **005-67 D2:** exact listed test-file paths select only rows at that path, including multiple projects if they list it. Source paths still use the unchanged closure-validity rule. Overlap regressions cover sibling declared inputs, an E2E source-tree glob, imports of another test file, and mixed test/source arguments. No scheduler priority or queue behavior changed.
- **Version and key pin:** all eight locations are `0.1.204`: root `package.json`, `package-lock.json` (both version entries), Claude Code package and manifest, Codex manifest, Pi package, OpenCode package, and `install.sh`. All four bundled CLIs carry `0.1.204`. `KEY_FORMAT_VERSION` remains 11 with pin `1ef85841e0ce3942d3f2d76f545c6a2753f2c6cb21dc2a3f841387e54ae529d0`. The last released tag `squeal--v0.1.199` carries 10, so the unreleased 11 re-pin does not reuse a released format.

## Nits

None.

## Inputs for the repair and next wave

Repair B1 on the status-open diagnostic only, with a behavior-based wording regression. Do not make `status --wait` or hooks retry for five seconds to satisfy the current sentence. The ordinary CLI callers must continue to pass the retry window; hooks and wait polls must omit it. Keep `byKey(key, 0)` read-only and preserve the exact-test-first, source-closure-second selection rule per argument. S1 can be folded into a deadline repair without changing those interfaces.

The actual production exclusive-lock holder remains unknown and outside this row (001-435's lineage). No finding here requires widening the work into daemon scheduling, wait promotion, or the other 011 wave rows.
