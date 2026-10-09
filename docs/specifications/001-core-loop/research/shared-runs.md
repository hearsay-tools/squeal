# Research: worktrees split a baseline through claims

Row 001-201, 2026-10-10. Topic `shared-runs` in `README.md`. Squeal at `8ca16a14` (0.1.86 plus 001-199's docs), Node 24.21.0, Linux, 24 CPUs. The host was shared with other workers' gates: load 22 to 65 during the experiments. Every experiment used scratch copies under `/tmp/sr201`: a `VACUUM INTO` copy of cezar's store (read-only connection, 220 MB, taken 00:26), and a fresh clone of cezar at `c07b0bfc` with three linked worktrees. Daemons ran with only `HOME`, `PATH`, `USER` and `LANG` in their environment and were all stopped. No live store or daemon was touched. Probes, the prototype patch and the raw output are in `probes/shared-runs/`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Where the claim lives, what it holds, what it costs | Derive it from what `startTier` already writes. A claim is another worktree's `test_file_keys` row at the key with `pending = 'running'`, whose daemon's heartbeat is fresh. That costs no new write, no table and no migration. Checking 651 keys took 2.7 to 5.2 ms. A table or `meta` rows cost about 0.5 ms per 200 claims, but a table bumps `user_version`, the store's first migration, and every older daemon exits on a newer schema (D8). The check and the claim must share one `BEGIN IMMEDIATE`: outside it, 300 to 450 of 600 keys were taken twice; inside it, none. | verified by experiment; read in source code |
| 2 | Expiry and takeover | A claim lives while three things hold: the claimant's row is `running` at that key, its heartbeat is within `HEARTBEAT_GRACE_INTERVALS` (2 × 5 s), and the waiter has waited under its own `runner.timeoutMs` plus the runner's 6 s grace (600 s when the timeout is `null`). A dead daemon's claim lapses in 10 s. A tier that ends without storing releases the claim in the transaction that records it, so the waiter runs the file. Two gaps: a restarted daemon shows its predecessor's `running` rows as live until its baseline commit, and a row re-keyed during a run claims a key that is not running. Each has a one-line fix (below). | read in source code; verified in the store copy (200 `running` rows of a daemon dead 24 h) |
| 3 | Tier composition | Claims gate exactly the files whose lookup would accept another worktree's result. Those are files not forced, not recent, that may inherit (004 D6), and are not held as an unconfirmed fail (001-170). The check goes after the lookup, in the fast selection (`selectTier`) and the slow one (`slow-tier.ts` `#pick`). Lanes, the backlog budget, the starvation bound, 001-179's split, 001-134's re-runs and 003-43's growth keep their rules. The split's granularity is the backlog tier, 200 files by default. | read in source code; verified by experiment for the fast tier |
| 4 | What must not change | An edit's own files (`recent`) never consult a claim. Inherited fails are still run locally, because a held lookup returns no hits and the file skips claims. The completion barrier and per-key validity are untouched: a claim never makes a result, it only delays a lookup. `status --wait` holds for the edit's re-keyed files, which never wait. Files re-keyed by an environment change can wait up to one claimant tier. | read in source code; inferred |
| 5 | Measured gain | See the table under finding 5. | verified by experiment |

## Findings

### 1. The claim (verified by experiment on the store copy; read in source code at `8ca16a14`)

What exists already. `startTier` (`src/core/scheduler/tiers.ts`) marks each picked file `running` (`Ledger.setRunning`) and commits in one `store.transaction`, a `BEGIN IMMEDIATE` (`connection.ts`). `Ledger.commit` writes `test_file_keys (worktree_id, project, path, key, revision, pending)` for every dirty file. `recordTier` clears `running` in the same transaction that stores the tier's results. `test_file_keys_by_key` indexes the key. So "worktree W is running key K" is already a committed, indexed fact. It turns to "results stored" or "nothing stored" atomically. `worktrees.daemon_heartbeat_at` and `daemon_heartbeat_interval_ms` say whether W's daemon lives.

Three storage options were measured on the copy of cezar's store, which has 10 worktrees and 5,952 key rows (`claim-cost.mjs`, `claim-cost.out`). Times are in ms; "load" means three processes committing tier-sized transactions every 150 ms (p50 42 to 48 ms, max 264 ms):

| Operation | idle | load |
|---|---|---|
| check 651 keys, derived (`test_file_keys` join `worktrees`) | 2.7 to 5.2 | 3.3 to 4.9 |
| check 651 keys, `meta` row per key / `claims` table | 2.0 to 2.8 | 2.0 to 2.7 |
| write 200 claims, `meta` / table, one transaction | 0.5 to 0.8 / 0.4 to 0.5 | 0.6 to 38 / 0.35 to 0.7 (the spikes are waits for the write lock) |
| release 200 claims | 0.3 to 0.7 | 0.3 to 19 |

Every option is cheap next to a tier's commit (87 to 469 ms on cezar after 001-161). What decides between them:

- The derived claim writes nothing new. It needs no schema step, so every daemon version reads the same store, and a crash leaves no orphan rows.
- A `claims` table is the store's first migration: `MIGRATIONS` has one step, and `SCHEMA_VERSION` is 1. D8 makes a daemon exit on a newer `user_version`, so every daemon of an older release on that store would stop until upgraded.
- `meta` rows need no migration. They duplicate what `test_file_keys` says, and `meta` has no pruning yet (the S4 Later row).
- What the derived claim lacks: claimed-at, and the daemon's identity on the row. Finding 2 covers both without new columns.

Atomicity (`claim-race.mjs`, `claim-race.out`; three rounds each). Four processes took 600 keys in the same order, 10 per tier, with a 5 to 10 ms "run" between tiers. With the check and the claim in one `BEGIN IMMEDIATE`, every key was taken once: 600 for 600, split 190/140/150/120 and similar. With the check before the claiming transaction, 340, 300 and 450 keys were taken twice or more (1,050 to 1,430 takes). All daemons order a fresh baseline the same way, by listing order when durations are unknown, so a race is the common case, not a rare one. So `startTier`'s transaction must re-check its picked keys and put back any another worktree claimed meanwhile. The prototype instead wrapped the whole selection in that transaction. That is simpler, but it holds the write lock for the selection's lookups as well.

Noticing results: a waiting daemon needs no new signal. When a skipped file comes up again, its lookup finds the claimant's results, which landed with the claim's release. 001-178's `changeMarker` (one `pragma_data_version` read) tells it when to look again. A timer is still needed, because a dead claimant changes nothing in the store.

### 2. Expiry and takeover (read in source code; one observation in the store copy)

- **Crashed or killed daemon.** Its heartbeat stops. Hooks count a daemon down after `HEARTBEAT_GRACE_INTERVALS` = 2 intervals (`status/snapshot.ts`, `delivery/liveness.ts`), 10 s at the default 5 s. The claim lapses then. The copy shows why the heartbeat condition is needed: worktree `4d78fdf6`, whose 0.1.45 daemon last beat 2026-10-08 22:51, still holds 200 rows `running` and 3 runs with no `ended_at` a day later, and the main worktree holds 12 open runs from earlier daemons. Neither `pending = 'running'` nor an open `runs` row alone proves a live run.
- **Restarted daemon.** A new daemon heartbeats before its baseline commit rewrites every row (`addFile` marks each file dirty). Until then its predecessor's `running` rows look live, and other worktrees skip those files for the length of a bootstrap. Fix: the daemon sets its worktree's `running` rows to `queued` in its first transaction, before the first heartbeat.
- **Stepped-down daemon** (`superseded`, `sessions-gone`, `reinstalled`). D10 lets the tier in flight finish and store, so `recordTier` releases the claims. The queue left behind is `queued`, which is no claim.
- **Hung run with a live heartbeat.** The claimant's own `runner.timeoutMs` bounds it: 600 s, plus the Vitest adapter's 1 s and 5 s graces (`runners/vitest/run.ts`). A `null` timeout means no bound. The waiter therefore keeps one bound of its own: it remembers when it first found the key claimed, and takes over after its own timeout plus 6 s (600 s when `null`). That needs no claimed-at in the store.
- **Run that ends without a result.** Crash, timeout (001-179 re-queues the incomplete files), stability discard, the completion barrier's withholding (001-168), observed growth stored under another key (001-132, 001-134), or environment growth (003-43). Each clears `running` in `recordTier`, so the claim ends with no hit, and the waiter runs the file. No file is left unrun.
- **Row re-keyed during a run.** `#syncPhase` writes `running` whenever `runningKey` is set, and `commit` writes `file.key`. So an edit that re-keys a running file makes the row claim the new key, which nothing runs. Others wait one tier, find no result, and run it. That is a delay, not an error. Fix: write `running` only when `file.key === file.runningKey`, else `queued`. That is also the truer phase.
- **Run twice by design** only in these cases: a takeover after the waiter's bound, a result stored under another key, a held fail (finding 3), a forced run, and two edits that reach the same key in two worktrees (`recent` never waits).

### 3. Tier composition (read in source code; the fast tier verified by experiment)

- Where the check goes: in `selectTier`, after `ledger.lookup` misses, so a stored result always wins over a claim. The same goes in the slow tier's `#pick` (`slow-tier.ts:332`), which does its own lookup. A skipped file stays queued in place and is looked at again at the next selection, as a busy lane's files are. Skipping does not count against `backlogBudget`.
- Gate: not forced, not `queue.isRecent`, `ledger.inherits(ref)` (004 D6, `inheritsAcrossWorktrees`), and the lookup did not withhold a held fail (`heldFailure`). A slow file that may not inherit never waits: another worktree's result could not stand for it anyway.
- Forced: `run --all --force` and 001-171's re-runs are forced. They skip the lookup today and skip claims too, so two worktrees forcing the suite each run it.
- Lanes (001-140): claims are by key, selection is per lane, and nothing changes per lane.
- Backlog tiers (D5 step 5): a backlog tier takes up to 200 files, so one claimant can hold 200 files while other worktrees idle. In the prototype, with 243 files, worktree 1 took 200, worktree 2 took 43, and worktrees 3 and 4 waited. Finding 5 measures a tier of 64.
- Starvation bound: `tierSelected` counts claimed backlog files as waiting. The next tier orders the backlog first, skips the claimed files, and takes recent ones. That is harmless.
- 001-179's `tierCap` lives in the daemon's memory. A file one worktree's timeout released can be claimed by another at full tier size and time out there too. Today every worktree pays that timeout anyway; sharing the cap is deferred.
- 001-134's first-seen re-runs and 003-43's growth re-runs go to their new key as ordinary misses, so claims apply to them normally.

### 4. What must not change (read in source code; inferred)

- An edit's own files are `recent` until they run (`RunQueue.add`) and never consult a claim. `status --wait` holds only for files the window's revisions re-keyed (001-186, 001-191, 001-194, `keyedAt`). Those are edits' files, so its window is unchanged. The exception is files an environment change re-keyed (003-45): those may wait at most one claimant tier.
- 001-170: `Ledger.lookup` returns no hits for another worktree's unconfirmed fail, and the claim gate excludes that case, so the file runs locally as today. A pass from a claimant still heals through the shared row.
- Completion barrier (001-168), stability check and per-key validity: a claim never stores or applies anything. Results come only through the existing lookup, after the claimant's `recordTier` passed every check.
- Checkpoints: a baseline or `run --all` checkpoint that holds a claimed file ends when the file's result is inherited (`checkpoints.done` on a lookup hit). That is no later than the claimant's tier, or its takeover bound.

### 5. Measured gain (verified by experiment)

PENDING

## Recommendation for Squeal

PENDING

## Open questions

PENDING

## Sources

- Squeal at `8ca16a14`: `src/core/scheduler/{tiers,ledger,queue,backlog,scheduler,slow-tier,held,rerun,timeout-split}.ts`, `src/core/store/{schema,store,connection}.ts`, `src/core/slow/inherit.ts`, `src/core/state/inherited.ts`, `src/core/status/snapshot.ts`, `src/core/delivery/liveness.ts`, `src/runners/vitest/run.ts`; `spec.md` D5, D8, D10; `status.md` amendments for 001-140, 001-161, 001-168, 001-170, 001-171, 001-179, 001-184, 001-186.
- cezar's store, copied read-only with `VACUUM INTO` from `/home/agent/projects/cezar/.git/squeal/store.sqlite` at 2026-10-10 00:26 (0.1.86 daemons live in two worktrees).
- cezar at `c07b0bfc`, Vitest 4.1.10, cloned to `/tmp/sr201/cz`.
- Probes: `probes/shared-runs/` (README lists each file).
