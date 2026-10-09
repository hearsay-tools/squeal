# 004 wave 4.6 review

## Verification

Tested HEAD: `1c9189fb5bfb5ce5fc0002992e64860f99bafd2b`, version 0.1.67. The 004-43 brief names `aadc80b` (004-42), `f70fd92` and `435c695` (004-41 with 004-33), `92b2083` (004-35) and bundle commit `9833c33`. `git diff --name-only 9833c33..HEAD` lists only the board, status and task brief. The executable candidate matches `9833c33`; there is no candidate mismatch. The intervening 001 work is outside scope except checking 004-42's reliance on 001-166 (`4d7c203`).

This is the human-approved fourth and last review of `reviews/wave-4.5.md` B1 and B2, limited to those cases and what their fixes touch, and the first review of 004-33 and 004-35. Earlier wave-4.5 closures were not re-prosecuted. Executable verification used the clean tracked candidate, including after building both committed plugin bundles. Independent probes imported its freshly built `dist`, used one private `/tmp` directory, and opened only fixture repositories, worktrees, stores and permit directories. They used a deterministic adapter, the real scheduler, state sink, hasher and change feed. A deaf controlled watcher isolates reconciliation behavior; it does not claim this host's real backend loses a particular event. No product code was changed; scratch was removed before the review commit.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 7s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.67 lint
> biome check .
Checked 667 files in 351ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.67 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.67 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.67 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  8 failed | 282 passed | 1 skipped (291)
     Tests  8 failed | 2185 passed | 10 skipped (2203)
    Errors  1 error
  Duration  421.05s
exit 1

$ npx vitest run test/cli/codex.test.ts test/delivery/registered.test.ts \
  test/e2e/lifecycle.test.ts test/harness/stop-require-slow-snapshot.test.ts \
  test/scheduler/observed-growth.test.ts test/scheduler/refinement-lock.test.ts \
  test/watcher/linked-dirs.test.ts test/runners/node-test/fixtures.test.ts \
  test/daemon/handover.test.ts test/daemon/lifecycle.test.ts \
  test/harness/bundles.test.ts test/harness/codex/bundles.test.ts \
  test/harness/step-down.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  13 passed (13)
     Tests  158 passed (158)
  Duration  187.71s
exit 0
```

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ npx vitest run --maxWorkers=4
Test Files  2 failed | 288 passed | 1 skipped (291)
     Tests  2 failed | 2191 passed | 10 skipped (2203)
  Duration  450.47s
exit 1

$ npx vitest run test/daemon/busy-store.test.ts test/daemon/lifecycle.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  1 failed | 1 passed (2)
     Tests  1 failed | 11 passed (12)
  Duration  165.61s
exit 1
```

One full gate per Node version. The Node 22 gate limited file workers to four after the Node 24 run observed load 132; it still ran every test file. All regression files in this review's scope passed in both full gates. Isolated reruns covered only files with explicit-gate or background Squeal failures.

| Failed check | Full-run evidence | Isolated outcome and scope |
| --- | --- | --- |
| Node 24, `test/cli/codex.test.ts:103` | 5 s timeout. | File passed. Init is outside this slice; unverified as a wave defect. |
| Node 24, `test/delivery/registered.test.ts:400` | 5 s timeout. | File passed. Unchanged query-cost gate; unverified as a wave defect. |
| Node 24, `test/e2e/lifecycle.test.ts:80` | Hook took 2033.2 ms against 2000 ms. | File passed. Unchanged lifecycle timing; unverified as a wave defect. |
| Node 24, `test/harness/stop-require-slow-snapshot.test.ts:115` | 5 s timeout. | File passed. The previously settled Stop snapshot path was not reopened; unverified as a wave defect. |
| Node 24, `test/scheduler/observed-growth.test.ts:176` | Default poll did not observe B's first closure; teardown then raised `database is not open` through `stopWaiting`. | File passed without the unhandled error. This load-sensitive poll/teardown shape is already on the board; unverified as a wave defect. |
| Node 24, `test/scheduler/refinement-lock.test.ts:47` | Revision call took 510.1 ms against 500 ms. | File passed. Unchanged timing gate; unverified as a wave defect. |
| Node 24, `test/watcher/linked-dirs.test.ts:64` | The first logged batch held `lib`, without `lib/a.ts`. | File passed. First-batch assertion does not discriminate watch hints from the interval walk. The independent linked-start control proves the reviewed startup-seed reliance; this failure is unverified as a slice defect. |
| Node 24, `test/runners/node-test/fixtures.test.ts:265` | Generated fixture's child run exited 1. | File passed. No cause isolated; adapter/fixture execution is outside this slice, unverified as a wave defect. |
| Node 22, `test/daemon/busy-store.test.ts:80` | Expected both writer children to have empty stderr; received SQLite experimental and EnvHttpProxyAgent warning text. | Reproduced alone with the same warning-only mismatch. This is the known 001-161 failure explicitly excluded by the brief, not a slice blocker. |
| Node 22, `test/daemon/lifecycle.test.ts:30` | Five-start probe could not observe a serving daemon within 60 s. | File passed. Singleton/startup path is unchanged by the named rows; unverified as a wave defect. |

