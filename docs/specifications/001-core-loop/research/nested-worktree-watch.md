# Research: a main checkout's daemon watches its nested worktrees

Board row 001-298. Read at `3c9ae2ae` (0.1.128): `src/core/watcher/` (`git.ts`, `watch-spec.ts`, `exclusions.ts`, `candidates.ts`, `change-feed.ts`, `chokidar-backend.ts`, `parcel-backend.ts`, `linked-watch.ts`), `src/core/scheduler/keying.ts`, spec 001 D2, spec 004 D5 and D6, `research/watcher-daemon-and-shared-store.md`, `evals/bin/run-cell.mjs`, `evals/lib/session.mjs`. Host: Linux 6.8, Node 24.21.0, git 2.43.0, chokidar 5.0.0, load average 7 to 10.

Probes, throwaway and kept out of the tree because this row commits one file (published as task artifacts, see Sources). They ran on scratch repositories under `/tmp` with a scratch `HOME`, through a `git` shim on `PATH` that logs every call and, with `PROBE_FIX=1`, drops `--no-empty-directory`:
- `count.ts` stubs `fs.watch` before chokidar loads (`syncBuiltinESMExports`), runs the real `createChangeFeed().start()` and counts the paths chokidar would watch. It takes no inotify watch. The host had about 5,000 free while the probes ran, so real watches were not an option: the first real-watch probe hit ENOSPC at 1,982.
- `cost.ts` gives the real change feed a fake backend and injects the hints chokidar would send for writes it makes, then counts git calls, batches and CPU.
- `dirwatch.mjs` uses one real watch: what a non-recursive `fs.watch` on a directory reports.

Fixtures (`setup2.sh`). The squeal-like one is a clone of this repository at `3c9ae2ae`: 3,363 own paths outside `.ai`, `node_modules` and `.git` (the brief counts 3,365 on the real checkout). The mvp-like one is synthetic: 3,189 own paths, each install 22,000 paths. Both use this host's layout: an untracked `.ai/cezar/.gitignore` ignoring `worktrees/`, `runs/`, `tmp/` and `runs.db-wal`, then git worktrees under `.ai/cezar/worktrees/` (6 and 4), each with an install, and one eval cell under `.ai/cezar/tmp/task1/squeal-evals/cells/` (its `work` a repository, its scratch `home` 1,100 paths that are not one).

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Yes. `listIgnored` passes `--no-empty-directory`, and with it git 2.43 lists no ignored path below an untracked directory that is not ignored itself. `.ai/` is such a directory: `.ai/cezar/.gitignore` and `config.json` are untracked. On this host's checkout the command prints nothing, so the spec excludes only `.git`, and chokidar watches every worktree, temp directory and eval cell under `.ai`. Nested repositories are dropped per event, not per watch. chokidar watches each file and each directory. Parcel (macOS) gets the same spec. | verified by experiment; read in source code (git `dir.c` v2.43.0 and master, chokidar `handler.js` 5.0.0) |
| 2 | In Squeal's feed: nothing per event from a nested worktree (dropped before git), one `git check-ignore` per batch of Cezar log writes, a full spec rebuild (4 git calls, about 150 ms of git CPU) per new directory under `.ai/cezar/tmp`, and at the watch limit one full reconciliation per ENOSPC error. chokidar's own work per event and per path comes on top. Memory: about 7.5 KB of JS heap per watched path. This explains the RSS, and the CPU through two loops. | verified by experiment (counts, git calls); inferred (attribution of the human's daemons' CPU) |
| 3 | Fix one flag. The count drops to the checkout's own paths: 45,182 to 3,366 (squeal-like) and 108,334 to 3,193 (mvp-like). Extra files, declared artifacts and linked artifacts keep their own watch paths. Nothing relies on today's behaviour. Also: coalesce reconciliations, treat ENOSPC as one note, and give linked targets exclusions. | verified by experiment; read in source code |
| 3b | Of the human's three options, watching only key inputs saves 2.7× on squeal and nothing on mvp-like over per-directory watches, and breaks revisions, spec rebuilds and new-file detection. Per-directory watches save 6.5× to 8× over per-file but need a new Linux backend. Recommend: never descend into ignored directories or nested repositories, on today's backend. | verified by experiment (counts); inferred (breakage) |
| 4 | Five rows; R1 is the fix, with a watch-count test. | inferred |
| 5 | Eval cells belong outside every repository: `os.tmpdir()` is `.ai/cezar/tmp/<task>` in a Cezar session. Below the checkout, a cell's Claude Code also loads the checkout's `CLAUDE.md` (not run). | read in source code; read in official docs |

