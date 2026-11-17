# 005-105 notes: every known state has a birth mark the store keeps

Worker 1519b409, 2026-11-17. Wave 21, W1 part 1 (`../wave-21.md`). Coordinator 4d2ecbfc. Design: `../../research/consumer-view-design.md`, design N.

## The objects as built

`src/core/store/state-born.ts`:

| Object | Text |
|---|---|
| Table | `state_born (id INTEGER PRIMARY KEY AUTOINCREMENT, worktree_id TEXT NOT NULL, check_id INTEGER NOT NULL, UNIQUE (worktree_id, check_id)) STRICT`; SQLite adds `sqlite_sequence` and `sqlite_autoindex_state_born_1` |
| `squeal_born_known_states_insert` | `AFTER INSERT ON known_states`: `INSERT INTO state_born (worktree_id, check_id) SELECT NEW.worktree_id, NEW.check_id WHERE NOT EXISTS (…same worktree and check…) ON CONFLICT DO NOTHING` |
| `squeal_born_known_states_delete` | `AFTER DELETE ON known_states`: `DELETE FROM state_born WHERE worktree_id = OLD.worktree_id AND check_id = OLD.check_id` |
| `ensureBirthMarks(store)` | When the table or a trigger is missing, in one transaction: `CREATE … IF NOT EXISTS` of each, the marks of states that are gone dropped (only after a lost delete trigger), each state with no mark given one (the fill). A store that has all three is left alone; a store with no connection too |
| `currentBirthMark(store)` | The high mark: `sqlite_sequence.seq` for `state_born`, `0` before the first mark, `null` while the table or a trigger is missing |
| `birthMarkOf(store, worktreeId, checkId)` | A state's mark, by the check's row id; `null` when none |
| `checksBornBy(store, worktreeId, mark)` | The row ids of the worktree's checks whose mark is `<= mark` |

Made by the daemon at registration (`src/core/daemon/daemon.ts`, `#register`, right after `ensureWriteMarkers`), in the registration's transaction. No `user_version` raise; `schema.ts`, `open.ts`, `prune.ts` and every repository are unchanged.

## Decisions and departures

1. **Made at the daemon's registration, not in `openStore`'s index step.** The findings name the write-marker manner; the brief's "the open path for additive objects" allowed either. `open.ts`, `schema.ts`, `store.ts` and the repositories are in the key-format validity bundle (`test/keys/validity/entries/global.ts` exports `schema` whole; the harness imports `open.ts` and `store.ts`); `daemon.ts` and `state-born.ts` are not. So no validity case is needed. Cost: a store opened by a test with `open()` has no marks until the test calls `ensureBirthMarks`, and `currentBirthMark` reads `null` there. Part 2's readers must treat `null` as "read as before" anyway (a store a released daemon serves).
2. **The trigger's insert is `WHERE NOT EXISTS` with `ON CONFLICT DO NOTHING`, not the upsert alone.** Measured: with `ON CONFLICT DO NOTHING` alone the mark row is kept, but SQLite draws an `AUTOINCREMENT` id for each rewrite, so one rewrite of 32,000 states moves the high mark from 32,000 to 64,000. That is still a correct cutoff, but the high mark no longer equals the newest state's mark. With `WHERE NOT EXISTS` it does, and the test pins it. The commit time of the two forms is within the noise (table below). The upsert clause stays as the guard the findings name.
3. **A retired and re-added check gets a new mark** (the delete trigger removes the old one). That is the findings' `sim.ts` model (`born.delete` on retire, a new `seq` on the next insert), which gave 0 differences in 100,000 runs: a check retired and back after a registration reads as born after it, so as never told.
4. **The removed-worktree list is unchanged.** The delete trigger removes a state's mark with the state, so `WorktreeRepo.remove` and prune's batched deletes of `known_states` take the marks with them, in every release that writes a store with the triggers. Adding `state_born` to `WORKTREE_SCOPED_TABLES` would fail with "no such table" on a store no daemon of this release has served, and would add a line to the validity bundle. Tests: "loses a removed worktree's marks with its states", "loses a pruned worktree's marks in prune's batches". `prune`'s `checks` clean-up needs no change: every check with a mark has a known state.
5. **"An older Squeal reads and writes the store"** is tested through the SQL an older version runs, not a released bundle: this row changes no repository, prune, transfer or open path, so this checkout's writers run the released SQL (`INSERT OR REPLACE`, the deletes, `WorktreeRepo.remove`, the batched prune) and the test reopens the store with `openStore`. The released bundle in `plugins/claude-code/dist` runs only as a whole CLI and daemon; not run here.

## Timings

`measure.ts` (this folder), Node 26.13.0, `node_modules/.bin/tsx measure.ts <scratch> 11`, stores under the task's scratch directory. Load is the host's own, 1-minute average 10.8 to 15.7 on 24 vCPUs.

| Step | Median | Other |
|---|---|---|
| The fill, a store at the released schema with 1,000,020 states (30 worktrees × 33,334 checks), `ensureBirthMarks` | 430 ms (444 ms in the first series) | max 457 ms; findings: 386 ms for 968,615 |
| State commit, all 32,000 states of a worktree rewritten through `knownStates.upsertMany`, write-marker triggers present, no birth-mark triggers | 323.6 ms | p90 340.5 |
| The same, with `ON CONFLICT DO NOTHING` only | 381.0 ms (+18%) | p90 393.9; high mark +32,000 per rewrite |
| The same, `WHERE NOT EXISTS` only | 407.5 ms (+26%) | p90 485.0 |
| The same, `WHERE NOT EXISTS` and `ON CONFLICT DO NOTHING` (as built) | 398.8 ms (+23%) | p90 422.4 |

The three trigger forms overlap within one series' noise. Without the write-marker triggers (first series, 9 rounds): 247.9 ms without and 373.7 ms with the upsert form. The findings' 225 to 265 ms (+18%) was raw SQL on a store copy.

## For part 2 (005-106)

- The consumer's mark is `currentBirthMark(store)` read in the registration's read transaction, with the states it seeds. `null`: write the full copy as 005-103 does and no mark.
- "No view row and born at or before the mark reads as a told pass": `checksBornBy(store, worktreeId, mark)` gives the set; the findings' delivery read used the complement (`id > mark`), which is smaller. A states read with a `LEFT JOIN state_born` gives each state's mark in the same read (`measure.mjs` `statesBorn` in the findings' probes). Neither has its own index on `(worktree_id, id)`; the unique index on `(worktree_id, check_id)` covers both reads per worktree.
- Re-check `currentBirthMark` (armed) at each delivery: a store whose triggers were lost reads `null`, and its marks then are not to be trusted until a daemon's registration mends them.
