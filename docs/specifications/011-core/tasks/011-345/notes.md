# 011-345: the fallback `status --wait` keeps its header parts while the states marker stays

Worker 14e7717d, 2026-11-14. Brief: `tasks/wave-94.md` W3. Board row 011-345. Starts from row 011-45 (`tasks/011-45/notes.md`): a quiet fallback poll kept the states, the key rows and the news, but made the header each poll from them, about 85 of its 98 ms.

## What changed

| File | What |
|---|---|
| `src/core/state/slow.ts` | `readLane` = `laneCounts` (states and keys alone) + `liveActivity` (now exported). `readSlowTier` = `slowTierOf(readLane(…), view)`. New types `LaneCounts`. Same objects, same key order, for every caller. |
| `src/core/state/groups.ts` | `readGroupTiers` = `groupTiersOf(store, id, keys, groupLaneCounts(states, keys, policy))`. `groupLaneCounts` is pure; `groupTiersOf` reads each lane's activity now. New type `GroupLaneCounts`. |
| `src/core/state/header-part.ts` (new) | `headerPart(states, keys, policy, isSlow?, openFiles?)`: every header part made from those alone (state counts, files without checks, `countNotCurrent`, `slowPending`, the slow lane's counts and whether the slow line is shown, the group lanes' counts, `lanePending`, `testsAtEdit`). `countStates`, `countFilesWithoutChecks` and `countSlowPending` moved here from `header.ts`, unchanged. |
| `src/core/state/header.ts` | `readHeader` = `headerWith(store, id, keys, (policy) => headerPart(states, keys, policy, …))`. `headerWith` reads the rest now: revision and commit, refined revision, install wait, checkpoints, the root and its policy, the lanes' activity, the commit line, the optimizer note, the listing runners. It reads them in the order `readHeader` always did, and asks `partOf` for the part once it has read the policy. `installFields` took the three install fields out of `headerWith` (complexity 22 → 15). Same object, same key order, same store reads in the same order. |
| `src/cli/wait/every-state.ts` | `EveryState.part`: the header part kept beside the states and keys. `readEvery`'s `partOf` reuses it while the marker stays (as before) and the policy reads deep-equal (`isDeepStrictEqual`), else makes it again. |
| `test/cli/kept-header.test.ts` (new) | The equality test (below). |
| `test/status/torn-read.test.ts` | Its module mock hooked `readHeader` to find each poll; the fallback poll now calls `headerWith`, so the mock wraps both. Cases and assertions unchanged. |

`src/core/store/write-markers.ts` is unchanged. The ownership of `slow.ts` and `groups.ts` for the additive split: the coordinator, 2026-11-14 (reply to request 98094300). Their split is its own commit, before the commit that keeps the part.

## What is kept, and what is read each poll

Kept while the states marker stays and the policy reads the same: everything `headerPart` makes. Its inputs are the kept states and key rows and the policy.

Read each poll: the policy file itself (`readPolicy`, to compare), the revision, the refined revision, the install wait, both checkpoints, the lanes' activity (`liveActivity` reads the published activity, the consumers' turns and the daemon's start), the commit report, the optimizer note, and the listing runners (`runsVitest` over the root and policy).

The policy is compared deep, not by identity: `readPolicy` makes a new object each read. A policy change with no row written (a narrower `slow.include`, a removed `checks` key) makes the part again on the next poll. The test covers both.

## Test

`test/cli/kept-header.test.ts`, for a slow-tier policy and for a `checks` policy. Red before the change (`expected 'made' to be 'kept'` on the second poll: the equality held, nothing was kept). Each poll checks the kept read's header against `readHeader` (deep, and `JSON.stringify` for key order) and the whole read against `readHeld(…, null)`, then says whether the part was kept. Steps:

- quiet poll: kept;
- a new revision (runner part pending), the refined revision, an install wait and its end, a completed checkpoint, the optimizer note, a commit report: kept, and each shows in the header;
- a key row (a lane file running): made;
- the lane's published activity running, then waiting for a pause with no agent in a turn (none), then with one in a turn: kept, and the activity changes each time;
- a state write: made;
- the policy file narrowed, then emptied: made each time, then kept.

Mutation check: with the policy comparison replaced by `true`, both cases fail (header not equal after the policy change).

## CPU per quiet poll, cezar store copy

Copy: `~/projects/cezar/.git/squeal/store.sqlite` (2.5 GB) by the SQLite backup API (`node:sqlite` `backup`) into a private `/tmp` directory (mode 700), under `nice 10`; 4.3 s. cezar's store had no marker triggers (its daemons are an older release), so the script makes them on the copy with `ensureWriteMarkers`, as a daemon of this release does at registration. Main worktree `b7555ac0d0f19f40`: 31,810 known states, 1,926 key rows; cezar's policy has a `checks` key (1 group lane, no slow line). `HOME` and `XDG_RUNTIME_DIR` point at a private directory.

The tables below are the final code (commit 3). The first measurement, on commit 2, gave the same result: before medians 90.3 and 90.9 ms, after 1.3 and 1.4 ms, load average 9.2 to 9.9.

