# Spec 018 wave 3.5: the coverage provider ignores test mocks

Approved by the human 2026-11-08 ("Squeal bug: Fix it now"), found by the 018-08 trial.

## 018-10 coverage provider takes Node built-ins past test mocks

Use /worker. Shape: repair.

Outcome: a test that mocks `node:path` (or `node:fs`, `node:crypto`, `node:url`) cannot change where or how Squeal's coverage provider writes, and that test's coverage is recorded.

Evidence (researcher a9fd78c8, `research/import-trial.md` Step 0, verified by experiment): cezar's `packages/cezar/src/artifacts/store-windows.test.ts` runs `vi.mock('node:path')` with `path.win32`. `src/core/code/coverage/provider.mjs` imports `join` from `node:path` (line 20) through Vitest's module runner, so `takeCoverage` (lines 73 to 86) builds a Windows path and writes `\tmp\squeal-<uid>\tmp\<hash>\coverage-X\.tmp\coverage-<uuid>.json` into the project root. The tree turns dirty, the daemon records a new revision, and that file's coverage payload is lost (`map-error`) on every machine.

Read: `spec.md` of `015-coverage-complexity` (the provider sections), `src/core/code/coverage/provider.mjs` and its header comment, `src/runners/vitest/coverage.ts`.

Starting seam: a failing test first, a fixture test file that mocks `node:path` with `path.win32` run under the provider, asserting no file appears outside the reports directory and the coverage record exists. First edit offered as a lead: take every built-in the provider uses through `process.getBuiltinModule(...)`, which returns the real module whatever the runner mocks; check it exists on Squeal's Node floor.

Owns: `src/core/code/coverage/provider.mjs`, its tests under `test/code/` or `test/runners/vitest/`, a fixture if needed.

Leave alone: key inputs. Do not raise `COVERAGE_PROVIDER_VERSION` unless `test/keys/key-format.test.ts` or the records' meaning requires it; say which in the final message. No `pnpm run build`.

Done when: the new test fails before and passes after; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean; the final message names the built-ins changed and whether any key moved.
