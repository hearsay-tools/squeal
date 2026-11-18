# Throwaway issue-241 probe

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-241/probe.ts
```

Synthetic graph, records and durations exercise real scheduler, tally, formatter and verdict functions. The probe skips when one-minute load exceeds CPU count. It starts no daemon or test runner. `output.jsonl` is the researcher's saved successful run. See ../../issue-241.md for limits and verification.
