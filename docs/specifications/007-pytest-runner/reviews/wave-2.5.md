# 007 wave 2.5 re-review

Candidate: `e7358895a1d8bc3d716b2bdea863d3c764b657db`.
Range: `2bf53fda..e7358895`.
Rows: 007-22, 007-23, 007-24, 007-25. Reviewer: Codex, 2026-10-14.

**FAIL: two proven blockers; no should-fix findings or nits.** The original five reproductions are repaired, but the environment repair's empty-path guards lose shared startup-input growth, and the new interval path exceeds the dispatched idle-work budget. These are in the explicitly agreed widenings. Bundle and key-format drift are expected, not findings. No product code was changed.

## Verification

The checkout matched the candidate and stayed free of tracked changes throughout verification. The independent Vitest run is the reviewer gate required by `docs/process.md` and `/reviewer`. Build was excluded by the dispatch and was not run; build/committed-bundle freshness remains **unverified** here. Bundle tests build into temporary directories.

```text
$ git rev-parse HEAD
e7358895a1d8bc3d716b2bdea863d3c764b657db

$ npm ci
added 58 packages, and audited 59 packages in 2s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.166 lint
> biome check .
Checked 1095 files in 1188ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.166 typecheck
> tsc --noEmit
exit 0

$ npx vitest run
FAIL test/harness/plugin.test.ts (1 test): expected committed-bundle drift
FAIL test/harness/codex/plugin.test.ts (1 test): expected committed-bundle drift
FAIL test/keys/key-format.test.ts (3 tests): expected key-format drift
FAIL test/runners/pytest/fixtures.test.ts:244: generator took 6793.778906 ms, limit 5000 ms
Test Files  4 failed | 510 passed | 1 skipped (515)
Tests       6 failed | 4326 passed | 10 skipped (4342)
Start at    15:26:17 Europe/Warsaw
Duration    302.97s
exit 1

$ npx vitest run test/runners/pytest/fixtures.test.ts
Test Files  1 passed (1)
Tests       13 passed (13)
Start at    15:32:21 Europe/Warsaw
Duration    4.72s
exit 0
```

The fixture generator is unchanged in the range. Its timing assertion passed on the focused rerun; this qualifies the additional full-run failure without making the full run green. All committed environment, admission, session-observation, skip, scheduler-recheck, composite, recovering-runner, node:test-recheck and pytest-command regressions passed in the independent full run. The existing node:test observed-growth tests passed too; they do not isolate shared preload growth after a settled baseline without another run learning that path.

Throwaway probes ran in archives outside this worktree. One archive used the candidate tests with `src/` replaced by `2bf53fda`'s sources; another used candidate sources. Dependencies were shared from the lockfile install. Python fixtures used `test/helpers/pytest-env.ts`. These are source-comparison experiments, not a second full-suite gate or evidence that the temporary archives were clean candidate checkouts. All scratch archives and their fixtures were removed before committing this file.

## The five prior blockers

### B1: original installed-upgrade reproduction fixed, proven

The daemon regression in `test/integration/pytest-environment.test.ts` establishes a passing baseline, upgrades `reviewdep` inside ignored `.venv`, requests reconciliation, and sees `test_installed_dependency` fail at the same workspace revision. It then changes only a `.pth` path and sees the second test fail, also at that revision. It passed on the candidate.

The same installed-upgrade regression with the pre-repair source failed after a passing baseline: revision 0, 16 current, no pending/stale/unknown checks and no known failures persisted after the upgrade. The throwaway copy shortened only the test helper's observation deadline from 180 s to 15 s; it did not change the daemon or adapter.

The trigger is now `scheduler.ts`'s quiet interval branch, which queues an empty invalidation. The ready pytest adapter compares the entire existing D2 fingerprint, including installed names, `.pth`, direct URLs and interpreter stat, and admits/recreates on a difference. The lockfile remains outside the fingerprint. Residual problems with the new interval path are R1 and R2 below.

### B2: startup and unstable-timeout reproductions fixed, proven

`admit` is now shared by initial admission and readmission. It waits for the quiet second, reads the environment again, verifies the exact stabilized fingerprint, and returns an explicit timeout state with `runnerVersion: unavailable` and one note. Candidate tests cover a settled startup, a change during settling, the final poll, a change between the quiet interval and admitting read, continuous changes through 20 s, and recovery. The live adapter cases run on Python 3.10 and 3.13.

The startup regressions failed against the old adapter, which returned without driving any admission poll. For the old timeout reproduction, a separate source-comparison probe controlled `Date.now` and `setTimeout`, changed real `.pth` bytes at every 200 ms poll, and called the public adapter invalidation after an admitted baseline. It did not depend on the newly added `options.clock` seam:

```text
pre-repair source: simulated elapsed 20000 ms; runnerVersion 9.1.1; assertion FAIL
candidate source:  elapsed >= 20000 ms; runnerVersion unavailable; assertion PASS
```

