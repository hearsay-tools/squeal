# 004 wave 4 review

## Verification

Tested HEAD: `96cb80744a0b90f621ef316131174887ec5fdb57`, version 0.1.61. The brief pins `4c7e1eb^..21cd841`: 004-28, 004-30, 004-31, 004-32, 004-29, 004-34 and their 0.1.60/0.1.61 bundles. HEAD is the subsequent documentation-only landing record. `git diff --name-only 21cd841..HEAD -- src plugins package.json` returned nothing. The executable candidate therefore matches the brief. The intervening 001 documentation commits are outside this review.

The tracked tree was clean before and throughout executable verification, including after the build. No product code was changed. All probes used one private directory under `/tmp`, fixture repositories and fixture stores; no probe opened this repository's store or the cezar checkout. Probes and their scratch were removed before the review commit.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.61 lint
> biome check .
Checked 652 files in 206ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.61 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.61 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.61 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  279 passed | 1 skipped (280)
     Tests  2115 passed | 10 skipped (2125)
  Duration  192.97s
exit 0
```

`npm ci` warned about installation scripts not approved in npm's allowScripts for the optional watcher and esbuild; installation and build succeeded. Build follows the explicit AGENTS.md and reviewer gate, as the preceding wave reviews did; the common no-build rule is for implementation workers. Both committed plugin bundles remained unchanged.

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ npx vitest run
Test Files  4 failed | 275 passed | 1 skipped (280)
     Tests  4 failed | 2111 passed | 10 skipped (2125)
  Duration  252.75s
exit 1

$ npx vitest run test/cli/codex.test.ts test/harness/bundles.test.ts \
  test/harness/starting-daemon.test.ts test/runners/node-test/fixtures.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  4 passed (4)
     Tests  65 passed (65)
  Duration  26.86s
exit 0
```

| Node 22 full-run failure | Evidence and disposition |
| --- | --- |
| `test/cli/codex.test.ts:102` | 5 s timeout. The entire file passes in isolation; init source is unchanged in this range. |
| `test/harness/bundles.test.ts:254` | The second fake CLI's `ran` marker was absent. The entire file passes in isolation. No cause was isolated; this is not proof of a wave defect. |
| `test/harness/starting-daemon.test.ts:83` | 1493.3 ms against a 1250 ms upper bound. The entire file passes in isolation; the settling path is unchanged. |
| `test/runners/node-test/fixtures.test.ts:265` | The generated project's Node process exited 1. The entire file passes in isolation; this fixture and its run path are unchanged. |

Background Squeal also reported two baseline failures in `test/daemon/step-down.test.ts:80,150` (expected spawned/alive, received alive/unavailable). The explicit Node 24 full run passed that file. Its isolated rerun confirms:

```text
$ npx vitest run test/daemon/step-down.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
     Tests  3 passed (3)
  Duration  20.00s
exit 0
```

Neither full-suite output proves the four issues below absent: the independent probes exercise configurations those tests do not cover. One full run was made per required Node version; only failing files were rerun. The Node 22 full-suite gate remains recorded as failed, not replaced by an all-green claim.

## Verdict

**FAIL at `96cb807`**, whose product files equal `21cd841`. Four proven blockers, two nonblocking should-fixes, one nit. First review round on this slice.

## Blockers

### B1. Proven: a parallel tier gives every file the first file's artifact provenance

Location: `src/core/scheduler/slow-tier.ts:295,337`; introduced by 004-34.

Spec D8 requires a failure to name what its own run tested; goal 6 requires truthful status. D5 permits different input declarations per test file.

Reproduction, on Node 22 and 24: a real scheduler and store, with a deterministic adapter returning one failing check per file, an idle consumer, calm injected load and `slow.maxParallel: 2`. Two slow files share a runner lane:

```json
{
  "slow": { "include": ["test/*.test.js"], "maxParallel": 2 },
  "inputs": {
    "test/a.test.js": ["dist/a/**"],
    "test/b.test.js": ["dist/b/**"]
  }
}
```

Both artifact directories contain a file. The selected tier contains both tests. The stored artifact mappings and actual delivered text are:

```text
ARTIFACTS {"runs":[["test/a.test.js","test/b.test.js"]],"a":["dist/a/**"],"b":["dist/a/**"]}
Slow tier: 2 test files; 2 current against dist/a/** as of revision 0. Not covered by Stop's wait.
FAIL  test/b.test.js > works
      first observed: FAIL, slow tier, Squeal's run saw it at revision 0, against dist/a/** as of revision 0
```

