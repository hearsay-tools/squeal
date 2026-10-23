# 011-152: why a new worktree misses results another worktree stored

Researcher of row 011-152, 2026-10-23, 15:40Z to 16:45Z. Brief: `research/missed-sharing-brief.md`. Read: `research/stored-nothing.md` and its probes, `research/edit-load.md`, `research/key-format-guard.md`, spec 011 C3, C4 steps 3 and 4, C7, C9, C12.

Versions: source at this branch's base `69cb9f7ed`, with no `src` change since `squeal--v0.1.276`. Host daemons ran 0.1.263 to 0.1.276 in the window: every one at `KEY_FORMAT_VERSION = 20` and `VITEST_ADAPTER_VERSION = "3"` (`git show <tag>:…`), on Node v24.21.0 (`ps`). Store copies of squeal and cezar with `-wal`, `-shm` and a snapshot of `runs/`, taken at 15:41:22Z and 15:41:24Z. Window: the 72 hours before each copy. Experiments: 15:57Z to 16:20Z, load (one minute) 30 to 46, daemons in `/tmp` clones with lookup-only baselines, so no test ran. Probes and how to re-run each: `probes/missed-sharing/README.md`.

**Units.** *Recorded seconds* are the per-file durations in run reports (`fileDurations`) of files that ran; a miss that was not run counts 0. One recorded second cost 0.32 to 0.59 CPU-seconds (`edit-load.md` 0). *First baseline*: each worktree's first `baseline` checkpoint, at revision 0 or 1. *Every baseline*: all 152 baseline checkpoints in the window, which includes head-move baselines in long-lived worktrees.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Each miss | Squeal: 41 first baselines, 13,665 misses, 8,126 ran, 43,656 recorded s (16,521 s live, 27,135 s removed). No miss had a stored row at its own key before its start (0 of the 2,520 with a known key) or an earlier clean row of its file at its own commit (0 of 12,252). For 333 misses (2,827 s), an earlier clean row stood at another commit with equal closure content and a different key. Cezar: 14 first starts, 4,810 misses, 0 s run (lookup-only); 0 of 590 known keys had a row before | read from store, verified by experiment |
| 2 | Causes | New content, its closure less than 15 min old in git (mostly candidate build commits): 44.1%. Content 15 min or more old with no surviving row or run: 35.9%. A path from another branch in the shared closure list: 6.5%. Dirty at the start: 4.9%. A removed worktree's run at equal content whose row is gone: 4.7%. Other: 3.8%. Releases, key format, runner and Node: 0%. Absolute paths, the worktree name, temp dirs, build outputs: 0% | read from store, verified by experiment (location, environment, branch paths), inferred (age, prune) |
| 3 | The read path | A result at an equal key is found. Source: two lookups at start, `byKey` then the formats read as one; another worktree's failure is held by design. On a copy, a fresh clone found 920 of 934 at equal content; the other 14 are probe artefacts. In the store: no miss with a row at its key | read in source code, verified by experiment, read from store |
| 4 | What a fix saves | The branch-path cause: 2,827 s first (4,989 s every), 900 to 2,900 CPU-s. The prune: 2,059 s seen (2,448 s every), at most a further 15,694 s (26,208 s) not determined. New content, dirty starts, new files: 0 by sharing; only the baseline policy moves them | inferred from 1 and 2 |

## 1. Each miss

`first.mjs` lists the misses of each first baseline (the checkpoint's `test_files`) with the key of its run (the run's stored row, or the worktree's current key when it was computed at or before the start's revision). It also lists every row of the file stored before the start. `results/first-baselines.txt` holds one line per checkpoint.

| Squeal, 72 h | First baselines | Every baseline |
|---|---|---|
| checkpoints; misses; ran | 41; 13,665; 8,126 | 152; 46,656; 20,709 |
| recorded s (live / removed) | 43,656 (16,521 / 27,135) | 101,274 (61,112 / 40,162) |
| key known; a row at that key before the start | 2,520; 0 | 11,720; 0 |
| clean commit known; an earlier clean row of the file at that commit | 12,252; 0 | 25,131; 0 |