Background Squeal also reported seven Node 24 baseline failures. Its latest status on the clean candidate says `Known failures: 7`, `Affected checks: 2477 passed, 0 running, 0 queued, 10 skipped`, and `Full-suite checkpoint: completed at revision 1`. These recorded failures remain in its store; an explicit isolated rerun does not clear that status. Every affected file was included in the 13-file rerun above, which passed: `daemon/handover` (expected spawned, observed alive), `daemon/lifecycle` (CLI start exited 1), `delivery/registered` (5 s timeout), `e2e/lifecycle` (bad-config startup readiness timeout), both harness bundle tests (5 s timeouts), and `harness/step-down` (expected a request, observed none). Their causes were not isolated as slice defects, so they are unverified against this wave. There is no all-green full-suite claim.

The build follows AGENTS.md and the reviewer gate. Implementation workers' no-build rule does not remove that gate. `npm ci` warned about unapproved optional-watcher and esbuild install scripts; installation and build succeeded. The bundles stayed unchanged. Full-suite failures stay recorded even when their files pass alone. An unrelated failure, or a check whose cause cannot be isolated, is not a proven blocker against this slice.

Independent probes exited 0 on Node `v24.21.0` and `v22.23.3` with identical normalized evidence. Their assertions confirm the failing observation under B1 as well as the passing controls:

```text
$ node --disable-warning=ExperimentalWarning <scratch>/probe.mjs <scratch>/fixtures
B1: wildcard and literal [dist/index.js]; different keys; B runs=1, no inherited pass
B2: empty startup revision=0; source interval addition revision=1, sourcesChangedSince=true
004-33 quiet control: addition discovered, key moved, watched=true
004-33 mixed interval: {"revision":4,"keyUnchanged":true,"lateWatched":false,"slowRunsSinceAddition":0,"current":1}
004-33 next quiet interval: late file discovered, key moved
exit 0 (both Nodes)

$ node --disable-warning=ExperimentalWarning <scratch>/startup.mjs <scratch>/fixtures
001-166 reliance: linked initial source hashed, feed starts revision=0, sourcesChangedSince=false
exit 0 (both Nodes)
```

## Verdict

**FAIL at `1c9189f`**, executable candidate `9833c33`. One proven new blocker in 004-33's first review, zero should-fixes, zero nits. Both prior wave-4.5 blockers are closed. 004-35 meets its running-file done-when. The new blocker is reproduced on Node 22 and 24 and is independent of host load and test timing.

## Blockers

### B1. Proven, 004-33: an interval with a source change never lists the new ignored build inputs

Location: `src/core/scheduler/keying.ts:300` (the new discovery is attached to `lockfileCandidates`), `:309` (unwatched ignored inputs); caller boundary `src/core/scheduler/batch.ts:38`. The unchanged caller's empty-diff condition is the seam the new implementation relies on, not a separate finding against pre-existing 001 code.

004-33's brief requires: "re-list the ignored declared inputs on the interval reconciliation pass ... so a file that appears in an ignored declared directory joins the key within 30 s without a reload or restart". Its done-when says "a rebuild that only adds a file re-keys within one reconciliation". Goal 3 requires a slow file to re-run when its declared artifact inputs change. The new discovery is skipped whenever that same interval found any ordinary source change.

Reproduction on both Nodes:

1. Commit a fixture with an ignored `dist/`, a slow file with static closure containing only itself, declared inputs `["**/dist/**", "build.json"]`, and tracked `src/source.js`. Create ignored `dist/index.js`; run the real scheduler to a current pass. Start the real feed with a controlled backend providing no hints.
2. The passing addition-only control adds `dist/added.js`, invokes `feed.reconcile("interval")`, and observes a changed key, watched extra and re-run. Wait until its result is current and save the key and run count.
3. Add `dist/late.js` without modifying any already watched build file. Modify the unrelated tracked `src/source.js`, then invoke the same real interval reconciliation and wait for scheduler refinement. Modify that source again and reconcile again. Each interval finds a source diff, so the new build file is absent from both revisions and from the extra watch list.
4. Read the key, activity and store-backed header. The actual output is:

   ```json
   {"revision":4,"keyUnchanged":true,"lateWatched":false,"slowRunsSinceAddition":0,"current":1}
   ```

5. Run one more interval without another source edit. It discovers `dist/late.js`, changes the key and re-runs the slow file. This passing control rules out a glob, hashing or fixture-install failure.