Thus the timeout test distinguishes refusing the still-moving environment from admitting it when the limit expires. Unknown/unavailable state and empty crashed results are also checked by the committed tests. No inherited or completed result is produced under the unsettled state.

### B3: original known/inherited parameter-ID reproduction fixed, proven

`RunReport.skippedFiles` reaches the scheduler through the composite. `recordsForFile` replaces fallback results with skips for the file's previous test checks when those exist; static enumeration stands only for an unseen file. The file-level check remains a pass. Ordinary reports without `skippedFiles` retain their prior path.

`test/runners/pytest/adapter-skip.test.ts` exercises the scheduler, shared store, real pytest adapter and composite. It passes for the parametrized baseline, the module skip, a never-seen file and a second synced worktree inheriting the parameter IDs with zero baseline runs. Different skip reasons force the second worktree to execute instead of inheriting the first skip result. Against the pre-repair source, the same test fails with `test_param=skip` instead of `test_param[1]=skip` and `test_param[2]=skip`. The committed scheduler and composite tests also passed. Vitest and node:test never set this additive report field.

### B4: original uncovered-discovery reproduction fixed, proven

`pytestFiles` now resolves only exact individually named listed files. Bare invocations and directory arguments return no resolution, so the hook runs the command. Hook regressions cover a narrower include, an excluded failing file and a directory containing an unlisted file. Explicit covered files and node IDs remain denied when current, including the recognized interpreter/uv forms; existing unsupported forms and Vitest denial pass.

The candidate's 17 hook tests passed. Against pre-repair sources, eight assertions failed, including all three uncovered-discovery cases; the hook emitted a deny where silent fall-through was expected. No collection is used to decide denial.

### B5: original dynamic startup-plugin reproduction fixed; shared-growth handling incomplete

The adapter now persists observed startup paths in `pytest.observedSession.<project>`, merges shared writes transactionally, registers the meta key, includes those paths in `environment().files`, and reports them through `environmentObserved`. The core's existing bounded environment-growth path refuses results under a key missing a startup input and reruns under the grown key.

The candidate tests passed for `pytest11`, `-p`, edit selection and a second synced worktree whose hidden module differs. The four live adapter session assertions failed against the old source because `environmentObserved` was absent. The committed daemon test additionally proves a differing second worktree executes and fails instead of inheriting the hidden-module pass.

This repairs the exact prior reproduction. It does not repair propagation into an already-open idle adapter: R1 below. The committed session test reaches the other adapter through an unrelated `README.md` edit, which bypasses the new empty-path fast return and masks this case.

## Blockers

### R1. Proven: empty-path guards discard shared startup-input growth

Locations: `src/runners/pytest/adapter.ts:176`, `:194`, `:207`, `:210`; `src/runners/node-test/adapter-project.ts:94`, `:105`. Caller: `src/core/scheduler/runner-work.ts`'s `queueObserved`; `src/core/scheduler/refinement.ts:97` and `:104`.

This is on B5's repair seam and the explicitly agreed node:test widening. D2 makes startup-plugin inputs part of the environment key. The existing shared-observation refinement must recreate/rekey a project when another worktree grows its startup inputs. The dispatch also requires preserving node:test behavior.

Both ready adapters now return from `invalidate([])` before refreshing the shared observations or taking the environment-growth flag. The scheduler asks `environment()` only when invalidation reports a recreation, an environment input changed, or a runner failure is being retried. Its later `affected([])` may read the shared observations, but it cannot report project recreation. Startup-only growth is not per-test growth, so this does not rekey the project. Repeating empty passes still exits before consuming the growth flag.

**Pytest reproduction:** in the committed `adapter-session.test.ts`, change only the other, already-open adapter's `invalidate([{ path: "README.md", kind: "change" }])` to `invalidate([])`. Keep the real `pytest11` dynamic import, shared memory store and all other assertions. Both Python versions fail:

```text
Python 3.10: expected { recreatedProjects: ["small"] }; received { recreatedProjects: [] }
Python 3.13: expected { recreatedProjects: ["small"] }; received { recreatedProjects: [] }
```

**Node:test differential reproduction:** a scheduler over a real preloaded adapter runs a passing baseline. Create an existing, initially unreferenced in-tree helper before that baseline, then append its path to the shared preload meta key, simulating the transactional observation another worktree publishes. Ask only `refreshObserved`, as the daemon's shared-observation timer does. This is enough to test the public key contract, without guessing a timer race or claiming that the helper actually ran in this worktree:

```ts
const { repo, store } = await twoWorktrees(true);
writeFileSync(join(repo.main, "nt/src/newly_observed.cjs"), "globalThis.extraValue = 1;\n");
const a = await open(repo.main, store, repo.commonDir, undefined, PRELOADED);
await a.scheduler.start();
await a.scheduler.idle();
const before = keyOf(store, repo.main, CONTROL_TEST);
const meta = nodeTestObservedPreloadsMetaKey(PRELOADED.name);
const prior = JSON.parse(store.meta.get(meta) ?? "[]");
store.meta.set(meta, JSON.stringify([...prior, "nt/src/newly_observed.cjs"]));
a.scheduler.refreshObserved();
await a.scheduler.idle();
expect(keyOf(store, repo.main, CONTROL_TEST)).not.toBe(before);
```

