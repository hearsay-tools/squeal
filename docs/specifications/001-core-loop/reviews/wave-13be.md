# Wave 13be: review of 001-334 and 001-332 (row 001-336)

## Verdict and verification

**PASS `a2e409d1974f331bcf476b1cb1b1228fbcafc162`**. Zero blockers, one plausible nonblocking suggestion, zero nits. Range: `7f4d8798..a2e409d1`, commits `ac61c3d2` (001-334) and `a2e409d1` (001-332), version 0.1.150. This review is bounded by 13bc S1/S2 for 001-332 and the new 001-334 diff. The independent full suite is **not green**; its failure is recorded below, outside this test-only range. No failing run was retried to green.

All candidate checks ran at the exact pinned commit on a clean tracked tree, before writing this file. `git status --short` stayed empty after the build, probes and full suite; `git diff --exit-code` returned 0. Throwaway configs, controlled-clock probes and mutated bundle copies lived outside the checkout and were removed. Only this findings file is committed; board, status, product, bundles and eval files were not edited.

`git rev-parse HEAD`:

```text
a2e409d1974f331bcf476b1cb1b1228fbcafc162
```

The commands used a scratch HOME and XDG config/cache directories, with `CODEX_SESSION_ID`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR` unset and `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1`. No credentials were read or copied. npm's warnings below did not prevent the checks. This is the reviewer's independent Vitest run, not a Squeal checkpoint.

`npm ci` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 5s

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

> squeal@0.1.150 lint
> biome check .

Checked 980 files in 378ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.150 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.150 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.150 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

Independent full-suite command (one run only):

```sh
env -u CODEX_SESSION_ID -u CODEX_HOME -u CLAUDE_CONFIG_DIR \
  HOME="$review_root/home" XDG_CONFIG_HOME="$review_root/home/.config" \
  XDG_CACHE_HOME="$review_root/home/.cache" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  npx vitest run --maxWorkers=4