`#select` captures only the first file's declaration; `recorded` assigns it to every run/current key in `tierKeys`. Test B's actual key still includes `dist/b/**`, so this finding concerns provenance, not the key's content. It reopens the per-result artifact guarantee established in earlier waves.

One-worker fix: capture artifact globs per selected file before execution, then record each file's run key and any post-observation key with that file's globs in the result transaction. Keep the existing failure-key selector. A regression must assert both the stored mappings and delivered B failure/header, with different declarations and with observation changing a file's key.

### B2. Proven: a wide node:test slow tier still runs at runner.tierSize, and its unstarted files bypass edit and shutdown checks

Changed boundary: `src/core/scheduler/slow-tier.ts:273,299`, 004-34's multi-file selection. Caller/callee seam: `src/core/daemon/node-test-runners.ts:140`, `src/runners/node-test/adapter-project.ts:156`, `src/runners/node-test/run/run.ts:124,142`.

The 004-34 brief requires an idle tier to run with that many workers, including node:test concurrency. D2 says a new edit takes precedence before the next slow file, while an already in-flight file finishes. The 004-29 drain bound must not launch further slow files during shutdown.

Reproduction, on both Node versions: `slow.maxParallel: 3`, `runner.tierSize: 1`, one fast file and three slow node:test files A/B/C in one project. Use the real node:test adapter with the daemon's concurrency callback returning 1, the real scheduler/composite/store and a deterministic fast adapter. Each slow file writes a started marker, then waits on its own release flag. Hold the consumer in-turn until the fast baseline drains, then end its turn to allow an idle slow tier.

The scheduler selects all three and holds three permits, but only A starts. Edit the fast file, hold its fast run, then release A and B. Alternatively, call `scheduler.close()` while only A has started, which is the scheduler shutdown used at the drain bound. The actual child markers show:

```text
EDIT_B {"chosen":[["test/a.test.mjs","test/b.test.mjs","test/c.test.mjs"]],"fastHeld":true,"startedAfterClose":false}
EDIT_C {"fastHeld":true,"startedAfterClose":false}
BOUND_B {"chosen":[["test/a.test.mjs","test/b.test.mjs","test/c.test.mjs"]],"fastHeld":false,"startedAfterClose":true}
BOUND_C {"fastHeld":false,"startedAfterClose":true}
```

Thus the idle tier is serial despite `maxParallel: 3`; B and C start while an edit's fast tier is running, and can start after close. The pump rechecks only between tiers, while the node:test worker queue advances inside a noncancellable slow tier. The shutdown probe checks that scheduler seam, not an independently timed real-daemon bound; the daemon's bound calls this same close path (`daemon.ts:469`). New 004-29 daemon tests have only one slow file, so they cannot expose the widened queue.

One-worker fix: make slow node:test concurrency follow the selected slow tier's width, independently of fast `runner.tierSize`. Do not hand a slow adapter more files than it can start together; if an adapter retains an internal queue, return its unstarted files to scheduler control before starting them after an edit or close. Keep finish-and-revalidate for files already started. Add a real adapter/daemon regression with unequal `maxParallel` and `tierSize`, startup markers, an edit, and a drain bound. Checking only the array passed to `run` is insufficient.

### B3. Proven: gitignored symlinked build directories still omit their bytes, allowing a different build to inherit a pass

Location: `src/core/keys/ignored-inputs.ts:22`, reached from `src/core/scheduler/keying.ts:152,416`; 004-28.

Goals 3 and 5, D5/D6, and 004-28's done-when require the declared artifact's bytes to enter the key. The review brief explicitly asks about symlinked build directories.

Reproduction, on both Node versions: two actual git worktrees of a fixture share one fixture store. Ignore `dist` and `real-build/`; create `dist -> real-build` in each worktree, with different `real-build/index.js` bytes. The test's static closure contains only the test. Declare `["dist/**", "build.json"]`, where the tracked build metadata file `build.json` is identical in both.

`ignoredInputs(root, ["dist/**"])` returns `[]`: git lists the link itself and never traverses it; `dist/**` does not match `dist`. Neither worktree receives a declared artifact extra. Their slow keys are equal. Run a deterministic pass in A; B's adapter would return a failure if called. Start B against the shared fixture store:

```text
SYMLINK_LIST []
SYMLINK_START {"equal":true,"extraA":[],"extraB":[]}
SYMLINK_INHERIT {"equal":true,"runsB":[],"statesB":[
  {"outcome":"pass","validity":"current","origin":{"kind":"inherited", "...":"A"}},
  {"outcome":"pass","validity":"current","origin":{"kind":"inherited", "...":"A"}}
]}
```

