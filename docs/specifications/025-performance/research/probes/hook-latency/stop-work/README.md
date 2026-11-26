# Row 025-18: Stop's repeated work (probe and notes)

Throwaway probe scripts for row 025-18. They are not product code. They expect `$S`, a scratch directory, and `$W`, the worktree. Copy them to `$S/probe/` and run from there.

## Setup

1. Build each tree's hook bundles into a scratch dist: `$W/node_modules/.bin/tsx $S/probe/build.ts <tree> <outdir>`. The script builds only the hook entries with the product's `bundleOptions`. Then it adds `globalThis.__sqLoaded = performance.now()` just before the final `await runMain(`. The marker does one assignment.
2. Copy `../bundles/hook-runs.probe.ts` to `$S/probe/`, and replace its `../../../../../../../` imports with `$W/`. After `seeded()`'s `r.apply`, add `if (process.env.PROBE_ARM === "1") { ensureWriteMarkers(r.store); ensureBirthMarks(r.store); }`. A real daemon makes both when it starts: the states-marker triggers and the birth marks. Without the birth marks, delivery reads every state in place of the relevant ones (`trustedMark`). Then write a `vitest.config.ts` with `root: $W`, as in `../bundles/vitest.probe.config.ts`.
3. `run.sh <out> <runs> <case regex> base=<dist>,new=<dist>` runs the dists interleaved. It prints p50/p95 of the time after load, measured from the marker to process exit (`after.mjs`). Total times are in `<out>/runs.json`.
4. `trace.sh <out> <case regex> name=<dist>` does one SQL and `fs` count run (`instrument.mjs`, with callers; set `PROBE_RAW=<regex>` to get full stacks) and one `--cpu-prof` run. Read the results with `show.mjs <trace.json> <min ms> [callers]` and `profall.mjs <profile dir> [n] [filter]`.

## What one Stop repeated (latency-test fixture, 0.1.638 source, `86160b189`)

