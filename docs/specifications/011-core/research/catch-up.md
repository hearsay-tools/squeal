# 011-22 and 011-23: catching up after a pull or a daemon start, and adopting another worktree's results

Researcher R3 of 011 wave 5, 2026-10-20. Brief: `tasks/wave-5.md` R3. Read: `docs/vision.md`, `docs/styleguide.md`, board rows 011-22 and 011-23, spec 011 C4 (steps 3 to 5 as amended through the slots of 2026-10-19), C5, C10, 004 D2, `status.md`, `research/backlog-wall-budget.md`, `research/streaming-lanes.md`, `tasks/011-21/notes.md`.

Versions: Squeal source at `cand/0.1.225` (`1fb03098`, slots included; not yet on main), read from a `git archive` copy. Cezar's store (`.git/squeal/store.sqlite`, 390 MB, 315,004 results, 914 test files, 7 days of retention) was copied once through a `readOnly` connection at 2026-10-19T22:21Z; every replay reads the copy. Cezar's git was read only (`git reflog`, `git ls-tree`). **No live measurement ran**: the one-minute load was 87 to 91 on 24 CPUs at the start, 52 while the costs were read, and 15 at the end, never below the brief's hold of 8. Probes: `probes/catch-up/` (README lists each).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What marks the work | The number of keyed sources one revision changes (a test file, a closure path or a declared input), at **10 or more**, whatever its trigger. The trigger cannot mark it: cezar's pulls came as `watch`, `interval` and `start` revisions. Files re-keyed cannot either: agent edits of 1 to 8 sources re-keyed up to 472 files. At 10 or more, every file the revision re-keys leaves the edit route, direct importers and edited test files included | read in source code, verified from the store |
| 2 | Where it runs | A third group between step 4's two: the backlog's route (the 120 s wall budget, 200 files, the pool grant, slots for node:test and pytest, the Vitest cancel by a later edit, claims), ordered ahead of the rest of the backlog, and inside it failing first, then shortest first, with no edited, direct or transitive split. The first group at backlog width loses: an agent's edit would wait 197 s on average for an uncancelled tier, 577 s at worst | read in source code, verified by replay |
| 3 | Adoption | The receiving daemon reads the keys stored since its last read (`results_by_time`), each reconciliation pass and before each tier, and settles its files at those keys through C4 step 3's lookup. Cost on cezar's store: 0.02 ms when nothing is new, 1.5 ms per 200 new keys. Provenance and C5's held fail come from the existing lookup path. A full re-look-up on a timer costs 12 ms per 876 stale keys per pass; a push by the storer costs 74 ms per receiving worktree inside the storer's write transaction | read in source code, verified by experiment (read-only store copy) |
| 4 | The gain on cezar | The 2026-10-19 catch-up (795 fast files): today's route is modelled to finish in 2,574 s, with 72 Vitest files done at 2 min (64 measured). The third group, shortest first, finishes in 857 s with 710 done at 2 min, and the mean time to a file's result falls from 1,588 s to 51 s. Second worktree: 664 of its 747 stale files had main's results 0 to 24 min before a restart happened to look them up (median 812 s, 8,684 file-minutes). Adoption makes them current within one 30 s pass | verified by replay |

## Findings

### 1. What marks the work

**The trigger does not.** Cezar's `git reflog` puts the checkout at 21:14:30Z and the pull at 21:14:34Z. The daemon's lookup-only baseline ran at 21:14:38Z, still at revision 97, so its `start` revision found nothing. The feed's first pass then made revision 98 (152 changes, trigger `interval`). That pass is `interval` by design: `change-feed.ts` `start()` says "`start` is the stat cache's bootstrap revision only ... This pass holds what changed while this daemon started ... so it is an ordinary reconciliation". Pulls under a live daemon arrive as `watch`: revision 91 (428 changes) and 92 (178), 10-19T06:52Z; revision 80 (157), 10-15T19:40Z. `interval` passes also carry one-file agent edits the watcher missed: 48 of the 83 `interval` revisions changed 1 or 2 paths with no HEAD move. The 7 h gap was real (revision 97 at 13:59Z), but daemons started 13 times at revision 97 between 20:09Z and 21:14Z with nothing to find (13 lookup-only baselines). *verified from the store; read in source code.*

**Files re-keyed do not.** Closures are transitive, and cezar's `packages/cezar/src/runs/store.ts` reaches about 220 test files. Among the 364 revisions that no HEAD move explains, 62 changed fewer than 10 keyed sources yet re-keyed 200 or more fast test files (at most 472). HEAD moves re-keyed between 6 and 642. *verified from the store; the re-key counts use today's closures, so they are approximate (inferred).*