The two inherited states are the test check and its file check. The identical metadata file satisfies the existing D6 predicate, so missing build bytes cause an actual inherited current pass, not merely over-running or a no-artifact note. With only `dist/**`, inheritance is refused, but the build is still absent from its startup key and watch extras. A manually supplied `dist/index.js` batch can add it to a key later; that does not repair startup or the omitted extra watch.

One-worker fix: expand declared artifact globs through permitted symlinked project directories as well as git's ignored-file list, using the watcher/keying path conventions and loop/outside-repository limits. Hash and watch the matching files under the declaration's worktree-relative paths; exclude `node_modules`. Add the two-worktree differing-build/inheritance probe as a test, plus an artifact edit. Coordinate with the 001 watcher owner if this requires changes there.

### B4. Proven: a genuine source addition at revision 1 is treated as a startup scan

Location: `src/core/state/slow.ts:221`; 004-31.

D8 says the line includes "sources changed since" when a source changed after the build's revision without a rebuild. Defect 8d calls for excluding the fresh worktree's initial listing, not every add-only revision numbered 1.

Reproduction, on both versions: start a scheduler with a slow test and declared `dist/**`, and complete it at revision 0. Add `src/new.js` through a normal watch batch without touching the artifact. The real store contains:

```text
revision: 1
changes: [{"path":"src/new.js","oldHash":null,"newHash":"f32ce5779437de02bc1c6831e6301064a46cc864"}]
slow: {"current":1,"currentAt":0,"artifact":["dist/**"],"sourcesChangedSince":false}
```

This is a real source edit after validation, not an initial filesystem listing. The new predicate suppresses it solely because the revision is 1 and every old hash is null.

One-worker fix: distinguish a startup listing from a watch-time source addition using actual scan provenance, rather than revision number and hash shape alone. Add paired status tests for a genuine add-only first watch revision after a revision-0 run and the initial-listing case; retain the slow-test/fixture exclusions from 8a.

## Should-fix

### S1. Plausible contract gap: different repositories' maxParallel values do not define one user-wide cap

Location: `src/core/slow/slot.ts:74,78`; spec D2's per-user permits, D7's per-repository policy.

A direct permit probe is proven: a client configured for 1 holds `slow.lock`; a client configured for 4 acquires three other permits beside it, for four total. The lower client's configuration therefore does not constrain the user's total. The same indexes do enforce the largest participating configuration; no same-value overflow was found.

Whether this breaks an intended limit is unresolved because D2 does not define whose value wins across repositories or a policy reload. This is not blocking. One-worker-sized follow-up: specify the shared-limit rule and encode a mixed-policy regression. If the limit is only the maximum participating value, say so; if it is a fixed user policy or a negotiated smaller cap, the slot must persist/enforce that rule. The brief's per-user claim needs this definition.

### S2. Proven test gap: the real drain tests start their slow file before the session ends

Location: `test/daemon/drain.test.ts:97,118`; 004-29's "slow files pending when the last session leaves" outcome.

`draining()` waits for the slow file's started marker, then every test calls SessionEnd. These tests prove retention of an in-flight file, cancellation of the exit by a new session, and a bound around that file. They do not prove an exec-style in-turn consumer leaves queued, unstarted slow files which then begin. The timer tests use a stand-in `slowPending` boolean.

One-worker follow-up: hold the initial consumer in-turn, assert zero slow starts, end the session, then assert the pending files start and store before exit. Add more than one file, and a SessionStart/first edit before a subsequent slow file starts. No separate implementation break is claimed here; B2 covers the proven multi-file seam.

## Nits

### N1. Proven documentation drift after the D2 amendment

Location: `docs/specifications/004-slow-suites/spec.md:14,50,78,82`.

D2 now allows multiple user-wide permits and several files per idle tier. Goal 2 and D10 still say one slow tier per user and no concurrent worktrees; D4 still bounds a discarded slow run by one file; the Testing paragraph still promises interleaving file by file. These sentences no longer describe amended D2. The implementation notes describe mixed-version concurrency as well. The coordinator should reconcile these sentences and state the bound for several already-started files. This is drift to report, not a request to undo the human's amendment.

## What fits