## Findings

### 1. Why the watcher reaches `.ai` (verified by experiment, read in source code)

`src/core/watcher/git.ts:99-107` runs `git ls-files -z --others --ignored --exclude-standard --directory --no-empty-directory`. Spec D2 names the command without `--no-empty-directory`; the flag came in with the watcher (`671606c2`, 2026-10-04). In the squeal main checkout (read-only, one call) it printed 0 entries, against 10 without the flag (`.ai/cezar/worktrees/`, `runs/`, `tmp/`, `runs.db*` and others). In a scratch repository:

| Layout | `--directory --no-empty-directory` (today) | `--directory` |
|---|---|---|
| ignored install in an untracked package, `packages/new/node_modules/` | missed | listed |
| untracked dir holding only ignored content, `cache/node_modules/` | `cache/` only | `cache/` and `cache/node_modules/` |
| ignored install in a tracked dir, `lib/node_modules/` | listed | listed |
| this host's `.ai/cezar/{worktrees,runs,tmp}/` | missed | listed |

Cause, read in git `dir.c` at v2.43.0 (`treat_directory`) and unchanged on master (2.56): `check_only = (flags & DIR_HIDE_EMPTY_DIRECTORIES) && !(flags & DIR_SHOW_IGNORED_TOO)`. `ls-files -i` sets `DIR_SHOW_IGNORED`, not `_TOO`, so an untracked directory that is not ignored is read only to decide whether it is empty, and nothing below it is recorded. The git docs say the flag has "no effect without --directory" and only drops empty directories, so this is git's behaviour, not its documented contract. Without the flag both forms took 8 to 9 ms on the 130k-path fixture.

Downstream, `buildWatchSpec` excludes `.git`, the listed entries, `git status`'s nested repositories and submodules. `git status` lists no repository below an ignored directory, so nothing under `.ai` is excluded. Nested worktrees are only filtered per event (`NestedRepoProbe` in `candidates.ts`), after chokidar has watched them.

**Per-file.** chokidar 5.0.0 `handler.js` `_handleFile` calls `fs.watch` on each file, and `_handleDir` on each directory (read in source code). The count probe agrees: today's 45,182 watched paths are 41,819 under `.ai`. chokidar's `directoryFilter` does prune a directory that `ignored` rejects, so the fixed spec does keep it out (count below).

**macOS.** `parcel-backend.ts` passes `spec.excluded` as parcel's `ignore`, so the same spec lets every `.ai` event through. FSEvents needs no per-path watch, so there is no limit to exhaust, but the per-event costs of finding 2 apply (read in source code; not run on macOS).

**Linked targets, a second leak.** `linked-watch.ts` watches each observed symlinked directory's target with `excluded: []`. A link `lib -> ../ext/lib` holding 10 files and a 2,200-path `node_modules` cost 2,216 watched paths, with or without the fix (verified by experiment, count stub).

### 2. What each event costs (verified by experiment, fake backend, squeal-like fixture)

