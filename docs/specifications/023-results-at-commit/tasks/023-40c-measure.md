# Rows 023-40c and 023-46: a commit daemon's start, first result and memory, measured again on a quiet machine

Version: cand/0.1.592 at `d0925e820` (rows 023-40c: the commit daemon owns setup; 023-46: a start skips the walks the store proves). Measured on the built plugin bundle `plugins/claude-code/dist/cli/squeal.mjs`, not `tsx`.
Machine: a boat.dev `default` sandbox, 4 vCPU, 8 GB RAM, 2 GB swap, AMD Ryzen 9 9950X (the same type and CPU model as the first measurement), Node 24.22.1, pnpm 12.15.0, git 2.43. Date: 2026-11-22.
Subject: the same as [`023-40-measure.md`](023-40-measure.md): this repository as a 4-commit chain whose trees are those of `15417c90c~3` to `15417c90c`. The user worktree is at the tip. Every call is `squeal status --at HEAD~1 test/daemon/commit-removal.test.ts --run`. HEAD and HEAD~1 differ in 45 files.
Raw data, scripts and profile summaries: [`../probes/023-40c-measure/`](../probes/023-40c-measure/).

## Summary

| Question | Answer |
|---|---|
| The call's total time (quiet, warm package store) | **10.6 s** median (9.6–12.8 s), n=6. Was 48 s. |
| Is the result right | **Yes, in every call.** The call read the named file's pass at the commit in the same call ("1 unchanged", exit 0), in all 16 calls that got a commit worktree (12 reps, 2 profiled, 2 of the three-call run), and in every second call. The first measurement read "not determined" (exit 3) in all 18. |
| Commit daemon: spawn to serving | **8.0 s** (6.0–9.2 s) quiet. Was 31 s from claim to serving (claim to serving now: 7.6 s). |
| Commit daemon: spawn to the named file's result | **9.6 s** (7.4–11.0 s) quiet |
| A second call at the same commit (warm daemon) | **0.45 s** (0.4–0.5 s), n=12, exit 0 |
| Both daemons start with the call (fresh store, no daemon before) | Call **31.5 s** (30.0–32.8 s), spawn to serving 25.2 s, n=3. Was 93 s. The commit daemon walks every file here, since no stored walk exists yet. |
| Memory of one commit daemon (PSS, daemon plus children) | Start peak **0.86 GiB** (was 1.46). Idle in the first minute 0.68 GiB (was 1.16). Idle after its 60 s GC **0.53 GiB** (was 0.72). Running 40 files with 4 workers: peak **1.66 GiB** PSS, 2.76 GiB RSS (was 1.91 and 3.07). |
| Three commit daemons at three commits | **Only two started.** The third call waited 98 s for a place and ended "unknown", exit 3: "2 of 2 commit worktrees live". The ceiling counts the live daemons twice (see the finding below). |
| Recommendation | Keep **2 GiB** per commit daemon: the run peak is 1.66 GiB PSS on 4 workers, and it grows with the worker count. But admit a new commit daemon while free memory holds another 2 GiB (`free / 2 GiB >= 1`), not while the live count is below `free / 2 GiB`. Start time: about 10 s to a result in the quiet case, about 30 s when no worktree has walked yet. The 100 s bound leaves wide room. |

### Findings

1. **The ceiling counts running commit daemons twice** (`src/core/checkout/commit-worktree.ts:186`, `commit-places.ts` `commitWorktreeCeiling`). The call waits while `live.length >= floor(os.freemem() / 2 GiB)`. `os.freemem()` is Linux's MemAvailable, which already excludes the memory of the live daemons. In the three-call run, MemAvailable was 3.4 to 5.9 GiB with two commit daemons live, so the ceiling stayed 2. After their GC the two daemons used 0.42 GiB PSS together, and the ceiling was still 2. On 8 GB a third commit daemon never starts, even when 5.9 GiB is free. On a machine with less free memory (an IDE, a browser), the second daemon can be refused too. Suggested reading of D7.4: admit a new daemon while `floor(free / 2 GiB) >= 1`, or count `live + floor(free / 2 GiB)`. No product code was changed here.
2. **A stale line in the call's output.** The `--run` call still prints `squeal: keying test files at <commit> in a temporary checkout` on stderr (`src/cli/status-at.ts:233`), before it branches to the daemon path, which keys nothing in a temporary checkout. The call's CPU profile shows 0.1 s of work in 12.9 s, so it does no keying. The line should go, or name what the call does.
3. **The key blocker of 023-40 is fixed.** The call reads the commit side at its daemon's live keys. The result's key (`31ba6e218a52`) is the one the first measurement saw the daemon store, and the call now reads it.

