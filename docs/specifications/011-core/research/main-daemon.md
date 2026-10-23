# 011-157: the main checkout as the baseline for new worktrees

Researcher of row 011-157, 2026-10-23, 16:56Z to 17:45Z. Brief: `research/main-daemon-brief.md`. Read: `research/missed-sharing.md`, `research/stored-nothing.md`, `research/edit-load.md`, `research/daemon-memory.md`, spec 011 C1, C3, C4 step 3, C7, C9, C10, and `status.md`.

Versions: source at this branch's base `46dac522c`; the shipped bundle 0.1.278 (`~/.claude/plugins/cache/hearsay/squeal/0.1.278`, copied); git 2.43.0; Node v24.21.0. Store copies of squeal, cezar and toolkit-dev with `-wal` and `-shm`, taken at 16:57:03Z. Window: the 72 hours before the copy. One experiment ran daemons, 17:15Z to 17:17Z, at load 84 to 98, in `/tmp/md157`, lookup-only, so no test ran. Probes and how to re-run each: `probes/main-daemon/README.md`; outputs in `probes/main-daemon/results/`.

**Units.** *Seconds* are recorded seconds: each file's median stored duration (`results.duration_ms`). One recorded second cost 0.32 to 0.59 CPU-seconds (`edit-load.md` 0). *Equal to main* means equal closure content: the file's stored closure list, observed set and declared inputs hashed from `git ls-tree` at both commits (011-152's method, `sig.mjs`). The *env* variant also hashes every `vitest.config.*` and the root lockfile, so it is a lower bound. A *first start* is a linked worktree's first revision (live worktrees) or first baseline checkpoint (removed ones) in the window. *Misses* are what its first baseline found in no stored result. The main daemon's *rate*: 60 to 140 seconds per wall minute, from the full `run --all` checkpoints in the window (squeal 5,510 s in 39.4 min; cezar 7,328 s in 55.3 min).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Coverage | Of today's misses at first starts, content equal to the main checkout's HEAD: squeal 22,395 of 72,402 s (30.9%; env 28.9%), cezar 410 of 21,246 s (1.9%), toolkit-dev 429 of 526 s (81.6%). Of all files: 53.0%, 39.6%, 82.6% of seconds. A main checkout at origin/main would give 41.6%, 94.6%, 97.1% of misses. Keys of a main checkout and a linked worktree at one commit: 943 of 943 equal | read from store and git; verified by experiment (keys) |
| 2 | Cost in the main checkout | Squeal's main HEAD moved 100 times (34 re-key), 92,326 s re-keyed, 77,000 to 92,000 s to run (8 to 10 suites a day). Cezar: 12 pulls, 30,000 to 35,000 s. Toolkit-dev: 410 s (4,531 s env). A release pull re-keys 70 to 97% of squeal's suite. Idle: 0.8 CPU-s per minute, 300 to 320 MiB RSS (cezar) | read from store and git; idle verified by `ps` |
| 3 | Lifetime | Nothing keeps a main daemon up today. A session's hook starts it; it exits 3 s after the last session. `squeal start` exits after 60 min without a request, and 3 s after any session in the main checkout leaves. No hook ensures another worktree's daemon. No login service exists. An upgrade reaches it only through a hook in the main checkout | read in source code, read from store |
| 4 | Telling the main checkout apart | Squeal: `.git` is a directory. Git: `--absolute-git-dir` equals `--git-common-dir`. They disagree for a submodule. A bare repository with linked worktrees has no main checkout. Each clone has its own store. Squeal's main checkout has no install; toolkit-dev's is a work branch | verified by experiment, read from store |
| 5 | Save and lose | Against today's default it saves nothing: squeal's misses cost 72,402 s at starts (43,656 s measured in 011-152), its main checkout's moves 77,000 to 92,000 s. Cezar 21,246 s against 30,000 to 35,000 s. 67 to 87% of squeal starts and 69 to 100% of cezar starts still lose the start verdict: candidates, other branches, a main checkout that lags origin, a daemon still running the move | inferred from 1 and 2 |

## 1. Coverage

`coverage.mjs`, by where the worktree started (`results/coverage-loss.txt`, `results/cov2-*.txt`). Seconds of today's misses whose content equals the main checkout's HEAD at the start; in brackets, all files.

| Started at | squeal: starts, misses s, equal | cezar | toolkit-dev |
|---|---|---|---|
| Main checkout HEAD | 2; 3,564; 100% (100%) | 4; 323; 100% (100%) | 0 |
| origin/main ahead of it | 17; 24,593; 68.6% (76.2%) | 7; 20,240; 0.4% (16.7%) | 1; 456; 82.5% (83.6%) |
| A candidate commit (`cand/*`) | 10; 25,232; 0.6% (4.9%) | 0 | 0 |
| Another branch | 10; 19,013; 9.6% (52.2%); env 1.8% | 1; 195; 0% (3.9%) | 1; 70; 75.7% |
| Behind the main HEAD | 0 | 1; 488; 2.0% (13.8%) | 0 |
| Commit unknown (removed, no row) | 2 | 0 | 0 |
| **All** | 41; 72,402; **30.9%** (53.0%) | 13; 21,246; **1.9%** (39.6%) | 2; 526; **81.6%** (82.6%) |

- **The main checkout lags.** Squeal's main checkout merges origin/main by hand: 100 HEAD moves in 72 h, median gap 13 min. Cezar's pulls 12 times. Toolkit-dev's is on a work branch (`chore/squeal-vitest-root`, 6 local commits). If the main checkout had stood at origin/main at each start, the misses covered would be 41.6% (squeal), 94.6% (cezar), 97.1% (toolkit-dev). Earlier main HEADs of the 7 days (results' retention, `prune.ts:42-62`) add nothing in squeal and 13.8 points in cezar (all files). *read from git reflogs and store.*
- **Files equal to main were mostly hits already.** In squeal, 61% of all files equal main, but 31% of misses do. Sharing between worktrees already finds most of what a main daemon would hold. *read from store.*
- **The main daemon is often not done.** At 60 to 140 s per minute, a daemon that ran each move had not finished before 4 to 8 of squeal's 17 "origin ahead" starts and 0 to 4 of cezar's 4 "main HEAD" starts (`lag.mjs`). *inferred.*
- **Keys are equal between a main checkout and a linked worktree.** `mkpair.sh` made a squeal clone at `46dac522c` with the host's untracked files (`.ai/`, `.claude/settings.json`, `squeal.config.json.local-bak`) and a linked worktree nested in its `.ai/cezar/worktrees/`. The 0.1.278 bundle keyed 943 of 943 files equal in both (`results/pair-main-linked.txt`). *verified by experiment.* The stores disagree in one place: toolkit-dev's main checkout and linked worktrees, at equal closure content, keyed 91 of 295 pairs apart even with configs and lockfile in the signature, and 0 equal (`results/validate-toolkit-dev-env.txt`). Its main checkout has tracked edits (`.gitignore`, `.claude/settings.json`) and is on a branch that changes the root Vitest config. Which input splits the keys is not determined. *read from store.* Cause D of 011-152 (row 011-158) also splits equal content between any two worktrees.

