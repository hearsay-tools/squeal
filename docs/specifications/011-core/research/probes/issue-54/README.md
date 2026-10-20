# Probe: issue 54 (throwaway)

Throwaway evidence for `../../issue-54.md`. Not product code; nothing imports it; outside the
repository's Vitest `include`, so neither Squeal nor CI runs it. No `node_modules` of its own.

- `probe.test.ts` drives the product scheduler unchanged through the 001-368 retry fixture
  (`test/scheduler/retry-fixture.ts`: `test/flaky.test.ts > flips` fails while a marker outside the
  worktree exists), host load injected through `SchedulerOptions.hostLoad` (8 CPUs; 26.64 for
  3.33 per CPU at the failure, 4 at the retry), `rerunCap: 0` so no 001-171 re-run intervenes. It
  prints `formatFailures(readFailures())` and `formatWhy(readWhy())` before and after a passing
  `--reason load` retry at the same key, plus the `meta` rows and the failing run's leftovers.
- `vitest.config.ts` roots Vitest at the repository and includes only the probe.
- `output.txt` is one run's stdout (2026-10-20T16:43:58Z, host load 15.26 on 24 CPUs), the
  worktree path replaced by `<worktree>` and Vitest's own stack frames dropped.

Run from the repository root, after `npm ci`:
`npx vitest run --config docs/specifications/011-core/research/probes/issue-54/vitest.config.ts --maxWorkers=1 --silent=false --reporter=verbose`