So the store holds no case of a result that existed at a key a fresh worktree then ran. Rows the prune deleted are not in it, and that limit is finding 2's subject. *read from store.* Cezar keeps `baseline.onStart: "lookup-only"`, so its 14 first starts ran nothing. Of its 4,810 misses, 590 have a known key, none had a row before the start, and 263 were stored later by another worktree (`cezar.mjs`). *read from store.*

**The nearest stored key.** No miss has an earlier row at its own commit. So `content.mjs` compares closure content instead. It hashes the file's stored closure list, its observed set and the policy inputs that select it from `git ls-tree` at the miss's commit and at the commit of each earlier clean row. For 333 misses (2,827 s), an earlier row stood at equal content under another key. Finding 2 names the input. For every other miss, no surviving row has equal content. *read from store and git; the closure as stored now, so inferred for the past.*

**Reconciliation with `stored-nothing.md` finding 5.** Its 51,256 s of "first daemon start" baselines in live worktrees are, on this copy, the first checkpoint (21,320 s) plus later baseline checkpoints before a second daemon start (29,633 s). The later ones are mostly head-move baselines in long-lived worktrees (`recon.mjs`). The "every baseline" column covers them. *read from store.*

## 2. Causes

`classify.mjs` gives each miss one cause, in this order: commit unknown, dirty start, equal content under another key, an earlier run at equal content whose row is gone, no earlier row of the file, then the age of the content. `earlier.mjs` reads the reports of earlier runs. `age.mjs` walks the commit's first-parent line back while the closure content stays equal.

| Cause | First baselines, s (share) | Every baseline, s (share) | Tag |
|---|---|---|---|
| A. New content: the closure content stood in git less than 15 min before the start | 19,252 (44.1%) | 31,161 (30.8%) | read from store and git |
| B. Content 15 min or more old; no surviving row and no surviving run at equal content | 15,694 (35.9%) | 26,208 (25.9%) | read from store; cause inferred |
| D. Equal content stored before under another key: a path from another branch in the shared closure list | 2,827 (6.5%) | 4,989 (4.9%) | verified by experiment (696 s), inferred for the rest |
| E. Dirty at the checkpoint's revision (the agent's own edits) | 2,153 (4.9%) | 29,323 (29.0%) | read from store |
| C1. An earlier run completed the file at equal content in a worktree removed since; its row is gone | 2,059 (4.7%) | 2,448 (2.4%) | read from run logs and store; the prune inferred |
| F. No clean row of the file at any commit before (new or rarely run) | 618 (1.4%) | 4,110 (4.1%) | read from store |
| C2. As C1 in a live worktree (replaced, or keyed apart as in D) | 520 (1.2%) | 686 (0.7%) | read from run logs |
| G. Not determined: no stored row gives the start's commit | 533 (1.2%) | 2,350 (2.3%) | |
| A release that moved the key format or a runner version; the Node version | 0 | 0 | read in source and tags |
| Build outputs or ignored paths; absolute paths, the worktree name, temp dirs | 0 | 0 | verified by experiment |

**A: the commit was minutes old.** The largest starts are fresh worktrees at candidate build commits, 1 to 5 minutes after the commit (`build: squeal 0.1.27x, bundles for wave N`, and the 0.1.277 repair). Examples: 297eb5fb at 7564837cf, 4,795 s; ea937e11 at f9fb6c219, 4,083 s; eb54f622 at c1f2edc50, 3,444 s (`results/no-equal-content-by-start.txt`). No daemon had run that integrated content, so there was nothing to share. The coordinator runs no full suite before review, and the reviewer's own full run is `npx vitest run`, which stores nothing in Squeal (`CLAUDE.md`). *read from store and git; the process link inferred.*