- **004-28, proven by tests and independent probes:** literal and wildcard-leading globs select regular ignored artifacts, excluding root/nested `node_modules`. A known artifact edit changes the key. Deleting the known artifact, then rebuilding it and adding a sibling rekeys again and adds both files to extras. Policy reload selection is covered by `test/scheduler/ignored-inputs.test.ts`, passing on both Node versions. A rebuild which only adds a new ignored file remains the already planned 004-33, not a new finding.
- **004-30/004-34, proven for a common configuration:** the guard waits before acquiring permits; the suite proves two schedulers share the configured permit count, and a waiting worktree gets a turn. An independent child acquired all four permits, was killed by its own probe parent, and the next client acquired all four immediately. Its mark remained on disk but stopped counting after the 30 s freshness window; no permit leak or permanent waiter block was found. Crash marks are inert filesystem remnants, not held permits.
- **D2's gate, proven at scheduler selection:** a slow tier can start beside held backlog work; pending/refining edit work and a held edit tier block a new slow selection. Selection rechecks the trigger and idleness after the guard, and shrinks unused permits. A wide tier already actually started is allowed to finish; B2 concerns files not yet started inside the runner.
- **Fast-tier completion during a guard wait, read in source and covered by the passing suite:** `#fly` aborts the slow guard wait after a fast tier ends; the remaining budget is retained and the pump can select the next fast tier. No endless retry was reproduced. This is not a starvation proof for arbitrarily many worktrees or continuous edits.
- **004-29, proven within the covered cases:** no slow work exits after the grace; an in-flight slow file survives the last departure and stores; a session counted during the drain cancels the exit and continues to be served; drain ticks do not update activity; the departure-based bound is covered by timer and real-daemon tests. Registration racing the exact final cross-process presence read was not independently proved safe or unsafe.
- **004-31, proven except B4:** slow-test/fixture changes alone do not cause the source-warning suffix. Current results' minimum/maximum observed revisions form the text's revision range. A down daemon retains the JSON wait reason as "last reported waiting for", without claiming it is live. The four intended wording cases pass in the status suite.
- **004-32, proven by the guard test:** two copies of the node:test runtime under different plugin roots yield equal environment/closure inputs, including the slow file's spawned CLI load. No adapter-version bump or key change was needed.
- **D3 to D7:** bounded load deferral, stability/discard, explicit triggers, no-artifact inheritance refusal, policy validation/defaults and Stop behavior remain covered by the passing focused files in both full runs. B1 changes artifact reporting, not the keyed-input stability check.

The large-repository question was measured on Node 24, load 79.16 with 24 CPUs, in a synthetic fixture containing 10,000 ignored artifact files, 5,000 other ignored files and 5,000 installed-package files:

```text
ignoredInputs("dist/**"):    10,000 matches; 28, 23, 26 ms
ignoredInputs("**/dist/**"): 10,000 matches; 32, 28, 34 ms
scheduler.start(): 5756 ms; 10,000 artifact extras
```

Listing alone was small in that fixture; hashing, statting and persisting the selected bytes also count toward startup. The 5756 ms is total cold fixture scheduler startup, not an isolated attribution to this patch or a calm-load benchmark. Larger repositories and retained-memory cost are unverified. There is no spec startup budget for this row to fail.

## Inputs for the next wave

1. Keep the two lanes and the amended recent/backlog gate. B2's fix is at the scheduler/runner concurrency seam; do not make fast tiers wait behind slow runs, cancel already-started slow files on edits, or reset the guard budget on every retry.
2. Give B1 a per-file artifact snapshot with per-file run/current keys, written in the same transaction as results. Preserve the existing failure-key lookup so delayed and inherited failures keep their own run's declaration.
3. Give B2 real process-start evidence at unequal policy widths. At an idle selection, only files that can start together should become the noncancellable tier. At an edit or drain bound, finish already-started files; unstarted ones must remain under scheduler control.
4. Give B3 the symlinked artifact fixture with two different builds and an identical declared metadata file. Merely testing that no-artifact inheritance is refused will miss the false-pass path. Hashing and extra watches must use compatible paths. Any watcher work crosses into the 001 lane and needs coordinated ownership.
5. Give B4 a real source addition after a revision-0 result, paired with a real initial-listing case. Do not identify initial discovery solely by "revision 1, all adds".
6. Keep 004-33 (addition-only ignored rebuilds) and 004-35 (naming every running slow file) visible. The latter was already planned before this review; it is not added to these blocker counts.
7. Decide S1's cross-repository limit semantics; strengthen the queued-at-departure proof in S2; align the remaining spec wording with amended D2. Node 22's full-run failures all passed isolated, but a fully green Node 22 full run was not observed in this review.
