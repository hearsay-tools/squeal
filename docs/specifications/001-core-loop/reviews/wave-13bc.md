# Wave 13bc: review of 001-326 (row 001-330)

## Verdict and verification

**PASS `92cfddb2857c944187f5d9decb7b2f0704d54646`**. Zero blockers, one proven should-fix suggestion, one plausible clock note, zero nits. Range: `583abb85..92cfddb2`, commits `f36a48ee` and `92cfddb2`, version 0.1.149. Candidate checks ran on the clean pinned tree before this findings file was written. The throwaway probes used external configs and files, without editing the candidate. No board, product or eval edits.

Verification output:

`git rev-parse HEAD`:

```text
92cfddb2857c944187f5d9decb7b2f0704d54646
```

`npm ci` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 4s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
```

`npm run lint` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.149 lint
> biome check .

Checked 984 files in 436ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.149 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.149 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.149 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

`git status --short` was empty after build and after the independent full run; `git diff --exit-code` returned 0. No tracked bundle drift.

The commands ran with a scratch HOME and XDG config/cache directories, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` unset, and `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`. Vitest also had `CODEX_SESSION_ID` unset and `--maxWorkers=4`, as assigned. This is the reviewer's independent run, not a Squeal checkpoint. npm's unknown `store-dir` warning and its `allowScripts` warnings for `@parcel/watcher` and `esbuild` did not prevent the checks.

Independent full-suite command and output (exit 0):

```sh
env -u CODEX_SESSION_ID -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  HOME="$review_root/home" XDG_CONFIG_HOME="$review_root/home/.config" \
  XDG_CACHE_HOME="$review_root/home/.cache" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  npx vitest run --maxWorkers=4
```

`review_root` was the task's scratch directory. One full run only, 664.37 s; no load timeouts occurred.

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/71bcf7b8-bde6-4fb6-9b9e-0f454040293b

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/71bcf7b8-bde6-4fb6-9b9e-0f454040293b/test/fixtures/scheduler/.tmp/f07971c3-4191-4c0f-a979-c78987530413/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/71bcf7b8-bde6-4fb6-9b9e-0f454040293b/test/fixtures/scheduler/.tmp/c6f460b5-ed58-4162-9d90-71fd46e63817/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3104183
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  460 passed | 1 skipped (461)
      Tests  3880 passed | 10 skipped (3890)
   Start at  19:07:42
   Duration  664.37s (tests 97%, import 2%, transform 1%)

    Isolate  461 workers spawned · ~175ms startup each (spawn + environment, per file)
             at least ~20.01s faster with isolate: false — reuses workers across files instead of one per file