**A HEAD move alone does not.** I counted a changed path as explained by a move when its new blob is its blob at the new HEAD and differs from the old HEAD's (`explained.mjs`). That catches every pull, but also an agent's own committed work: worktree 2d626467's reflog shows 24 cherry-picks, 4 commits, 2 merges, a checkout and a fast-forward on 10-19, and its explained revisions changed 1 to 42 keyed sources. *verified from the store and the reflog.*

**Keyed sources changed per revision do.** From `threshold.mjs`:

| | Revisions | Keyed sources p50 / p90 / max | At 10 or more keyed sources |
|---|---|---|---|
| In a HEAD move | 72 | 2 / 39 / 428 | 14 revisions, 4,654 files re-keyed: pulls (r80 148 sources, r91 428, r92 158, r98 146, r82 13), the checkout r84 (25), merges of `origin/main` (ba5234dc r31, 39) and a fast-forward (r49, 12) |
| No HEAD move | 364 | 1 / 5 / 250 | 22 revisions, 142 files re-keyed: every one a build or an install (45 to 250 keyed `dist` paths, 6 to 8 files re-keyed each) |

The largest revision with no HEAD move that no build wrote has 8 keyed sources (b20a0d00 r19, b7555ac0 r79). The smallest move at 10 or more has 12. Builds cross the threshold, but harmlessly: their 6 to 8 files run at once on either route when nothing else is queued. *verified from the store.*

So, for the brief's three cases. An agent editing 30 files by hand makes revisions of 1 to 8 sources (p90 5) and stays on the edit route. A codemod that writes 30 at once goes to catch-up, still ahead of the backlog. A `git pull` of 150 goes to catch-up. A branch switch of 25 goes to catch-up, and one of fewer than 10 stays an edit. *inferred from the table.*

**Direct importers do not stay edit work** in a catch-up revision. The pull's 73 edited test files and their importers were what held the edit route. Before the restart, its Vitest lane ran 100 files whose times sum to 3,376 s, in tiers of 4 of comparable length up to 554 and 528 s. The remaining 645 files the backlog later ran summed to 3,477 s. *verified from the store (`extract-733.mjs`).*

The same data show a second gap that this row does not cover. An agent's own edit of a central source (one to eight sources, 200 to 472 files) also runs as edit tiers of 4. ba5234dc r13, a 6-source cherry-pick, took 1,454 s for 73 files. Under the process, that is a new proposed row, not a widening of 011-22 (Open questions).

### 2. Where it runs

From `tiers.ts` `selectTier` and `queue.ts` at `cand/0.1.225`: whether a tier is the backlog's is decided by `!queue.hasFirstGroup(free lanes)`. `cancelsBacklog` cancels a backlog tier when `hasRecent` holds in its lane. A file waits on a claim only when it is not `recent` (`waits = mayWait && !recent`; `claimOf`). `tierSelected(tookBacklog)` counts any non-recent, non-promoted pick as the backlog's turn. Slots are the backlog's shape (`backlogSlot`), and an edit's tier of a slot lane takes only the edit's work. 004 D2 (as amended for 004-60) holds the slow tier back for fast backlog as well as edits. *read in source code.*

A catch-up file that is not `recent` therefore gets the backlog route for free: the budget, `Claims.backlogSize`, the grant before `startTier`, slots, the Vitest cancel and node:test running beside, and claim waits. The only new parts are the mark and the place in the order. Choosing between the two placements the brief names (replay of finding 4, Vitest lane):

| Placement | Catch-up done | An agent's edit during it waits | Claims | Four-tiers turn |
|---|---|---|---|---|
| First group at backlog width | 929 s | 197 s mean, 577 s worst (never cancelled); node:test 44 s mean | none (edit work never waits) | catch-up starves the backlog |
| Third group, backlog route | 929 s (class order), 857 s (shortest first) | at most about 6 s in Vitest (cancel, 1 s plus 5 s grace; R1 measured 0.36 s); 0 in node:test and pytest (beside the slots) | waits, and splits tiers with sharers | edits keep 4 tiers in 5; the turn's tier is never cancelled (C4 step 5), so catch-up moves |

The order inside the group decides most of the gain. In recorded class order (edited, direct, transitive, each shortest first), the edited class's 577 s file lands in the round every backlog tier always takes (step 5: "the first round is always taken"). Twenty-two light files then wait 577 s for their results, and only 82 files are done at 2 and at 10 minutes. With the group as one class, shortest first, 710 are done at 2 minutes and the heavy file runs last in a tier of its own (finding 4). Cezar had no failing file then (19,125 passes and 9 skips in those runs), so failing-first was not exercised. *verified by replay.*

