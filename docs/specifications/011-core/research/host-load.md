# Host load and result sharing, 2026-10-21

The human (2026-10-21): the host sits near 100% CPU with about ten worktrees per project, though Squeal was expected to share most results. The coordinator of task 3800fd79 measured the host between 20:06 and 20:20 CEST and wrote an HTML report (a Cezar task artifact of that task). This file keeps its findings for the rows that follow. Tags: `measured` (read on this host), `read in source code`, `inferred`.

## 1. Who uses the CPU

- `measured` At 20:06 the one-minute load was 51.9 on 24 CPUs, idle 3%, kernel time 31%. Swap was full (4.0 of 4.0 GiB). The kernel created about 750 processes and threads per second (`/proc/stat` `processes` over 10 s).
- `measured` A 20-second sample of every process, with CPU summed per process tree including children's times, gave 25.3 cores. Trees under Squeal daemons used 17.5 (70%): cezar `007cdd17` 11.1, squeal `716a6766` 3.6, cezar `2686d16a` 2.1, 15 other daemons 0.7. Other: an integration gate `flock … npx vitest run` 4.4, the Cezar cockpit with its sessions 1.9, short-lived processes adopted by systemd 1.3. The daemons' own CPU was about 1.4 cores; the rest is test processes and what they start.
- `measured` `sar` (`/var/log/sysstat/sa14` to `sa21`): idle fell from about 75% (16 to 19 October) to 54% on 20 October and 44% on 21 October; niced user time, which is Squeal's tests at nice 10 since 9 October, rose from about 9% to 20% of all CPU; kernel time from about 7% to 18%.
- `measured` `squeal ps` undercounts Squeal: in the same 3 s it reported 4.0 CPUs, the kernel 6.2 cores of niced user time plus their kernel time. It samples live processes over 2 s and misses tests that start and end inside the sample (row 014-21).

## 2. How much is shared

Read-only queries of `<common-dir>/squeal/store.sqlite` through `node:sqlite`.

- `measured` Live worktrees per key (`test_file_keys`, daemons with a heartbeat in the last 10 min): cezar 13 worktrees, 11,854 (worktree, file) pairs, 6,063 distinct keys, 2.0 per key; squeal 5 worktrees with keys, 4,004 pairs, 3,215 keys, 1.25 per key.
- `measured` Worktrees on one commit share 99 to 100% (cezar main checkout, `007cdd17`, `db9f81dc`, `dcd4e3aa`; squeal `03d89750`, `1c5a389b`). A claim keeps two worktrees from running one key at once (`src/core/scheduler/claims.ts`, 001-205).
- `measured` 24 hours of `runs`: cezar 4,165 runs, 23,456 files picked (about 25 times its 945 test files), 17,741 distinct keys recorded; squeal 748 runs, 15,672 files picked (about 19 times 820 files), 9,389 keys.

## 3. Why the keys differ

1. `measured` **Hub files and a moving main.** Every closure is `static imports plus declared inputs`. Cezar (966 test files): median closure 81 files, 90th percentile 404; each of 22 files in `packages/contract/src/` is in 49 to 64% of closures. Squeal (970): median 188, 90th percentile 455; `src/core/fs/` (8 files) in 84 to 85%, `src/core/types/` (9 files) in 78 to 79%. In 24 hours cezar main took 41 commits (6 in `packages/contract/src`), squeal main 101 outside `docs/`. Live cezar branches sat 0 to 12 commits behind main, with 9 to 126 files changed on main since their base.
2. `measured` **Cezar's declared inputs.** `squeal.config.json` gives every `packages/web/e2e/*.e2e.ts` (81 files) all of `packages/cezar/src/**` and `packages/web/src/**`; 1,537 browser-test executions and 11.1 run-hours in 24 hours. A cezar change, not this repository's.
3. `measured`, cause `inferred` **Whole-suite splits.** Squeal `716a6766`, `04a258b0` and `5c664a42` shared 0% with any live worktree; `03d89750` and `1c5a389b` shared 99%. All five have the same `vitest.config.ts` and `squeal.config.json`. The two that share have the same `package.json` version (0.1.240), `package-lock.json` and `node_modules/.package-lock.json`; the three others each have a different installed lockfile, which records the root version (0.1.242; 0.1.242 with an install from 0.1.237; 0.1.244). Cezar `f1ca49e6` shares 1% with `7c144ff7` on the same base; its 18 changed files are e2e and test-environment scripts no unit test imports. `read in source code`: `installedDependencies` hashes the installed lockfile whole (`src/core/keys/environment.ts:208-211`); `scopedDependencies` replaces that with the shared packages' identities when the package graph is usable (`src/core/keys/dependencies.ts:35-54`). Which key part differs is row 011-81's question.

## 4. Work that leaves no result

- `read in source code` An edit's work cancels a backlog tier in flight (`src/core/scheduler/tiers.ts:96-103`); an outcome is discarded when a newer run has the file at another key (`src/core/scheduler/store-decision.ts:130-133`).
- `measured` Squeal `716a6766`, 19:52 to 20:09: 36 revisions in 16 minutes during an open `squeal run --all`; 23 checkpoint batches of 200 files, 4,600 files picked, 750 results stored (16%), 770 s of batch time. Batches ended after 3 to 15 s with 0 to 15 results; one ran 167 s at revision 28 and stored none (not explained).
- `measured` 24 hours: cezar 76% of picked files stored a result, 342 runs with none took 10.3 of 66.0 run-hours; squeal 60%, batches of 100+ files 52%. A file re-run at the same key counts as no result for the earlier run, since `results` keeps one row per check and key.

## 5. Capacity and leftovers

- `read in source code` `capacity.hostSlots` is 12 in the user config. The pool is shared, but each daemon has a free worker beside it (`src/core/capacity/pool.ts`), so 18 daemons can run about 30 test processes before slow-lane tiers; the children of a test are not counted. During the sample all 12 permits were held and one daemon used 11 cores.
- `measured` 16 to 18 daemons held 10.3 to 13.7 GiB; five ran an older release held by a session; all of 0.1.235, 0.1.238 and 0.1.240 use key format 20.
- `measured` Cleaned with the human's approval at 21:00: 17 leaked test children adopted by systemd (mock servers, MCP and RPC stubs, four `node:test` processes of the deleted worktree `96fa9572`, a 5.9-day `node -e setInterval` watcher), the stale socket and pool mark, and 3,832 leftover temp directories (6.5 GiB). 24 named scratch directories of reviewers, researchers and evals (5.3 GiB, `/tmp/squeal-evals-1001`, `/tmp/squeal-011-42`, `/tmp/squeal-review-*` and others) were kept for their owners.
