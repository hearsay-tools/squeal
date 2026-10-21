# Probe: issue 63 (throwaway)

Throwaway probe for `../../issue-63.md`. Not product code, not in the suite (`vitest.config.ts` at the root includes only `test/` and `src/`). It reuses `test/scheduler/catch-up-fixture.ts`: a real store and scheduler, a fake runner that honours a cancel.

- `superseded-tier.probe.ts`: one fast regression file and four slow files (3 s real each) in one lane. Revision 2 edits their shared source; the regression runs alone, then the four slow files run as an edit's tier. While that tier runs, revision 3 edits again and a named wait promotes the regression. Case A: revision 3 re-keys the running tier too (superseded). Case B: it re-keys only the regression file.
- `vitest.config.ts`: runs only this probe from the repository root.
- `results.txt`: the recorded run, with date, load, node and commit.

Run from the repository root after `npm ci --ignore-scripts`:

```
npx vitest run -c docs/specifications/011-core/research/probes/issue-63/vitest.config.ts --reporter=verbose
```