## 2. Cost in the main checkout

`moves.mjs` re-keys each HEAD move; `sim.mjs` runs the queue at the rate, a later move superseding a queued file; "skip" drops files some worktree had stored at equal content (`results/sim.txt`, `results/moves-*.txt`).

| 72 h | squeal | cezar | toolkit-dev |
|---|---|---|---|
| HEAD moves; moves that re-key | 100 (75 `merge origin/main`, 25 `merge <commit>`); 34 | 12 pulls; 12 | 7; 5 |
| Re-keyed; already stored at equal content | 92,326 s; 14,330 s | 35,348 s; 5,337 s | 410 s (env 4,531 s); 2 s |
| What a daemon that stays up runs | 77,000 to 92,000 s (24,600 to 54,300 CPU-s) | 30,000 to 35,000 s (9,600 to 20,900 CPU-s) | 410 to 3,700 s |
| The same, following origin/main at once | 99,500 to 105,000 s (473 moves) | 77,000 to 90,000 s (63 moves) | 969 s |
| Full suite | 943 files, 3,900 s | 997 files, 4,645 s | 398 files, 825 s |

- **Releases.** 23 of squeal's moves re-keyed 2,500 to 3,800 s each (70 to 97% of the suite). 18 carry a `build: squeal 0.1.2xx` commit; the other 5 a `chore(release)` commit or product fixes. A cezar pull carries hours of commits and re-keys 3,661 s at the median, through files many tests share: one pull's 9 changed paths re-keyed 187 files (`whyrekey.mjs`). A release that moved the key format would re-key the whole suite; none did in the window (011-152). *read from git and store.*
- **What main runs today.** Cezar's main daemon ran 10,471 s of `run --all` and 952 s of other work in the window, and holds 30 failing file rows (29 `e2e`, recorded 2026-10-21 08:16Z to 09:24Z). Squeal's ran nothing: its main checkout has no `node_modules`, so it keys 468 files to nothing (note: "no dependencies are installed in this worktree"). *read from store.*
- **Idle.** `sample-main.sh` over the host's main daemons (17:07Z to 17:20Z, load 84 to 139): cezar's took 26 to 31 CPU-s in its first 100 s, then 0.8 CPU-s per minute, at 300 to 320 MiB RSS; squeal's, with no install, 10 CPU-s and 150 MiB. `daemon-memory.md`: a cezar daemon idle 30 min holds 620 to 629 MiB private, 486 MiB after the idle GC that 011-69 shipped. *verified by ps; the cezar clone read.*
- **Restarts today.** Main checkouts get many short sessions: squeal 253 since 04:50Z (21 an hour, median gap 1.5 min), cezar 404 since 07:12Z (41 an hour). Cezar's main daemon exited "no session registered for 3 s" 11 times in 27 minutes; at about 30 CPU-s a start, that is about 720 CPU-s an hour a daemon that stays up would not spend. *read from store (`revision-registered-left`, notes); the per-start CPU from one observed start, so inferred.*