### 3. Adoption

**Today.** C4 step 3 looks a key up only when the key changes. A queued file is looked up again just before it would run (`selectTier` probes in order), and when a claimant's tier records. Under `baseline.onStart: "lookup-only"`, a miss is never queued (`bootstrap.ts`: `checkpoints.finish("abandoned")`), so nothing looks it up again until its key moves or the daemon restarts. The heal (`store-results.ts`) refreshes other worktrees only when a `fail` is replaced by a `pass`, and only for files already at that key. *read in source code.*

**Now, on cezar's copy** (`adoptable.mjs`): live worktree 54393890 holds 84 files with no current state, and 66 of them have results at their own key, none of them a fail. *verified from the store.*

**Three ways to learn**, costed on the copy at load 52 (`adoption-cost.mjs`, best of 5):

| Way | What it reads or writes | Cost |
|---|---|---|
| (a) The storer pushes, as the heal does | `test_file_keys_by_key` per stored key, then a foreign `sink.refresh` per receiving worktree, then a `meta` signal for the receiver's ledger (as `held-files`) | 3.8 ms per 200-file tier to find 645 rows (live and dead worktrees), then 74 ms per receiving worktree to list its 20,284 state and key rows, all inside the storer's write transaction |
| (b) The receiver reads a watermark | `select distinct key from results where recorded_at > ?` (`results_by_time`), intersected with its own files that have no result at their key, then `Ledger.settle` on those | 0.02 ms when nothing is new; 1.5 ms for 200 new keys; the adoption's own commit, the same as any lookup hit |
| (c) The receiver re-looks-up every stale key on a timer | `results_by_key` for each | 12.3 ms for 876 keys per pass, growing with the stale count |
| The socket | needs a new message, every live daemon's socket, and a lookup at the receiver anyway | not built; not measured |

