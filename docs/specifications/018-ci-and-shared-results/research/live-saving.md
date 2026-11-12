# live-saving: what CI's shared results save on this host (row 018-39)

Researcher 2b3001f6 for spec 018, 2026-11-12, 14:48Z to 15:05Z. Brief: `research/README.md`, "Topic: live-saving". Source read at squeal `2c4d01751` (main). Data: squawk's (cezarion's) one shared store, `~/projects/cezar/.git/squeal/store.sqlite` (all 42 cezar worktrees use it), opened read-only, and the runs' `report.json` files. Cutoff 2026-11-12T14:45Z unless a line says otherwise. No daemon was started or stopped; nothing ran in `~/projects/cezar`. Host one-minute load was 22 to 30 on 24 vCPUs while I read; I took no timing measurement of my own. Durations below are the daemons' own records under that load. Probes: `probes/live-saving/` (throwaway).

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Files current from an import against a local run, and the local seconds replaced | **Coverage is high, the measured CPU saving is small.** In the 14 worktrees that still have rows, 13,305 of 19,522 current file states come from imports; a fresh worktree has 1,044 to 1,448 of its 1,509 to 1,882 listed files current from an import (61 to 96%). But under `baseline.onStart: "lookup-only"` a file missing at start is never run, so most of that coverage replaces no run. **Lower bound: 1,045 file runs, 7,168 local file-seconds**, in one worktree, where a change while the daemon ran reached files the import already held. **Ceiling: 10,003 imported file keys looked up, 60,311 local file-seconds** in the 19.75 h since imports worked (local runs in the same hours: 101,376 file-seconds). Per worktree and day for removed worktrees: not determined, because cezar deletes a worktree's rows with the worktree **[exp][src]** |
| 2 | Before and after 09:19Z, per release | **The step came at 2026-11-11 18:48Z, when the local daemons moved from Node 24.22.1 to Node 26.13.0, not at the Action (09:19Z) and not at 0.1.441 or 0.1.449.** Before it: 30 imports, 0 re-keyed, 29 of about 44,000 imported keys ever looked up. After it: 19 of 21 imports re-keyed, 9,974 keys looked up. The Action changed CI's Squeal (0.1.431 to 0.1.443) and the export shrank by 40 to 60 files; use per import did not change. node:test is not exported, so 0.1.449's re-key only adds local runs **[exp]** |
| 3 | Imports present but not current, per reason | For each live worktree's best import: 10,499 current, 5,998 same key kept (mostly an earlier import's result at the same key), 2,448 environment, 1,019 closure, 45 observed, 767 content, 1 not adopted. **The newest import (fe53b2f9, 14:47Z) is current in no worktree: 19,286 of 20,746 read "environment differs"**, because it was stored at CI's own key. Two more imports today (d51e5285, ba5a2048) were stored wholly at CI's key **[exp][src]** |
| 4 | What the numbers say about the goal | Shared results now reach most fresh worktrees, but CPU saved on this host is bounded by how often a running daemon meets main's new content, and by the first-importer defect of Q3. Local load per worktree fell 57% on 2026-11-12 against 2026-11-09/10: large, unconfirmed, confounded **[exp][inf]** |

## Q1. Current from an import, against local runs

**Live worktrees** (`worktrees.mjs`, `out/wt.txt`). The 14 worktrees whose daemon ran after the first import, by the origin of each test file's current known states now:

| Worktree | Registered | Daemon | Listed | Imported | Inherited | Own | Not current | Imported, reached by a change | Local file-runs / file-s since 11-05 |
|---|---|---|---|---|---|---|---|---|---|
| b7555ac0 (main checkout) | 10-14 | 0.1.451 | 1,916 | 1,113 | 436 | 2 | 365 | 0 (all at a daemon start) | 4,088 / 40,182 |
| dc20d96e | 11-11 21:12 | 0.1.451 | 1,882 | 1,210 | 523 | 3 | 146 | 0 | 3 / 107 |
| c274a0de | 11-12 09:38 | 0.1.443 | 1,706 | 1,121 | 476 | 109 | 0 | 0 | 214 / 360 |
| 616bcf31 | 09:38 | 0.1.448 | 1,711 | 1,075 | 437 | 97 | 102 | 0 | 258 / 1,009 |
| 888db0a9 | 09:40 | 0.1.451 | 1,814 | 173 | 12 | 170 | 1,459 | 0 | 2,335 / 16,945 |
| 8ee33ff0 | 09:40 | 0.1.449 | 1,746 | 1,428 | 34 | 34 | 250 | 0 | 51 / 362 |
| b3a63fc4 | 10:21 | 0.1.449 | 1,732 | 306 | 99 | 794 | 533 | 0 | 1,023 / 2,707 |
| e68fc045 | 10:44 | 0.1.443 | 1,704 | 1,121 | 489 | 3 | 91 | 0 | 4 / 79 |
| d1d5dc51 | 10:44 | 0.1.443 | 1,708 | 1,044 | 513 | 95 | 56 | 0 | 104 / 981 |
| e2e8adfd | 11:00 | 0.1.443 | 1,708 | 1,114 | 574 | 20 | 0 | 0 | 23 / 508 |
| 8437c153 | 11:18 | 0.1.447 | 1,700 | 1,076 | 4 | 526 | 94 | **1,045 (7,168 s)** | 651 / 1,856 |
| a13cd09a | 12:09 | 0.1.447 | 1,724 | 0 | 29 | 146 | 1,549 | 0 | 173 / 359 |
| 6421a070 | 13:00 | 0.1.448 | 1,607 | 1,076 | 531 | 0 | 0 | 0 | 0 / 0 |
| 6ac78c9c | 14:03 | 0.1.450 | 1,509 | 1,448 | 61 | 0 | 0 | 0 | 0 / 0 |