`reconcileBatch` calls `keys.lockfileCandidates()` only when `diff.changes.length === 0` and the trigger is not `watch`. 004-33 attached its ignored-file re-list to that helper. An unrelated source edit does not set `#ignoredStale`, whose other path is an edit to an already known declared extra. Thus neither discovery path executes for the added build file. The result remains current under its old key, despite the artifact gaining declared bytes. Repeated intervals with source changes postpone discovery without a bound. This requires no claim about particular watch-event loss: one ordinary changed candidate in the interval suffices to defeat the stated done-when.

One-worker fix: list new ignored declared inputs on each interval independently of whether its ordinary candidates changed. Coordinate the small batch seam with the 001 owner because wave-4.6 explicitly left `batch.ts` outside the implementation worker's ownership. Keep installed-lockfile behavior scoped as before. Reconcile the newly found build candidates together with the original source candidates, preserving both sets of changes and cache updates; merely removing the empty-diff guard would let the current `diff = { ...lockfiles, ... }` replacement drop the source changes. The revision, content re-key and pending states must keep their existing transaction contract.

Add a regression through the real feed with no hints: addition-only ignored rebuild plus a changed non-input source in the same interval. Assert the build file joins the key and extra watch list in that first pass, its slow file runs, and the source change is also retained. Keep the quiet-pass control and cover an ordinary ignored directory and a tracked ignored build link. Run on Node 22 and 24. This is 004-33's first round, not another reopening of the last-round tracked-link or source-warning cases.

## Should-fix

None.

## Nits

None.

## What fits

- **Prior wave-4.5 B1, proven closed:** tracked link discovery reads only mode `120000` index entries (`ignored-inputs.ts:75`) as candidates, then applies declared-glob reach and the existing link limits. The independent two-worktree probe actually tracks `dist -> real-build` under `dist/` and `real-build/` directory-only ignores, uses `["**/dist/**", "build.json"]`, and creates different ignored build bytes. Wildcard and literal declarations both enumerate `dist/index.js`; keys differ and B runs instead of inheriting A's pass. Candidate scheduler regressions also cover artifact edits and equal builds equalizing keys. No tracked-link/wildcard escape remains in the approved case.
- **Prior wave-4.5 B2 and 004-42, proven closed:** `sourcesChanged` no longer suppresses first interval additions (`slow.ts:220`). The independent real feed starts empty at revision 0 after the slow run, then finds a genuine source addition through interval reconciliation: revision 1 has `sourcesChangedSince: true`. Status regressions retain watch/start controls and later intervals. Startup reconciliation is an ordinary edit boundary, not an inferred discovery label.
- **001-166 reliance, proven:** bootstrap seeds the linked files the feed would walk (`keying.ts:162`, `watcher/linked-files.ts:16`), using the same walker and watch exclusions. An independent fixture with a tracked source-directory link has its aliased source cached before the real feed starts, makes no startup revision and has no false source-warning. Candidate `linked-start.test.ts` also covers source additions during watch startup, later interval additions and edits through the source link. Only this dependency was reviewed from the intervening 001 range.
- **004-33's quiet-pass case, proven:** both the ordinary ignored-directory and tracked-link candidate regressions add a chunk without a watch hint, then use an empty interval batch to get a changed key and extra watch entry. The real-feed probe confirms that path and the subsequent edit tracking. B1 above concerns the untested nonempty interval seam, not failure of the implemented empty-pass case.
- **004-35, proven by source contract and candidate regressions:** selection publishes every selected path in the transaction that marks the tier running (`slow-tier.ts:301`), decoding preserves the additive `paths` (`slow/state.ts:54`), and header reading filters each member against running slow key rows (`state/slow.ts:192`). Rendering names two and counts the rest (`slow-text.ts:38,57`), with the existing single-file shape as fallback. Tests cover one, two and three running files, finished members disappearing, remaining queued files still counted, and the real scheduler's held two-file idle tier. No old first-file-only claim or finished-member running claim was found.
- **Limits retained:** ignored-link enumeration keeps declaration-relative aliases, rejects installed paths, root/ancestor loops, other repositories and nested directory links, and filters the final files against the declarations. The new `reachesBelow` predicate only gates walks; actual inclusion still uses the existing input matcher. Existing boundary tests cover these limits. macOS remains unverified, outside the bounded review.

## Inputs for the coordinator

1. The approved final round for prior B1 and B2 is finished; both close. Do not dispatch another review of settled wave-4 cases. 004-35 is also accepted by this review.
2. Dispatch one worker-sized repair for the first-round 004-33 blocker, if continuing the slice. Its scope needs the ignored-input discovery plus the 001-owned batch seam and tests, with ownership agreed before dispatch. Preserve both source and artifact diffs in one revision, the synchronized key/pending transaction, and the same declared-glob reach and link limits.
3. Keep the failing full-suite outcomes visible with their isolated reruns; these are not the evidence used to block. The brief's known Node 22 busy-store stderr/warning issue is outside this slice. No product changes, board edits or status amendments were made by this reviewer.
