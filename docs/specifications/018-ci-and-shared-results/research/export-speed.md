# Research: where `squeal ci export` spends its time (018-71)

Worker task 5d9bbee1, 2026-11-21. Brief: `tasks/wave-23.md`, 018-71. Parts: squawk's merge-queue CI run 44896173620 (2026-11-21 10:49Z, commit `8a331af9`), its nine `squeal-parts-*` artifacts (8 Vitest shards and the node:test parts, 71 MB), downloaded read only with `gh run download`. Its step `Export Squeal results` took 85 s (10:58:25 to 10:59:50) with Squeal 0.1.582 (action `ef0e5002`). Every time below is from one boat.dev sandbox: default type, 4 vCPU AMD Ryzen 7 9700X, 8 GB, Node 26.13.0, a shallow squawk checkout at `8a331af9` with `pnpm install --frozen-lockfile`. Nothing was timed on this host. Probes: `probes/export-speed/` (`run-export.sh` runs the export as the CI step does; `pairs.sh` alternates the two builds; `same-bytes.mjs` compares two exports; `prof-*.mjs` summarise a `--cpu-prof` profile; the summaries and raw times are beside them).

## Answer

Half of the export was one loop. `bundleOf` (`src/core/ci/export-bundle.ts`) built each file's observed entries with `readSharedEntries`, which reads a project's whole observed map from the store and parses it as JSON. It did this three times (one per map) for each of the 1,948 exported files. A map holds one entry for each file of the project that observed a path, and the export parsed the whole map to take one entry: for squawk, the same large maps about 5,800 times. This took 36.6 s of 83.4 s, and most of the 18.2 s of garbage collection came from it. The fix reads each `meta` key once per bundle (commit `20fc4a6aa`). The export then takes 25–31 s on the same parts and sandbox, and writes the same bytes.

## Times (same parts, same sandbox, wall clock of the whole command)

| Build | Runs (s) | Median (s) |
|---|---|---|
| 0.1.582 (squawk's CI) | 82.4 | 82.4 |
| 0.1.585, branch base `bf23dbc07` | 81.1, 84.2, 72.3, 74.3 | 77.7 |
| 0.1.585 + fix `20fc4a6aa` | 25.0, 25.0, 31.4 | 25.1 |

The base and fix runs alternated (base, fix, fix, base, base, fix) in one sandbox. Each run printed the same counts: 1,948 test files, 34,155 results, 706 on endpoint hashes; left out 14 uncertified, 2 with two checks of one name, 2 with an absolute path. With `--cpu-prof` the runs took 83.5 s (0.1.582) and 37.3 s (fix).

**Output unchanged.** `same-bytes.mjs` decodes two exports and compares their JSON with `header.createdAt` set to 0: each of the three base/fix pairs is equal (57,269,901 bytes of JSON each), and the sorted stderr lines of the export are equal. `test/ci/export-bundle.test.ts` holds the same at the unit: the bundle's bytes equal those of bundles built one file at a time (the old read), entries named `__proto__` and `constructor` included, and each map's key is read once. Without the fix that test fails: each key is read 3 times.

## Profile before the fix (0.1.582, 83.4 s sampled)

Inclusive time, from `probes/export-speed/profile-base582.txt`:

| Where | s | % |
|---|---|---|
| `exportWith` → `bundleOf` → `observedOf` → `readSharedEntries` | 36.6 | 43.9 |
| of which JSON parse (`parse`) | 25.1 | 30.1 |
| of which the store's `meta.get` | 11.5 | 13.7 |
| garbage collector (all) | 18.2 | 21.9 |
| Vite and rolldown: each file's closure through the runner (`ssrTransformScript`, oxc `transform`, `parseAst`) | about 11.8 | 14 |
| keys: `setClosure`, `grow`, `writeSeen` | about 3.5 | 4 |
| everything else (parts read, certify, records, encode) | under 2 | under 2 |

## Profile after the fix (37.1 s sampled, with the profiler's own cost)

From `probes/export-speed/profile-fix.txt`, self time by source: Squeal's bundle 11.6 s (31%), rolldown 7.1 s (19%), Vite 5.9 s (16%), idle 3.0 s (8%: waiting on the runner and child processes), garbage collector 2.9 s (8%). Inclusive: Vite's `ssrTransformScript` 4.4 s, `DaemonKeying.grow` 3.2 s, of which `writeSeen` 2.7 s (the store's observed maps written in one transaction), `setClosure` 2.2 s, `recordsForFile` 0.6 s, `encodeBundle` 0.5 s, `bundleOf` 0.2 s, `inputsHere` (certify) 0.2 s, reading the parts 0.3 s.

What is left is not in `src/core/ci/` or `src/cli/ci-export.ts`:

1. **Closures through Vitest (about 13 s CPU).** The export asks the Vitest adapter for each file's closure, as a daemon's start does (spec 018 D9, `DaemonKeying.keyFiles`). Vite transforms and parses every module of the graph. This is the runner's closure code (`src/runners/vitest/`); making it faster changes every daemon's start too, so it is a separate row if wanted.
2. **Key growth and its store write (about 5 s).** `DaemonKeying.grow` and `WorktreeKeys.writeSeen` (`src/core/scheduler/`, `src/core/keys/observed.ts`) write the shards' observed paths into the job's scratch store, as a daemon's record does. The export needs the keys, not the stored rows; skipping the write would need a keys option outside this row.

Neither moves the export as much as the fix did: together they are most of the 25 s.

## For the merge-queue decision after 018-71

On this sandbox the step drops from about 80 s to about 25 s. A GitHub runner was 3% slower than this sandbox before the fix (85 s against 82.4 s), so expect about 26 s there (an estimate, not measured on a runner), plus setup and artifact download (about 4 s in the run above). The export now ends about 55 s sooner after the last shard, so the ref is published about 55 s sooner after main moves.
