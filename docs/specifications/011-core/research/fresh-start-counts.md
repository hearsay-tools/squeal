# 011-223: can a new worktree show its inherited counts at registration

Researcher of row 011-223, 2026-10-25, 20:58Z to about 22:30Z. Brief: `research/fresh-start-counts-brief.md`. Read: `research/missed-sharing.md`, `research/main-daemon.md`, row 011-205 and `src/core/delivery/header.ts`, spec 011 C3, C4 step 3, C5, C9 (start), `status.md` for 011-205.

Versions: source at this branch's base `c696096a9` (package 0.1.321). Host daemons run 0.1.318 to 0.1.321; the experiments ran a copy of the shipped 0.1.321 bundle (`~/.claude/plugins/cache/hearsay/squeal/0.1.321`), patched only to log step times (`patch.mjs`). Node v24.21.0, 24 CPUs. Store copies of squeal and cezar with `-wal` and `-shm`, taken at 20:59:01Z. Window: the 72 hours before the copy. Clones: squeal at `c696096a9`, cezar at `fe61be8c4` (origin/main), under `/tmp/fsc223`, lookup-only (both repositories' own setting), so no test ran. Probes and how to re-run each: `probes/fresh-start-counts/README.md`; outputs in `probes/fresh-start-counts/results/`.

**Load.** Rule: time nothing while the one-minute load is above 24. The store-copy integrity timing ran at load 23.4. Squeal start sq-a1 waited 20 s and started at load 22.3; sq-b1 waited 586 s and started at load 22.9. Both reached load 27 to 30 while they ran. The cezar starts waited from 22:20Z and had not started by 22:56Z: load stayed at 36 to 41 (see open question 1). Every experiment ran at nice 10, below the host daemons' nice 0, so its CPU-bound steps are slower than on the host.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | The wait | Registration to the first listed header is two steps. (a) Hook to daemon constructed: 7.3 to 22.6 s on the host (n=9, median 16.5 s), 34 to 35 s in clones at nice 10. Almost all of it is `PRAGMA integrity_check` on the 850 MB store: 29.8 to 33.9 s in clones, 24.0 s on a store copy, where `quick_check` takes 1.6 s. (b) Daemon constructed to listing committed: squeal median 13.7 s (n=21, 4.8 to 36.4 s), cezar median 32.4 s (n=17, 8.0 to 50.1 s) on the host; squeal clones 13.4 and 13.6 s, of which listing itself is 0.03 s and re-resolving the misses' closures 3.7 to 6.5 s | read from store, verified by experiment |
| 2 | What a listing depends on | The file list is Vitest's glob over the filesystem; closures are Vite's module graph, filtered to paths inside the root and outside `node_modules`, stored per project and shared; keys add each path's blob id and an environment hash (Node, platform, installed dependencies, configs, allowlisted variables). On two squeal clones at one commit: 1,117 of 1,117 keys equal. Each clone against a host linked worktree at that commit: 1,108 equal; the 9 that differ are exactly the 9 files whose closure or observed set holds `.git` (a directory in a clone, a file in a linked worktree). Two host worktrees at docs-only different commits: 1,117 of 1,117 equal. Three cezar worktrees at one commit: 1,029 of 1,029 equal | read in source code, verified by experiment |
| 3 | Reuse | Possible for most starts: 17 of 20 squeal starts and 11 of 16 cezar starts in 72 h began at test-relevant content another worktree's daemon had already recorded (exact commit: 4 of 20 and 10 of 16). A reused count would come from a key set at equal content, so it is right where keys are equal; it is wrong for files with a worktree-specific input (here the 9 `.git` files, so 1,116 current shown where the real listing finds 1,107), for a held failure, and for a different install or Squeal key format. The agent would see the corrected count 25 to 50 s later, on the first listed header (row 011-205's owed counts) | read from store and git, verified by experiment (the 9 files), inferred (other corrections) |
| 4 | Cheaper listing | Yes. The integrity check is 55 to 70% of the wait: `quick_check` instead costs 1.6 s, not 24 s, and moving the check off the start path removes it from the wait completely. Re-resolving misses' closures (3.7 to 6.5 s squeal) could follow the first commit under lookup-only. Together these leave about 8 to 10 s for squeal on this host | verified by experiment (timings), inferred (savings) |

## 1. The wait

**From the host stores** (`starts.mjs`, `results/starts.txt`). For every live worktree registered in the window, `worktrees.registered_at` is the first daemon's construction time (`#startedAt`, set in the `Daemon` constructor after `openDaemon` returns, `src/core/daemon/daemon.ts:238`). Its first `baseline` checkpoint starts after the listing and the lookup (`src/core/scheduler/bootstrap.ts`, `ledger.checkpoints.start`), and the commit follows within about 1 s. For every current daemon, the earliest consumer registered in the 120 s before construction gives the hook's moment: the SessionStart hook registers its consumer as it spawns the daemon.

