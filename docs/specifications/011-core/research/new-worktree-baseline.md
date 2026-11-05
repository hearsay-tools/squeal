# 011-299: why a new worktree's first baseline runs so much

Researcher of row 011-299, 2026-11-05 22:50Z to 2026-11-06 00:30Z (Europe/Warsaw 23:50 to 01:30). Brief: `research/new-worktree-baseline-brief.md`. Read: `research/restart-baseline.md` and its probes; `019-run-triggers/research/load-split.md` and `probes/load-split/baseline.cjs`; `git show 24aa26286:docs/specifications/011-core/research/completed-donor-inheritance.md`; spec 011 C3; `src/core/keys/check-key.ts`, `environment-hash.ts`, `environment.ts`, `observed.ts`, `runtime-files.ts`, `store/schema.ts` at squeal `a58b4dc85` (0.1.406).

Data: one copy of cezar's store (`store.sqlite` with `-wal` and `-shm`), taken 2026-11-05T23:07Z (a first copy at 22:56Z was lost when scratch was wiped; the counts of both agree). Window as `load-split.md`: 72 h to 2026-11-05T16:50Z. cezar's git repository, read only. Fixture runs: a fresh repository under my `$TMPDIR`, 8 Vitest files, nice 10, 4 host slots, Squeal 0.1.406, removed at the end. No test ran in a cezar or squeal worktree. Load1 during the fixture runs: 26 to 38 (24 CPUs). Probes and re-run steps: `probes/new-worktree-baseline/README.md`.

**Units.** Recorded seconds are per-file durations from `report.json` (node:test: stored durations). Shares are of the 222,721 recorded s that the 247 first baselines ran. 2,843 more file runs never ended (their daemon stopped) and have no recorded seconds; `load-split.md` counted 215,735 s for ended files with stored results.

**How "content" is compared.** The store keeps one row per check and key, and a later run at the same key replaces it, so a key a lookup missed is not stored anywhere. I compare content instead: a test file's closure (its `test_files.closure_paths`, its entry in the shared observed set, and the runner and lock files) as git blobs at the run's commit, against the commits of clean rows other runs stored before the run (up to the 12 newest commits per file). The closure is today's, so it is an approximation of the closure at each run. *Method inferred; inputs read in source code (`check-key.ts`: the key hashes the environment hash, the test path, and each closure path with its file hash).*

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Class of each first-baseline file run | (b) content new on this host: 74.1%. Own commits, pulls or edits since the start touched the closure: 21.0%. (c) same content stored with another key: 3.7%. (d) parallel duplicate: 0.9%. (a) equal key stored before: 0.3%. 33.6% of seconds ran in removed worktrees at an uncommitted (dirty) state, where own edits cannot be checked; in live worktrees own edits explain 90% of such seconds. Corrected for that: (b) about 46%, own edits about 51%, (c) about 1% | read from the store copy and git; classes inferred |
| 2 | The merged-tree case | 128 of 247 first baselines (136,668 s, 61%) started at a tree no daemon had a clean result at: 44 on origin/main, 84 on branch commits. 37 of the 166 main commits in the window (22%) changed a hub file (in at least half of the server closures). A new worktree at the squash of two validated branches re-ran only the test both branches changed | read from the store copy and git; verified by experiment |
| 3 | Defects | None reproduced. Sequential, simultaneous and staggered starts at equal keys ran each file once. The store's (a) and (d) footprints, 1.2% together, also fit results discarded at store time | verified by experiment; store footprint inferred |
| 4 | Levers | Main-checkout daemon: 52% of first-baseline seconds had content equal to a main commit that landed at least 30 min before the run, 11% at 120 min; it moves this work, it does not remove it. Consistent installs: at most 3.7% (about 1% corrected). A fix for (a) or (d): at most 1.2% | inferred bounds from 1 to 3 |

## 1. Classes

`classes.cjs` and `summary.cjs`, first matching class in this order: (a), (d), own changes, (c), (b). (b) before (c) does not matter: they split on whether any clean row at equal content exists.

| Class | Recorded s | Share | File runs | Baselines | Tag |
|---|---|---|---|---|---|
| (a) an earlier run (any worktree) completed the file at the same closure content and its row is gone (replaced at the same key, or discarded) | 740 | 0.3% | 77 | 18 | inferred, defect candidate |
| (d) a run in another worktree overlapped this one at the same content and one of the two rows is gone (13 s more where both rows stayed) | 1,958 | 0.9% | 214 | 17 to 20 | inferred, defect candidate |
| Own commits, pulls or rebases since the start touched the closure | 36,109 | 16.2% | 1,915 | 37 | expected re-key |
| Own uncommitted edits touched the closure (live worktrees only) | 10,595 | 4.8% | 1,252 | 6 | expected re-key |
| (c) a clean row at the same closure content exists, with another key | 8,300 | 3.7% | 2,660 | 82 | environment, observed set or untracked files: component not determined per run |
| (b) no clean row at the same closure content before the run | 162,641 | 73.0% | 14,361 | 237 | expected re-key: content new on this host |
| (b) no clean row for this file at all before the run | 2,378 | 1.1% | 205 | 47 | expected: new or rarely run file |
| Never ended | 0 | | 2,843 | 77 | daemon stopped |

