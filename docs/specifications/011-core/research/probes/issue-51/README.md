# Probe: issue 51 (throwaway)

Throwaway probe for `../../issue-51.md`. Not product code, not in the suite (`vitest.config.ts` at the root includes only `test/` and `src/`). It reuses `test/scheduler/catch-up-fixture.ts`: a real store and scheduler, a fake runner.

- `large-requeue.probe.ts`: 303 files re-keyed by one catch-up revision, the first backlog tier held in flight; with and without a 60 s promotion of the file the order would run last.
- `vitest.config.ts`: runs only this probe from the repository root.
- `results.txt`: the recorded run, with date, load, node and commit.

Run from the repository root after `npm ci`:

```
npx vitest run -c docs/specifications/011-core/research/probes/issue-51/vitest.config.ts --reporter=verbose
```
