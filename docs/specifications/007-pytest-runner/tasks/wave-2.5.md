# 007 wave 2.5 briefs: repairs of `reviews/wave-2.md`

Three repair rows in parallel, then one re-review. All start from the unlanded integration of 007-14 and 007-15 on `cez/2ab5b448` (off main until 005 tags its hub release). Read `reviews/wave-2.md` in full first: each blocker has its reproduction and a worker-sized fix. Spec D2, D3, D6, D7, D8 and `status.md`. Do not run `npm run build` in your worktree; bundle and key-format drift are expected and the coordinator's. Python environments only through `test/helpers/pytest-env.ts`. Never edit `docs/board.md`; ask the parent before widening.

## 007-22 environment admission, installed-set changes and startup plugins (B1, B2, B5)

Outcome: the adapter admits an environment only after it is stable, notices every installed-set change without a source edit, and keys what startup plugins import.

Shape: repair. Seams: `src/runners/pytest/adapter-environment.ts` and `src/runners/pytest/adapter.ts`. B2 first: one bounded stabilization path for the first admission and every later one, returning `stable` or `timeout` and the stabilized fingerprint; a timeout stays not ready (`unknown`, one note, nothing stored or inherited). B1: the whole D2 fingerprint triggers change detection (site-packages entries, `.pth`, `direct_url.json`), including a bounded environment recheck at reconciliation, because `.venv` is ignored and the scheduler does not call `invalidate` without a changed path. On a change, re-key the project before any run or inheritance. B5: persist startup-plugin observations (`PytestRun.session`) per project in a shared meta key (register it in `test/store/worktree-meta.test.ts`), merge them into `environment().files`, and report new ones through `RunReport.environmentObserved`, following node:test's environment-growth contract. Cover `-p` plugins as well.

Owns: `src/runners/pytest/adapter.ts`, `adapter-environment.ts`, `adapter-observed.ts`, the session lines of `adapter-run.ts` (not `skipKnown`), `src/core/daemon/pytest-runners.ts`, the pytest meta-key names in `src/core/types/`, `test/store/worktree-meta.test.ts` (registration only), `test/runners/pytest/adapter*.test.ts`, `test/integration/pytest*.test.ts`. Leave alone: `src/core/scheduler/**` and `RunReport` (007-23), `src/harness/**` (007-24).

Done when: each of B1, B2 and B5's reproductions is a regression test that fails before and passes after. That includes a daemon test with an installed upgrade and no source edit, a `.pth` change, controlled-clock admission tests (at startup, settled, a change near the end, changes through 20 s), a dynamic import of an entry-point plugin with selection on its edit, and a second synced worktree with a different hidden module. Lint, typecheck and the full suite green apart from the expected drift.

Use /worker.

## 007-23 a module-level skip keeps the file's known check identities (B3)

Outcome: when pytest skips a whole module, every check Squeal already knows for that file, inherited ones included, records `skip`; a file Squeal has never seen falls back to static enumeration.

Contract, decided by the coordinator (an additive interface change, amending D6): `RunReport` gains optional `skippedFiles: readonly { testFile: TestFileRef; reason: string }[]`. The scheduler treats a listed file like a completed file whose known checks are all `skip`, expanding it the way it expands `fileErrors` to the checks previously known. The adapter lists module-skipped files there and stops synthesising static skips for files the core knows.

Shape: repair. Seams: `src/core/types/runner.ts` (the field, with its doc comment), the scheduler code that expands `fileErrors` (`src/core/scheduler/records.ts`, `ledger.ts`), and the `skipKnown` lines of `src/runners/pytest/adapter-run.ts`. Vitest and node:test never set the field; their behaviour must not change.

Owns: those files, `test/scheduler/**` cases for `skippedFiles`, `test/runners/pytest/adapter-skip.test.ts`. Leave alone: the rest of `adapter*.ts` (007-22), `src/harness/**` (007-24). 001's coordinator works in `src/core/scheduler/` too. Keep your change additive and in its own commits.