Each poll runs in one `readTransaction`; CPU is `process.cpuUsage` (user + system) per poll; 3 warm-up pairs, then 15 pairs in alternating order. "Before" is the quiet poll as at `427e4b049`: `statesMark` + `readHeader` over the kept states and rows (the news was already kept). It is measured on this branch, where `readHeader` does the same work through `headerPart` + `headerWith`, in the same process as "after". Host load average 8.6 to 8.9 on 24 vCPUs, the host's real load from parallel coordinators; no load was made on purpose.

| Run | Before, ms (sorted) | Median | After, ms (sorted) | Median |
|---|---|---|---|---|
| 1 | 71.7, 82.6, 83.0, 84.3, 84.4, 84.7, 84.8, 85.3, 87.2, 87.5, 88.0, 88.0, 90.2, 90.9, 91.3 | 85.3 | 1.2, 1.3, 1.3, 1.4, 1.4, 1.4, 1.5, 1.5, 1.6, 1.6, 1.6, 1.7, 1.8, 2.3, 2.9 | 1.5 |
| 2 | 88.8, 89.5, 90.0, 91.1, 91.6, 93.1, 93.7, 95.9, 96.4, 97.1, 99.6, 99.7, 100.5, 104.0, 105.7 | 95.9 | 1.2, 1.2, 1.2, 1.2, 1.4, 1.4, 1.5, 1.7, 1.7, 1.7, 1.9, 1.9, 2.1, 2.3, 2.8 | 1.7 |

What is left of a quiet poll (about 1.5 ms): the marker check, the policy file read and compare, and the fresh reads of `headerWith`.

On the copy, the kept read equals a full read (`readHeld(…, null)`), deep and as JSON, at the first read and after the 30 quiet polls; the part stayed the same object across them. The script is `measure.ts` in the copy's directory; the copy is deleted after the run.

## Calls the brief did not settle

1. **Read order.** A first shape read the root and policy before the revision, so the wait could pick its part first. `test/presence/reads.test.ts` pins the order of the header's store reads to the old reader's and failed (94 cases: a `row` read moved ahead of `head-move`). `headerWith` now takes `partOf(policy)` and calls it where `readHeader` always read the policy, so the order is the old one.
2. **The split's home.** The pure part is a new file, `src/core/state/header-part.ts`, so `header.ts` stays under 300 lines (270). `readHeader`'s signature is unchanged.
3. **When a kept part is stale.** Kept with the states marker (unchanged rule) and the policy compared deep each poll. The policy file is read each poll, as before; a part is never kept across a policy change.
4. **The lanes' activity is fresh.** `liveActivity` reads store rows the states marker does not cover (published activity, turns, the daemon's start), so it is read each poll from the kept key rows.
5. **`isSlow` and `openFiles`.** `headerPart` takes them as `readHeader` does; the fallback wait passes neither, as before.

## Type changes (all additive)

- `src/core/state/header-part.ts`: `HeaderPart`, `StateCounts`, `headerPart`.
- `src/core/state/header.ts`: `headerWith(store, worktreeId, keys, partOf)`.
- `src/core/state/slow.ts`: `LaneCounts`, `laneCounts`, `slowTierOf`; `liveActivity` exported.
- `src/core/state/groups.ts`: `GroupLaneCounts`, `groupLaneCounts`, `groupTiersOf`.
- `src/cli/wait/every-state.ts`: `EveryState.part?`.

## For the next worker

- A new header field: put it in `headerPart` only when it is a function of (states, keys, policy); anything read from another store row or file goes in `headerWith`. `test/cli/kept-header.test.ts` catches a field put on the wrong side only if one of its steps writes that input, so add a step for a new kind of input.
- A test that mocks `header.js` to observe polls must wrap `headerWith` as well as `readHeader` (`test/status/torn-read.test.ts`).

## Checks

- `pnpm run lint`: `Checked 3478 files`, no fixes. `pnpm run typecheck`: clean.
- Run directly (`env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run <paths>`), since Squeal had the edit's 1,000 dependents queued behind its catch-up: `test/presence/` (all), `test/cli/kept-header.test.ts`, `test/status/torn-read.test.ts`, `test/cli/wait-every-state.test.ts`, `test/cli/older-writers.test.ts`, `test/keys/key-format.test.ts`: 16 files, 591 of 591 passed on the final code. `test/status/` with key-format and the wait tests: 79 files, 494 tests, 2 failed in `torn-read` before its mock wrapped `headerWith`, then 4 of 4.
- `test/keys/key-format.test.ts`: 12 of 12, no raise.
- Squeal at revision 17 (commit 2): `kept-header`, `torn-read`, `wait-every-state`, `key-format` current with no failure. Over the 1,019 dependents of the changed files: the presence-read failure above (fixed in commit 3) and the four committed-bundle tests (`test/harness/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`, `codex/packaging/runtime.test.ts`: `cli/squeal.mjs differs from the build`). That drift is expected: this row changes bundled source, and the brief forbids `pnpm run build`; the bundles are rebuilt at release.