```

`review_root` is the task's scratch directory. Full output follows; every reported failure is retained.

Exit 1:

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/20780230-18f1-4a27-91e4-ae011d6ec1d2

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/20780230-18f1-4a27-91e4-ae011d6ec1d2/test/fixtures/scheduler/.tmp/057f50f6-1329-4df3-b5f6-7920b14013e0/main/.git/worktrees/staged/gitdir
 ❯ test/e2e/lifecycle.test.ts (6 tests | 1 failed) 114889ms
   ❯ a bad squeal.config.json, codex (1)
     × yields one note and a running daemon 66024ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/20780230-18f1-4a27-91e4-ae011d6ec1d2/test/fixtures/scheduler/.tmp/5aea0f4b-e9ac-4ccd-a707-92f6554f7902/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 1449717
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/e2e/lifecycle.test.ts > a bad squeal.config.json, codex > yields one note and a running daemon
Error: timed out after 45000 ms waiting for a ready daemon in /tmp/squeal-e2e-gWlry7/repo
 ❯ until test/e2e/support.ts:43:13
     41|     if (value !== null) return value;
     42|     if (Date.now() > deadline) {
     43|       throw new Error(
       |             ^
     44|         `timed out after ${ms} ms waiting for ${what}${last ? `: ${Str…
     45|       );
 ❯ test/e2e/lifecycle.test.ts:150:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 460 passed | 1 skipped (462)
      Tests  1 failed | 3897 passed | 10 skipped (3908)
   Start at  19:58:31
   Duration  764.97s (tests 97%, import 2%, transform 1%)

    Isolate  462 workers spawned · ~225ms startup each (spawn + environment, per file)
             at least ~25.71s faster with isolate: false — reuses workers across files instead of one per file
```

The failing bad-config daemon-readiness case in `test/e2e/lifecycle.test.ts` is the known open load case explicitly excluded by the brief. Its test and daemon-readiness implementation are unchanged in this range. It is failed verification evidence, not a finding against 001-332/001-334. The static gates and build reproduction pass; the review does not claim a green full-suite gate.

Focused discriminators (all with the same isolated environment; Vitest probes use `--maxWorkers=1`):

- **Wider-cutoff bundle overlay:** copied each committed `stop-slow.mjs` outside the checkout and replaced only its handoff expression with `(deps.now ?? Date.now)() - 3000`. An external Vite transform redirected the new test's two bundle paths to those copies. Exit 1, all four tests fail. The delayed children fail at `test/harness/stop-slow-handoff-bundle.test.ts:80`, `AssertionError: expected undefined to be 'block'`. The stale children fail at `:100`, `AssertionError: expected 'block' to be undefined`. Duration 16.34 s.
- **Pre-001-326 bundle overlay:** same method, with `(deps.now ?? Date.now)() - STOP_SLOW_HANDOFF_SLACK_MS`. Exit 1, two failed and two passed; both delayed children fail at `:80`, `AssertionError: expected undefined to be 'block'`. Both stale controls pass. Duration 22.77 s.
- **Wrong epoch-frame source overlay:** an external Vite transform replaces the injected clock in the handoff expression with `Date.now()`. Run only `stamped now|in that frame` in `test/harness/stop-slow-handoff.test.ts`. Exit 1, four failed, four passed, four original tests skipped. Both behind-clock fresh cases fail at `:97`, `AssertionError: expected undefined to be 'block'`; both ahead-clock stale cases fail at `:109`, `AssertionError: expected { decision: 'block', …(1) } to deeply equal {}`. Duration 18.02 s. These are intentional mutation failures, not candidate failures.
- **Controlled-clock helper probe:** load the actual `test/cli/wait-clock.ts` with a temporary timer and monotonic-clock stand-in. Exit 0:

```text
PASS: early callback at 299.38; waitedMs=299.48; endedBy=299.48
PASS: early quiet rejects unfinished callback (Infinity)
PASS: callback before the caller continuation cannot hide early quiet (10 < 299.38)
LIMIT: preemption before internal start can reject a valid end (conservative bound 210 < callback 300 < actual end 310)
```

- **001-334 stress:** twenty consecutive `npx vitest run test/cli/status-wait-window.test.ts --maxWorkers=1` runs beside the full run. All exit 0, 7 tests each (140 test executions). The harness stops at the first failure; none occurred. Sampled one-minute load spans 41.70 to 56.77. Output:

```text
PASS iteration 1:       Tests  7 passed (7)
41.70 36.03 36.64
PASS iteration 2:       Tests  7 passed (7)
43.07 36.51 36.78
PASS iteration 3:       Tests  7 passed (7)
41.79 36.35 36.73
PASS iteration 4:       Tests  7 passed (7)
42.20 36.52 36.79
PASS iteration 5:       Tests  7 passed (7)
43.55 36.90 36.91
PASS iteration 6:       Tests  7 passed (7)
43.58 37.02 36.95
PASS iteration 7:       Tests  7 passed (7)
50.29 38.65 37.48
PASS iteration 8:       Tests  7 passed (7)
52.59 39.32 37.70
PASS iteration 9:       Tests  7 passed (7)
51.58 39.33 37.71
PASS iteration 10:       Tests  7 passed (7)
51.69 39.56 37.80
PASS iteration 11:       Tests  7 passed (7)
54.68 40.38 38.07
PASS iteration 12:       Tests  7 passed (7)
54.23 40.52 38.13
PASS iteration 13:       Tests  7 passed (7)
53.88 40.89 38.27
PASS iteration 14:       Tests  7 passed (7)
56.77 41.70 38.55
PASS iteration 15:       Tests  7 passed (7)
56.23 41.84 38.61
PASS iteration 16:       Tests  7 passed (7)
53.73 41.56 38.54
PASS iteration 17:       Tests  7 passed (7)
52.39 41.49 38.53
PASS iteration 18:       Tests  7 passed (7)
51.48 41.48 38.55
PASS iteration 19:       Tests  7 passed (7)
50.00 41.34 38.52
PASS iteration 20:       Tests  7 passed (7)
48.40 41.15 38.47
```

## Blockers

None proven in this range.

## Should-fix suggestions

### S1. Plausible, nonblocking: keep setup outside the conservative timing interval

Locations: `test/cli/wait-clock.ts:27`, `test/cli/status-wait-window.test.ts:67`, `test/cli/status-wait-edit.test.ts:37`, and `test/integration/status-wait-sync.test.ts:56`.

The helper is sound for detecting early quiet, but its lower bound is deliberately conservative. Let `c` be its call timestamp, `s` the wait's internal start, `e` the internal end, and `f` the completion callback. It asserts `c + (e - s) >= f`. Since `c <= s`, passing proves `e >= f`; failing need not prove the wait ended early. An independent controlled-clock probe with `c=0`, `s=100`, `f=300`, `e=310` rejects the valid end: `210 < 300`. No such failure was observed on the candidate; susceptibility under scheduling load is plausible, not blocking.

Several converted callbacks still construct `options(...)` or spread an object after the helper samples `c`, despite its instruction, "Build its arguments before, outside the clock." These are small today, but they add avoidable work to `s-c`.

One-worker suggestion: hoist the remaining option construction into locals before `timed()` in the converted CLI/integration tests, as the named-path and held-slow sites already do. Keep the no-slack inequality. Document that a failure can also mean preemption before the wait's internal start, so a future load failure is investigated rather than weakened. This removes avoidable setup time; it does not eliminate scheduler preemption. No product change is requested.

## Nits

None.

## What fits

- **Honesty and seams:** runtime behavior is unchanged. The sole source change documents `HookDeps.now`; no type, transaction, bundle, key format or version changes. The tests continue to use the same wait interfaces and the shared Stop implementation through both harnesses.
- **001-334's cause:** `waitForStatus` starts its monotonic measurement at `src/cli/status-wait.ts:196`; `waitForNamed` does so at `src/cli/status-wait-paths.ts:179`. `later()` schedules first, on Node's timer clock. Node's installed `internal/timers` source uses `binding.getLibuvNow()` and truncates milliseconds when inserting the timer. The later wait start also subtracts setup time from the measured duration. Consequently a nominal 300 ms timer does not imply `waitedMs >= 300`. This review ran on Node 24.21.0, not the reported Node 22 CI host; the exact 299.38 ms CI event was supplied by the brief, not reproduced here. Fifty real 20 ms samples had a minimum of 20.126 ms and no early firing; that negative sample does not rule out the clock explanation.
- **One clock and no slack:** `later()` records `performance.now()` after the synchronous completion action and leaves `at=Infinity` until then. `timed()` combines its `performance.now()` call timestamp with the wait's own monotonic `waitedMs`, not the later caller continuation's time. In the controlled probe, completion at 299.38 and a wait duration of 299.48 passes despite being below 300. An unfinished callback fails against Infinity. An early duration of 10 also fails when completion at 299.38 occurs before the caller continuation; waiting to read the marker cannot turn that early wait green.
- **Every converted site still holds the intended boundary:** the window tests wait for the told pending edit and for the older edit A, rather than only the newer B; edit tests hold for A despite backlog news and until refinement is applied; the named-path wait holds for A while B remains pending; held-slow quiet waits for the originally held file despite changed policy; the basic status test waits for revision 4 to be stored, not merely the earlier sync answer; the real-daemon integration waits for the edit's revision after releasing its write lock. Outcomes, window/count/revision assertions, backlog reporting and the unchanged prompt-return upper bound remain. The old 250 ms, 1150 ms and `HOLD_MS - 100` lower bounds allowed ends before their actual completion callbacks; their replacements are stricter on that behavior.
- **13bc S1 is closed:** each committed `plugins/*/dist/stop-slow.mjs` runs in a fresh Node child, with `Atomics.wait(...,4100)` as a preload after process start and before bundle load. The short entry ends silently first; an untold current slow failure then lands. The delayed child returns a block naming that failure at revision 1 and restores `in-turn`. A separately seeded handoff at least 2500 ms before the child's start is rejected, the 3 s handoff wait elapses, and the turn stays idle. Every case has a 30 s Vitest budget. The independently mutated bundle copies reject both incorrect cutoffs, as recorded above. No source import stands in for the waiting child.
- **Bundle-child isolation:** `runNode` passes only PATH, HOME and the explicit test environment. The new test overrides HOME with `tempDir`, uses a private short runtime directory and a fixture socket, and points `SQUEAL_CLI` at `quietCli`. `daemonCliEntry` gives that override precedence over the bundle's sibling CLI. The input cwd/store belong to a fake repository; the recorded daemon socket is fixture-specific. The waiting Stop path itself opens that store and polls it, with no daemon startup call. It does not reach the real HOME, daemon or CLI. No agent CLI or eval runner was launched by this review.
- **13bc S2 is closed:** the new comment accurately requires real elapsed-time advancement with at most a constant epoch offset. The paired fresh/stale tests use both harnesses at offsets of minus and plus one day. They stamp the handoff in the same frame; the daemon activity remains in the real frame. An independent Vite overlay using `Date.now()` instead of the injected epoch clock fails exactly those four cases: both behind-clock fresh handoffs are lost and both ahead-clock stale handoffs block. The other four offset controls pass. `handedOver` still calls the injected epoch clock once, before its poll loop; the poll/decision schedules retain their clock-call numbering. Frozen or independently advanced fake clocks remain explicitly unsupported by this conversion.
- **Scope/style:** eleven changed files, all tests except seven documentation lines on an existing dependency interface. No runtime dependency, generated bundle or package-version edit; build reproduction is clean. The prior review's other settled product findings were not reopened.

## Inputs for the next wave

No product fix wave is required by this review. S1 can be one optional test-only cleanup row over the converted option construction and the helper comment. Keep the actual completion markers and the strict comparison; do not restore timer-duration thresholds or add a tolerance. The bundle regression must continue to use both committed plugin paths, a fresh process, the 4.1 s pre-load stall, scratch HOME/runtime/CLI and a separate stale control. The handoff contract remains process start minus 2 s; its observation wait remains 3 s; the slow-suite wait in this fixture remains 400 ms. Keep one injected epoch-clock call in the handoff check and preserve the current-revision write-transaction decision. The coordinator owns board/status updates and landing.
