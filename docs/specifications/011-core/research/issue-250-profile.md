# Issue #250 profile: where a two-file named status spends its CPU

2026-11-19, row 011-408. Recommendation: in a named answer, compare only the newest import, not all of them. On this store that cuts a no-wait two-file status from about 7 s to about 3 s of CPU at the issue's kind of load, and it cuts the end of every `--wait` by the same amount. 0.1.567 did not make it worse. The cost grows with the number of stored imports, and nothing deletes them.

## Questions and verdict

| Question | Answer | Tag |
| --- | --- | --- |
| Does the issue's call cost this much on a copy of the reporter's store? | Yes. Two named test files: 7.1 to 7.5 s user CPU, 7.5 to 8.5 s wall (medians, load 21 to 27). The first run on a cold page cache took 13.4 s wall. | `verified by experiment` |
| Where does the CPU go? | 55 to 70 % is the comparison of all 185 stored imports in the whole-worktree snapshot (`readImports`). Next: three reads of the 35,015 known states with the worktree header (about 1.5 s together), the 750 ms settle (idle, no CPU), GC (0.45 to 0.5 s). Selection, verdict classes, sync and store open take under 40 ms together. | `verified by experiment` |
| Did 0.1.567 regress against 0.1.566? | No. Medians: 0.1.566 7.49 s user, 0.1.567 7.33 s, main 7.06 s. The 0.1.567 changes (011-398, 011-403) run in 5 to 30 ms. | `verified by experiment` |
| Does a missing daemon take another path than a late one? | No, for the snapshot. Both are not ready, so the pause and hold reads never run (0 ms). A late daemon costs the same 5.7 to 8.4 s user. A synced daemon was not reproduced. | `verified by experiment`; synced case not determined |
| Why did `--wait 60000` end 14 to 17 s late? | The final read after the deadline builds the same snapshot. `--wait 3000` with a late daemon ended at 8.0 to 8.8 s; the polls before the deadline were cheap. | `verified by experiment` at load 13 to 14; the issue's 14 s at load 43 to 46 is `inferred` |
| What is the smallest fix? | Compare the newest import only in a named answer (snapshot and the named wait's last read). Measured saving with one import kept: 2.7 s of 4.8 s user at load 8, about 4 s of 7 s at load 17 to 20. | `verified by experiment` (proxy), contract `read in official docs` |

## Setup and versions

**`verified by experiment`.** The largest stores on this host are `squeal` (7.1 GB) and `cezar` (6.6 GB). The issue's paths are under `packages/cezar`, so the cezar store is the reporter's shape. I copied it to scratch (no `-wal`, no process held it, mtime unchanged) and cloned the repository to scratch at `cez/09efb45b` (`87da207e5`). That worktree, `a41de0395ad10bfe`, last ran a 0.1.567 daemon. `prepare-store.mjs` moved its rows to the clone's worktree id and cleared every `daemon_socket` in the copy. Store contents: 35,015 known states and 1,956 test-file key rows for the worktree; store-wide 185 imports, 289,524 import-file rows, 2,832 test files with 54 MB of closure JSON. Schema is the same in all three versions, and status opens without creating indexes, so one copy served all.

CLI bundles: `plugins/claude-code/dist` from `squeal--v0.1.566` (`85bf5476`), `squeal--v0.1.567` (`407052a8`) and `origin/main` (`7dba57db`). Every call ran `env -i` with `HOME`, `XDG_*` and `TMPDIR` in scratch, `timeout 180`, `/usr/bin/time -v`. No daemon ran. The call:

```sh
squeal status --json packages/cezar/src/core/runner-skill-trigger-omp-parity.test.ts packages/cezar/src/core/runner-skill-trigger-pi-parity.test.ts
```

Every run gave exit 3, both files current/pass, "no verdict", as in the issue. The host load of each run is in `probes/issue-250/runs.log`; I made no load.

## Findings

### 1. Phases per version

**`verified by experiment`.** `node --cpu-prof` at 500 µs, 3 profiles per version at load 15 to 24, median ms of main-thread time per phase. Profile time includes time the thread waits for a CPU, so it is wall time of the main thread. Process CPU is in the `/usr/bin/time` rows below the table.

| Phase | 0.1.566 | 0.1.567 | main |
| --- | ---: | ---: | ---: |
| Total sampled | 6350 | 6658 | 6817 |
| Bundle load and start | 161 | 167 | 164 |
| Settle wait, idle (no daemon answers within 750 ms) | 744 | 748 | 743 |
| Store open, source paths, sync attempt | 13 | 15 | 17 |
| Named selection (`selectNamedFiles`) | 8 | 5 | 9 |
| Verdict classes (`readClasses`) | 16 | 14 | 15 |
| Whole-worktree snapshot (`buildSnapshot`) | 4121 | 4131 | 4485 |
| of it: imports comparison (`importsOf`) | 3605 | 3491 | 3780 |
| Verdict (`readVerdict`) | 422 | 517 | 481 |
| Named files (`readNamedFiles`) | 392 | 500 | 409 |
| JSON rendering | 176 | 153 | 150 |
| GC, spread over the above | 450 | 490 | 499 |

Five timed runs per version, interleaved, load 21 to 27: user 0.1.566 6.99 to 7.98 s (median 7.49), 0.1.567 6.43 to 7.95 s (7.33), main 6.27 to 8.48 s (7.06). Wall medians 8.48, 8.08 and 7.52 s. The spread follows the load, not the version.

Inside the imports comparison (0.1.567 profile, 4.1 s): per-file reason 1.9 s, of which closure hashes 1.2 s (`store.testFiles.get` then `listHash`) and observed hashes 0.5 s; reading the import-file rows 0.8 s; the `fromImport` count 0.7 s; environment differences 0.3 s.

### 2. Rows read per phase

**`verified by experiment`** with `count-rows.mjs` (0.1.567 and main give the same counts).

| Phase | Statement calls | Rows | Main reads |
| --- | ---: | ---: | --- |
| Source paths | 1 | 1,956 | test-file keys |
| Sync attempt | 6 | 6 | pragmas, worktree row |
| Named selection | 1 | 1,956 | test-file keys |
| Verdict classes | 15 | 37 | the two files' states and keys |
| Snapshot, without imports | 65 | 38,945 | 35,015 states, test-file keys twice |
| Imports comparison | 12,184 | 303,846 | 185 × `import_files` (289,524), 10,097 `test_files` lookups, 1,038 table checks |
| Verdict | 15 | 35,024 | all 35,015 states again |
| Named files | 19 | 36,980 | all states again, test-file keys |

A two-file answer reads 418,750 rows. 69 % of them are import-file rows.

### 3. Cost grows with imports, not with releases

**`verified by experiment`.** `trim-imports.mjs` parked all but the newest N imports on the copy, then restored them. Main, named no-wait call:

| Imports kept | Load | User s | Wall s |
| ---: | --- | --- | --- |
| 185 (all) | 8 | 4.82 | 5.39 |
| 92 | 9 to 10 | 4.11 to 4.31 | 4.62 to 4.84 |
| 1 (newest) | 8 | 1.95 to 2.27 | 2.50 to 2.75 |
| 0 | 8 | 1.81 to 1.95 | 2.37 to 2.49 |
| 185 (all) | 17 to 27 | 6.27 to 8.48 | 6.9 to 12.1 |
| 1 (newest) | 19 to 20 | 2.72 to 3.36 | 3.21 to 3.81 |
| 0 | 16 to 18 | 2.33 to 2.70 | 2.78 to 3.11 |

So each stored import adds about 15 ms of CPU at load 8 and about 22 ms at load 20 to every status call that builds the snapshot. Pathless `status --json`: 3.79 s user with 185 imports, 1.00 s with one.

**`read in source code`, main.** Import rows are only written (`INSERT OR REPLACE` in `src/core/store/transfer-rows.ts`) and read (`src/core/store/imports.ts`); no code deletes them. The copy's imports by day: 7 on 2026-11-10, then 28, 38, 22, 22, 35, 17 and 16 (2026-11-19). The cost therefore rose by roughly 0.3 to 0.8 s per day since the first import, across every release.

### 4. Missing daemon and late daemon

**`verified by experiment`.** `late-daemon.mjs` wrote a fresh heartbeat, a new start time and a scratch socket path on the copy's row, and listened on that socket without answering. Status then read the daemon as `alive`, outcome `snapshot`, reason `unsynced`. User CPU 5.74 to 8.35 s (load 15 to 23), the same as without a daemon. `pauseOnlyIds` and `holdOfWait` took 0 ms: in `src/cli/wait/snapshot.ts` both need `ready`, which an unsynced daemon does not give. Only a daemon that answers the sync adds them; I did not reproduce that case, because it needs a real daemon or a fake of its sync protocol.

The copied store also holds the old daemon's exit record. Without a new start time, the first `--wait 3000` attempt ended at once as `no-daemon` after 7.8 s, all of it the one final read.

### 5. The wait overrun

**`verified by experiment`.** With the late daemon, `status --wait 3000 --json <2 files>` ended `timeout`, `waitedMs` 8019 (main) and 8803 (0.1.567); process wall 7.5 to 9.1 s at load 13 to 14. The profile: 2.9 s idle between polls, then the final read 3.96 s, of which the snapshot 3.18 s and the imports comparison 2.76 s. The polls before the deadline did not build the snapshot. The deadline bounds the polls, then the final read runs to its end (`issue-250.md` finding 3).

**`inferred`.** The issue's 74 s for `--wait 60000` at load 43 to 46 is one such final read under twice this load, plus the stale-heartbeat wording, which `issue-250.md` finding 4 shows adds no time.

## Recommendation for Squeal

1. **Smallest fix: compare the newest import only in a named answer.** In `buildSnapshot`, as called from `src/cli/wait/snapshot.ts:151` and `src/cli/wait/named.ts:193`, run `readImports` for the newest import, the one the default text names (spec 018 D5, row 018-32). Expected saving, from the one-import experiment: 2.7 s of 4.8 s user at load 8, about 4 s of 7 s at load 17 to 20. The wait's final read gets shorter by the same. The cost stops growing with imports. Contract: D5 says `--json` lists every import, and today the named JSON carries the whole snapshot. D19's count of imports that differ only in Node also reads every import. The coordinator decides whether a named answer may narrow that list, which is a C6 or 018 D5 amendment.
2. **No contract change, smaller saving (`inferred` from the profile):** compute each test file's closure hash and observed hash once per call, not once per import (10,097 lookups for at most 2,832 files). That saves up to the 1.7 s spent in those hashes. Reading 289,524 rows and the `fromImport` count stay linear in imports.
3. **Bound the growth (owner 018, not measured):** prune imports that a newer import of the same source replaced. This also protects pathless `status`, `--full` and `--json`.
4. **Read states once (`inferred`):** verdict and named files each read all 35,015 states again and recompute the header. Passing the snapshot's rows to them would save most of their 0.8 to 1.0 s.

## Open questions

- The cost with a daemon that answers the sync (verdict ready): not measured. It adds the pause and hold reads.
- The issue's own run: its store then had fewer than 185 imports, and its load was 43 to 46. The two runs here at load 21 to 27 took 7 to 8.5 s user. I did not raise the load to check 10.5 s.
- Who reads `imports` beyond the newest: in `src`, `import-lines.ts` (`--full` text, all imports) and `node-mismatch.ts` (D19's count of imports that differ only in Node, over all imports). Whether the named text prints either, and whether external harnesses read the named JSON's list: not determined.

## Sources

- Issue [#250](https://github.com/hearsay-tools/squeal/issues/250); `research/issue-250.md` (triage).
- Source at `7dba57db`: `src/cli/wait/snapshot.ts`, `src/cli/wait/named.ts`, `src/core/status/snapshot.ts` (`buildSnapshot`, `importsOf`), `src/core/status/imports.ts` (`readImports`, `hereOf`), `src/core/store/imports.ts`, `src/core/store/transfer-rows.ts`, `src/cli/status-sync.ts`, `src/core/presence/heartbeat.ts`, `src/core/store/repos/worktrees.ts`.
- Spec 018 D5; spec 011 C6 and C15.
- Probes, `runs.log` and setup: `probes/issue-250/` (throwaway). The store copy, clone and profiles stay in the task's scratch folder.