## 3. Lifetime

| Way | Who starts it | When it exits | An upgrade | What a user sees |
|---|---|---|---|---|
| Today: a session's hook in the main checkout | `ensure` in the hook, for the hook's own root (`src/harness/shared/ensure.ts:61-80`) | 3 s after the last session leaves (`sessions-gone`), after draining only that session's work; a pull's catch-up stays queued for the next daemon (C9) | A newer hook in the main checkout asks `step-down` when every other consumer runs a version at least its own (`ensure.ts` `succeeds`) | The SQUEAL header in main-checkout sessions only |
| A hook in any worktree that ensures the main daemon | No such code: `ensureDaemon(location.root)` only | As `squeal start` below: it has no consumer | Only a hook in the main checkout asks a step-down | Nothing in the linked session; `squeal ps` lists it |
| `squeal start` without consumers | A human or a script | `daemon.idleExitMinutes` (60) after ready or the last socket request; queued work does not count (`lifecycle.ts:249-256`, `daemon.ts:633, 660`). Once any session registers and leaves, 3 s later (`lifecycle.ts:293-311`) | A newer `squeal start` finds it alive and sends `resume`; it asks a step-down only in a short handoff (`src/cli/start.ts:59-66, 117-129`) | `squeal start` prints the status; then nothing |
| A login service (systemd user unit, launchd) | Not in Squeal: no unit, no install step | Its own exits as above, unless the service restarts it | As above | Not determined |

Two facts decide the upgrade: Claude Code keeps every version's cache directory (59 under `~/.claude/plugins/cache/hearsay/squeal/`), and a Codex daemon runs from a kept copy (005-73, 005-81). So the `reinstalled` exit does not fire on a release, and an old main daemon serves until something in the main checkout steps it down or it exits. With 21 to 41 sessions an hour in the main checkouts here, a `squeal start` daemon lives minutes. *read in source code; the cache read on disk.*

## 4. Telling the main checkout apart

`layouts.sh` (`results/layouts.txt`, git 2.43.0):

| Layout | `.git` | `--absolute-git-dir` = `--git-common-dir` | Squeal's `isMain` (`daemon.ts:428`: `.git` is not a file) |
|---|---|---|---|
| Main checkout | directory | yes | true |
| Linked worktree, outside or nested in the main checkout | file | no | false |
| Bare repository's worktrees | file | no | false for all: no main checkout, so prune's main rule (`prune.ts:45-56`) keeps nothing |
| Second clone | directory | yes | true, with its own store: no sharing (C1) |
| Submodule | file (`gitdir: ../.git/modules/sub`) | yes | false: the two tests disagree; `git worktree list` names `super/.git/modules/sub` as its main worktree |

