# Wave 132: the seven intermittent CI rows left after 0.1.664 (rows 011-436 to 011-442)

The human, 2026-11-28 (coordinator session 9d95aa57, after its report that 0.1.664 shipped six repairs and left five rows plus two new ones): "Start a new task to work on the remaining 7". Coordinator 96504e70. Background: `research/ci-flake-census.md` (row 011-428), `research/ci-shard-workers.md` (row 011-435), wave 131 (`tasks/wave-131.md`) and its reviews `reviews/0.1.663*.md`, `0.1.661.md`, `0.1.664-r2.md`. Goal: fewer CI re-runs before a release. A repair that only raises a time limit is out of scope.

| Row | Was | Shape |
|---|---|---|
| 011-436 | ci-45806426506, `optimizer-start` extra newline (G2) | research, then repair |
| 011-437 | ci-program-build, lint start-budget test (G1) | worker, repair |
| 011-438 | ci-43528167215, Pi `tool_call` gate misses 2 s (G5) | research, human card, then product repair |
| 011-439 | ci-45256832662 and the `node-test` part of ci-44491147466, hook silent on a busy store (G5) | research, human card, then product repair |
| 011-440 | flake-0.1.597-storage, `proof*` red `stored` false | research on a slow boat.dev sandbox, then repair |
| 011-441 | ci-fastpath-0.1.664, `fast-path.test.ts:175` p95 (G1) | worker, repair |
| 011-442 | local-vitest-max-workers, `VITEST_MAX_WORKERS` overrides the adapter's count | research, human card, then product repair |

## Rules for every code row

- Read `docs/styleguide.md` and the findings named. Own only the files listed; name any other change you need in your final message.
- A rewritten test must still fail when the product guard it covers is removed: show it (revert the guard locally, run the test, paste the failure, restore). Wave 131's review caught a weakened check.
- Replace a time bound with counted work, event order or an injected clock the code already accepts; never a higher limit. Do not scale skip gates such as `LOADED` (`test/daemon/helpers.ts`) by CPU count.
- Process ownership by path matches whole paths or a `dir/` prefix, never a substring.
- Done when: `pnpm run lint`, `pnpm run typecheck`, and `squeal status --wait 60000 <changed-path>...` read and reported. A direct `vitest run` names its files and runs under `timeout 600`. No loops of repeated runs on this host, no build, no full suite. Commits on your branch. Not `docs/board.md`, `package.json`, `plugins/*/dist`, `spec.md`.
- Final message: per changed file, the old check and the new one, and the guard-removed failure output.

## Research: rows 011-436, 011-438, 011-439, 011-440, 011-442 (one researcher)

Writes `research/ci-flake-remaining.md` and probes under `research/probes/ci-flake-remaining/`. No other repo edits. One section per row, every finding tagged.

1. **011-436.** Why `optimizer-start.test.ts:170` reads a second newline although `36c776cdf` made the shim's claim atomic. Lead: a `gitShim` that logs each call's pid, argv and time. Name the repair (test or product).
2. **011-440.** The source of the `proof-copy`, `proof`, `proof-green-daemon`, `proof-kept-key`, `proof-not-kept` red `stored: false`. Reproduce on a slow boat.dev sandbox (read `~/projects/notes/topics/boat-dev.md`; start a few, keep the slowest, about 3.8 GHz; delete all at the end; budget about $5 for the whole wave). Name whether the product gate or the test is wrong, and the repair.
3. **011-442.** Read how `src/runners/vitest/` passes its worker count and whether `VITEST_MAX_WORKERS` (or `VITEST_MIN_WORKERS`) in a user's environment overrides it. Show it with a small probe if cheap. List the options (clear, honour, honour as a ceiling) with the user-visible effect of each.
4. **011-439.** Confirm or refute that `integration/node-test.test.ts:209,286` fail because the session-start hook prints nothing when the store stays busy past `STATUS_BUSY_TIMEOUT_MS` (`src/core/status/open.ts`, `src/harness/shared/context.ts`). Describe what the user sees today and the options, with the cost of each.
5. **011-438.** Read Pi's `tool_call` gate (`src/harness/pi/extension.ts`, its 2,000 ms deadline). Describe what the user sees when it misses, how often (CI sightings), and the options with their cost.
6. Optional, only if the rest is done: the cause of `test/harness/hung-daemon.test.ts:135` (row ci-45710459569).

No artificial load on this host. Use /researcher.

## 011-437 and 011-441 (one worker, repair; test-only)

- **011-437.** `test/lint/provider/program-build.test.ts:75` "whose build outlasts the start budget reads unknown" received `undefined` for `report.results` on CI (main 42369696690, 42361750329). Find why the report has no results under load and make the test wait on the event it asserts. Owns that test file and its fixtures. A change under `src/core/lint/` is owned by coordinator b468025e: name it, do not make it.
- **011-441.** `test/harness/fast-path.test.ts:175` asserts a wall-time p95 under 10 ms. Lead: the fast path's claim is that the shell answers without starting Node; check that by counted work (for example a `PATH` shim that counts `node` starts) and remove the wall bound, naming the `bench/` cell it belongs in (do not edit `bench/`). Owns that test file.

Use /worker.