```

Focused evidence, collected without changing the candidate:

- Old-expression overlay: restore `(deps.now ?? Date.now)() - STOP_SLOW_HANDOFF_SLACK_MS` through a temporary Vite transform, then run `test/harness/stop-slow-handoff.test.ts`. Exit 1, two failed and two passed. Both slow-start cases fail at line 39 with `AssertionError: expected undefined to be 'block'`; both stale controls remain silent. This independently confirms the reported pre-fix symptom.
- Weaker-expression overlay: use `(deps.now ?? Date.now)() - 3000` instead. Exit 0, all four tests pass. This settles S1 below.
- Both committed `plugins/*/dist/stop-slow.mjs` bundles, in separate fresh Node processes: preload an `Atomics.wait(..., 4100)` with `--import` before the bundle loads, after the short entry silently ended the turn and an untold slow failure landed. Both return `decision: "block"`, name the failure at revision 1, and restore `in-turn`. A separate child with a handoff stamped `Date.now() - 3100` stays silent, takes at least the 3 s handoff wait and leaves the consumer idle. Four tests passed. These use the child's real process start and its real clock; neither source-hook invocation nor the Vitest worker's start stands in for them.
- Unchanged stress schedule, as required by 001-326: `npx vitest run test/harness/stop-slow-untold.test.ts --maxWorkers=4 -t "13an S2: a pending file moved and failed at a newer key before its first read blocks"`, 20 consecutive independent runs beside the full suite. Each exited 0 with `Test Files  1 passed (1)` and `Tests  2 passed | 38 skipped (40)`, one pass per harness. Sampled one-minute load was 36.09 to 50.41.
- Current candidate, the new handoff test, existing read-boundary/untold schedules and key-format guard: `npx vitest run test/keys/key-format.test.ts test/harness/stop-slow-handoff.test.ts test/harness/stop-slow-boundary.test.ts test/harness/stop-slow-untold.test.ts --maxWorkers=4`. Exit 0, `Test Files 4 passed (4)`, `Tests 91 passed (91)`, duration 12.78 s. This confirms the old expression's failing cases pass on the candidate and the clock-call schedules still discriminate.

## Blockers

None proven in this range.

## Should-fix suggestions

### S1. Proven, nonblocking: the regression accepts a fixed wider cutoff

Location: `test/harness/stop-slow-handoff.test.ts:36` and `:50`.

001-326's done-when names the stalled-first-clock schedule, which the new test meets. The requested behavior is more specific: freshness is anchored to the waiting entry's own process start, and an older handoff remains stale. A 2.1 s stall only proves that the cutoff tolerates just over 2 s. The stale control is anchored to the Vitest worker's start, not to a freshly launched hook. Replacing the fix with `now() - 3000` passes all four tests in this review, even though an entry that reaches its handoff check 4.1 s late would lose the current handoff again.

One-worker fix: retain the fast source tests and add a two-harness bundle regression using a fresh hook child. Record the short entry's real handoff just before spawning the child; stall the child before its bundle loads by more than 3 s (the review used 4.1 s). Assert one block with the failure and the restored turn. In a separate child seed a handoff older than that child's start minus 2 s and assert silence after the 3 s handoff wait. Bound each case explicitly. The committed candidate passes this schedule in the independent probe. Adding it is a regression-strength improvement, not evidence of a candidate product break.

## Clock note

### S2. Plausible, nonblocking: the clock-frame conversion assumes matching elapsed time

Location: `src/harness/shared/stop-slow.ts:193`.

With a stable real wall clock, `Date.now() - performance.now()` estimates `performance.timeOrigin`, apart from millisecond rounding and the gap between those two samples. A consistently offset injected epoch clock also works, provided handoff timestamps use the same offset and it advances at the real clock's rate. The repository's scheduled `clock()` does exactly that: it performs its scheduled action, then returns `Date.now()`. `handedOver` still reads that injected clock once, so the read-boundary schedules keep their call numbers.

A frozen or independently advanced fake clock does not model that relationship: subtracting the real worker uptime can widen or narrow the intended fake-clock window. A wall-clock step since process start also changes the estimate, and descheduling between the epoch sample and the monotonic sample widens it by that gap. No such production failure was established here; these are a limitation of the conversion, not a blocker.

One-worker suggestion: document the elapsed-time requirement on `HookDeps.now` and add a paired clock test for a constant epoch offset. If independently advancing fake time is meant to be supported, inject the elapsed/process-start reference in the same frame, with a test covering a fresh and a stale handoff. Keep the handoff's epoch-clock call count at one so the existing transactional schedules remain meaningful.

## Nits

None.

## What fits

- Honesty: the range changes which handoff is fresh, not result validity or provenance. After accepting it, the existing wait and write-transaction decision still decide at the live revision, only block on current untold slow failures, and deliver news at the decided revision. No old result becomes current through this change.
- Seams: both harnesses route their waiting entry to the same `stopSlow` with their harness identity and `stop_hook_active` flag. Both return the shared reason as a policy block. The short entry records its epoch handoff atomically with becoming idle; the waiting entry still requires an idle registered consumer, and a new prompt or waiter wake prevents it taking the turn.
- 004 D9 as amended and 001-305: a delayed entry accepts the fresh short-entry handoff and reports the untold current slow failure in both harnesses. The slow-tier completion and told-fingerprint rules are unchanged. The off switch, cancellation, SubagentStop and `stop_hook_active` exits remain outside the changed path.
- Staleness is relative to process start minus the intentional 2 s slack. A handoff within that slack may precede the waiting process and still be valid; one older than the cutoff is rejected. The committed bundle stale controls verify the latter without relying on worker uptime.
- The handoff wait remains 3 s after the check; `slowWaitMs` remains a separate wait, capped at 600000 ms; hook timeout remains 630 s. The short entry retains its 2 s budget.
- Both committed plugin dist trees reproduce under `npm run build` without drift. The root package, Claude Code package and both plugin manifests all say 0.1.149. `KEY_FORMAT_VERSION` remains 9; the changed delivery/harness logic is exempt from the guarded key/result sources, and the key-format guard's unchanged pin is covered by the 91-test independent focused run.
- Style: one implementation expression, a comment explaining its anchor, no dependency or public type change. The test exercises both harnesses through their public hooks and checks the reason and the consumer's turn, not only a returned boolean.

## Inputs for the next wave

No product repair is required by this review. S1 can be one test-only row owning the handoff test and a bundle fixture. Use both committed plugin paths, scratch HOME/runtime directories and recorded Stop JSON; establish the registration/Stop-wait marker and an in-turn consumer before the short entry ends it. Land the untold slow failure after that silent end. Then spawn the delayed waiting child; do not sleep before spawning it, since that would move its process start and test a different cutoff. Keep the 2 s slack, the 3 s handoff wait, and the failure's live-revision transaction unchanged. The separate stale child must have no fresh short-entry handoff. S2 is optional clock-contract documentation/testing. Neither requires a key-format bump. The coordinator owns any board/status updates and the landing decision.
