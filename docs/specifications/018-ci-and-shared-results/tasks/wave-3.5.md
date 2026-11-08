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

## 018-10 R1 repair after review FAIL (`reviews/wave-3.5.md`; the human, 2026-11-08: "A: drop coverage only")

Use /worker. Shape: repair, on candidate `cand/0.1.418`.

Outcome: coverage records made by the old provider are never read after the upgrade, while every test result key stays the same.

Read: `reviews/wave-3.5.md` B1 and S1, with their reproductions; spec 015 D8 (records stored at result key plus provider version); `src/core/code/coverage/record.ts` around line 19.

The human chose option A: do not raise the version inside the key (`src/runners/vitest/environment.ts` keys `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }`, which stays 3). Instead split the record's version from the key's: a record version (for example `COVERAGE_RECORD_VERSION = 4`) that every write, read, shared-part hash and prune of `code.sqlite` uses (`coverage/writer.ts`, `map-worker.ts`, `mapper.ts`, `parts.ts`, `crap/cache.ts`, `crap/loaders.ts`, `code/store/*`), so version-3 records read as "no coverage" until the file runs again. Name the rule in the comment at `record.ts`: the key version moves only when outcomes can differ; the record version moves when a record's meaning does.

Starting seam: a failing test first: an old version-3 record stored at a result key is not read by the new reader (crap cache and loaders) for that same key. Then the review's URL-only regression (covered lines `[5,6,11,13]`). Then S1: the mock regression must leave nothing in the checkout root when the bug returns (a child with a disposable working directory, or removal of its own escaped files on every exit); prove it by restoring the old provider once.

Also: candidate CI 42488454322 failed `test/daemon/handover-tier.test.ts` "one successor, the old daemon out within 15 s ..." on Node 22 (two daemon pids). It has not failed in the 40 runs before. Check whether the provider change can cause it (the daemon's Vitest workers load the provider); run it three times directly, on Node 22.19 if available. Report the result; fix it only if the cause is this row.

Owns: the files above under `src/core/code/`, `test/runners/vitest/own-provider-mocks.test.ts`, code-store and crap tests.

Leave alone: `src/runners/vitest/environment.ts` and every key input (`test/keys/key-format.test.ts` must pass unchanged); `src/core/state/slow.ts`, `src/core/scheduler/slow.ts`, `src/cli/` (018-11). No `pnpm run build`.

Done when: the three tests above pass and fail before their fixes; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean; the final message names the record version and every reader and writer changed.

## 018-11 the fast-lane verdict uses the checkpoint's own files (the human, 2026-11-08: "Yes, same release")

Use /worker. Shape: repair.

Outcome: `squeal run --fast --wait` ends with a verdict in a project whose `squeal.config.json` has `checks` groups, because the command and the daemon agree on which files the fast checkpoint holds.

Evidence (researcher a9fd78c8, read in source at `squeal--v0.1.417`): the daemon's fast checkpoint takes `slowView(policy).isSlow` (`src/core/scheduler/scheduler.ts:639`; `src/core/scheduler/slow.ts:83`: any group but `tests` is slow). The command's verdict takes `laneFiles` (`src/cli/run-lanes.ts:50`) through `worktreeSlowView` (`src/core/state/slow.ts:51`: with `checks` set, only the `slow` group is slow). So cezar's `browser` group (`at: manual`, 98 files) counts in the verdict but never runs: "98 unknown", exit 3.

Starting seam: a failing CLI test first with a config that has a manual group: `run --fast --wait` must end with a verdict over the files the checkpoint ran. First edit offered as a lead: the verdict reads the files the checkpoint recorded (styleguide: record a fact where it is known), and the two "is slow" rules become one function that both sides call. Check every caller of `worktreeSlowView` (`status-wait-slow.ts`, `status/slot-holders.ts`) keeps its meaning or say what changes.

Owns: `src/cli/run-lanes.ts`, `src/cli/run.ts`, `src/core/state/slow.ts`, `src/core/scheduler/slow.ts`, their tests.

Leave alone: `src/core/code/` (018-10 R1); key inputs. No `pnpm run build`.

Done when: the new test fails before and passes after; `squeal status --wait 60000 <changed paths>` current and passing; lint and typecheck clean.