## Method

As in `023-40-measure.md`, with three changes. They are marked in **bold**.

- Each rep starts from a fresh Squeal state: every daemon stopped, the repository's `.git/squeal` and `~/.cache/squeal` deleted, git worktrees pruned.
- Batches, 3 reps each:
  - **quiet**: `squeal start` in the user worktree. The driver waits until its log says "serving", **then until the machine is quiet (under 0.2 s of busy CPU in each of three 2 s windows; it took 12 to 26 s)**. Then the call. Warm package store.
  - **group**: as quiet, then 90 s idle, then 40 test files (`test/scheduler`) in the commit daemon (`squeal run tests ... --wait 400000` in the commit worktree).
  - **cold**: as quiet, with the package store emptied before the call. **In 023-40, `cold` and `warm` ran while the worktree daemon was still starting (a script error). Here they wait for a quiet machine. So `cold` is the clean case with an empty store, not the "contended" batch of 023-40.**
  - **both**: no daemon before the call. The call starts the worktree daemon and the commit daemon at the same time.
  - Two profiled calls (`NODE_OPTIONS=--cpu-prof`, inherited by every Node process): one quiet, one `both`.
  - Three calls at once at `HEAD~1`, `HEAD~2` and `HEAD~3`, after the worktree daemon is quiet; 90 s idle; then 40 files in each commit daemon at once.
- **After each call, a second call at the same commit, 2 s later.**
- A sampler read `/proc` every 200 ms: RSS (`VmRSS`) and PSS (`smaps_rollup`) of each daemon and its descendants, MemAvailable, the commit worktree's marker (folder, installed, claimed) and the store's `results` rows for the named file. The commit daemon's spawn time is read from `/proc/<pid>/stat`. (In `quiet-1` the sampler had a bug, and its spawn is the first sample that saw the process, to within 200 ms.)
- Install alone: `git worktree add --detach` at `HEAD~1` and `pnpm install --frozen-lockfile`, three times cold and three times warm.
- Background on the sandbox: its snapshot agent ran for 1 to 4 s about once a minute, at about 60% of one CPU (42 two-second checks out of about 1,350; `snapshot-agent-seconds.txt`). It falls in every batch alike. It probably also ran during the first measurement, which did not record it.
- Times are seconds from the call's start unless the row says otherwise. Values are medians with the range in brackets.

**Why this subject and not `d0925e820`'s own trees.** On a chain of `d0925e820~3` to `d0925e820`, HEAD~1 differs from HEAD only in the plugin bundles. The named file's key is the same on both sides. The commit daemon selects nothing to run, and the call reads the worktree's result at the commit's key. That case is fast and right (`reps-d0925e820-chain.json`: call 11.2 s (8.5–11.2), second call 0.5 s, spawn to serving 9.7 s (7.4–10.1), "1 unchanged", exit 0, n=3). But it does not test a run at the commit. So the main subject stays 023-40's chain, where the file runs at the commit.

## Times

### Against the first measurement