On the host: squeal's main checkout has no install and is dirty by untracked files only; cezar's is dirty the same way and pulls by hand; toolkit-dev's is used for work, on a branch with tracked edits. Toolkit-dev's main daemon once listed 3,686 test files inside the nested `.ai/cezar/worktrees/` (`test_files`, written 2026-10-22 about 12:00Z), which C1 calls opaque; its current keys hold none. Why is not determined. *verified by experiment, read from store.*

## 5. What it would save and lose

Today's default for linked worktrees is `lookup-then-run-missing`; squeal and cezar set `lookup-only`.

| 72 h | squeal | cezar | toolkit-dev |
|---|---|---|---|
| Misses at first starts, run under the default | 72,402 s (43,656 s ran in 011-152's window) | 21,246 s | 526 s |
| Main daemon at its HEAD | 77,000 to 92,000 s | 30,000 to 35,000 s | 410 to 3,700 s |
| Saved against the default | −5,000 to −48,000 s (it costs more) | −9,000 to −14,000 s | −3,200 to +100 s |
| Against `lookup-only` | costs 77,000 to 92,000 s, gives a start verdict on 31% of misses | costs 30,000 to 35,000 s, gives one on 1.9% | |
| Restarts not spent | small (no install) | about 720 CPU-s an hour, inferred | |
| Starts that still lose the start verdict | 26 to 34 of 39 (67 to 87%) | 9 to 13 of 13 | 2 of 2 |

Causes of the loss, squeal at 140 s per minute: content not at main HEAD in 21 starts (all 10 candidates, 5 of 10 other branches, 6 of 17 ahead of main), the main daemon still running the move in 5. Cezar: 9 starts differ in content (7 ahead of a lagging main checkout); at 60 s per minute all 4 "main HEAD" starts also find it behind. Beside them, a failure stored by the main checkout stays held in a linked worktree until a local run confirms it (`heldFailure`, `src/core/state/inherited.ts:18-30`), and `lookup-only` runs no miss, so it stays hidden: cezar's 30 stale failing rows today. *inferred from 1 and 2; held failures read in source and store.*

## Recommendation for Squeal

The numbers do not carry the idea as stated. The tradeoff is the main checkout's churn against what starts miss: squeal's main HEAD moves re-key 8 to 10 suites a day, more than every first start missed, and the starts that miss most (candidates, other branches) gain nothing from it. Where it would help is a main checkout that follows origin/main in a repository whose worktrees start there: cezar would cover 94.6% of its misses, at 77,000 to 90,000 s against 21,246 s. A design that runs main content only when a linked worktree starts at it, or only the files a start missed, is the cost side this research did not model.

## Open questions

1. Why toolkit-dev's main checkout keys apart from its linked worktrees at equal closure content: not determined. A patched bundle that logs key inputs (011-152 `rekey3.mjs`) would show it.
2. The rate: 60 to 140 s per minute comes from two full runs on a loaded host. The main daemon's real throughput beside other daemons is not measured.
3. Misses on the start's own later work (catch-up after a rebase, `run --all` at the end) that a main daemon's results would cover: not measured.
4. The CPU of one main-daemon start: one observed cezar start (26 to 31 CPU-s). A count over a day is not measured.
5. Seconds use median stored durations. For squeal, 011-152 measured 43,656 s run where the medians give 72,402 s; files cut or superseded explain part of the gap.

## Sources

- Store copies: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-23 16:57:03Z.
- Git: the three repositories' objects, `logs/HEAD`, `logs/refs/remotes/origin/main`, `logs/refs/{heads,remotes/origin}/cand/*`, `git --no-optional-locks status`.
- Source at `46dac522c`: `src/core/daemon/{daemon,lifecycle,ensure}.ts`, `src/harness/shared/ensure.ts`, `src/harness/codex/kept.ts`, `src/harness/shared/version-copies.ts`, `src/cli/start.ts`, `src/core/fs/git-layout.ts`, `src/core/store/prune.ts`, `src/core/scheduler/accept.ts`, `src/core/state/inherited.ts`, `src/core/keys/environment.ts`; spec 011 C1, C7, C9.
- Shipped bundle 0.1.278, copied to `/tmp/md157/bundle` and run there.
- `ps` and `/proc/<pid>/stat` of the host's main-checkout daemons; read only.
- Research: `missed-sharing.md`, `stored-nothing.md`, `edit-load.md`, `daemon-memory.md`.
- Probes: `probes/main-daemon/` (README lists each script and the commands; `results/` holds the outputs quoted here).
