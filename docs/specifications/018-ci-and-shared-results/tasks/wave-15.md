# Spec 018 wave 15: the daemon tests' teardown race

The human, 2026-11-12: "Test race: Yes" (row 018-37).

## 018-37 the daemon tests' teardown race (ENOTEMPTY)

Use /worker. Shape: repair.

Outcome: `test/daemon/died.test.ts` (and any test that shares its cleanup) never fails at teardown with `ENOTEMPTY` on `rmdir` of a fixture directory, because teardown waits for, or tolerates, what still writes there.

Evidence: CI runs 43102768524 (main, Node 22 1/3, "status and the next hook say it died, with the run in flight", path `.git/squeal`), 43102892208 (cand, "a stop killed before it finished is not called dead", `test/fixtures/scheduler/.tmp/<uuid>/main`) and 43124851809 (main, same test, same path); each passed on re-run. Board notes of 2026-10-24 and 2026-11-11 name the same cleanup race in other daemon tests. Read the failed logs with `gh run view <id> --log-failed`.

Starting seam: `suite.cleanup(() => rmSync(dir, { recursive: true, force: true }))` in `test/daemon/died.test.ts` and the helper that makes `suite` (find it from the import); the scheduler fixture's `.tmp/<uuid>/main` comes from a shared helper. First find which process still writes in the directory when cleanup runs (a daemon or child that outlives the test, a late store write), then make teardown end or wait for it; a retry of `rmSync` alone is acceptable only if the writer is shown to be gone within a bounded time and the reason is in a comment.

Owns: `test/daemon/died.test.ts`, the shared test helpers it uses for fixtures and cleanup (`test/daemon/helpers.ts`, `test/helpers/*` as needed). Leave alone: product code under `src/` unless the writer is a product defect; then stop and report it before changing `src/`.

Done when: died.test.ts passes 20 of 20 repeated direct runs on Node 22.19 and 26.13 at this host's real load (state the load); lint, typecheck, `squeal status --wait 60000` on the changed paths. No build, no full suite.
