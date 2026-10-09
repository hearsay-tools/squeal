# 004 wave 4.7 re-review

## Verification

Tested HEAD: `7c9109ac20f8fc1ee9178deae07169df2904f703`, version 0.1.68. Executable candidate: `caec2ce`, the range endpoint in the 004-45 brief. `git diff --name-only caec2ce..HEAD` lists only the board, status and wave-4.7 brief. There is no executable candidate mismatch. The landed fix is `43840d5` and the priority-test change is `7aa5223`; comparisons with the brief's `c379e6d` and `8604813` show identical owned-file contents. The 005 documentation is outside scope.

This is the second and last round for 004-33, bounded by `reviews/wave-4.6.md` B1 and the 004-44 delta: ignored discovery on nonempty intervals, preserving both diffs and their cache updates, installed-lockfile discovery, and the touch rule. Earlier closures and 004-35 were not re-prosecuted. No product code, board or status was changed.

Checks ran on the clean tracked candidate. Installation used the lockfile; build regenerated both committed plugin bundles without drift. AGENTS.md and the reviewer gate require build; the implementation rows' no-build rule does not remove this review check. The required explicit test gates are permitted by the Squeal skill. Each Node version ran one full suite with four file workers; reruns below cover only a reported failure.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.68 lint
> biome check .
Checked 667 files in 206ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.68 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.68 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.68 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run --maxWorkers=4
Test Files  290 passed | 1 skipped (291)
     Tests  2196 passed | 10 skipped (2206)
  Duration  421.80s
exit 0

$ npx vitest run test/scheduler/observed-growth.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  4.26s
exit 0
```

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ npx vitest run --maxWorkers=4
Test Files  2 failed | 288 passed | 1 skipped (291)
     Tests  2 failed | 2196 passed | 8 skipped (2206)
  Duration  308.14s
exit 1

$ npx vitest run test/daemon/busy-store.test.ts test/watcher/reconcile-pass.test.ts \
  --maxWorkers=1 --no-file-parallelism
Test Files  1 failed | 1 passed (2)
     Tests  1 failed | 1 passed (2)
  Duration  106.45s
exit 1
```

| Failed check | Full-gate evidence | Isolated outcome and scope |
| --- | --- | --- |
| `test/daemon/busy-store.test.ts:90` | Both writer children emitted EnvHttpProxyAgent experimental-warning text; assertion expected empty stderr. | File passed in isolation. The full-gate failure remains recorded; attribution to this wave is unverified. This warning-only mismatch was already recorded in wave-4.6 verification; no busy-store or writer code changed in this slice. |
| `test/watcher/reconcile-pass.test.ts:72` | Best re-stat time for 10,000 paths was 670 ms, exceeding 500 ms. | Reproduced in isolation: 525, 535 and 545 ms, best 525 ms, reported load average 1.4. The test invokes the feed and hasher directly, without the changed scheduler helpers. This timing gate and the watcher code are unchanged; the same load-sensitive budget is already on the board. Unverified as a wave defect. |

Installation warned about unapproved optional-watcher and esbuild install scripts; installation and build succeeded. Node 22 probes printed an EnvHttpProxyAgent experimental warning. Neither warning changes the check outcomes.

Background Squeal's baseline recorded one failure at `test/scheduler/observed-growth.test.ts:282`: expected each node:test file once after preload growth, observed both twice. The explicit Node 24 full gate and the isolated four-test file both passed. The observed-growth timer and file are unchanged by this slice; the failure's cause is **unverified** as a wave defect, not a proven blocker. The latest clean-candidate Squeal snapshot remains `Known failures: 1`, `2486 passed, 0 running, 0 queued, 10 skipped`, with a full-suite checkpoint completed at revision 1. An explicit rerun does not update that store. This review makes no all-green background-status claim.

Independent probes imported the freshly built product `dist` and used one private `/tmp` directory. Each fixture had its own git repository, store and slow-permit directory; no probe opened the repository's own store or another project's tree. A controlled backend emits no hints, isolating the real change feed's interval path. The real scheduler, filesystem hasher, state sink, revisions and key rows remain in use; only the runner's results are deterministic. Slow load readings are controlled, with no CPU burners. All probe fixtures and scratch were removed before the report commit.

The candidate probes exited 0 on Node 24 and Node 22 with identical normalized evidence:

```text
$ node --disable-warning=ExperimentalWarning <scratch>/probe.mjs \
  <candidate-root> <scratch>/fixtures
ordinary quiet: discovered and re-ran
ordinary mixed 1: source+artifact changes/cache kept, old pass pending, one re-run
ordinary mixed 2: source+artifact changes/cache kept, old pass pending, one re-run
ordinary no-op: no revision or re-run
linked quiet: discovered and re-ran
linked mixed 1: source+artifact changes/cache kept, old pass pending, one re-run
linked mixed 2: source+artifact changes/cache kept, old pass pending, one re-run
linked no-op: no revision or re-run
touch: ignored rewrite excluded even when in own batch; source touch retained
lockfile: empty own diff merges new installed lockfile and artifact; environment re-key retained
PASS independent real-feed probes
exit 0 (both Nodes)
```