By project: (b) server 128,758 s, e2e 24,331, root:test:unit 5,758, web 3,611.

**The dirty-state caveat.** 74,834 s (33.6%) ran in removed worktrees at a dirty revision. Removal drops revisions, so whether the agent's uncommitted edits touched the file's closure is not knowable; the table counts them by committed content, as if they did not. In the 19 live worktrees' first baselines, own uncommitted edits touched the closure in 17,577 of 19,502 dirty seconds (90.1%), mostly hub files such as `packages/cezar/src/workflows/run.ts` (`owned-edits.cjs`). With that rate, about 61,400 s of (b) and 6,000 s of (c) are own-edit re-keys: (b) about 103,600 s (46.5%), (c) about 2,300 s (1.0%), own changes about 114,100 s (51.2%). *Read from the store copy; the correction inferred from a sample of 19 baselines.*

**Why a first baseline runs own edits at all.** A first baseline is long: 230 of 247 ended `abandoned`, and its queued files run at the worktree's current revision while the agent works. So a large share of "first baseline" seconds is the agent's own change, not the start state. *Read from the store copy; cause inferred.*

**(c) components.** Not named per run: the key's components are not stored. Candidates, each checked where the data allows:

- *Installed dependencies.* 46 of 47 live cezar checkouts have the installed `node_modules/.pnpm/lock.yaml` that their committed `pnpm-lock.yaml` implies (5 committed lockfile versions map one to one to 5 installed ones); one checkout holds the install of an older lockfile. *Read on disk, 2026-11-05T23:15Z.* Lockfile changes in commits are content, counted under (b).
- *Node version.* All cezar daemons run 24.22.1 since 2026-10-27 (`restart-baseline.md`, read from `/proc`). Not stored per daemon, so not excluded.
- *The shared observed set.* It grows and is never pruned (`observed.ts:16-25`); a path joining a test's entry re-keys it where the path exists (fixture E8 in `restart-baseline.md`). My comparison uses today's set, so a row stored before the path joined shows as equal content with another key.
- *Untracked files in a closure.* Not visible to git. Not determined.

The equal-content row was stored less than 1 h before the run in 5,685 + 753 s of (c), and came from the main checkout only in 0 s. *Read from the store copy (`components.cjs`).*

## 2. The merged-tree case

cezar squash-merges every pull request; origin/main has no merge commits (154 first-parent commits since 2026-11-02, 0 merges). A worktree starts from origin/main (`baseBranch: "origin"`) or from a parent's branch commit. *Read in cezar's git and `.ai/cezar/config.json`.*

| First baselines by start commit (`startcommits.cjs`) | Baselines | Recorded s |
|---|---|---|
| a daemon had a clean result at that commit before the start | 114 | 77,377 |
| not that commit, but one with the same tree | 5 | 8,676 |
| **tree never seen on this host** | **128** | **136,668** |
| of it: on origin/main | 44 | 69,218 |
| of it: a branch commit (a parent's head, for example) | 84 | 67,450 |

"Seen" does not mean every file was validated there: 114 baselines at a seen commit still ran 77,377 s, mostly own changes and (b) for files the earlier daemon had not reached.

**Hub files.** 332 paths are in at least half of the 1,373 server closures. 37 of the 166 main commits in the window (22%) changed one. Of the 128 never-seen start trees, 38 (43,155 s) sat on a main commit whose own squash changed a hub file (`hubs.cjs`). The median start was 1 main commit after the newest main commit a daemon had seen, with 17 files changed between them. *Read from the store copy and git.*

**What the nearest stored content differs in** (class (b), `newcontent.cjs`): 1 path in 30,608 s, 2 to 5 paths in 39,861 s, 6 to 20 in 33,665 s, more than 20 in 58,507 s. A hub file is among the differences in 98,440 of 162,641 s. The paths with most seconds are the parity test kits (`packages/cezar/src/core/harness-parity.testkit.ts` 14,129 s, `workflows/waits-parity-cells.testkit.ts` 10,592 s, `core/harness-parity-cells.testkit.ts` 4,045 s), then hub sources (`runs/store.ts`, `workflows/run.ts`, `runs/record-write-rules.ts`), then `squeal.config.json` (3,474 s) and `vitest.config.ts` (2,504 s). A runner or lock file is among the differences in 22,388 s. *Read from the store copy and git.*

**The human's expectation, tested** (`scenario.sh`, Squeal 0.1.406). Branch B1 changed `src/a.ts`, branch B2 `src/b.ts`; each worktree validated its branch (ran a and h; b and h). Main squash-merged both: a tree no daemon had seen. A new worktree there ran 1 file, `h`, the only test whose closure both branches changed; `a` and `b` came from B1 and B2. *Verified by experiment.* So inheritance works per test file; what runs is the tests whose closure combines changes no single worktree had together. In cezar, with closures of 340 files at the median, that is most server tests whenever two merges touch hub files.

## 3. Defects

No defect reproduced in 0.1.406 (`scenario.sh`, `parallel.sh`, `stagger.sh`):

| Fixture | Listed, ran |
|---|---|
| a new worktree at a validated tree (P2 after P1, N for `a` and `b`) | 1, 0; files of other worktrees inherited |
| two worktrees started at the same moment, 8 files re-keyed | 8, 4 and 8, 4: split, no file twice |
| the second started 8 s after the first, its 20 s runs in flight | 8, 8 and 8, 0: the second waited and inherited |

*Verified by experiment.* Earlier: equal-content recipients inherit with zero runs (`completed-donor-inheritance.md`, 0.1.367).

The store's footprints are small and not proof: (a) 740 s, 92% of it with the earlier run in another worktree's baseline less than 1 h before; (d) 1,958 s, the runs started under 1 min apart (1,027 s) or 1 to 10 min apart (918 s), the other run a baseline or a run outside a checkpoint (`dupes.cjs`). A row is also gone when a run's results are discarded at store time (inputs changed during the run: 2.3% of cezar's seconds in `load-split.md` section 2), and my "same content" is by commit, not by key. *Inferred.* Together they bound any lookup or claim defect at 1.2%.