| | 023-40 (`15417c90c`), clean n=6 | 023-40c (`d0925e820`), clean n=6 |
|---|---|---|
| **The call ends** | 48.1 (41.2–75.0) | **10.6 (9.6–12.8)** |
| The call's exit and the file's state | 3, "not determined", 6 of 6 | **0, "1 unchanged" (pass read at the commit), 6 of 6** |
| The call keys at the commit in a temporary checkout | 12.3 (11.2–18.4) | none |
| Commit daemon spawned (from the call's start) | not measured | 0.8 (0.7–1.1) |
| Commit daemon claimed the worktree | 14.3 (12.7–21.0) | 1.2 (1.2–1.4) |
| Commit worktree: folder made to installed (warm store) | 1.2 (0.9–1.8), by the call | 1.9 (1.8–2.1), by the commit daemon |
| **Claim to "serving"** | **31.0 (25.9–49.2)** | **7.6 (5.8–8.7)** |
| Spawn to "serving" | not measured | 8.0 (6.0–9.2) |
| Commit daemon serving | 45.3 (38.6–70.1) | 8.7 (7.2–9.9) |
| Named file's result stored at the commit, after "serving" | 1.9 (1.7–4.6) | 1.6 (1.4–1.9) |
| **Named file's result stored at the commit** | **47.4 (40.3–74.7)** | **10.3 (8.6–11.8)** |
| Spawn to that result | not measured | 9.6 (7.4–11.0) |
| Second call at the same commit | not measured | 0.45 (0.4–0.5), exit 0 |
| `squeal stop --at HEAD~1` returns | 0.2 (0.2–1.1) | 0.6 (0.1–0.7) |
| Worktree gone, from the stop | 0.8 (0.8–1.1) | 0.7 (0.6–0.8) |

| Both daemons start with the call, n=3 | 023-40 | 023-40c |
|---|---|---|
| The call ends | 93.0 (92.5–100.5), exit 3 | **31.5 (30.0–32.8), exit 0, "1 unchanged"** |
| Claim to "serving" | 59.0 (54.8–65.3) | 24.7 (22.3–25.5) |
| Named file's result at the commit | 92.5 (91.5–107.2) | 31.2 (29.2–32.2) |
| Worktree daemon serving | (not reported) | 22.9 (22.8–23.2) |

| Empty package store, n=3 (023-40c only; 023-40's `cold` was contended) | |
|---|---|
| The call ends | 12.9 (11.1–13.5), exit 0, "1 unchanged" |
| Folder made to installed, in the commit daemon | 4.2 (4.1–4.4) |
| Spawn to "serving" | 10.4 (8.8–11.0) |
| Named file's result at the commit | 12.8 (10.9–13.4) |

An empty store costs about 2.3 s, all in the commit daemon's install. In 023-40 it cost the call's keying install instead.

### `ensureCommitWorktree` alone

| | `git worktree add` | `pnpm install --frozen-lockfile` |
|---|---|---|
| Empty package store | 0.83 s (0.79–0.84) | 2.78 s (2.69–2.89) |
| Warm package store | 0.93 s (0.83–1.12) | 0.23 s (0.22–0.39) |

023-40 measured 1.3 / 3.4 s cold and 1.2 / 0.34 s warm. In the call the commit daemon's install takes longer than the install alone (1.9 s from folder to installed, warm). That span includes the daemon's boot and claim before it runs pnpm.

## Where the start goes now

The quiet start, seconds from the commit daemon's spawn (median of the clean reps, `start-phases.txt`, profiles `quiet-*.txt`):

| Time | Work |
|---|---|
| 0–0.4 | daemon boot; claims the worktree |
| 0.4–1.4 | `pnpm install --frozen-lockfile` in the commit worktree (pnpm seen in its tree at 1.0–1.2 s) |
| 1.4–3.5 | daemon main thread: scan, stat cache, keys from the stored lists (`matches`, `blobHash`, `lstat`) |
| 3.5 | runner-host child spawned |
| 3.5–8.5 | runner-host: Vitest load, then the walks of the files whose stored walk does not match (80 of 2,105, row 023-46), listing; then the closure rows are stored and the daemon serves |
| 8.5–10 | the named file runs; its result is stored about 1.6 s after "serving" |

CPU in the quiet profile: the daemon main thread was busy 3.3 s of 22 s, the runner-host 2.5 s of 18.6 s. Both were idle most of the time. Together that is about 6 s of CPU in an 8.5 s start, in two processes, plus pnpm and git children. The 20 s single-thread walk of 023-40 is gone.

With both daemons starting together, the commit daemon finds no stored lists (the worktree daemon has not stored its walk yet). So it walks all 2,105 files: the runner-host was busy about 15 s (`visit`, `jsonParseAst`, `depToPath`, `transformSync`), then `encodeImports` took 0.9 s on the main thread. The worktree daemon does the same walk at the same time.

What would cut it further (no product change made here):

1. **The `both` case needs a cheaper walk, not a different order.** When both start together they walk the same 2,105 files on two cores at once. Waiting for the worktree daemon's walk would not help on its own: it serves at 23 s, and a commit start after it takes about 8 s, so about 31 s again. What helps is a walk that costs less: each file's resolved imports stored by its content hash and shared across worktrees (023-40's point 1), so the second daemon parses only the 45 changed files; or the walk spread over more than one thread (it uses one core of four).
2. **Spawn the runner-host while pnpm installs.** It starts at 3.5 s, after the install and the main thread's keying. Vitest's load could overlap them if it does not need the fresh install (it does at the commit, so this needs care).
3. **The rest is spread out.** About 1 s install, 2 s keying, 5 s Vitest and walks. No single step dominates any more.

## Memory

All values in MiB. "Tree" is the commit daemon process plus every descendant (runner-host, store children, test workers).

### One commit daemon

| State | 023-40c tree RSS | 023-40c tree PSS | 023-40 tree PSS | Runs |
|---|---|---|---|---|
| Start peak (until "serving") | 975 (958–996) | **881 (865–897)** | 1,499 | clean, n=6 |
| Start peak, both daemons start together (full walk) | 1,495 (1,471–1,535) | 1,402 (1,372–1,440) | about 1,441 | both, n=3 |
| Idle, from 5 s after the second call until the group or the stop (30 s; 90 s in group reps, past the GC) | 784 (771–827) | 692 (678–734) | 1,190 | clean, n=6 |
| Idle after its 60 s GC (log: private memory 750–798 → 500–515 MiB in the worktree daemon, 357–400 → 199–210 MiB in the commit daemon) | 633 (625–637) | **541 (532–545)** | 735 | group, n=3 |
| Running 40 files (`test/scheduler`), 25–26 processes | peak 2,827 (2,816–2,922) | peak **1,704 (1,648–1,751)** | 1,954 | group, n=3 |
| Idle after the 40 files | 663 (659–679) | 575 (571–591) | 815 | group, n=3 |

The 40 files took 244 s (243.8–244.8), all passed. In 023-40 they took 264 s. After the GC the daemon process held 257–268 MiB RSS, and the runner-host 366–370 MiB.

### Three calls at three commits

| State | Sum of the commit trees, RSS | Sum, PSS | Per daemon | MemAvailable (min) |
|---|---|---|---|---|
| The calls (98 s: two daemons start, the third call waits) | peak 2,268 | peak 1,970 | about 1,000 PSS at the peak | 3,413 |
| Idle, first 55 s | median 887 (peak 1,487) | median 747 | | 4,795 |
| Idle after the GC | 518 | 424 | about 210 PSS | 5,946 |
| 40 files in each of the two, at once (334 s, all passed) | peak 4,167 | peak 2,679 | about 1,340 PSS | 3,567 |

The worktree daemon held 1,413 MiB RSS (median) during the calls and about 515 MiB after its GC. Calls 1 and 2 ended in 11.8 s with exit 0 and the pass. Call 3 queued nothing: "the call's wait ended before a commit worktree was free (waiting for a place: 2 of 2 commit worktrees live)". In 023-40, three daemons started and took MemAvailable down to 205 MiB. That was the cost of three full walks, plus three keying calls at 0.8 GiB each. Neither happens now.

### The per-daemon estimate

| State | PSS per commit daemon |
|---|---|
| Idle after GC | 0.53 GiB |
| Idle, first minute | 0.68 GiB |
| Start, with stored walks | 0.86 GiB |
| Start, full walk (no worktree walked yet) | 1.37 GiB |
| Running a group on 4 workers | 1.66 GiB (2.76 GiB RSS) |

The ceiling counts daemons that will start and run tests, so the peak decides: **2 GiB stays right** for a 4-worker machine, with some room for more workers. A smaller estimate (1 GiB) would hold for idle and starting daemons, but not for three running groups at once on 8 GB (2 × 1.34 GiB measured, plus the worktree daemon).

The formula needs the change in finding 1, not a new number. With `free / 2 GiB >= 1` as the test, this sandbox would have admitted the third daemon: 3.4 GiB was free at the worst moment of the calls. The measured cost of three running groups (about 4 GiB PSS together, plus 0.5 GiB for the worktree daemon) fits 8 GB.

This is for a repository of 2,105 test files. The bench fixture repositories (sizes S and L) were not measured.

## Cost

One `default` sandbox, 00:02 to 01:02 UTC (1 h 0 min), at $0.036 an hour: about $0.04, inside the plan's included hours. It was created with `--no-env` and deleted at the end.