| Phase | Today | Fixed spec |
|---|---|---|
| 100 writes in a nested worktree, 10 batches | 0 git calls, 39 ms feed CPU | 0 git calls, 20 ms |
| 210 Cezar log and WAL appends, 10 batches | 10 `check-ignore`, 70 ms git CPU | 0 |
| 20 temp dirs made and removed under `.ai/cezar/tmp` | 101 git calls (20 each of `ls-files`, `status`, `config`; 41 `check-ignore`), 3,010 ms git CPU, 0 batches | 0 |
| 200 ENOSPC errors | 201 full reconciliations, 804 git calls, 29 to 32 s git CPU, 28 to 31 s wall | the same |

Two loops:
- **Spec rebuild per new ignored directory.** `candidatesFromHints` returns a new ignored directory as `ignoredDirs`, and `onDebounced` rebuilds the spec to exclude it. Here `ls-files` never lists it, so the rebuilt spec is unchanged and the next directory rebuilds again. `.ai/cezar/tmp/<task>` is every Cezar session's `TMPDIR`, so every `mkdtemp` in any session's tests pays one rebuild.
- **One reconciliation per ENOSPC.** chokidar emits `error` for each watch it cannot add (`_handleError` skips only ENOENT and ENOTDIR). `Feed.onLost` queues one `reconcile("dropped-events")` per error, never coalesced. With real watches at the limit, the first probe's start took 233 s and 37,714 git calls.

The human's daemons fit both. Sampling `/proc/<pid>/task/*/children` for 10 s, the squeal daemon (pid 3261105) spawned `ls-files` twice, `status` once and a link `check-ignore` once; the mvp daemon spawned `ls-files` once (read in `/proc`). `ls-files` runs only in a spec rebuild. Which loop dominates is not determined; their notes are in the human's store, which this row does not read.

**Memory.** With `fs.watch` stubbed, the feed's start grew RSS by 346 MB for 45,182 paths and 758 MB for 108,334, about 7.5 KB per path before any native handle. At 279,561 that is about 2 GB, in line with the 1.8 GB observed (inferred). The squeal daemon's 1.87 GB at 74,156 paths also holds its Vitest instance; the split is not determined. Start time fell from 3.8 s to 0.5 s and from 5.1 s to 0.25 s with the fix.

**Collateral, read in `/proc`.** Four worktree daemons, this row's own among them (pid 1374527), held 0 inotify watches. A daemon that starts at the limit watches nothing, gets one error per path and relies on the 30 s reconciliation. Cause inferred from finding 2.

### 3. The fix and what must still be watched

Watched paths per option, count stub (verified by experiment). The real 0.1.124 daemons held 74,156 (squeal) and 279,561 (mvp-unveiled-july26), read in `/proc`.

| Option | squeal-like | mvp-like |
|---|---|---|
| Today | 45,182 | 108,334 |
| Only drop nested repositories (`.git` entry) | 4,496 | 4,323 |
| Never descend into ignored directories (drop the flag) | 3,366 | 3,193 |
| The same with a nested-repository guard | 3,366 | 3,193 |
| Per-directory watches over that | 520 | 389 |
| Key inputs only: directories of closure files, include bases, root | 196 | 387 |

Dropping only nested repositories still watches Cezar's `runs/` and the eval cell's scratch `HOME`. The fixed count is the checkout's own paths plus `.ai/cezar` and its two untracked files.

What must still be watched, and why the fix keeps it (read in source code):
- **Ignored closure files and installed lockfiles** go to `extraFiles`. chokidar watches each by path (`watch([root, ...extraFiles])`; `Exclusions.excludes` returns false for them), and parcel subscribes each one's parent. Covered by `test/watcher/backend.test.ts` "reports extra files inside them".
- **Declared artifacts** (004 D5, `packages/cezar/dist/**`) are listed by `ignoredInputs` with their own `ls-files` (no `--directory`) and join `extraFiles` on every reconciliation (`ignoredCandidates`). They are root-level ignored, so already excluded today; nothing changes.
- **Linked artifacts** go through `LinkedWatches` and `linked-files.ts` (`test/keys/linked-artifact-watch.test.ts`), unaffected.
- **A directory that stops being ignored**: a `.gitignore` change rebuilds the spec, `update` re-adds it, and a reconciliation follows. That is today's path.

