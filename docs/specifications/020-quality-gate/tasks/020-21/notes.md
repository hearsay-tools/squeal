# 020-21 notes: one Vitest adapter rule, and the cleanup edits in spec 021's files

Worker notes for whoever integrates or reviews the row. Brief: `tasks/wave-8.md`, section "020-21". Findings: `quality/2026-11.md`, row `proposed-runs-vitest` and slice 8; the left-overs are in `tasks/020-22b/notes.md`. Baseline `5d78a307c` (`w8/int`, 0.1.436). No behavior change was intended.

## Where each part lives now

- **`runsVitest(root, policy)`** in `src/core/daemon/runner.ts`, beside `vitestDetected`. It is the rule "no other runner is configured, or Vitest is detected" (spec 003 D7). Callers: `daemon.ts` (the Vitest runner), `code/gate/runners.ts` (`openRunners`; `collect.ts:303` in the quality file, moved there by 020-22a), `cli/code-gate-stored.ts` (`daemonAdapters`), `state/header.ts` (`listingRunnersField`), `cli/retry-unlisted.ts` (`mayList`, and also `testFileName`, whose `others.length > 0 && !vitestDetected(root)` is the same rule negated). `grep -rn "pytest.length === 0" src` finds only `runner.ts`.
- **`daemonVitestOptions(input)`** in a new `src/core/daemon/vitest-options.ts`, not in `runner.ts`: `runner.ts` would pass 300 lines. It gives the options the policy moves: `root`, `observe`, `excludeProjects`, `exclude`, and, with a provider, `coverage` (`enabled` is `coverageOn`, `children`, `provider`, `tempDir`, `collected`). The policy is a getter, because the daemon's changes with a reload. Callers add their own: the daemon `note`, `optimizer`, `childEnv`, `maxWorkers`; gate stored `cache: false`; `ci export` nothing.
- **Slice 8: `openReadOnly(path, version)`** in `src/core/store/open.ts` (the slice said `readOnly`; the exported name says what it does). `gate/stored.ts` (`readStores`) and `cli/code-gate-durations.ts` call it. `open.ts` is 304 lines, `stored.ts` 299.

## Why the option sets key the same

- The daemon builds the options once and spreads them into each instance, so every instance still shares one coverage object. That matters: a provider failure is a `WeakSet` keyed by that object (row 015-70), and it turns coverage off in all instances.
- `ci export` gave coverage only when `coverageOn(policy)`, with `enabled: () => true`. It now always gives the provider, with `enabled: () => coverageOn(policy)`, as the daemon does. With coverage off, the adapter's `coverageWanted` is false either way, so its instance starts with `coverage: { enabled: false }` and the environment hash is the same. `coverageProvider()` is now called with coverage off too; it is an `existsSync` and writes nothing.
- Gate stored built the same coverage object field by field.

## The left-overs of 020-22b

1. **The dead `listed` spread.** It is no longer in `runner-work.ts`: spec 021 (021-08, `12fb9ac35`) moved the commit to `src/core/scheduler/refine-apply.ts`. Removed there. `ledger.commit` reads only `options.refined`.
2. **`lifecycle.ts`** builds its observed keys from `OBSERVED_META_KEYS`. The order of the four keys changes (startup and modules swap). The snapshot is compared only with another taken in the same process, so nothing reads the old order.
3. **`store-writes.ts`** imports `BUSY_BOUND_MS` from `core/store/sliced-write.ts` and re-exports it; `cli/import.ts` still imports it from `store-writes.ts`.

## Not done, for the coordinator

- **A sixth copy of the rule** that the quality row does not list: `src/runners/vitest/describe.ts:70`, `!configured || vitestDetected(root)`, where `configured` is `configuredProjects(policy).length > 0` (`runners/descriptions.ts:158`), the node:test and pytest projects. It is `runsVitest(root, policy)`. Outside this row's files, so left.
- **A different rule:** `src/core/status/snapshot.ts:239` (`vitestExcluded`) skips Vitest when `policy.nodeTest.length > 0 && !vitestDetected(root)`. It ignores pytest, so with only pytest projects and no Vitest it still names Vitest's excluded projects. Its comment says "by the daemon's rule for building Vitest". Probably a defect; changing it is a behavior change, so left.

## Tests

- New: `test/daemon/vitest-options.test.ts`, for `runsVitest` and `daemonVitestOptions`. Its `runsVitest` cases use a pytest project: a test file that names node:test projects is taken for a node:test caller by `test/version-sensitive.test.ts`.
- Known failures on this host, not from this row: `test/daemon/start-short.test.ts` and `test/daemon/start-handoff.test.ts` ("expected null to match object { squealVersion }"). Both fail the same way on clean commits of other worktrees today (`81a2988`, `2e37288`, `6a725d3`, `5676e68`).