Use the helpers from `test/scheduler/preload-worktrees.ts`, types' meta-key helper, and Node fs/path imports. The assertion passes on `2bf53fda`, fails on `e7358895`. The candidate retains the old current key despite a newly known environment input. This proves a behavior regression and a provenance break; it is not a claim that the probe ran a newly failing test.

**Worker-sized fix:** preserve the existing empty-path shared-observation refinement. Both adapters must report startup growth before the scheduler decides whether to reread environments. Add the quiet pytest shared-growth case and the node:test differential key regression. Coordinate this with R2: restoring observation reads on every interval would repair correctness while still violating the idle budget. Separate the quiet interval recheck from a metadata-triggered observation refresh, or agree another minimal contract that conveys the distinction.

### R2. Proven: every quiet interval performs runner work beyond the pytest fingerprint

Locations: changed `src/core/scheduler/scheduler.ts:211`; resulting call at `src/core/scheduler/refinement.ts:138`; `src/runners/vitest/adapter.ts:319`, `:492`; `src/runners/node-test/adapter-project.ts:115`; `src/runners/pytest/adapter.ts:213`.

The dispatch explicitly requires that an idle daemon do no runner work each pass beyond one pytest fingerprint read. The new interval branch queues a complete refinement. Empty-path invalidation guards cover only its first call: `fetchRunnerPart` unconditionally calls `runner.affected([])` afterward.

**Differential reproduction:** start and settle `test/scheduler/helpers.ts`'s harness over a real Vitest adapter. Wrap `h.runner.affected` to count calls while delegating to the original implementation. Send one `handleBatch({ trigger: "interval", paths: [] })`, then await `idle`.

```text
2bf53fda: affected calls 0; assertion expecting 0 PASS
 e7358895: affected calls 1, argument []; assertion expecting 0 FAIL
```

Source establishes the work behind that observed call: Vitest's `affected` enters its instance and calls `testSpecifications`, which calls `vitest.globTestSpecifications()` before inspecting the changed paths. It does suite discovery despite there being none. In a composite, node:test and pytest also refresh shared observations, scan/merge them, and allocate the listed-file set in their `affected` calls. The pytest fast fingerprint check therefore does not bound an idle pass to the promised work. There is no evidence that a test process spawns each pass; the proven excess is discovery and observation/graph work.

The committed scheduler test asserts no calls to the public `testFiles` or `environment` methods, but it does not count `affected` or discovery inside it. The node:test test likewise counts reads during `invalidate([])` alone. Both can pass while the daemon performs this extra work.

**Worker-sized fix:** make an unchanged interval return after the bounded fingerprint check when no recreation or explicit shared-observation work is reported. Preserve affected selection for actual source changes and for metadata-triggered growth, including R1. Add a scheduler/composite idle regression that observes the entire pass, not just `invalidate`; verify no Vitest discovery and no node:test/pytest observation scans in that quiet case. Any interface change remains the coordinator's decision.

## Should-fix

None.

## Nits

None.

## What fits

- Original B1 to B4 reproductions are closed with discriminating regressions. B5's dynamic import, edit selection, fresh differing worktree and `-p` paths are closed; keep those tests and the bounded core environment-growth handling.
- The skip marker is additive and merged across the composite. Existing scheduler behavior for ordinary reports, collection errors and partial completion passed the independent suite.
- Recovery guards avoid repeatedly constructing a failed outer runner or failed node:test project on a quiet pass. Real changed-path retries still pass. R1 concerns a successfully built project's shared-observation contract.
- The installed-set fingerprint remains file-based, does not use the lockfile as an environment substitute, and handles declared environments through the same recheck. Before/after-run sync rejection and observation filtering remain intact.
- Session meta writes union paths within `Store.transaction`; the shared meta-key registration passed. R1 is consumption of growth, not a lost-write finding.
- The conservative pytest deny leaves exact named-file/node-ID behavior and recognized invocation forms intact. The Vitest hook control passed. The interval scheduler change does increase Vitest discovery work, as R2 proves.

## Inputs for the coordinator and proof wave

1. This is the second and last review round. The FAIL rests on the two proven cases above, not an additional architecture review or a demand for another review round. The coordinator chooses their disposition.
2. Repair shared observation propagation and quiet-pass cost together. Empty paths already serve the metadata-growth refinement; they cannot unconditionally mean “nothing needs attention.” Avoid fixing one case by breaking the other.
3. Retain the tested stable-fingerprint admission, unknown timeout, transactional session key, observed environment report, skip expansion and exact-file deny. Rebuild the committed bundles and bump/re-pin key format at landing as planned.
4. Python 3.10 and 3.13 are covered here. Pytest 8 compatibility, shipped harness loading, mixed two-pytest-project proof and real-project dogfooding remain wave 3's previously assigned work. No new proof-wave obligation is inferred from this re-review.