- **Which adoptions replaced a run.** `src/core/scheduler/bootstrap.ts` step 4: under `lookup-only` the start's misses are "abandoned unless empty", and a start queues a revision's reach only when it resumes a rest (011-91). So a file the import makes current at a daemon start would not have run then. A file the import makes current at a revision whose changes reach its closure would have run, as edit or catch-up work. Of 13,305 imported file states, 7,060 were adopted at revision 0, 2,157 at a later daemon start, 4,088 at a running revision, and 1,045 of those at a revision whose changed paths are in the file's static closure: worktree 8437c153, revision 6 (11:43Z), a `package.json` change that reached 1,045 files whose new keys the import already held. That is the measured saving: 7,168 s at the files' local medians **[exp][src]**. The other running-revision adoptions (e68fc045's 1,121 at a revision that changed only `docs/sdlc/friction.md`) came from the import's own re-key, not from a change **[exp]**.
- **Store-wide, all worktrees, removed ones included** (`imports.mjs`, `late.mjs`). Each content key is held by the first import that carried it (later imports at the same content find it held). Since lookups worked: 9,974 distinct imported (file, key) pairs were looked up at least once (`last_used_at` moved past the import time; `byKey` moves it); at local medians 60,311 s. 20,411 imported pairs were never looked up. 13 pairs were run locally again after the import (`rerun`, 219 s). 1,825 pairs had a local result before the first import that carried them (`late`, about 7,400 s), 646 of them from one worktree, most likely the merged pull request's own runs **[exp][inf]**. A lookup is a ceiling, not a saving: it happens at a start too.
- **Local load per day** (`local.mjs`; all worktrees, removed ones included; non-checkpoint file-seconds per worktree with runs): 11-07 5,424; 11-09 4,659; 11-10 4,991; 11-11 6,739; 11-12 (to 14:45Z) **2,069**. Against the mean of 11-09 and 11-10: −57%. Worktrees with runs per hour were similar (11-11 1.75, 11-12 1.76). This is one partial day with no control for what the agents did, and the Node 26 move on 11-11 re-ran files once, so it is a large, unconfirmed difference, not a measured saving **[exp][inf]**.

## Q2. Before and after, per release

Windows (`out/local-summary.json`, `out/late.txt`, `out/rekey.txt`, `out/environments.txt`):

| Window (UTC) | Hours | Worktrees with runs | Local file-s (non-checkpoint) | per hour | Imports | Re-keyed | Imported keys looked up (local-median s) |
|---|---|---|---|---|---|---|---|
| A 11-05 00:00 to 11-10 21:49, no import | 141.8 | 343 | 1,426,644 (1,014,583) | 10,060 (7,154) | 0 | – | – |
| B to 11-11 19:00, imports, none used | 21.2 | 50 | 312,434 (298,295) | 14,750 (14,083) | 30 | 0 | 29 (11) |
| C to 11-12 09:19, CI 0.1.431 | 14.3 | 19 | 75,730 (67,497) | 5,289 (4,714) | 12 | 12 (≥77% each) | 6,676 (39,332) |
| D to 13:21, Action, CI 0.1.443 | 4.0 | 14 | 16,286 | 4,041 | 4 | 4 | 1,750 (13,363) |
| E to 14:45, local 0.1.449+ | 1.4 | 4 | 9,360 | 6,686 | 5 | 3 (d51e5285, ba5a2048: 0) | 1,548 (7,605) |

- **The step is the local Node.** Local environments read Node v24.22.1 until 2026-11-11 18:40:17Z and v26.13.0 from 18:48:35Z (`environments`). The first re-keyed import came at 19:04Z. Every import before it was stored at CI's key (`ci: true`, Node 26), so no local key could equal it (D11 re-keys only when the importer's environment equals CI's under D10). The local Squeal then was already 0.1.431 or newer (hub cache 15:24Z), which also carries 018-28's re-key after an import; the store records no per-run version, so the two are not separable **[exp][inf]**.
- **0.1.441** (released 00:06Z on 11-12): no separate step. Imports were used for 5 h before it **[exp]**.
- **The Action** (09:19Z, CI's Squeal 0.1.431 to 0.1.443): per-import use is of the same kind (0.1.431 exports first at new content: 1,192 to 1,502 keys used; 0.1.443: 612 to 1,448). Exported files fell from 1,508 to 1,529 per export to 1,469 to 1,485. That gap is row 018-40's topic **[exp]**.
- **node:test re-key (0.1.449)**: node:test files are not exported (`ci record` records Vitest only), so imports neither gain nor lose. Local node:test file-seconds read 3,858 in D and 230 in E, an undercount, since a later run at the same key replaces the row this reads **[exp]**.
- Window A includes 412,061 s of full-suite checkpoints; C has 8,233, D and E none **[exp]**.

## Q3. Imports present but not current

`reasons.ts` runs Squeal's own `readImports` (D5) per live worktree over a read-only store (`out/reasons.txt`, read 15:00Z, so it includes fe53b2f9 at 14:47Z):

| Per live worktree, summed | Files | Current | Same key kept | Not adopted | Environment | Closure | Observed | Content |
|---|---|---|---|---|---|---|---|---|
| Best import (most current) | 20,777 | 10,499 | 5,998 | 1 | 2,448 | 1,019 | 45 | 767 |
| Newest import (default status's) | 20,746 | 2 | 698 | 3 | **19,286** | 0 | 0 | 757 |

- "Same key kept" is mostly benign: the key matches, and the current result is an earlier import's at the same content. "Closure" is 917 of its 1,019 in one worktree (b3a63fc4), whose branch changed closure lists. "Content" is the expected case after main moved **[exp]**.
- **The first importer decides for every worktree.** The reader skips an export whose commit any import in the shared store already holds (`src/core/shared/reader.ts`, `held`, `nearestHeld === 0`). Re-keying uses the importing worktree's environment and stores at CI's key when it differs from CI's under D10, or when the worktree has none recorded yet (`src/core/store/transfer-rekey.ts`, `localHash`) **[src]**. Measured: d51e5285 (14:07Z) and ba5a2048 (14:39Z) were stored wholly at CI's key, fe53b2f9 (14:47Z) 1,120 of 1,485 files; 1e93f0cb, 99aaa04a and de83e59e partly (219, 345, 238 files) **[exp]**. The commits were in the clone before each import (`origin/main` reflog), so a missing commit is not the cause **[exp]**. Which worktree imported is not recorded. Candidates, inferred: 888db0a9, whose server environment differs from CI's in one config file (`files.5`) and which keyed at 14:39:10Z, two seconds before ba5a2048; for d51e5285, a daemon that had just started (6ac78c9c registered 14:03:52Z, 8ee33ff0 revised at 14:06:59Z) and may have had no environment recorded **[inf]**.
- Time from the local fetch of a main commit to its import: 0.1 to 19.3 min, median 8.1 (n = 9, `origin/main` reflog against `imports.imported_at`). Cause of the longer gaps not determined **[exp]**.

## Recommendation

1. **Report the saving as two numbers, not one.** Coverage is real: 61 to 96% of a fresh worktree's listed files are current from an import. CPU saved is much smaller under `lookup-only`: measured 7,168 file-seconds for certain, at most 60,311, against 101,376 run locally in the same 19.75 h. A shared store already hands main's content from one worktree to the next, so on this host an import can only save the first local run of main's new content, and only when a running daemon would run it.
2. **A repair row for the first-importer defect** (Q3): three of 21 working imports, the newest included, are unusable for every worktree because one worktree's environment differed at import time. Squeal decides the fix; what the evidence asks for is that a held import stored at CI's key can still serve a worktree whose environment matches.
3. **Measure again before claiming a load effect**, after several days of one Squeal release on both sides. The store cannot answer this well: worktrees take their history with them, `last_used_at` keeps only the last lookup, and no row records when a file became current or from what. A measurement row, not a product change, could log adoptions from the reader's daemon log or status snapshots over a week.

## Open questions

- How much of the −57% local load per worktree on 11-12 the imports caused: not determined, because one partial day, no record of agent work per worktree, and the Node 26 re-runs on 11-11.
- Which worktree made the three CI-key imports, and whether "no environment recorded yet" at a fresh start is a cause: the store keeps no importer; a daemon log would show it.
- Why some imports came 9 to 19 min after the fetch: the reader's trigger timing was not studied.
- Saved runs in removed worktrees: their `known_states` and `revisions` rows are gone; only `runs` and `results` remain.

## Sources

- Store: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (tables `imports`, `import_files`, `results`, `known_states`, `revisions`, `runs`, `environments`, `worktree_environment_hashes`), `runs/<id>/report.json`; read 2026-11-12 14:48Z to 15:01Z.
- Source at `2c4d01751`: `src/core/scheduler/bootstrap.ts` (lines 38 to 54, 124 to 125), `src/core/shared/reader.ts` (166 to 176, 228 to 289), `src/core/store/transfer-rekey.ts` (27 to 40, 70 to 140), `src/core/store/repos/results.ts` (`byKey`, `putMany`), `src/core/status/imports.ts`, `src/core/types/state.ts` (`importIdOf`).
- Release times: git tags `squeal--v0.1.426` to `squeal--v0.1.451`; hub cache directories `~/.claude/plugins/cache/hearsay/squeal/<version>` (birth times).
- `~/projects/cezar` `origin/main` reflog (read only).
- Earlier findings extended, not repeated: `shared-proof.md` (fresh-clone counts, export left-outs, CI cost), `capture-saving.md`.