**B: older content, no surviving row.** These starts are mostly at docs commits on main, 15 to 120 minutes after the product content they carry landed. Examples: b17ee032, f85f8e2b and 06a032dc at a8aa0795d, 09:01Z to 09:10Z, with content 19 to 27 minutes old. Two explanations fit, and the copy cannot separate them. Either the worktree that ran that content was removed and the prune deleted its rows, or no daemon completed it. The prune runs 60 s after every daemon start and hourly (`src/core/daemon/lifecycle.ts:347-369`). It deletes a removed worktree's results unless their key is live in some worktree or is main's newest (`src/core/store/prune.ts:42-62`), so a result outlives its worktree only while another worktree holds its key. C1 is the part with proof: a report of a removed worktree's run completed the file at equal content, and its row is gone. Concurrent starts at equal content do not repeat work: a claim covers another worktree's running tier (`src/core/scheduler/claims.ts`), and the two fresh worktrees 07b0d895 and 7174683f at 016013a6b stored disjoint files (`pair.mjs`). *read in source code, read from store; the split of B inferred.*

**D: a path from another branch.** Closure lists (`test_files.closure_paths`) and the observed set are shared per project across worktrees. The last worktree that resolves a list writes it, and the observed set merges and never prunes (011 C3). An absent path enters a key as `path\0-\0` (`src/core/keys/check-key.ts:45-47`). The first lookup at start keys every file from the stored list (`src/core/scheduler/bootstrap.ts:140-178`). So when a worker branch adds a module and its runs record it, every other branch keys that test file with one more absent path, and its earlier rows no longer match. The experiment (`results/experiments.txt` E3) took 2b9eaa1f at 3225f593c (14:03Z), which missed 52 files (696 s) that 3c74c111 had stored at e5905d35e with equal content. Clones at both commits, keyed today, give equal keys, and they equal 2b9eaa1f's keys. With `src/runners/focus.ts` (53 files) and `src/core/scheduler/record.ts` (51 files) removed from the stored lists of a store copy, the clone at e5905d35e reproduces 3c74c111's stored key for 53 of 54 files. Neither path exists at either commit. Branches 011-144 (13:03Z) and 011-131 (12:41Z) add them. Across all 333 D misses, 309 have such a path that first appears in a report between the two runs (`growth2.mjs`). *verified by experiment for 52 files, inferred for the rest.*

**What does not cause misses here.** Key format 20 and Vitest adapter 3 hold across every release in the window, so a release moved no key. Row 011-35's question stays open for releases that do move them. A clone at `/tmp/ms152/clones/c` with a fresh `npm ci`, no session variables, and the shipped 0.1.276 bundle keyed 920 of 934 files equal to this research's own fresh worktree at 69cb9f7ed (E1). So the worktree's location and name, its `node_modules` and the session environment do not enter keys. The hidden lockfiles of 15 live worktrees are byte-identical to the clone's. No closure or observed path is absolute or lies outside the worktree. The 14 that differed are probe artefacts: 8 have `squeal.config.json` in their closure, which the probe edits, and 6 have `.git` in their closure, which is a directory in a clone and a file in a worktree. Host worktrees share those 6: this worktree inherited them from four others. *verified by experiment, read from store.*

## 3. The read path

At start, `baseline` keys every listed file from its stored closure list and looks it up. A miss is keyed again from this worktree's own closure and looked up once more (`src/core/scheduler/bootstrap.ts:140-178`). Each lookup is `acceptedAt` (`src/core/scheduler/accept.ts:43-59`): `results.byKey(key)` (`src/core/store/repos/results.ts:48-63`). When it finds nothing, the formats read as one (13 to 19, and the definition before 011-85) are read once per file and key, and the newest set found is copied to the key (`copyReadAsOne`, `KEY_FORMATS_READ_AS_ONE`). Another worktree's `fail` is held, and the file runs here, until this worktree confirms it (`heldFailure`, 001-170): that is a miss by design. *read in source code.*

On a copy: with the shipped bundle, clones at 69cb9f7ed, e5905d35e and 3225f593c each found 920 of 934 results (E1, E2). In the store, no miss had a row at its key before its start, failures included. So no stored result at an equal key went unfound. *verified by experiment, read from store.*

