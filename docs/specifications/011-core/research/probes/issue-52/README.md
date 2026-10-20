# Probe: issue 52 (throwaway)

Throwaway evidence for `../../issue-52.md`. Not product code; nothing imports it; outside the
repository's Vitest `include`, so neither Squeal nor CI runs it. No `node_modules` of its own.

- `probe.test.ts` drives the product's scheduler and delivery unchanged through the 001-368 retry
  fixture (`test/scheduler/retry-fixture.ts`: a test that fails while a marker outside the worktree
  exists), with the host load injected through `SchedulerOptions.hostLoad` (8 CPUs; 26.64 for
  3.33 per CPU, 4 for 0.50). No CPU stress is created.
- `vitest.config.ts` roots Vitest at the repository and includes only the probe.

Run from the repository root: `npx vitest run --config docs/specifications/011-core/research/probes/issue-52/vitest.config.ts`