| Step | squeal | cezar | Tag |
|---|---|---|---|
| Hook to daemon constructed (current daemons, first starts and restarts) | 14.0, 19.6, 19.9, 22.6 s | 7.3, 12.8, 14.5, 16.5, 17.4 s | read from store |
| Daemon constructed to first baseline (first starts, 72 h) | n=21: median 13.7 s, p90 30.5 s, max 36.4 s | n=17: median 32.4 s, p90 46.6 s, max 50.1 s | read from store |
| This researcher's own session (26a6ad36) | hook 0 s, daemon 14.8 s, baseline 25.8 s, first delivery 27.2 s | | read from store |

So the 30 to 40 s the human saw is about 15 s of daemon start plus 14 s (squeal) or 32 s (cezar) of listing, then the next hook boundary.

**Per step, in clones** (`patch.mjs`, `runstart.sh`, `steps.mjs`, `results/steps.txt`). Seconds from `squeal start`:

| Step | sq-a1 | sq-b1 | Tag |
|---|---|---|---|
| Daemon process up, bundle evaluated | 0.31 | 0.32 | verified by experiment |
| Lock held (`git rev-parse`, realpath, lock) | 0.03 | 0.07 | |
| **`PRAGMA integrity_check`** (`openDaemon`, `checkIntegrity: true`, `src/core/daemon/open.ts`) | **33.93** | **34.74** | |
| Store open done, registered, modules loaded | 0.14 | 0.30 | |
| Daemon loop start (runners made) | 1.19 | 1.33 | |
| `scan`: stat cache (`git ls-files`, seed hashes) | 1.61 | 3.36 | |
| Environments read (Vitest instance, configs, installed dependencies) | 0.85 | 1.48 | |
| Listing (`globTestSpecifications`) | 0.03 | 0.05 | |
| Stored closures set for 1,117 files | 0.62 | 0.85 | |
| Closures resolved for files with no stored list | 1.16 | 1.35 | |
| First lookup | 0.41 | 0.45 | |
| Misses' closures resolved again, second lookup | 6.49 | 3.72 | |
| Commit (counts, `listing.` meta row) | 1.03 | 0.97 | |
| **Total to committed; daemon part** | **47.8; 13.4** | **49.0; 13.6** | |
| One-minute load at start; when listed | 22.3; 29.6 | 22.9; 27.0 | |

`squeal start` returned exit 3, "still starting: it has not answered after 30 s", in both runs, because the integrity check outlasted its 30 s bound (row 011-214). *verified by experiment.*

**The integrity check alone** (`integrity.mjs`, `results/integrity-squeal.txt`): on the squeal store copy (207,625 pages of 4 KiB, 850 MB, 360 free pages), `integrity_check` took 24.0 s and `quick_check` 1.6 s, read-only, nice 10, load 23.4 to 26.7. The host's 7 to 23 s at nice 0 fits the same work at a higher priority. *verified by experiment.* The check runs on every daemon start, first starts and restarts alike (C9; `openStore(…, { checkIntegrity: true })`). Store notes show at least 61 squeal and 31 cezar daemon exits in live worktrees in the last 24 h (notes are capped per worktree, and removed worktrees are not counted). So the check costs at least 92 × 15 to 34 s, about 25 to 50 CPU-minutes a day. *read from store, the per-start cost from the experiment.*

## 2. What a listing depends on

Read in source at `c696096a9`:

- **File list.** `VitestAdapter.testFiles` calls Vitest's `globTestSpecifications`, which walks the filesystem with each project's `include` and `exclude`, then drops what `vitest.exclude` and `excludeProjects` drop (`src/runners/vitest/adapter.ts:480-487`). So the list sees untracked files and ignored directories that an `include` reaches, and not git. In squeal, `include` is `test/**`, `src/**`; `.ai/` and `.cursor/` are out of reach. A main checkout with nested worktrees under an included path would list their files (`main-daemon.md` 4, toolkit-dev).
- **Closures.** Vite's import graph plus unresolved candidates and the snapshot path (`adapter.ts:445-467`), kept only for paths inside the root and outside every `node_modules` (`src/core/fs/worktree-paths.ts:24-26`), stored relative. One list per project and test file is shared by all worktrees, written by the last that resolved it, and the observed set only grows (C3, `status.md` 2026-10-25, 016-27).
- **Keys.** Each closure path's git blob id (from the index when clean) and the project's environment hash: key format and adapter version, Node version, platform, arch, the resolved config and config files, setup files' closures, the installed dependencies (hidden lockfile or pnpm lockfile, `src/core/keys/environment.ts:109-145`), and allowlisted variables. `squealVersion` is read but left out of the hash (`environment.ts:46`).
- **What differs between two worktrees at one commit:** untracked and ignored files an `include` or a closure reaches; the install (a different `node_modules` fingerprint); environment variables on the allowlist; the Node version of the daemon; a dirty file; and paths whose kind differs by layout, such as `.git`. Not the absolute root, not the worktree's name, not `TMPDIR` (none enters a key).

