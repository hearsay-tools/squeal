# Probes for issue #225 (throwaway)

Throwaway evidence for `../../issue-225.md`. Not product code. Delete freely.

- `probe.ts`: drives the real permit pool (`src/core/capacity/pool.ts`) in a temporary directory, with injected CPU readings (24 CPUs, fake host busy cores, fake marks of other daemons). One `acquire(1, "fast", 1, kind)` per case, as a one-file tier asks. Also calls the retry load gate `loadAllows`. No daemon, no runner, no real load. Output: `output.txt`.
- `live-marks.ts`: read-only. Lists the live per-user pool marks under `$XDG_RUNTIME_DIR/squeal` on this host. Writes nothing. Output, with a 3 s `/proc/stat` busy-core sample: `live-marks-output.txt`.

Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-225/probe.ts
pnpm exec tsx docs/specifications/011-core/research/probes/issue-225/live-marks.ts
```

Limits: the probe tests the pool's admission rule alone. It does not run the scheduler's tier selection, the 2 s recheck loop, the floor's rotation over time, or several real daemons. It does not reproduce the 2026-11-15 incident.