| Work | Count | Cost | Status |
|---|---:|---|---|
| `squeal.config.json` load (`loadPolicy`; callers: `stopTurn`, `codeSource`/`lintStoreSource` `policy()`, `headerWith`) | 7 (SessionStart 9) | about 0.9 ms inclusive, file missing in the fixture | Reused while the file's text is unchanged (`config-file.ts` `lastLoads`, `policy.ts` `lastPolicies`) |
| Full `known_states` list (news `deliveryStates`, `decide`'s `readRequired`, `endTurn`) | 3 | about 1.2 ms SQL plus decoding each; it also adds GC work | `keepStates` kept it only with the marker triggers. The fixture has none, so it listed 3 times. It now falls back to `PRAGMA data_version` and lists once |
| `consumer_views` list (deliver transaction, `endTurn`'s `plan`) | 2 | about 1 ms SQL each | Not changed: own writes happen between the two lists |
| Status header (`readLiveHeader` in `decide`, `readHeader` in `endTurn`) | 2 | about 1.6 ms each | Not changed: the inputs differ (open runs, liveness) |
| `meta` single-row reads (`readAll` slots, holds, notes) | 45–49 | about 0.35 ms in all | Not worth it |
| `sqlite_master` trigger check (`armed`) | 3 | about 0.04 ms | Not worth it |

With the triggers in place (`PROBE_ARM=1`, as in stores a daemon has served), the base already lists states once. Then this row's gain is about 0–1 ms. The latency test's store has no triggers. So most of the measured gain there is the `data_version` fallback, which brings that store to the state real stores already have.

The rest of Stop's after-load time is spread out. Under the profiler, one silent Stop spends about 9 ms in the deliver transaction (one states list, one views list, `planDelta`, liveness), about 4 ms in `decide`, about 3 ms in `endTurn`, about 3 ms opening the store, and 5–6 ms in GC. Module compilation (`compileSourceTextModule`, about 14 ms) runs at load, which rows 025-16 and 025-17 cover.

## Measured (this host, 16 vCPUs; three interleaved batches of 20 runs per dist, load average 2.6–3.3)

Base is `86160b189`; new is this row's two commits. Each cell is p50 / p95 in ms.

| Case | After load, base | After load, new | Total, base | Total, new |
|---|---|---|---|---|
| stop | 33.1/39.5, 30.9/34.0, 30.6/33.9 | 26.2/29.8, 26.0/30.3, 25.9/31.4 | 85.6/101.1, 84.6/90.7, 85.1/90.8 | 81.2/88.1, 80.3/87.5, 78.7/85.3 |
| stop (silent) | 31.2/33.3, 30.2/37.2, 28.8/32.5 | 26.6/30.3, 25.8/28.9, 25.3/29.1 | 86.6/92.1, 86.4/96.6, 83.1/92.0 | 81.3/89.2, 81.9/90.0, 77.4/86.4 |
| session-start | 25.1/29.5, 25.9/30.0, 25.5/27.1 | 24.7/26.8, 25.8/29.3, 25.3/27.0 | 75.8/81.9, 79.5/86.6, 77.3/83.7 | 74.8/80.2, 80.4/87.8, 77.5/81.2 |

With the triggers in place (one batch, load 3.2–3.5): stop after load 27.2/37.3 → 25.8/29.4, silent 25.4/29.6 → 25.2/26.5.

Total times include the probe's `--import` preload. Compare them only with each other, not with the 80 ms budget.

## Armed store: what real stores spend (both marks, as a daemon leaves them)

The latency fixture has neither the states-marker triggers (`ensureWriteMarkers`) nor the birth marks (`ensureBirthMarks`). On an armed store, one silent Stop runs 153 SQL calls in 3.9 ms. It lists the full states once, and the views are small. After-load time is about 21–25 ms p50 on this host. Most of it is a long tail of first calls, each 0.2–0.9 ms of self time, which includes V8's lazy compilation. Under the profiler, the largest items are:

| Item | Mean inclusive ms | Note |
|---|---:|---|
| Status header (`readLiveHeader` in `decide`, `readHeader` in `endTurn`) | 3.8 | `worktreeStatesOf` was 1.7 of it for two counts of one list: now counted once (commit 3) |
| Opening the store (`openContext` → `openStore` → `connect`) | 3.2 | `createStore` is 0.9 ms. It is in `store.ts`, a peer's file: not changed |
| States list and decoding | 2.4 | Needed once |
| Delivery `plan` (views, `planDelta`) | 2.1 | Done twice (deliver, then `endTurn`). Own writes come between, so a kept view cannot be trusted |
| Lease request to the daemon (`acquire`) | 1.3 | Socket round trip. The fixture socket only accepts and closes |
| GC after `runMain` | about 1.7 | Self time |

SessionStart on the armed store: the registration transaction takes about 11.5 ms. `readLiveHeader` takes 4.5 ms (it counts all states in JS, with `worktreeStatesOf` at 1.3 ms). `statesToSeed` takes 2.6 ms (its SQL 1.5 ms). Opening the store takes 3.0 ms. Possible next cut: count the registration header in SQL (`readWorktreeStates`, row 025-11). It was not done here: it adds `status-reads.ts` to the SessionStart bundle, which row 025-17 is trimming, and its gain at 500 checks is unmeasured.

Armed, interleaved, after load p50/p95 (three batches, load average 1.0–2.6), base → new:

| Case | Batch 1 | Batch 2 | Batch 3 |
|---|---|---|---|
| stop | 24.5/26.7 → 22.8/25.1 | 31.9/52.4 → 29.4/53.9 | 25.4/27.8 → 23.0/26.5 |
| stop (silent) | 21.2/23.9 → 20.7/22.5 | 24.6/32.7 → 25.1/29.7 | 22.5/24.4 → 21.9/24.3 |
| session-start | 22.4/25.7 → 22.7/24.5 | 24.5/35.4 → 23.6/32.3 | 23.1/26.7 → 24.3/28.6 |
