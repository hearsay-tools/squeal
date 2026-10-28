# Issue 79 gate probe (row 011-208)

Throwaway research only. This directory is outside the normal Vitest include list and outside Squeal's coverage. Findings: `../../issue-79-gate.md`.

`gate.probe.ts` drives the real scheduler and store of `test/scheduler/catch-up-fixture.ts` on the model clock of `test/scheduler/model-clock.ts`. A fake runner's runs take model time. No real test, daemon or worktree hold is touched. The fixture uses temporary repositories, a temporary store and a private capacity pool. Options B and C are patches of this probe (a `vi.mock` wrapper of `selectTier` and prototype patches of `RunQueue` and `Ledger`), not of product code.

Inputs: `durations.json`, written by `node extract.mjs ~/projects/cezar durations.json`. It holds the median passing file-level duration since 2026-10-21 from cezar's store, which is opened read-only.

Run from the repository root. `run.sh` waits while the one-minute load is above the CPU count, records the load, and runs one Vitest invocation:

```sh
sh docs/specifications/011-core/research/probes/issue-79/run.sh <name> [GATE_OPTIONS=today,B,C,B+C] [GATE_AGENTS=whole,halves,guard,none] [GATE_WORKERS=23,8] [GATE_GAP_S=15] [GATE_SMALL_AT=60,75,...]
```

Outputs per `<name>`: `<name>.jsonl` (one row per simulation, with load before and after), `<name>-traces.jsonl` (each run's start, end, size, parity count, grant and cut count, in model seconds from t0), `<name>-load.jsonl` and `<name>-output.txt`. A second run with the same name appends to the `.jsonl` files, so delete them first.

The model is deterministic: one plan gave the same numbers in three invocations at different host loads.
The `none` agent was added after the `matrix`, `gap*` and `small` runs. The other plans did not change.
