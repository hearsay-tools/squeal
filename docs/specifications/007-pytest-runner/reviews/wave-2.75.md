# 007-27 focused review of 007-26

Candidate: `fc80de8f23327f04559b58aea49609add07d5fa9`.
Range: `5c7a05bf..fc80de8f`, three commits: `af1be9ae`, `486db6ba`, `fc80de8f`.
Reviewer: Codex, 2026-10-14.

**PASS: zero blockers, zero should-fix findings, zero nits.** R1 and R2 of `wave-2.5.md` are repaired with discriminating regressions. This judgment covers 007-26's range and contract only; it does not reopen wave 2. The five expected bundle and key-format failures are not findings.

## Verification

The candidate matched the assigned range. Verification ran on its clean tracked tree; `git status --porcelain` remained empty afterward. No product code was changed. The reviewer gate is an independent `npx vitest run`, not an inherited Squeal result. `npm run build` was explicitly excluded by the dispatch and was not run; build and committed-bundle freshness remain **unverified** here. The bundle tests build into temporary directories.

```text
$ git rev-parse HEAD
fc80de8f23327f04559b58aea49609add07d5fa9

$ npm ci
added 58 packages, and audited 59 packages in 2s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.166 lint
> biome check .
Checked 1091 files in 472ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.166 typecheck
> tsc --noEmit
exit 0

$ npx vitest run
FAIL test/harness/plugin.test.ts (1 test): cli/squeal.mjs differs from the build
FAIL test/harness/codex/plugin.test.ts (1 test): cli/squeal.mjs differs from the build
FAIL test/keys/key-format.test.ts (3 tests): expected guarded-source pin drift
Test Files  3 failed | 512 passed | 1 skipped (516)
Tests       5 failed | 4331 passed | 10 skipped (4346)
Start at    16:24:26 Europe/Warsaw
Duration    255.54s
exit 1

$ git diff --exit-code 2bf53fda HEAD -- src/runners/vitest/adapter.ts \
    src/runners/node-test/adapter.ts src/runners/node-test/adapter-project.ts
no diff
exit 0

$ git diff --check
no output
exit 0
```

The install also reported npm's informational warning that two dependency install scripts were not covered by `allowScripts`. The checks above completed. The full run emitted fixture worktree-repair diagnostics and test-process cleanup notices; no additional test failed.

Before-source experiments used a scratch archive outside this worktree: candidate tests and helpers, with `src/` replaced by `6530bf2d`'s sources and dependencies shared from the lockfile install. They are differential evidence, not another full-suite gate or a clean candidate verification. Python fixtures used `test/helpers/pytest-env.ts`. The archive and its fixtures were removed before this findings commit.

```text
$ npx vitest run test/scheduler/idle-pass.test.ts \
    test/scheduler/preload-refresh.test.ts \
    test/runners/pytest/adapter-session.test.ts \
    test/scheduler/environment-recheck.test.ts \
    test/daemon/composite-runner.test.ts test/daemon/runner.test.ts \
    test/daemon/escaped-overlap.test.ts test/daemon/slow-instance.test.ts
with candidate tests and 6530bf2d sources:
Test Files  8 failed (8)
Tests       12 failed | 41 passed (53)
Duration    29.18s
exit 1

$ npx vitest run test/runners/pytest/adapter-session.test.ts \
    -t "a pytest11 plugin's dynamic import"
with 6530bf2d sources, removing only the new optional-recheck assertion:
Python 3.10: invalidate([]) returned []; expected recreatedProjects ["small"]
Python 3.13: invalidate([]) returned []; expected recreatedProjects ["small"]
Test Files  1 failed (1)
Tests       2 failed | 2 skipped (4)
Duration    14.97s
exit 1
```

The two skips in the filtered probe are the unselected `-p` tests. Removing the optional-recheck assertion isolates R1: otherwise the old source fails earlier because it has no `recheck` method. The candidate's unchanged test, including both assertions, passed on both Pythons in the independent full run.

## R1: shared startup-input growth repaired, proven

The pytest adapter's `invalidate([])` now takes the ordinary invalidation path: it rereads the environment, refreshes shared observations, invalidates the graph and consumes `takeRecreate`. The already-open other adapter in `adapter-session.test.ts` reports `small` recreated and includes the dynamically imported hidden module in its environment. Its separate quiet `recheck()` reports no recreation and does not consume the observation growth. Both Python 3.10 and 3.13 passed; the isolated old-source reproduction above fails at the original R1 assertion.

