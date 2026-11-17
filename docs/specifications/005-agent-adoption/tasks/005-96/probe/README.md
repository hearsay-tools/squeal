# Probe for row 005-96 (throwaway)

Throwaway. Not part of the product suite; nothing imports it. Adapted from `../../../../011-core/research/probes/011-357/`. A private store and a scratch `HOME` (`vitest.config.ts`).

- `probe.test.ts`: the scheduler's lock turns while edit tiers start, with 1, 4 and 12 projects (2 files each), over the catch-up fake runner (runs end at once). Each round edits `src/core.ts`, which every file imports, and waits until every file is current. The lock watcher times each turn; `onStep` tags it with what the step decided. `startTierTurns` are the turns that started a tier. `recordBytes` is the record's size after the run (`null` before row 005-96).
- `record.test.ts`: a start-like `BEGIN IMMEDIATE`, alternately without and with `recordEditTier` after it in its own transaction (the first round had it inside), 300 iterations, with 1, 12 and 100 projects in the width map.

Run from the repository root, one run at a time:

    PROBE_ROUNDS=30 timeout 300 env -u PLUGIN_ROOT -u PLUGIN_DATA node_modules/.bin/vitest run --config docs/specifications/005-agent-adoption/tasks/005-96/probe/vitest.config.ts --silent=false

- First round (the record inside the start's transaction, `e0d52baec`): `paired-before-0.1.535-{1,2}.txt` (a detached tree at `61904d31b`) and `paired-after-in-transaction-{1,2}.txt`, run alternately 2026-11-17 00:10 to 00:11 UTC, load 37.8 to 44.5 on 24 CPUs; `record-in-transaction.txt`, 00:11 UTC, load 47.2.
- Repair after review 0.1.535 (the record in its own write after the flight, `88ea38856`): `paired-before-{1,2}.txt` (a detached tree at `61904d31b`) and `paired-after-{1,2}.txt`, run alternately 00:37 to 00:38 UTC, load 76 to 86; `record-own-write.txt` (`record.test.ts` as it is now), 00:37 UTC, load 86.0.

`../notes.md`, "The lock turn" and "Repair after review 0.1.535", give the tables.
