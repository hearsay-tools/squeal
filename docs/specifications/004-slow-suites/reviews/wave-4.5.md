# 004 wave 4.5 re-review

## Verification

Tested HEAD: `a850a940abd9664aa755e26255657db40642d80f`, version 0.1.63. The brief pins `96cb807..641f95b`. HEAD is the subsequent landing record; `git diff --name-only 641f95b..HEAD` lists only the board, status and task brief. The executable candidate matches `641f95b`. Scope: 004-37, 004-38, 004-39 and their bundles. The intervening 001-164/0.1.62 changes and documentation commits are outside this re-review.

This is the second and last round on this slice, bounded by `reviews/wave-4.md` B1 to B4 and S2. The tracked tree was clean throughout executable verification, including after the build. No product code was changed. Independent probes used one private `/tmp` directory, fixture Git repositories/worktrees and fixture stores. No probe opened this repository's store or the cezar checkout. Scratch was removed before the review commit.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.63 lint
> biome check .
Checked 655 files in 331ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.63 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.63 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.63 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  3 failed | 278 passed | 1 skipped (282)
     Tests  3 failed | 2135 passed | 10 skipped (2148)
  Duration  207.20s
exit 1

$ npx vitest run test/daemon/handover.test.ts test/harness/starting-daemon.test.ts \
  test/integration/revert-restore.test.ts test/cli/codex.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  4 passed (4)
     Tests  30 passed (30)
  Duration  22.99s
exit 0
```

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ npx vitest run
Test Files  2 failed | 279 passed | 1 skipped (282)
     Tests  2 failed | 2136 passed | 10 skipped (2148)
  Duration  238.66s
exit 1

$ npx vitest run test/cli/codex.test.ts test/runners/node-test/graph-cost.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  2 passed (2)
     Tests  14 passed (14)
  Duration  4.65s
exit 0
```

| Failed check | Full-run evidence | Disposition |
| --- | --- | --- |
| Node 24, `test/daemon/handover.test.ts:72` | Expected `spawned`, received `alive` while handing over a released daemon. | File passes without file parallelism. No cause isolated; unverified as a wave defect. This path is unchanged by 004-37 to 004-39. |
| Node 24, `test/harness/starting-daemon.test.ts:83` | 1763.7 ms against a 1250 ms bound. | File passes without file parallelism. Unchanged timing gate, not evidence of a slice break. |
| Node 24, `test/integration/revert-restore.test.ts:192` | Could not plant the required reverted-byte transform before asserting its validity. | File passes without file parallelism. Failure is probe setup, not a reproduced false result. Runner transform handling is unchanged in this slice. |
| Node 22, `test/cli/codex.test.ts:103` | 5 s timeout. Background Squeal also reported this timeout on Node 24; the explicit Node 24 full run did not. | Entire file passes without file parallelism on both Nodes. Init belongs to the out-of-scope 001-164 changes. |
| Node 22, `test/runners/node-test/graph-cost.test.ts:97` | Re-resolution 259.3 ms against cold build 249.7 ms. | File passes without file parallelism. Graph cost is unchanged in this slice; this comparative timing gate is already on the board's load-sensitive list. |

The independent probes, run from the clean candidate's freshly built `dist`, also exited 0 on both Nodes. Their assertions confirm the erroneous observations and the passing controls documented under the blockers, not a pass verdict:

```text
$ node --disable-warning=ExperimentalWarning <private-scratch>/inherit-linked-build.mjs <private-scratch>
tracked: dist; literal: [dist/index.js]; wildcard: []
equalKeys: true; extrasA: []; extrasB: []; runs: {a:1,b:0}
B: two inherited, current pass states
exit 0 (both Nodes)

$ node --disable-warning=ExperimentalWarning <private-scratch>/source-add.mjs <private-scratch>
watch: revision 1, sourcesChangedSince true
interval after empty startup: revision 1, sourcesChangedSince false
add during feed startup: revision 1, sourcesChangedSince false
dropped-events: revision 1, sourcesChangedSince true
exit 0 (both Nodes)
```

The build follows the explicit AGENTS.md and reviewer gate; the implementation workers' no-build rule does not remove that gate. `npm ci` warned about unapproved install scripts for the optional watcher and esbuild; installation and build succeeded. Both plugin bundles stayed unchanged. One full run was made per required Node version; only failing files were rerun. Full-suite failures are recorded, not converted into an all-green claim by isolated reruns. A failure outside the slice is not proof of a blocker in this wave.

## Verdict

**FAIL at `a850a94`**, executable candidate `641f95b`. Two proven remaining blockers, zero new should-fixes, zero new nits. Prior B1, B2 and S2 are closed. Prior B3 and B4 have their original examples repaired but remain open for the cases below. Both remaining breaks were reproduced on Node 22 and 24. Under the brief's final-round rule, they go to the human through the coordinator; this review does not authorize another repair/re-review round.

## Blockers

### B1. Proven, remaining wave-4 B3: a tracked build-directory link is missed by a wildcard-leading declaration