## 4. Levers

Upper bounds, of the 222,721 s.

| Lever | Bound | What it costs or leaves |
|---|---|---|
| A daemon on the main checkout that validates origin/main after each pull | 132,991 s (59.7%) of file runs had closure content equal to a main commit (its base on main or main's tip) that landed before the run; 115,917 s (52.0%) if it landed at least 30 min before; 24,649 s (11.1%) at 120 min. Of the 30-min bound, 93,584 s are (b), 13,182 s own changes (mostly pulls or rebases onto a newer main), 7,171 s (c) | It moves the work, it does not remove it: a worktree that starts at a new main content today runs these files once, and the next worktree inherits; only 13,640 s (6.1%) of first-baseline runs repeated content an earlier first baseline in another worktree had run. It would validate every main commit: first baselines started from 79 distinct main bases of 166 main commits. A main commit that changes a hub file re-keys most server tests, so its validation takes most of the server suite; the 30 to 120 min lag decides how much of the bound it reaches. Today the main checkout is 126 commits behind origin/main |
| Consistent installs | at most (c): 8,300 s (3.7%), about 2,300 s (1.0%) after the dirty correction | 46 of 47 live checkouts already match their lockfile; the rest of (c) may be the observed set |
| A fix for (a) or (d) | at most 2,698 s (1.2%) | no defect reproduced; part may be discarded results |

*Inferred from sections 1 to 3; `levers.cjs`.*

## Recommendation for Squeal

None as design. For the coordinator's next step, the numbers say: a new worktree's first baseline is not lookup failure. About three quarters of its seconds are content no daemon on the host had ever run, and about half of those (after the dirty correction) are the agent's own edits run while the long baseline is still in progress. The rest is the start tree itself: cezar's squash merges combine branch changes that each worktree validated alone, and hub files and parity test kits in most closures turn that into most of the server suite. A main-checkout daemon could take up to half of the seconds off new worktrees' path if it finishes within 30 minutes of a merge, but it moves that CPU to the main checkout and adds the main commits no worktree starts at.

## Open questions

1. Own uncommitted edits in removed worktrees: not determined, because removal drops revisions; the 90% correction rests on 19 live baselines.
2. Which (c) component per run: not determined, because the store keeps no key components, no observed-set history and no per-daemon Node version.
3. Whether the (a) and (d) footprints are replaced or discarded rows: not determined, because a replaced row leaves no trace of its key.
4. How long a main-checkout daemon would take per main commit on this host: not measured (no test runs allowed); it decides where between the 30-min and 120-min bounds the lever lands.

## Sources

- Store copy: `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-11-05T23:07Z; run logs `runs/<id>/report.json` read in place. `~/projects/cezar/squeal.config.json`, `.ai/cezar/config.json`, and installed `node_modules/.pnpm/lock.yaml` of the 47 live checkouts, read 2026-11-05.
- cezar git: origin/main at `4160527d3` (2026-11-05T22:22Z); `git ls-tree`, `diff`, `merge-base`, `rev-list`.
- Source at squeal `a58b4dc85` (0.1.406): `src/core/keys/check-key.ts` (`checkKey`, `keyFromSegments`), `src/core/keys/environment-hash.ts`, `src/core/keys/environment.ts:110-181`, `src/core/keys/observed.ts:16-25`, `src/core/keys/runtime-files.ts` (`runtimeIdentity`), `src/core/store/schema.ts`.
- Earlier findings: `research/restart-baseline.md`; `019-run-triggers/research/load-split.md` sections 1 and 2; `completed-donor-inheritance.md` at commit `24aa26286`.
- Probes: `probes/new-worktree-baseline/` (README lists each script, the fixture results and the commands).