Shown on clones (`keys-*.json`, `results/keys-compare.txt`):

| Pair | Equal keys | Differ | Tag |
|---|---|---|---|
| Clone a vs clone b, squeal at `c696096a9` | 1,117 | 0 | verified by experiment |
| Clone vs host worktree 26a6ad36 at `c696096a9` | 1,108 | 9 | verified by experiment |
| Host 26a6ad36 at `c696096a9` vs host 017527fd at `96926f662` (docs only between) | 1,117 | 0 | read from store |
| Cezar host worktrees fabc7220, a86dd042, 62ebd553 at `477978962` | 1,029 | 0 | read from store |

The 9 squeal files that differ are exactly the 9 whose closure or observed set lists `.git` (`test/daemon/{departure,drain,drain-checkpoint,drain-wait,restart-handover-signal,stop-cancel}.test.ts`, `test/evals/eval-root.test.ts`, `test/kit/vitest.test.ts`, `test/scheduler/environment-growth-wait.test.ts`). *verified by experiment that the sets are equal; that `.git` is the input is inferred.* `missed-sharing.md` found 6 such files on 2026-10-23. Host linked worktrees share these keys with each other, so this splits clones and main checkouts from linked worktrees only.

## 3. Reuse

**How often a start has a donor** (`same-content.mjs`, `results/same-content.txt`). For each live worktree registered in 72 h, its start commit comes from its reflog. Evidence that another worktree listed a commit before that start: a revision row with that head (a daemon recorded it) or a clean result at that commit ("proven"). A reflog entry alone does not prove a daemon ran. *Equal test-relevant content*: every path in any stored closure list or observed set, every test file, every `package.json`, lockfile, `tsconfig*.json`, Vitest config and `squeal.config.json` has the same blob at both commits.

| 72 h | squeal | cezar | Tag |
|---|---|---|---|
| Fresh starts with a known commit | 20 | 16 | read from git reflogs |
| Another worktree had listed the same commit (proven) | 4 (8 with reflog-only evidence) | 10 | read from store |
| ...or equal test-relevant content (proven) | **17 (85%)** | **11 (69%)** | read from store and git |
| No donor | 3: cand/0.1.322 `2d1cca690`, the build commit `02fd25325` (0.1.324 bundles), the docs commit `703e9bfdf` | 5: 288ff376, ab979002 (reflog evidence only), ee1ae15d, fd7d7578, f2efc7b3, all before 10:32Z | |
| Age of the newest proven donor listing | 0 to 44 min (median 6) | 0 to 20 min, one 931 min | |

Squeal's starts are mostly at docs commits on main, so an exact-commit match finds few and a content match finds most. Cezar's start at origin/main in groups (three at `477978962` within a second, three at `6823f952e`), so exact commits match. *read from store and git.* Removed worktrees' starts are not counted: their reflogs are gone. Their listings do count as donors when a result proves them.

**What a donor gives.** Reused key sets answer what the first header needs, the current count and the inherited count, at registration and with no runner call. They are right where this worktree's keys equal the donor's. From 2, they differ for:

1. files with a worktree-specific input: on this host the 9 `.git` files between a clone or main checkout and a linked worktree, 0 between two linked worktrees;
2. an install that differs (another lockfile resolution, an install not finished: `awaiting-install`), or another Node version or key format (a daemon of another release);
3. a dirty start, or untracked files an `include` reaches;
4. a failure the donor holds: another worktree's fail is held as not current here (`heldFailure`, C4 step 3), so the donor's own counts would show it wrongly, and only its keys are reusable;
5. results stored or pruned between the donor's listing and now. Keys name content, so this changes the count but makes no early count false.