Location: `src/core/keys/ignored-inputs.ts:38,55-60,86`; 004-38's link discovery. The scheduler consumes this list in `src/core/scheduler/keying.ts`.

Goals 3 and 5, D5/D6, and 004-38's differing-build done-when require the declared artifact's bytes to enter its key. The fixed literal `dist/**` case holds. A wildcard-leading glob still allows a different build to inherit a current pass.

Reproduction on both Nodes, with two actual Git worktrees sharing only a fixture store:

1. Track a relative `dist -> real-build` symlink. `.gitignore` contains `dist/` and `real-build/`. Git permits tracking the link because `dist/` is a directory-only rule. Put different `real-build/index.js` bytes in each worktree. The target directory is generated and ignored.
2. Commit identical `build.json`, the slow test and this policy in both worktrees:

   ```json
   {
     "slow": { "include": ["test/slow.test.mjs"] },
     "inputs": { "test/slow.test.mjs": ["**/dist/**", "build.json"] }
   }
   ```

3. Run a real scheduler in A with a deterministic adapter returning a pass. Start a second real scheduler in B whose adapter would return a failure. Each adapter's static closure is only its test file. Inject calm load and give the probe its own permit directory.

Normalized output is identical on Node `v22.23.3` and `v24.21.0`:

```text
git ls-files dist: dist
ignoredInputs("dist/**"):    ["dist/index.js"]
ignoredInputs("**/dist/**"): []
equalKeys: true
extrasA: []
extrasB: []
runs: {"a":1,"b":0}
statesB: [
  {"outcome":"pass","validity":"current","origin":{"kind":"inherited","worktreeId":"A"}},
  {"outcome":"pass","validity":"current","origin":{"kind":"inherited","worktreeId":"A"}}
]
```

The states are the test check and its file check. `build.json` satisfies D6's existing-artifact predicate, so this is a demonstrated false-pass path, not merely a missing watch or an inheritance-refusal note.

The new discovery asks Git only for `--others`, both ignored and unignored. A tracked link appears in neither list. A literal glob finds the link through its prefix/ancestors; `**/dist/**` has an empty literal prefix and contributes no such candidates. The build never enters the key or watch extras. The shared `ignoredLinks` predicate deliberately treats the directory-only ignored link as an ignored directory, so relying on the ordinary watcher does not supply those bytes at startup either.

One-worker repair if the human chooses it: include tracked symlinked directories among link candidates independently of a glob's literal prefix, then apply the same ignored-directory, installed-package, loop and other-repository limits before expansion. Do not add all tracked regular files to the ignored-file output. Preserve declaration-relative paths through the link for hashing and watching. Extend the two-worktree regression with a tracked link and wildcard-leading glob, identical tracked metadata, different generated builds, and an artifact edit. Keep the working literal/untracked-link cases.

### B2. Proven, remaining wave-4 B4: interval is not provenance for an initial listing

Location: `src/core/state/slow.ts:224,228-234`; 004-39. Evidence boundary: `src/core/watcher/change-feed.ts:118-121,238-245`.

D8 requires "sources changed since" when a source changed after the tested build's revision without a rebuild; goal 6 requires truthful status. The first `watch` and `start` add cases are fixed. A genuine first source addition discovered by `interval` is still suppressed by revision number and hash shape, with the generic trigger added to the heuristic.

Reproduction on both Nodes: use a real scheduler, state sink, store, filesystem hasher and change feed, with a deterministic passing adapter. Run the slow file against declared `dist/**` at revision 0. Complete feed startup with no changes, proving initial discovery finished and the revision remains 0. Create `src/new.js` without changing the artifact, with a controlled backend that supplies no watch hint, then call the real feed's `reconcile("interval")`, the method its ordinary idle timer calls. Wait for scheduler refinement.

```text
revision: 1
trigger: interval
changes: [{"path":"src/new.js","oldHash":null,"newHash":"0eaecc096f4cb8763371e2e97cd3bd1b98b75bf6"}]
slow: {"current":1,"currentAt":0,"artifact":["dist/**"],"sourcesChangedSince":false}
Slow tier: 1 test file; 1 current against dist/** as of revision 0. Not covered by Stop's wait.
```

A second variant writes the source in the controlled backend's `watch()` call, after the revision-0 run and before the feed's first reconciliation. This also records the actual source addition as an `interval` revision 1 and omits the warning. The source comment at `change-feed.ts:118` explicitly states that startup reconciliation can contain an agent's real edit; it is an ordinary reconciliation, not discovery-only provenance.

Controls on both Nodes, with the same real source addition and revision-0 pass:

| Detection | Actual revision trigger | `sourcesChangedSince` |
| --- | --- | --- |
| Explicit watch batch | `watch` | `true` |
| Dropped-events reconciliation | `dropped-events` | `true` |
| Interval reconciliation after completed empty startup | `interval` | `false` |
| Source added during feed startup | `interval` | `false` |

