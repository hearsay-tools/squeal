# Probe for row 011-357 (throwaway)

Throwaway. Not part of the product suite; nothing imports it. It measures how long each lock turn of the scheduler lasts while slow lanes run, with 1, 3 and 6 configured groups, before and after row 011-357 moves each lane's listing, load guard, slot and pick into the step's lock turn.

`probe.test.ts` starts one scheduler per group count over the catch-up fake runner (runs end at once): 4 fast files and 2 files per group, every file importing `src/core.ts`; each group at `edit`, `maxParallel` 2, `deferUnderLoad` 1.0 per CPU and 5 s, the load guard read at 0. A private store and slot directory, and a scratch `HOME` (`vitest.config.ts`). Each round edits `src/core.ts` and waits until every file is current. The lock watcher (`watchLock`) times each turn with `performance.now`; `onStep` tags a step's turn with what it decided (reads left out). One JSON line per group count.

Run from the repository root, one run at a time, with the one-minute load below the CPU count:

    PROBE_ROUNDS=30 env -u PLUGIN_ROOT -u PLUGIN_DATA node_modules/.bin/vitest run --config docs/specifications/011-core/research/probes/011-357/vitest.config.ts --silent=false

`before.txt`: commit `82309c087` (cand/0.1.515 plus the wave-102 brief), 2026-11-15 18:39 UTC, one-minute load 6.9 to 7.0 on 24 CPUs. `after.txt`: the row's last commit; its notes give both tables.
