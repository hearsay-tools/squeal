# Spec 018 wave 16: a cancelled run's log never recreates a removed Squeal folder

The human, 2026-11-12: "Row 018-38: Yes".

## 018-38 a run log is written only while Squeal's store folder exists

Use /worker. Shape: slice.

Outcome: when a runner (Vitest, node:test, pytest) writes a run's log after its daemon ended, it writes nothing if the store's folder (`.git/squeal`, or the store root the run's `logDir` sits under) no longer exists; it never creates that folder or the checkout again.

Evidence: row 018-37 (`tasks/wave-15.md`, review `reviews/018-37.md`): after a SIGKILLed daemon, `squeal runner-host` cancels its run and `writeRunLog` (`src/runners/vitest/run.ts:308`, `mkdirSync(logDir, { recursive: true })`) recreated `.git/squeal/runs/<id>` and even a removed checkout during test teardown: ENOTEMPTY in CI 43102768524, 43102892208, 43124851809, 43196057677 (`subagent-start`), main 43189918961 (OpenCode test). The reviewer reproduced the user case: a removed checkout got its folders back.

Starting seam: the three `mkdirSync(options.logDir, { recursive: true })` calls (`src/runners/vitest/run.ts:308`, `src/runners/node-test/run/run.ts:112`, `src/runners/pytest/run/run.ts:97`). First find what `logDir` is relative to (where the runs directory comes from, `src/core/...`) and make one shared check: create only below a store folder that exists; otherwise skip the log quietly (the run's result already went nowhere, since its daemon is gone).

Items, each with a failing test first: a cancelled run whose store folder was removed writes nothing and recreates nothing (Vitest; node:test and pytest if their writers can be reached the same way); a normal run still writes `vitest.log` and `report.json`; a first run in a fresh store, where `runs/` does not exist yet but the store folder does, still writes its log.

Owns: the three run files' log writers, one shared helper beside them (or in `src/core/` where the runs path is defined), their tests. Leave alone: `src/core/runner-host/*` (row 011-314 of coordinator 4f261dae edits `protocol.ts`), `src/core/shared/*`, `src/core/ci/*`, test cleanup helpers (`test/daemon/helpers.ts`, row 018-37).

Done when: the new tests fail before and pass after; lint, typecheck, `squeal status --wait 60000` on the changed paths; the key-format guard (`pnpm exec vitest run test/keys/key-format.test.ts`) passes or you say which versions it names. No build, no full suite.

## 018-38 R1: node:test coverage cannot restore a removed store; lost records discard results

Use /worker. Shape: repair. Base: candidate `cand/0.1.449` (9ed332b11) plus the review file; read `reviews/0.1.449.md` B1 and its reproduction.

Outcome: in a node:test run with coverage, removing the store (or only the run's log folder) after an earlier file completed stores no result whose observed loads were lost, and nothing Node writes on process exit recreates the removed store.

Items, each with a failing test first, from the review's two real-process reproductions:
1. Coverage destination: `NODE_V8_COVERAGE` (`src/runners/node-test/run/coverage.ts` `coverageDir`) points outside the store, at a run-owned temporary folder (removed after the run), or the run otherwise prevents Node's recursive creation from restoring `.git/squeal`; `coveragePayloads` reads from there.
2. Lost-record detection independent of folder existence: a run-owned marker (or the log folder's identity) recorded at start and checked at the end; a replaced or recreated log folder rejects the run (`logGoneReport`), so no completed file with lost graphs is stored.
3. The other recursive creators the worker notes name (`NodeTestReads.start`, `coverageEnv`): same rule, or say why they cannot restore the store.
4. Regressions: store removed and log-folder-only removed, after an earlier file passed, coverage on; queued files; the existing no-coverage cancellation cases; normal and fresh-store logs still written.
5. Key-format guard re-run; extend the validity cases if lines change; no version raise unless stored outputs differ where the store exists.

Owns: the files of row 018-38 plus `src/runners/node-test/run/coverage.ts` and `reads` creators, their tests. Leave alone: test cleanup helpers, `src/core/runner-host/*`, `src/core/ci/*`.

Done when: the two reproductions from the review fail before and pass after; test/runners/{node-test,pytest,vitest}, test/runners/log-dir.test.ts, test/keys/key-format.test.ts and test/keys/validity pass; lint, typecheck. No build, no full suite.
