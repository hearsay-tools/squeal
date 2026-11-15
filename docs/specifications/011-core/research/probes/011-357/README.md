# Probe for row 011-357 (throwaway)

Throwaway. Not part of the product suite; nothing imports it. It measures how long each lock turn of the scheduler lasts while slow lanes run, with 1, 3 and 6 configured groups, before and after row 011-357 moves each lane's listing, load guard, slot and pick into the step's lock turn.

`probe.test.ts` starts one scheduler per group count over the catch-up fake runner (runs end at once): 4 fast files and 2 files per group, every file importing `src/core.ts`; each group at `edit`, `maxParallel` 2, `deferUnderLoad` 1.0 per CPU and 5 s, the load guard read at 0. A private store and slot directory, and a scratch `HOME` (`vitest.config.ts`). Each round edits `src/core.ts` and waits until every file is current. The lock watcher (`watchLock`) times each turn with `performance.now`; `onStep` tags a step's turn with what it decided (reads left out). One JSON line per group count.

Run from the repository root, one run at a time, with the one-minute load below the CPU count:

    PROBE_ROUNDS=30 env -u PLUGIN_ROOT -u PLUGIN_DATA node_modules/.bin/vitest run --config docs/specifications/011-core/research/probes/011-357/vitest.config.ts --silent=false

A relabel of the step's turn (row 011-357) starts a new part under the new text; `byKind` times each part, `byTurn` each whole turn (`+lane`: a lane decided in it), `lockTotalMs` and `longestTurnMs` all turns.

- `before.txt`: commit `82309c087` (cand/0.1.515 plus the wave-102 brief), before any edit, 2026-11-15 18:39 UTC, one-minute load 6.9 to 7.0 on 24 CPUs; the probe then had no `byTurn` (a turn had one part).
- `after.txt` and `paired-after-{1,2}.txt`: this branch at `da601c447`; `paired-before-{1,2}.txt`: a detached tree at `37c830c2c` with this probe. Run alternately (before 1, after 1, before 2, after 2), 19:08 UTC, load 7.0 to 11.1. `after.txt` is `paired-after-1.txt`.
- `slot.test.ts` / `slot.txt`: `acquireSlowSlot` alone, 100 takes of 1 and of 2 permits, a private directory, load 8.5.

`tasks/011-357/notes.md` gives the tables.