A negative control used a private copy of candidate `dist` with only `batch.ts` and `keying.ts` from pre-fix `9848df0` compiled into it. This is a boundary control, not a claimed full verification of that earlier commit. On both Nodes the same probe passed the quiet addition, then exited 1 at the first mixed interval:

```text
ordinary quiet: discovered and re-ran
AssertionError: Expected values to be strictly deep-equal
actual:   ['src/source.js', 'src/unrelated.js']
expected: ['dist/late1.js', 'src/source.js', 'src/unrelated.js']
exit 1 (both Nodes, expected negative-control failure)
```

## Verdict

**PASS at `7c9109a`**, executable candidate `caec2ce`. Zero blockers, zero should-fixes, zero nits. Prior wave-4.6 B1 is **proven closed** on Node 22 and Node 24. The adjacent merged-diff, lockfile and touch contracts hold in the bounded review. Node 24's full gate is green. Node 22's full gate is not all green; its failures and isolated outcomes above are outside the changed slice, and do not prove a new break in it.

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits

- **Prior B1, proven closed:** `src/core/scheduler/keying.ts:309` exposes ignored discovery independently of installed-lockfile lookup; `batch.ts:41` calls it on every non-watch pass regardless of its own diff. The independent real-feed fixture first proves the quiet control, then adds a new ignored artifact alongside two tracked source edits on each of two successive intervals. Both an ordinary ignored directory and a tracked `dist -> real-build` link declared by `**/dist/**` acquire the new alias, change the slow key immediately and run exactly once for each addition. A held slow run exposes pending validity for the old pass before release. No quiet interval, reload or restart is needed.
- **Both diffs and cache updates, proven:** `batch.ts:87` excludes paths already in the batch before stat-ing discovery candidates. `:95` merges and sorts both change lists; `:96` keeps both sets of updates. Each mixed probe's one revision names the artifact addition and both source edits, each path has a persisted hash, and both the declared slow key and the fast source-dependent key move. `:49` retains the existing transaction enclosing revision, cache flush, content re-key, queued phases and refreshed known states. A following unchanged interval creates no revision or extra run.
- **Installed-lockfile behavior, proven retained:** `batch.ts:43` still checks moved installed lockfiles only when the batch's own content diff is empty and the trigger is not watch. It evaluates that condition before merging discovery. `keying.ts:298` now returns only lockfile moves. The independent empty-own-diff probe adds an installed npm lockfile and an ignored artifact together; both enter one revision, the project's fast key changes, and the lockfile becomes an extra watch. Candidate scheduler lockfile regressions are included in both full gates.
- **Touch boundary, proven retained:** `batch.ts:48` removes discovery candidates from unchanged-touch output without removing ordinary source touches. The independent control rewrites a formerly hashed artifact with equal bytes, makes it ignored, and places it in the batch as well as the discovery set. It also touches a tracked source with equal bytes. The artifact acquires an extra watch without a runner touch; the source still produces a runner touch. The candidate regression independently covers the empty-batch discovery case. Already watched paths and the existing watch path are outside the new discovery delta.
- **Priority-test change fits:** `test/daemon/slow-lane.test.ts:27` polls for nice 10 for at most 20 seconds after the fixture is released, then retains the actual priority assertion in its caller. The fixture deadline increases by the same 20 seconds. It accommodates the existing one-second lowering poll while preserving the fast-beside-slow behavior check; no daemon priority implementation changed. This file passed in both full gates.
- No runtime dependencies or persisted shapes changed. The new `WorktreeKeys.ignoredCandidates()` is an internal scheduler helper; the public `Scheduler` and runner contracts are unchanged. Re-listing continues to use the previously reviewed glob and link limits. macOS is unverified and outside this Linux re-review.

## Inputs for the coordinator

1. Wave-4.6 B1 closes; no repair wave is required by this bounded review. This finishes the second and last round for 004-33. Settled wave-4.5 cases and 004-35 were not reopened.
2. Keep the seam: discover unwatched ignored declared inputs on every non-watch pass, merge them with source candidates and cache updates in the existing revision transaction, and exclude them from unchanged runner touches. Keep the installed-lockfile empty-own-diff condition.
3. Preserve the verification caveats above. The background observed-growth failure is not erased by the passing explicit gate or isolated rerun. The coordinator owns any board/status update and decides integration; this commit contains only the review file.
