# 001-205 notes: worktrees split a baseline through derived claims

Built from `research/shared-runs.md` (001-201) as its recommendation words it: no table, no migration, `user_version` stays 1.

## Seam map

- `src/core/scheduler/claims.ts`: `Claims` (one per `Ledger`, `ledger.claims`). `holds(key)` asks the store (`TestFileKeyRepo.claimed`: another worktree's `running` row at the key, its daemon's socket set and heartbeat within `HEARTBEAT_GRACE_INTERVALS`), remembers when this worktree first saw each claimed key, and lets the file go once it has waited `runner.timeoutMs` plus `CLAIM_GRACE_MS` (6 s; `CLAIM_UNBOUNDED_MS`, 600 s, for a `null` timeout). `waiting` says some queued file waited since `begin()`, which `selectTier` calls at the start of each pass. `backlogSize(queued)` is the split. `claimOf(ledger, ref)` is the gate for the slow tier's candidates. `claimWake(store, signal)` polls `changeMarker` every 250 ms for up to `CLAIM_RECHECK_MS` (1 s).
- `Ledger.probe(file, key)`: `lookup` plus `mayWait`, true only for a miss whose file may inherit (004 D6). A miss that withheld another worktree's hits (004 D6 or a held fail, 001-170) has `mayWait: false`. `lookup` is `probe(...).hits`.
- `selectTier` no longer takes files off the queue while it picks; `TierFile.waits` marks the files that may wait. `startTier` runs in one `store.transaction`: it re-checks `waits` files with `claims.holds`, leaves the claimed ones queued in their place, removes the rest, sets `running`, writes the run row and commits. It returns `null` when every file stayed queued; `selectTier` then commits and counts no tier for the starvation bound.
- `Ledger.#syncPhase`: `running` only while `runningKey === key`.
- The pump (`scheduler.ts`): after selection and the slow tier, `if (ledger.claims.waiting) await #claimWake()`, which races `#nextEvent` against `claimWake`. That is the only wake for a claimant that dies.
- Slow tier (by agreement with the 002/003/004 coordinator): `#candidates` keeps only `claimOf(...) === "free"` files and returns `[]` without touching the slot or the activity when the rest wait, so the pump parks on the claim wake (no slot spin); a file `claimOf` settled (a result landed) leaves the queue there, so a 004-29 drain ends with the claimant's result. `#pick` gates like `selectTier`. `#select` returns `"claimed"` when nothing runs because of claims, or when `startTier` returns `null`; `next()` turns it into `null`. The running activity is published only for a tier that started.
- Daemon start: `#register` calls `testFileKeys.releaseRunning(id)` in the transaction that writes the first heartbeat.
- Store (queries only): `TestFileKeyRepo.releaseRunning`, `claimed`, `sharers`; `Liveness` in `types/store.ts`.

## Tests

- `test/scheduler/claims.test.ts`: the research's tests 1, 4, 5, 6 (with and without a claim), 8 and 9. Test 9 makes the race deterministic: a store proxy writes another worktree's `running` rows inside b's claiming transaction, as a commit between b's selection and its claim would; without the re-check in `startTier` b runs them.
- `test/scheduler/claims-expiry.test.ts`: tests 2 (heartbeat stops), 3 (crashed, timed out, discarded, withheld by the completion barrier) and 10 (the waiter's bound, through a skewed clock while the claimant's heartbeat stays fresh).
- `test/daemon/claims-restart.test.ts`: test 7, an in-process `startDaemon` over a store holding a killed predecessor's `running` row.
- `test/scheduler/claims-slow.test.ts`: the slow tier, as the 002/003/004 coordinator asked: a claimed slow file takes no slot while it waits and runs here when the claimant dies or crashes; a slow file that may not inherit never waits; a drain ends when the claimant's result lands.
- `test/scheduler/claims-split.test.ts`: the backlog cap (10 of 20 beside one other daemon with the same keys, 20 alone), and finding 5 in process: four worktrees of 120 files, each key run once (30 per worktree when I ran it).
- `claims-fixture.ts`: two or more worktrees of one repository, each scheduler on its own store connection with a fake runner that can hold, crash, time out or fail.

Each fix was checked to discriminate: without the claim check test 1 runs keys twice; without the `#syncPhase` fix test 8 fails; without the re-check in `startTier` test 9 fails; without `releaseRunning` test 7 fails.

## Four-worktree probe with real daemons

`probe.mjs` (throwaway, run from outside the repository): a generated repository of N Vitest files, each sleeping 300 ms, with three linked worktrees, inside `test/fixtures/vitest/.tmp` so it resolves Vitest; four `squeal daemon` processes from a checkout's sources (`node --import tsx src/cli/index.ts`) start together with only `HOME`, `PATH`, `USER`, `LANG` and a private `XDG_RUNTIME_DIR`; it polls the store until every baseline checkpoint ended with nothing pending, then counts file runs per path from `runs`. Run 2026-10-10 09:10 to 09:11, load 4 to 10 on 24 CPUs:

| Arm | Files | File runs | Most runs of one file | File runs per worktree | Current checks per worktree |
|---|---|---|---|---|---|
| base `bc0c9543` | 40 | 160 | 4 | 40, 40, 40, 40 | 80 each |
| 001-205 | 40 | 40 | 1 | 20, 14, 6 (one inherited all) | 80 each |
| 001-205 | 120 | 120 | 1 | 60, 60 (two inherited all) | 240 each |

The poll is every 2 s and every arm ended by the second poll, so these runs give no wall time.

## Decisions the research left open

- **Backlog split, "while claims by other live daemons are visible".** The divisor counts other live daemons that hold a `queued` or `running` row at a key this worktree has queued (`sharers`), not only those with a `running` row. With `running` only, the first of several daemons starting together sees no claim and takes the full 200-file tier, the case the research measured as the problem. An idle worktree, or one on another commit, shares no queued key and does not shrink the tier.
- **`queued` in the split** is the worktree's fast queue size (`queue.fastSize`), claimed files included, so four daemons over 243 files take 61 each, as the research's 64-file arm approximated.
- **Re-keyed while running** writes the phase the queue gives (`queued`, or `null` when the new key already had a result) rather than always `queued`.
- **Wake cadence**: `changeMarker` is read every 250 ms while a file waits, up to 1 s. A store busy with other daemons' commits wakes the pump at most four times a second; each pass re-runs the lookups of the queue.

## Not done here

- `Claims` remembers a claimed key until it is seen unclaimed or taken. A key abandoned while claimed (the file re-keyed by an edit) keeps its entry for the daemon's life: a few bytes per such key.
- Sharing 001-179's `tierCap` across worktrees, claims for forced runs, and a status line naming the worktree that runs a file are deferred, as the research says.
- The research's cezar-scale probe (243 files, four real daemons for minutes) was not rerun: the host was at load 74 to 86 on 24 CPUs for most of the slice.
- `plugins/*/dist` is not rebuilt (the brief said not to run `npm run build`).
- The key-format guard (001-203) will ask for a re-pin of version 1 after this lands.
