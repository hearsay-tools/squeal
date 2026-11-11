# 020-22b notes: shared seams around the gate

Worker notes for whoever integrates or reviews the row. Slices are those of `quality/2026-11.md`. No behavior change was intended; the two timing details below are the only differences found.

## Slices

- **1, the listing record.** Gone from `ledger.ts`, `bootstrap.ts` and `types/scheduler.ts`. Only an old daemon's own process read `listingMetaKey` (the 0.1.426 pass, `pass/source.ts`), and that daemon writes the key again at its first commit, so a take-over by an older release reads its own writes. `bootstrap.ts`: both of its commits are now `{ refined }`, so the `early` flag had no reader; `commitFirst` returns nothing. `listingFailed` stays.
- **1, tests (a deviation from the brief).** The brief said to delete `test/scheduler/listing-record.test.ts`. Its third case was the only test that pins a re-list after a runner part that threw before its listing applied (`runner-work.ts` sets `listingFailed`, `refinement.ts:131` reads it). It lives on, without the record assertions, in `test/scheduler/list-again.test.ts`. Its second case, a failed `testFiles`, is `runner-failure.test.ts`'s "a failed listing retires nothing and is retried with the next revision". Its first case pinned only the record. `listed-before-recheck.test.ts` keeps `refined` set before the recheck in place of the listing assertions.
- **2.** `openDaemonKeys` in a new `src/core/scheduler/daemon-keys.ts`; `ci/export.ts` and `gate/stored.ts` call it. It names its six fields, so `ci export`'s other inputs do not reach `WorktreeKeys`. `OBSERVED_META_KEYS` is in a new `src/core/keys/observed-rows.ts`, not `observed.ts`: `modules.ts` and `startup.ts` import `observed.ts`, so the list there would make an import cycle.
- **9.** `slicedWrite(write, giveUp)` and `BUSY_BOUND_MS` in a new `src/core/store/sliced-write.ts` (spec 021 owns `store/busy.ts`). The loop is the full check's: try, and on a busy store wait `busyBackoffMs`, then ask `giveUp`. The full check's old first `giveUp` call came before any await, so it was always false. The keep step's old loop checked `now() + pause >= deadline` before the pause; it now checks `now() >= deadline` after it. The same tries run; a give-up comes one pause (at most 250 ms) later. `KEEP_BUSY_BOUND_MS` is gone.
- **10 (changed after the first try).** The first commit exported a function `observedAdapterVersion(base)`. Its body was a new line on the key path that no validity case runs, because no case starts a Vitest adapter that observes, and `key-format.test.ts` failed. The shared piece is now the suffix, `OBSERVED_ADAPTER_SUFFIX` in `src/runners/vitest/observe.ts`, built at module load. `VitestObserver.adapterVersion` and `ci-runs.ts` append it as before. `GateEnvironment` has `observedSuffix` in place of `recorderVersion` and keeps the gate's own rule, "add it when it is missing". A case that runs an observing adapter's `environment()` would need `test/keys/validity/harness/vitest.ts` to pass `observe` (the adapter's 4th argument) and to key `adapterVersion`; no case covers that branch today, before this row or after it.
- **11.** `readPartsIn` moved to `src/core/ci/parts.ts`, beside `readPart`, under the gate's name so test titles stay. It sorts by `compare`, which is code-unit order, the same as `sort()`.
- **15 (the part in this row).** The `015-103` comment moved with `UNMEASURED` and now says what the words cover.
- **16.** The coverage words of the CLI and of delivery are in a new `src/core/delivery/code-coverage-words.ts`. `UNTESTED` and `UNTESTED_CHILDREN` are built from `NOT_RUN` and `NOT_RUN_CHILDREN`. `NOT_LOADED` is exported from `cli/code-crap-reason.ts` and is the `no-loader` entry. `delivery/code-coverage.ts` is now 289 lines and `cli/code-coverage.ts` 422 lines (from 441). Delivery still has its own "a test runs it in its own thread" (twice), which no slice named.
- **17.** `CHILD_FILE_LIMIT_TEXT` in `mapper.ts`; `drops.ts` imports it. `mapper.ts` is now 304 lines.
- **18.** `UnknownCause` is in `types/code-delivery.ts`; `crap/loaders.ts` re-exports it, so `crap/file.ts`, `status.ts`, `summary.ts` and `cli/code-crap-reason.ts` import it as before. Note: `types/status.ts` has another `UnknownCause` (a test file's unknown cause), a different union.

## Left for row 020-21 (spec 021's files, by the parent's decision)

1. `src/core/scheduler/runner-work.ts:263-268`: the `listed` const and its spread into `ledger.commit` are dead. `CommitOptions` has no `listed`; TypeScript does not check spread properties, so it compiles.
2. `src/core/daemon/lifecycle.ts:396-403`: its list of the four observed meta keys can be `OBSERVED_META_KEYS` (its order differs, but it only builds an in-process snapshot).
3. `src/cli/store-writes.ts:20`: `BUSY_BOUND_MS` can be imported from `core/store/sliced-write.ts` and re-exported.

## Commits in files of 020-22a (by agreement)

- `src/cli/code-gate.ts`: the `readPartsIn` import (slice 11).
- `src/cli/code-gate-stored.ts`: `observedSuffix: OBSERVED_ADAPTER_SUFFIX` (slice 10, two commits: the first passed `observedAdapterVersion`).

## Checks at the branch head (`01809c841`, revision 34)

- `pnpm run lint`: 3087 files, no fixes. `pnpm run typecheck`: clean.
- `squeal status --wait 60000` over 179 test files (those that import a changed module, `test/code/gate/*`, `test/cli/code-gate*`, `test/keys/key-format.test.ts`): no known failures, each current.
- Known failures in the worktree, outside that set and not from this row: `test/daemon/resumed-after-signal.test.ts` (2 tests; it fails the same way on other coordinators' clean commits since 19:27Z), and `test/runners/vitest/harness.test.ts` (the host's Node rejects `--experimental-transform-types`).
- No build and no full suite, as the brief says.