Nothing found relies on the over-watching. The `logs/` rule (an untracked directory whose current contents are all ignored stays watched) still holds: git still lists `cache/` and `check-ignore` still rejects it.

**Nested-repository guard.** Today a repository is excluded only after a rebuild: `git status` lists an untracked one, and a `.git` hint triggers the rebuild. A `git clone` or `git worktree add` into a watched, non-ignored directory is watched file by file until then. A chokidar `ignored` predicate that rejects a directory below the root holding a `.git` entry (one `existsSync` per directory) closes that window on Linux. It changes no count on these fixtures.

**3b. Key inputs only, compared (inferred from source, counts above).** It needs per-directory watches anyway, since new files must be seen. It saves 2.7× on squeal and nothing on mvp-like, where the closures cover the tree. It breaks:
- revisions for edits outside every closure: docs edits appear in headers ("Revision 385 (changed docs/board.md ...)") and in `changedAfter`; they would wait for the 30 s idle pass, which hints keep pushing back;
- spec inputs: a `.gitignore` or `.git` anywhere, and any `package.json` above a closure file (D4 re-resolution);
- a file created before the import naming it (D3 absent candidates need the nearest existing ancestor watched);
- `r` listings (D4), which key every directory below them;
- re-subscription: every closure change becomes a watch update, and a write in between is missed until the completion barrier or the next pass.

The slow tier's "sources changed since" reads stored closures, so it survives either option.

**Per-directory against per-file on Linux (verified by experiment).** One non-recursive `fs.watch` on a directory reported an in-place write, an atomic save and a write after it, a create, a delete and a `mkdir` of its children, but not a grandchild's write. One watch per directory is therefore enough for hints: 6.5× and 8.2× fewer watches. chokidar has no such mode, though, and was chosen as the only backend passing every scenario (`research/watcher-daemon-and-shared-store.md`). After the fix both counts are under 1% of the host limit, so a new backend is not needed for this incident.

### 4. Evals under the checkout (read in source code, read in official docs)

`evals/bin/run-cell.mjs:82` and `run-baseline.mjs:51` default `SQ_EVALS_ROOT` to `join(tmpdir(), "squeal-evals")`. In a Cezar session `tmpdir()` is `.ai/cezar/tmp/<task>` (the daemon pid 1408009's cwd shows a cell's `work` there). The fix keeps those paths out of the watch. A root outside any repository, for example `/tmp/squeal-evals-<uid>`, is still worth it for a second reason. Claude Code "loads `CLAUDE.md` and `CLAUDE.local.md` from your current working directory and every directory above it" (code.claude.com/docs/en/memory, fetched 2026-10-12), and project memory is not excluded by the cells' `--setting-sources project`. A cell under `/home/agent/projects/squeal` would then also read Squeal's own `CLAUDE.md`. The same holds for Node's nearest `package.json` lookup (`"type": "module"` here) for a cell file with none of its own. Not run: probe isolation forbids running the agent tooling.

## Recommendation for Squeal

Rows in the board's shape (numbers for the coordinator):

