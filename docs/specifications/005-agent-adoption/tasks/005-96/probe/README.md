# Probe for row 005-96 (throwaway)

Throwaway. Not part of the product suite; nothing imports it. Adapted from `../../../../011-core/research/probes/011-357/`. A private store and a scratch `HOME` (`vitest.config.ts`).

- `probe.test.ts`: the scheduler's lock turns while edit tiers start, with 1, 4 and 12 projects (2 files each), over the catch-up fake runner (runs end at once). Each round edits `src/core.ts`, which every file imports, and waits until every file is current. The lock watcher times each turn; `onStep` tags it with what the step decided. `startTierTurns` are the turns that started a tier. `recordBytes` is the record's size after the run (`null` before row 005-96).
- `record.test.ts`: `recordEditTier` alone inside a start-like `BEGIN IMMEDIATE`, alternately without and with it, 300 iterations, with 1, 12 and 100 projects in the width map.

Run from the repository root, one run at a time:

    PROBE_ROUNDS=30 timeout 300 env -u PLUGIN_ROOT -u PLUGIN_DATA node_modules/.bin/vitest run --config docs/specifications/005-agent-adoption/tasks/005-96/probe/vitest.config.ts --silent=false

- `paired-before-{1,2}.txt`: a detached tree at `23f67d006` (main, 0.1.531 plus the wave-119 brief) with this probe; `paired-after-{1,2}.txt`: this branch at `e0d52baec`. Run alternately, 2026-11-17 00:10 to 00:11 UTC, load 37.8 to 44.5 on 24 CPUs.
- `record.txt`: `record.test.ts` at `e0d52baec`, 00:11 UTC, load 47.2.

`../notes.md`, "The lock turn", gives the tables.