A tsc build of the same source keyed all 934 files differently from the shipped bundle (E0). Why is not determined. Any experiment on keys must use the shipped bundle. *verified by experiment.*

## 4. What a fix saves

Per cause, the recorded seconds a fix keeps if it removes the cause completely, and CPU-seconds at 0.32 to 0.59. No design.

| Cause | First baselines | Every baseline | What it costs in correctness |
|---|---|---|---|
| D: a path absent here keys a file because another branch added it | 2,827 s; 905 to 1,668 CPU-s | 4,989 s; 1,596 to 2,943 CPU-s | The absent path re-keys the file the moment the module appears here (C3). Without it, that re-key depends on C3's add rule, which re-resolves the closures of a directory's importers on an add |
| C1: rows deleted with their worktree | 2,059 s seen (659 to 1,215 CPU-s); B adds up to 15,694 s, how much not determined | 2,448 s seen; B up to 26,208 s | None, since keys name content; the cost is store size |
| A: new content | 0 by sharing; the baseline policy moves 19,252 s (6,161 to 11,359 CPU-s) | 0; 31,161 s | `lookup-only` gives no whole-suite verdict at start (`stored-nothing.md` 6) |
| E, F: own edits, new files | 0 | 0 | |
| Releases, location, environment | 0 in this window | 0 | |

*inferred from findings 1 and 2.*

## Recommendation for Squeal

Keep the baseline decision on finding A, not on sharing. At most 11% of first-baseline seconds were sharing that failed (D and C1, 4,886 s of 43,656). Up to 36% more (B) may be the prune, which this copy cannot separate from content no daemon ran. The largest part, 44%, is content no daemon had run: candidate build commits that a reviewer's or repair worker's fresh worktree baselines minutes after the commit. A fix to sharing cannot keep that work. Only the baseline policy, or one Squeal run of the candidate before review, can. If sharing is worked on, cause D is the one with an exact mechanism and a measured cost.

## Open questions

1. How much of B is the prune: not determined. A deleted row leaves no trace, and the runs of a removed worktree with no row left are deleted with it. Two store copies taken an hour apart would show rows deleted and later missed.
2. Equal content against dirty rows: `content.mjs` compares clean rows only. A worker's dirty state that equals a later commit, keyed apart by D, is counted in B.
3. Why the tsc build keys differently from the bundle: not determined. It affects probes only.
4. The 6 `.git` files of E1: which input makes a clone's key differ from the host's is not determined (`rekey3.mjs`, `rekey4.mjs`). Host worktrees share them.
5. The closure content uses today's closure lists and observed sets for past commits. A list that lost a path since then can make two commits look equal when their keys were not.
6. Cause D outside baselines: edit and catch-up keys read the same shared lists, and their misses are not measured here.

## Sources

- Store copies: `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-23 15:41:22Z and 15:41:24Z; `runs/` snapshots copied right after each.
- Git: `~/projects/squeal/.git`, read with `ls-tree`, `rev-list`, `cat-file` and `show <tag>`. Tags `squeal--v0.1.263` to `squeal--v0.1.276`.
- Source at `69cb9f7ed`: `src/core/keys/{check-key,environment,hidden-lockfile,dependencies,packages,key-format,former}.ts`, `src/core/scheduler/{bootstrap,ledger,accept,claims}.ts`, `src/core/state/` (`heldFailure`), `src/core/store/{prune.ts,schema.ts,repos/results.ts}`, `src/core/daemon/{lifecycle,paths}.ts`, `src/core/ps/reads.ts`, `src/runners/vitest/environment.ts`, `src/core/types/policy.ts`; spec 011 C3, C4, C7.
- Shipped bundle: `~/.claude/plugins/cache/hearsay/squeal/0.1.276/dist/cli/squeal.mjs`, copied to `/tmp` and run there.
- `ps` for the host daemons' Node binary and bundle paths; read only.
- Probes: `probes/missed-sharing/` (README lists each script and the commands; `results/` holds the outputs quoted here).