`test/scheduler/preload-refresh.test.ts` commits R1's node:test differential reproduction: after a passing baseline, another worktree's shared preload meta key gains an existing helper, and `refreshObserved()` alone must change the test's key. It passes on the candidate. Against `6530bf2d`, the key remains identical and the assertion fails. This tests provenance through the scheduler and real adapter, without relying on an unrelated source edit or a subsequent run learning the helper.

The Vitest adapter and both node:test adapter files are byte-for-byte their pre-wave-2.5 sources at `2bf53fda`. The recovering runner's `invalidate([])` likewise restores its previous retry behavior; its only remaining source delta from that commit is the additive `recheck`. Empty invalidation again performs shared refinement, while a quiet recheck does not retry a failed creation. `queueObserved` explicitly refuses to treat a queued recheck as a substitute for that refinement.

## R2: bounded quiet pass repaired, proven

`scheduler.ts` queues `queueRecheck` only for an interval that applied and touched nothing. `RunnerWork` returns immediately when the optional recheck reports no recreated project. It preserves the carried closures and makes no `invalidate`, `affected`, `testFiles`, `environment`, enumeration or run call in that case. If recreation is reported, the normal refinement rekeys the project using that report, without a second invalidation.

`test/scheduler/idle-pass.test.ts` starts and settles real Vitest, node:test and pytest adapters behind a composite. It counts all their runner methods, both observation stores' read methods and pytest's `currentFingerprint` over three whole quiet passes. The candidate passes these assertions:

```text
runner calls: ["pytest.recheck", "pytest.recheck", "pytest.recheck"]
observation reads: 0
fingerprint reads: 3
```

Against `6530bf2d`, the same test reaches its settled baseline, then fails with `invalidate` and `affected` calls for all three adapters on each pass, 12 observation reads and 3 fingerprint reads. This discriminates the prior extra work from the agreed budget. No Vitest discovery can be reached by the candidate's quiet path: no Vitest method is called. The one-read assertion is per ready pytest adapter; the composite fixture contains one pytest project.

The scheduler's separate regression checks two quiet intervals over a real Vitest adapter, no revision or new run, no recheck for an empty watch batch, and rekey plus rerun when recheck reports a recreation. These passed on the candidate; all three changed interval cases failed against the old scheduler. A failed recheck is recorded as a note and leaves existing check state unchanged, as the implementation's test specifies.

## Wrapper forwarding and B1 preservation, proven

- `composite-runner.ts` calls only adapters that expose `recheck`, unions recreated project names and sorts them. Its regression passed.
- `runner.ts` forwards to an existing inner adapter through `around`, returns an empty result when none exists or it is closed, and never invokes the factory from recheck. The failed-factory and successful-forwarding regressions passed. Empty invalidation still retries as before.
- `escaped.ts` binds and forwards the optional method without adding one to an adapter that lacks it. Its regression passed.
- `slow-instance.ts` binds and forwards to the fast instance only. It neither constructs nor rechecks the temporary slow instance. Its regression passed.

All four wrapper regression files fail with old sources at their new forwarding assertions. Binding preserves the receiver where the wrappers copy a method; composite and recovering calls retain their normal member-call receiver.

`test/integration/pytest-environment.test.ts` passed in the independent full run. Its B1 daemon regression establishes a passing baseline, upgrades an installed dependency inside ignored `.venv`, requests reconciliation, and sees the test fail without a new workspace revision. Changing only a `.pth` path then fails the second test at that same revision. The pytest admission tests also passed with their installed-set, `.pth` and timeout recovery checks routed through `recheck`; they retain a check that ordinary empty invalidation notices an environment change too.

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits and inputs for landing

Keep the optional `recheck` boundary distinct from shared-observation refinement. An unchanged quiet pass reads one ready pytest environment fingerprint; explicit observation refresh still uses `invalidate([])`. A recreation from recheck must continue through ordinary environment, listing and closure refinement before results can be inherited or run under the new key.

The coordinator still owns rebuilding the committed bundles, the patch bump, and the key-format bump and pin at landing. Those expected failures do not qualify this focused PASS. The proof wave's existing obligations are unchanged; this review adds none.