| Task | Status | Scope | Done when |
|---|---|---|---|
| R1 the watch spec excludes ignored directories below untracked ones | proposed, first | `src/core/watcher/git.ts` `listIgnored` without `--no-empty-directory`, matching D2's text. chokidar's `ignored` also rejects a directory below the root with its own `.git` entry. One worker, `src/core/watcher/` and `test/watcher/`. | `watch-spec.test.ts`: an untracked `.ai/cezar/.gitignore` with a git worktree, `runs/` and `tmp/` excludes all three, and `packages/new/node_modules/` is excluded. A Linux-only test starts a chokidar change feed on a fixture whose nested worktree holds 5,000 files: the inotify delta in `/proc/self/fdinfo` is at most the own paths plus 20. Both fail at `3c9ae2ae`. A `git worktree add` into a watched, non-ignored directory never raises the count above that bound while it runs (pins the guard). |
| R2 no reconciliation or rebuild storms | proposed, with R1 | `change-feed.ts`: at most one reconciliation queued, later requests joining it. ENOSPC and EMFILE give one note per daemon naming `fs.inotify.max_user_watches` and "changes found by the 30 s pass only", not a pass per error. A rebuild that leaves the spec unchanged records the hinted directories so their later hints skip it. | The fake-backend probe as a test: 200 injected ENOSPC errors give at most 2 passes and one note; 20 temp dirs under an ignored-but-unlisted directory give at most one rebuild. |
| R3 linked targets get exclusions | proposed, after R1 | `linked-watch.ts` watches a target with the exclusions git gives for paths under the link (its ignored directories), not `excluded: []`. | A linked directory with a 2,000-path ignored `node_modules` adds at most its own paths plus 10 watches; a write to its tracked file is still reported under the link. |
| R4 eval cells outside every repository | proposed, 006 lane | `SQ_EVALS_ROOT` defaults to a per-user directory under `/tmp`, not `os.tmpdir()`, and the runner refuses a root inside a git work tree unless forced. | A cell started from a Cezar session has a root outside the checkout; a test checks that no ancestor of the default root holds `.git`. Then: did past cells load Squeal's `CLAUDE.md`? |
| R5 per-directory Linux backend | later, only if counts matter again | Research first: re-run the scenarios of `research/watcher-daemon-and-shared-store.md` against a backend of non-recursive directory watches. | A research file with the scenario table. |

Rejected: watching only key inputs (finding 3b). After R1 and R2 ship, the human's two main-checkout daemons keep their watches until they exit or step down (D10). They must be restarted to free the host.

## Open questions

- Which loop drove each daemon's 70 to 100% CPU: the per-directory rebuilds, ENOSPC reconciliations, or chokidar's own event handling? Their notes, in the human's store, would say; not read.
- How much of the squeal daemon's 1.87 GB is the watcher? Not determined.
- Did eval cells run under `.ai/cezar/tmp` load `/home/agent/projects/squeal/CLAUDE.md`? A cell transcript's loaded-memory list would show it; not read.
- `status.md` (2026-10-12) says the two main-checkout daemons were stopped. Both were live at 12:45 with 74,156 and 279,561 watches (pids 3261105 and 3925328, up 1 h 36 min and 1 h 14 min). They were not touched.
- During the first probe, a read-only `git status --ignored` and `ls-files` ran once in the squeal main checkout without `--no-optional-locks`. It may have refreshed the index's stat data; nothing else there was touched.

## Sources

- git `dir.c` `treat_directory`, v2.43.0 and master: https://raw.githubusercontent.com/git/git/v2.43.0/dir.c, https://raw.githubusercontent.com/git/git/master/dir.c; `Documentation/git-ls-files.txt` v2.43.0.
- chokidar 5.0.0 `handler.js` (`_handleFile`, `_handleDir`, `createFsWatchInstance`) and `index.js` (`_handleError`, `_isIgnored`), from `node_modules`.
- Claude Code memory docs, "How CLAUDE.md files load": https://code.claude.com/docs/en/memory.
- Squeal at `3c9ae2ae`: `src/core/watcher/git.ts:99-107`, `watch-spec.ts`, `candidates.ts`, `change-feed.ts` (`onDebounced`, `onLost`), `linked-watch.ts`, `parcel-backend.ts`, `src/core/scheduler/keying.ts` (`track`, `ignoredCandidates`), `evals/bin/run-cell.mjs:82`, `evals/lib/session.mjs`.
- `/proc/<pid>/fdinfo` and `/proc/<pid>/task/*/children` of the human's daemons, read 2026-10-12 12:40 to 12:50.
- Probes: `count.ts`, `cost.ts`, `dirwatch.mjs`, `setup.sh`, `setup2.sh`, `run.sh`, `bin/git`, published as task artifacts.