Done when: B3's reproduction is a daemon regression: a passing parametrized baseline, then a module skip records `skip` for `test_param[1]` and `test_param[2]` with no synthetic `test_param`. A fresh worktree that inherited those IDs records the same. A never-seen skipped file still gets static skips. Existing scheduler tests stay untouched and green. Lint, typecheck and the full suite green apart from the expected drift.

Use /worker.

## 007-24 a bare or directory pytest command runs (B4)

Outcome: 005 D8's deny never stops a pytest command whose discovery Squeal cannot prove it covers.

Shape: repair. Seam: `src/harness/shared/test-command-files.ts`. A pytest command with no path, or with a directory, falls through. Only individually named test files and node IDs, all listed and all current, can be denied. Do not use pytest collection to decide.

Owns: `src/harness/shared/test-command-files.ts`, `test-command-pytest.ts`, their tests under `test/harness/shared/`. Leave alone: everything else.

Done when: hook regressions show that a narrower `include`, an excluded failing file and a directory holding an unlisted test all run normally. Named covered files and node IDs are still denied when current. The existing fall-through cases are unchanged. Lint, typecheck and the full suite green apart from the expected drift.

Use /worker.

## 007-25 re-review of wave 2.5

Shape: review. `/reviewer` over the three repair rows' commits against `reviews/wave-2.md`. Write `reviews/wave-2.5.md`. This is the second and last round on wave 2.

Use /reviewer.

## 007-26 a bounded environment recheck that keeps empty invalidation (R1, R2)

Outcome: an idle daemon notices a changed pytest environment with one fingerprint read and nothing else, and `invalidate([])` again means what it meant before wave 2.5 (the human chose this narrow repair, 2026-10-14).

Read: `reviews/wave-2.5.md` in full (R1 and R2 with their reproductions); `fb0bbbf0` and `c28d8014` on this branch, which introduced both.

Contract, decided by the coordinator (additive, amending D2's recheck): `RunnerAdapter` gains optional `recheck?(): Promise<InvalidateResult>`, a bounded look at inputs no watched file shows. Only pytest implements it: one fingerprint read, and on a difference the bounded admission and a recreation. Every wrapper forwards it (composite, the recovering runner without retrying a failed one, `escaped.ts`, `slow-instance.ts`). On a quiet interval with nothing applied or touched, the scheduler calls `recheck` and stops unless a project was recreated, in which case it re-keys as a reported recreation does today. It never calls `affected`, `testFiles` or `environment` otherwise.

Shape: repair. Seams: `src/core/types/runner.ts` (the method, with its doc comment), the interval branch of `scheduler.ts` `handleBatch`. Then revert the empty-path guards to pre-2.5 behaviour: `src/runners/node-test/adapter-project.ts`, `adapter.ts`, `src/core/daemon/runner.ts`, and the pytest adapter's empty-path early return, which must again refresh shared session observations and report startup growth like node:test.

Owns: those files, `src/core/daemon/composite-runner.ts`, `escaped.ts`, `slow-instance.ts`, `src/core/scheduler/runner-work.ts` and `refinement.ts` if needed, `src/runners/pytest/adapter*.ts`, and their tests. Leave alone: `src/harness/**`, `src/cli/**`, `key-format.ts`, `plugins/*/dist`. 001's coordinator works in `src/core/scheduler/`: keep the change additive and in its own commits.

Done when: R1's pytest case (the open adapter's `invalidate([])` reports `small` recreated on 3.10 and 3.13) and R1's node:test differential key regression pass; R2's idle regression over a composite of Vitest, node:test and pytest counts a whole quiet pass: zero `affected`, no Vitest discovery, no observation scans, one pytest fingerprint read; B1's installed-upgrade and `.pth` daemon regressions still pass; each new test fails on `6530bf2d`. Lint, typecheck and the full suite green apart from the expected drift. Do not run `npm run build`.

Use /worker.

## 007-27 focused review of 007-26

Shape: review. `/reviewer` over 007-26's commits only, against R1 and R2 of `reviews/wave-2.5.md` and the contract above. Write `reviews/wave-2.75.md`. Not a re-review of wave 2.

Use /reviewer.