**What the real listing corrects, measured on the clones:** a donor count taken from host worktree 26a6ad36 says 1,116 of 1,117 files current (the human's "1,116 of 1,117"). The clone's real listing finds 1,107 current and 10 unknown: 9 files shown current early would turn unknown. *verified by experiment.*

**How a wrong early count would show to the agent.** Today SessionStart says `0 current … The daemon has not listed this worktree's test files yet; these counts are not complete`, and row 011-205 sends the full counts once on the first delivery after the listing (`counts-owed:`). With reuse, SessionStart would carry the donor's counts, and the first listed delivery would replace them 25 to 50 s later (1 above). An overcount marks a file current that is not current here. Under lookup-only nothing queues that file either way, so the agent learns it only from the corrected header. An agent that edits nothing in those seconds loses nothing. An agent that decides from the SessionStart line, for example "nothing to run", decides on the overcount. *inferred from source and the clone counts.*

## 4. Cheaper listing without reuse

Options, each with its cost. No design.

| Option | Saves per start | What it costs | Tag |
|---|---|---|---|
| A. `quick_check` instead of `integrity_check` at start | 22 to 32 s at nice 10; on the host 7 to 21 s of 7 to 23 s | SQLite: quick_check "does not verify UNIQUE constraints and does not verify that index content matches table content" and runs in O(N), not O(N log N). So an index-only corruption is found later or never, where D12 moves the store aside today | verified by experiment (timings); read in official docs (coverage) |
| B. Run the integrity check after the daemon serves, or once a day per store | the whole check from the wait; with once a day also 25 to 50 CPU-min a day | a corrupt store serves until the check ends; recovery after serving must stop the daemon and move the file aside | inferred |
| C. Under lookup-only, commit the first lookup before re-resolving the misses' closures | 3.7 to 6.5 s squeal (10 misses); cezar not measured (69 to 113 misses at its starts) | the misses' keys are first those of the shared list, then corrected (cause D of `missed-sharing.md`); the header counts stay right, and unknown files stay unknown | verified by experiment (step time), inferred (saving) |
| D. Skip the stat-cache seeding of all tracked files at the start | 1.6 to 3.4 s | hashes are needed for the first edit; deferring them moves the work, does not remove it | inferred |

A plus C leave about 8 to 10 s between the hook and the listed counts in a squeal worktree on this host: daemon start and loop 2 to 3 s, scan 1.6 to 3.4 s, environments, listing and lookup 3 to 4 s, commit 1 s. Cezar's 32 s median daemon part is not split here (open question 1).

## Recommendation for Squeal

Make the start cheaper before reusing listings. The integrity check is 15 to 34 s of a 25 to 50 s wait, on every daemon start, and option A or B removes most of it with no new correctness risk to counts. Reuse would show counts at registration for 85% (squeal) and 69% (cezar) of fresh starts, but it adds a donor count that can be wrong. On this host the error is small and visible (9 of 1,117 files between a clone and a linked worktree, 0 between two linked worktrees), and the real listing corrects it 25 to 50 s later. If reuse is built, match on test-relevant content plus install fingerprint, Node version and key format rather than on the commit, since a commit match finds 4 of 20 squeal starts. Reuse keys, never the donor's held failures, and say in the SessionStart line that the counts are another worktree's until this one lists.

## Open questions

1. Cezar's per-step split: not determined. The load stayed at 36 to 41 from 22:20Z to the end of the budget, so the two cezar clone starts did not run. The store gives only cezar's total, a 32.4 s median from daemon to listing. `series.sh c:stores/cezar:cz-c1 d:stores/cezar:cz-d1` runs them.
2. Why `.git` keys differently between a clone and a linked worktree: inferred from the equal file sets, not traced. `missed-sharing.md` open question 4 is the same.
3. The integrity check at nice 0 in a clone: not measured, because of the nice 10 rule. The host gaps (7 to 23 s) stand in for it.
4. Daemon starts a day across all worktrees: at least 92 from notes, which are capped and lost with their worktree.
5. Donor evidence uses today's closure lists and observed sets for past commits, as `missed-sharing.md` did, so content equality is inferred for the past.

## Sources

- Store copies: `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-25 20:59:01Z.
- Git: reflogs `~/projects/{squeal,cezar}/.git/worktrees/*/logs/HEAD` and `logs/HEAD`, `git ls-tree -r` per commit.
- Source at `c696096a9`: `src/core/daemon/{open,daemon}.ts`, `src/core/store/open.ts`, `src/core/scheduler/{bootstrap,keying,ledger}.ts`, `src/runners/vitest/adapter.ts`, `src/core/fs/worktree-paths.ts`, `src/core/keys/environment.ts`, `src/core/delivery/header.ts`, `src/core/notes.ts`; spec 011 C3, C5, C9.
- Shipped bundle 0.1.321, copied to `/tmp/fsc223/bundle` and patched there with `patch.mjs`.
- SQLite `PRAGMA quick_check`: https://www.sqlite.org/pragma.html#pragma_quick_check, fetched 2026-10-25; Node's bundled SQLite is 3.53.4.
- Research: `missed-sharing.md`, `main-daemon.md`.
- Probes: `probes/fresh-start-counts/` (the README lists each script and the commands; `results/` holds the outputs quoted here).