The controlled backend isolates a missing hint and the startup boundary; it is not a claim that this host's real backend loses a particular edit. The state/feed failure is deterministic and needs no timing or load assumption. The run, artifact bytes and revision came from real product paths, not manually constructed revision rows.

One-worker repair if chosen: distinguish discovery from edits with actual discovery provenance or seed initial linked-directory contents without a source-change revision, as planned in 001-166. A generic `interval` plus "revision 1, all adds" cannot identify discovery. Coordinate that watcher ownership with the 001 coordinator. Add a regression that starts the feed empty, makes a genuine addition before its first later interval, and asserts the warning, plus the edit-during-startup case; retain a genuine initial-listing control and the working watch/start/dropped-events cases.

## Should-fix

None newly filed. Prior S2 is closed below. Prior S1's mixed-policy permit semantics were settled in D2 and the amendment log; this delta does not reopen them.

## Nits

None newly filed. Prior N1's spec wording was reconciled with amended D2; specification/review documents are outside product prosecution in this bounded re-review.

## What fits

- **Prior B1, proven closed by the passing candidate regressions and source contract:** `SlowRun.artifacts` snapshots declarations by test-file id at selection (`slow-tier.ts:296-305`). Recording associates each file's run and post-observation keys with that same file's globs (`:340-347,463-465`), in the result transaction. `test/scheduler/slow-artifact.test.ts` checks different declarations in one parallel tier, the delivered second-file failure, the header and both run/current keys after observed growth. No first-file artifact leak remains in the covered cases.
- **Prior B2, proven closed:** the real node:test adapter omits fast `runner.tierSize` concurrency for a slow-lane run (`adapter-project.ts:157-161`); `runNodeTest` defaults to the number of selected files and starts each worker before its first await. The real-adapter scheduler tests use `maxParallel: 3`, `tierSize: 1` and process-start markers, then a held edit and close. All selected files actually start before either boundary; no delayed internal worker queue survives.
- **004-37's one-project rule, proven:** `runnerOf` combines the slow lane with the configured node:test project (`slow-tier.ts:441-445`). The multi-project regression has two held files in each project and `maxParallel: 4`; exactly one project's two files start, and the other project stays unstarted while the edit's fast tier is held. This closes the sequential-composite seam which merely widening adapter concurrency would miss. The existing fast concurrency path still uses its callback.
- **Prior S2, proven closed:** `queuedInTurn()` starts and prompts a real consumer before waiting for the fast baseline. The new drain regression asserts zero slow starts while in-turn, ends that session, then observes both formerly queued files start and store before exit. Its `maxParallel: 1` companion registers/prompts a new session and edits before the second file starts, confirms the fast failure arrives and the second slow file stays unstarted, then fixes and stops so the second starts. Both real-daemon cases pass on both Nodes. Existing single-file drain-bound coverage remains; the widened node:test close seam is covered by the real-adapter close test.
- **Prior B3's original example, proven repaired:** the candidate's two-worktree regression over an untracked ignored `dist -> real-build` with literal `dist/**` and identical `build.json` keys different builds differently, runs the second worktree, exposes `dist/index.js` as an extra, re-keys on an edit and equalizes keys when builds become equal. The real Linux/chokidar feed test observes rewriting the target as `dist/index.js`. B1 above concerns the still-uncovered tracked-link/wildcard combination.
- **004-38's exported watcher predicates, read in source and covered by passing boundary tests:** the delta only exports `holdsRoot` and `inOtherRepository`; their bodies are unchanged. Link expansion calls them with the resolved root and target before walking. The candidate tests retain no root/ancestor loop, no other repository, no `node_modules` path and no nested link. No predicate regression was found.
- **Prior B4's original watch-add example, proven repaired:** paired status tests pass for first-revision `watch`/`start` source additions and an initial interval listing; the independent real-scheduler watch and dropped-events controls warn. B2 above retains the ambiguity of genuine interval additions.

## Inputs for the coordinator

1. This closes the second/last review round. Present the two remaining prior blockers to the human; do not silently dispatch another fix wave. Prior B1, B2 and S2 need no repeat architecture review.
2. A B3 repair belongs to ignored-input discovery/keying and its tests. Preserve the watcher predicates, per-declaration alias paths, `node_modules` exclusion and no-loop/no-other-repository rules. The decisive test must actually track the link and use a wildcard-leading declaration with metadata satisfying inheritance.
3. A B4 repair needs source-discovery provenance, with 001-166 coordinated if it seeds linked paths. Count genuine interval/startup edits; do not solve the status wording by suppressing all first interval adds. No product code was changed by this reviewer.
4. Keep the known follow-ups 004-33 (addition-only ignored rebuilds), 004-35 (every running slow file named), 001-166 and 001-167 (parcel watches beyond an ignored symlink) visible. The already documented parcel/macOS gap is not a new blocker in this re-review. macOS remains unverified.
5. Keep the failed full-suite runs and their isolated outcomes visible. Only the deterministic B3/B4 probes are used to block this slice; a green isolated rerun does not retroactively turn a full run green.
