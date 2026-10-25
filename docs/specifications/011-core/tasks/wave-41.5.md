# Wave 41.5

Repair of `cand/0.1.322` (`2d1cca690`, branch `int/w41`), 2026-10-25, from `reviews/0.1.322.md` (FAIL: B1 to B4, S1). One repair round, then one re-review (`docs/process.md` step 6). The two workers resume on their own branches, on disjoint seams. The coordinator picks their commits onto `int/w41`, fixes S1 in `test/cli/fake-daemon.ts` itself, and rebuilds 0.1.322. N1 stays row 011-221. N2: the board on main already read *in review*.

## R1: 011-207 B1, B2 and B3 (resume W1 b528f9fc)

Use /worker. Shape: repair. Row 011-207. Read `reviews/0.1.322.md` B1 to B3 and its *Inputs for the fix wave*, and 011 C15's 011-207 amendment (`docs/specifications/011-core/spec.md:418`).

1. B1. The check and the write are one transaction. `askNamedRun` (`src/core/retry/records.ts:183`) checks only the retry records. First edit, offered as a lead: `askNamedRun` takes a predicate. It calls the predicate inside its transaction, after the record guards, on every busy retry. `askNamedRuns` passes the checks of `askableFiles` for that one file: same key, stale or unknown, nothing queued, no other claimant. When the predicate is false, return a new answer that stores nothing. The wait does not hold for that file and does not report it.
2. B2. The one-run fact must outlive the 1024 kept requests. Write it in the same transaction as the ask. Also never evict a pending request, and never read a missing record as ended (`askedEnds`). A new table or column goes in as 016-15 added `checks.runner` (`1d1c410f2`, no `user_version` raise). Send one request with the design before you write it. Say how the fact's size stays bounded.
3. B3. `asked` in both JSON forms lists only files whose request was stored. With only busy refusals, `asked` is absent. The `Run not asked:` line stays.

Each fix starts with a test that fails before it, as the review's cases say. Owns `src/core/retry/`, `src/cli/status-wait-ask.ts`, `status-wait-paths.ts`, `store-writes.ts`, a store table or column if B2 needs one, and their tests. Not yours: `src/core/scheduler/`, `src/core/daemon/` (R2), `test/cli/fake-daemon.ts`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the new tests fail before the fixes and pass after them, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.

## R2: 011-211 B4 (resume W2 cc9bf3f8)

Use /worker. Shape: repair. Row 011-211. Read `reviews/0.1.322.md` B4.

A `SlowRelease` timer close runs outside the pump. `drop()` in `withSlowInstance` (`src/core/daemon/slow-instance.ts:34`) clears `slow` before that close ends. A shutdown during the close gets `Promise.resolve()` from `drop()`. Then `close()` returns while the `globalSetup` teardown is still running. First edit, offered as a lead: with no instance open, `drop()` returns the close in progress (`closing`). Do not throw again an error that the timer's release already noted.

Start with a test that fails before the fix. Gate a fake slow instance's `close`, let the timer start the release, then call `SlowRelease.close()` and the runner's `close()` in the daemon's order. The runner's `close()` stays pending until the gate opens, and the teardown runs once. Keep the 60 s bound, the hold's cancel order, and the selection, load-wait and in-flight guards. Owns `src/core/daemon/slow-instance.ts`, `src/core/scheduler/slow-release.ts`, `scheduler.ts` for its close, and their tests. Not yours: `src/cli/`, `src/core/retry/` (R1), the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the new test fails before the fix and passes after it, and lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