(b) is the cheapest and uses the pattern the scheduler already has: `#pass` takes `confirmHeld` and `takeRetries` from `meta` every pass, and claims poll `changeMarker` (`data_version`, 0.03 ms). It needs no change in the storer, and it works whichever daemon or version stored the rows. `recordedAt` is set before the storing transaction commits (`results.putMany`, `INSERT OR REPLACE` with the provenance's time). A row can therefore commit after a reader has passed its time, so the read must overlap its previous window by more than the longest store wait. A rowid watermark is not exact either: `INSERT OR REPLACE` of the newest row can reuse its rowid. *read in source code; inferred for the margin.*

**Provenance and C5 hold** through the existing path. `Ledger.settle` calls `probe`, which withholds every hit of a file when another worktree's fail is unconfirmed here (`heldFailure`). `applyResults` derives the state's origin from the result row (`derive.ts` `originOf`: inherited from that worktree at its commit). The pass settles with `queueMisses: false`, so it queues nothing policy did not: a held fail stays as it is under `lookup-only` and stays queued under `lookup-then-run-missing`. *read in source code.*

**Whether `lookup-only` should re-look-up on a timer:** yes, but by the watermark on the 30 s reconciliation pass (`reconcileIntervalMs`), not by a full re-look-up. The full one costs 12 ms per pass per daemon at today's size, and it grows with the stale count, not with what changed. *verified by experiment (read cost); inferred (cadence).*

### 4. The gain on cezar

**The 733-file case**, replayed in `replay-733.mjs`. It takes the 795 fast files the edit route and the restart's `run --all` ran (740 Vitest, 55 node:test; the board's 733 was one moment's count; 87 slow e2e files run in the slow tier under every rule). Their recorded times are sums of check durations, which run 1.04 to 1.27 times below the measured walls (`calibrate.mjs`). Vitest W is 23, budget 120 s; node:test runs 4 wide:

| Rule | Vitest done | at 2 / 5 / 10 min | Mean time to a file's result | Edit's wait |
|---|---|---|---|---|
| Edit route, tierSize 4 (0.1.224) | 2,574 s | 72 / 84 / 88 (measured: 64 / 76 / 84) | 1,588 s | 116 s mean, 577 s worst |
| Edit route, tierSize 12 (cezar's stopgap) | 1,520 s | 84 / 96 / 107 | 1,013 s | 165 s, 577 s |
| First group at backlog width | 929 s | 82 / 82 / 82 | 621 s | 197 s, 577 s |
| Third group, class order | 929 s | 82 / 82 / 82 | 621 s | ≤ 6 s |
| **Third group, shortest first** | **857 s** | **710 / 733 / 733** | **51 s** | **≤ 6 s** |

node:test was never the problem: 124 to 165 s under every rule. The recorded backlog route needed 804 s for its 645 files, decided by one 576 s file. *verified by replay.*

**The second worktree** (`second-worktree.mjs`). ba5234dc's lookup-only baselines at revision 48 (7fe10d99) listed 876 misses at 20:53:06Z, 747 at 21:24:14Z (129 inherited) and 83 at 21:56:52Z, when a restart looked them up. 653 of the 664 files adopted then were stored by main's `run --all` from 21:42:37Z, and 11 by main's edit route from 21:32:37Z. None held a fail. Today the files stayed stale a median of 812 s and at most 1,455 s after their results existed, and only because the daemon happened to restart. Adopting on a 30 s watermark pass would have saved 8,352 file-minutes (8,684 at no delay): with no delay, 747 stale files become 337 by 21:44 and 92 by 21:48. *verified by replay.*

## Recommendation for Squeal

**011-22.** A revision that changes 10 or more keyed sources is not an edit's work, whatever its trigger. The files it re-keys form a third group, catch-up, which runs on the backlog's route, ordered after the first group and ahead of the rest of the second, failing first and then shortest first. The tradeoff that decides it: catch-up keeps its place ahead of the backlog, but loses the edit route's guarantee that a tier is never cancelled. An agent's later edit preempts it within about 6 s instead of waiting up to 577 s. On cezar that brings the mean time to a result from 1,588 s to 51 s. Only the threshold is a new number.

**011-23.** Each reconciliation pass and each tier selection reads the keys stored since the last read, with an overlap, and settles the worktree's files at those keys through step 3's lookup, queuing nothing. The tradeoff: up to 30 s of delay against no change in the storer and no new channel, at 0.02 ms per idle pass.

**C4 sentences it would change.**

- Step 4, after "a queued file an edit reaches joins the first group until it runs." add: "A revision that changes 10 or more keyed paths (test files, closure paths or declared inputs) causes no edit's work, whatever its trigger, as a `git pull`, a checkout, a merge or a daemon start's first pass does: the files it re-keys, the ones it edited and the runner's direct importers included, are **catch-up**, a group between the two that runs on the backlog's route (step 5) ahead of the rest of the second group. Within catch-up, checks whose last known state is `fail` come first, then shortest last-known duration; the edited, direct and transitive classes do not divide it. A queued file a catch-up revision reaches joins catch-up until it runs, unless it is in the first group; an edit or a named wait (C15) still moves it to the first group (cezar, 2026-10-19: 795 files of a pull's catch-up took a modelled 2,574 s as edit tiers and 857 s on the backlog route; `research/catch-up.md`)."
- Step 4, "After four tiers in a row of the first group only while the second waited, the next tier is the second group's" gains: ", catch-up first".
- Step 4's claim sentence stands as written. "unless an edit caused it" already makes catch-up wait on a claim. Step 5's "While the queue holds no work an edit caused" and the cancel sentences also stand: catch-up is not an edit's work, so its tiers take the budget, the grant and slots, and a later edit cancels them or runs beside them.
- Step 3 gains: "A file whose key has no result here is looked up again when other worktrees store results: each reconciliation pass and each tier selection read the keys recorded since the last read, with an overlap for stores that commit late, and settle this worktree's files at those keys as above. Provenance is kept and an unconfirmed fail stays held (C5); nothing is queued that policy did not queue, so under `baseline.onStart: "lookup-only"` a stale file becomes current without a run."
- "On daemon start in a worktree, the baseline is a lookup ... or lookup only, per policy" gains: "; later lookups follow other worktrees' results (step 3)".
- C5 and C10 are unchanged.

**011-22's done-when, as tests** (`test/scheduler/`, fake runner with fixed durations, injected pool):

1. A revision of 12 keyed sources reaching 480 test files of 0.1 to 5 s, plus one of 60 s: the first tier is a backlog tier (takes a grant, holds more than `runner.tierSize` files under the 120 s budget). Red on main: tiers of `runner.tierSize`.
2. The same change across 9 sources: edit tiers of `runner.tierSize`, as today.
3. The same 12-source change as a `watch`, an `interval` and a `start` revision (`lookup-then-run-missing`): catch-up in all three.
4. An edit of one source 1 s into a catch-up Vitest tier: the tier is cancelled, the edited file is current within its own run plus 6 s, and the cancelled tier's finished files keep their results. In a node:test lane, the edit's tier starts beside the catch-up slots.
5. Order: with an edit, catch-up and a `run --all` backlog queued, the tiers run edit, then catch-up, then backlog. After four edit tiers, the turn takes a catch-up tier.
6. A catch-up file that a later edit re-keys runs in the first group; a named wait promotes one ahead of catch-up.
7. Shortest first inside catch-up: with an edited 60 s test file and 50 transitive 0.1 s files, every 0.1 s file is current before the 60 s file ends.
8. Two worktrees on one commit with the same 12-source change: each key runs once; the second worktree waits on the claim and adopts.
9. The cezar case before and after: `probes/catch-up/replay-733.mjs` on the slice's selection, or live once the load is below 8. Version bump, review PASS.

**011-23's done-when, as tests:**

1. Two worktrees on one commit under `lookup-only`. After the first's `run --all`, the second's stale files are current within one reconciliation pass (a short `reconcileIntervalMs` in the test), with no run in the second, and with origin "inherited from" the first worktree at its commit. Red on main: they stay stale.
2. A fail stored by the first stays held in the second: no known failure, `why` reads "being confirmed", and nothing is queued under `lookup-only`. Under `lookup-then-run-missing` the file stays queued and runs.
3. A pass with nothing new takes no write lock (001-412's rule).
4. A result whose `recordedAt` is earlier than the last read but commits after it is still adopted.
5. Cezar's second-worktree case before and after (`second-worktree.mjs` shape, live once the load is below 8). Version bump, review PASS.

## Open questions

- **The threshold** is the human's. Cezar's history puts it between 8 (largest agent revision that no build wrote) and 12 (smallest large HEAD move). It is one repository's 7 days.
- **Agent edits of central sources** (proposed new row, not 011-22): 62 cezar revisions of fewer than 10 sources re-keyed 200 to 472 files each and ran them as edit tiers (ba5234dc r13: 73 files in 1,454 s). Keeping only the edited files and the runner's direct importers on the edit route, and moving the transitive rest to catch-up, would cover them. How many direct importers such edits have is not determined, because the store keeps only transitive closures, not the module graph.
- **Failing first inside catch-up**: a heavy failing file would still lead a round and hold 22 light files. Cezar's case had no failing file, so this is not measured.
- **lookup-only and a pull before the daemon starts**: the `start` revision's files are not queued under `lookup-only` (`bootstrap.ts`), but a pull 4 s before the feed's first pass is. Whether a pull's files should run under `lookup-only` at all is the human's call; this research changes neither case.
- **The overlap margin** for (b) is not measured. It must exceed the longest gap between a result's `recordedAt` and its commit, a busy store's retry wait included (001-422).
- **Live numbers.** Every number here is replayed. Both slices should measure cezar live below load 8.

## Sources

- Squeal `cand/0.1.225` (`1fb03098`): `src/core/scheduler/{queue,tiers,backlog,claims,ledger,bootstrap,batch,head-move,keying,store-results,held,scheduler,slots}.ts`, `src/core/watcher/change-feed.ts`, `src/core/daemon-loop/index.ts`, `src/core/state/{sink,derive}.ts`, `src/core/store/{store.ts,repos/results.ts}`, `src/core/types/watcher.ts` (`reconcileIntervalMs` 30,000).
- Spec 011 C4, C5, C10, C15, `status.md`; 004 D2 (as amended, 004-60); `research/backlog-wall-budget.md`; `research/streaming-lanes.md`; `tasks/011-21/notes.md`; board rows 011-22 and 011-23.
- Cezar's store `/home/agent/projects/cezar/.git/squeal/store.sqlite`, copied read-only 2026-10-19T22:21Z (tables `revisions`, `runs`, `results`, `checkpoints`, `test_files`, `test_file_keys`, `known_states`, `worktrees`, `meta`); cezar's `squeal.config.json` (`runner.tierSize` 12, `baseline.onStart` `lookup-only`, `slow.include` `packages/web/e2e/*.e2e.ts`); `git reflog` of the main worktree and of worktree 2d626467; `git ls-tree` of the revisions' heads.
- Probes: `probes/catch-up/` (README, `snapshot.mjs`, `revisions.mjs`, `explained.mjs`, `threshold.mjs`, `extract-733.mjs`, `calibrate.mjs`, `replay-733.mjs`, `second-worktree.mjs`, `adoptable.mjs`, `adoption-cost.mjs`, `results/`).
