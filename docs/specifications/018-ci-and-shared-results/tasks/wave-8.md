# Spec 018 wave 8: `squeal ci record` ignores Vitest runs that tests start

The human, 2026-11-10: "Inner runs: Yes, both" (row 018-27, then a cezar PR that moves its pinned Squeal version).

## 018-27 `squeal ci record` records only the project's own Vitest runs

Use /worker. Shape: slice (fix).

Outcome: a Vitest run that a test starts itself (a fixture, a nested `vitest`) writes no part, so `squeal ci export` sees only the project's runs.

Evidence: cezar merge-group run 42821041101 (hearsay-tools/cezarion), shard 1/4. `squeal ci record` wrote 5 parts: the real run (404 files, shard 1/4) and four nested runs at shard 1/1 that cezar tests start (`.ai/qa/unit-env-*/environment.test.ts`, `.../sandbox.test.ts`, a re-run of `packages/cezar/src/server-install/platforms/ubuntu-vps.test.ts`, and one with `end: crashed`, which its test ends on purpose). `ci export` then refused: "is of a run that did not complete (crashed)". The parts are in `/home/agent/projects/squeal/.ai/cezar/t/3739e45a/parts1/` (read only).

Read: `spec.md` D8 and D9; `src/runners/vitest/ci-runtime/vitest-ci.cjs` (where it decides to attach) and `children.cjs` (how the hook and `SQUEAL_CI_RECORD` reach children).

Starting seam: the attach decision in `vitest-ci.cjs`. A Vitest CLI process started from inside a test is nested: its parent is a Vitest worker (the env carries `VITEST_WORKER_ID`/`VITEST_POOL_ID`, or the spawning process had `__vitest_worker__`). Cover both a child that inherits the env and one started with its own env (`children.cjs` carries the settings there; it can mark them nested). A nested run keeps the evidence hooks (its writes still count) but writes no run file and no part.

Owns: `src/runners/vitest/ci-runtime/vitest-ci.cjs`, `children.cjs` (only for the nested mark), a new test such as `test/runners/vitest/ci-record-nested.test.ts` and its fixture. Peer row 020-08a (coordinator 31e1d860) also edits `vitest-ci.cjs` for a coverage provider: keep the change small and local so a rebase is easy. Leave alone: `src/core/ci/*`, `src/cli/*`, `spec.md`.

Done when: a test where a test file starts a nested `vitest run` (inherited env, own env, and one ended early) gives exactly one part and an export that succeeds, and failed before the fix; existing `ci record`, export and evidence tests pass; lint and typecheck pass; `squeal status --wait 60000` on the changed paths. No build, no full suite.
