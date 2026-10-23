# Host load: the daily measurement

The human asked on 2026-10-21 why the host sits near 100% CPU while ten worktrees should share most test results. The report of that day (task 3800fd79, artifact `7f6a77e0`) found that Squeal-run tests used most of the busy CPU and that worktrees shared few results. The four designs that followed shipped in 0.1.253 and 0.1.255: 011-85 (keys that survive a version raise), 011-84 (departed and unused daemons), 011-82 (a quiet wait after a backlog cancel) and 011-83 (a CPU gate on the backlog). A Cezar automation runs this measurement every morning until the problem is resolved. This file is its runbook. The results go to `../../host-load/<date>.md`, one file a day.

## Rules for the session

- Read only. Scripts read store copies only: never open a live store or a daemon socket. Run no tests, no `npm ci`, no build, no `squeal run`. Stop no process and kill nothing, with one exception: run `squeal stop` in your own worktree first, because your session started a daemon there that must not add load. Leave your own worktree out of every count.
- Never print or store an environment value or a credential. To prove a process is Squeal's, print variable names only.
- Your only writes are the results file, its docs commit on main, and one published HTML artifact. Never edit the board, a spec, code, configuration or memory. A fix you think is needed goes into the results file as a proposed row.
- You run unattended. Never ask and never wait for a human. Wait between samples with a Cezar timer, never with `sleep`.

## Steps

All scripts are in this folder. Run them with the paths below; each prints JSON or one JSON summary line.

1. **Context.** Record the time, `uptime`, the CPU count (`nproc`), `capacity.hostSlots` from `~/.config/squeal/config.json` (default: CPUs − 1), and whether an eval run is active (`pgrep -af 'evals/bin/run-'`). List the Squeal projects and their live daemons with `squeal ps` and `squeal ps --json`.
2. **Yesterday's CPU.** `sh sar-day.sh <DD>` with yesterday's day of month in local time (the full day, 144 ten-minute samples). Also run it for today, for context only.
3. **Each project's store.** For each project root that `squeal ps --json` names, `<common>` is `$(git -C <root> rev-parse --path-format=absolute --git-common-dir)` and the store is `<common>/squeal/store.sqlite`. Skip a project with no store. Copy the store with its `-wal` and `-shm`, then its run logs, back to back, because the live daemons prune both: `mkdir -p <scratch>/<project>/runs && cp <common>/squeal/store.sqlite* <scratch>/<project>/ && cp -a <common>/squeal/runs/. <scratch>/<project>/runs/`. Then run `node --disable-warning=ExperimentalWarning waste.mjs <scratch>/<project>/store.sqlite 24 <scratch>/<project>/runs` and `node --disable-warning=ExperimentalWarning share.mjs <scratch>/<project>/store.sqlite`. Delete the copies when the results file is written.
4. **Live samples.** Take three 20-second samples at least 10 minutes apart: `python3 -I sample.py 20 <scratch>/sN.json`, then `python3 -I analyze.py <scratch>/sN.json`. Keep the scratch files out of the repository. A sample counts when its `busyCores` is at least a quarter of the CPUs (6 on 24). If an eval run is active, take no samples: criterion C2 is then not measured.
5. **Daemons and memory.** From `squeal ps`: each flagged daemon (older, root-gone, install-gone, not-installed) and how long it has been up; the daemons' total resident memory. From `free -b`: swap used and total. List niced processes adopted by `systemd --user` or init that carry the variable name `SQUEAL_OBSERVE`, with their age (report only; cezar's own leaks are hearsay-tools/cezarion#1448 and #1449).
6. **Yesterday's result.** Read the newest earlier file in `../../host-load/`.

## Criteria

The problem is resolved when all five criteria are met on two measured days in a row. Baselines are from 2026-10-21 (the report and sar `sa21`) unless the row says otherwise. `sa21` leaves the host on about 2026-10-28, so the numbers below are the baseline from then on.

| | Criterion | Target | Baseline 2026-10-21 | Source |
|---|---|---|---|---|
| C1 | The host is rarely saturated, or Squeal is not why | 10-minute samples with idle under 10%: at most 5% of the day; or, when more, Squeal-run tests (`%nice`) are at most 20% of the busy CPU in those samples | 16.8% of samples saturated; `%nice` 36.4% of busy CPU in them. 19 October, before the load: 0% | step 2, `saturatedShare`, `niceShareOfBusyWhenSaturated` |
| C2 | Squeal is a minor share of the busy CPU | Mean `squealShareOfBusy` of the counted samples at most 35%; met as "quiet" when fewer than two samples count | 70% (17.5 of 25.3 cores, one sample at load 51.9) | step 4 |
| C3 | Saves waste few test runs | In each project with at least 1,000 files picked in 24 h, at least 78% of picked files store a result at run end (`all.files.keptShare`) | squeal 60%, cezar 76% (design 011-82 expects about 81% and 78%), counted by the results that still existed: compare `all.files.keptShareNow` with them for a regression | step 3, `waste.mjs` |
| C4 | Worktrees share results | In each project with at least 3 counted worktrees, `medianSharedShare` at least 50% | squeal about 0% (3 of 5 worktrees shared 0%), cezar about 43% | step 3, `share.mjs` |
| C5 | No stale daemons; memory has room | No flagged daemon up more than 1 hour; daemons' total resident memory at most 8 GiB; swap under 90% used | 5 older daemons; 10.3 to 13.7 GiB; swap 4.0 of 4.0 GiB | step 5 |

Report these too, without a target: yesterday's mean idle (baseline 40.0%; 75.4% on 19 October), mean `%nice` (22.4%; 9.2%), mean `%system` (19.1%; 7.7%), holders per key, the number of live worktrees per project, files picked per project in 24 h (`all.files.picked`), and per project the prune's share (`all.files.prunedShare`) and the live worktrees' `live.files.keptShare`. They show whether the day was comparable: a day with far more work can miss C1 for reasons outside Squeal.

## How `waste.mjs` counts C3

Row 011-155, from `../../stored-nothing.md` finding 1. It reads the runs that started in the `<hours>` before `[end]` (an ISO time, default now) and ended. Each file a run picked is one of three:

- `storedNow`: the run still holds a result of the file.
- `prunedWithWorktree`: the run's worktree is removed since, and its `report.json` completed the file and did not withhold it. The prune deletes a removed worktree's results unless a live worktree holds the key (001 D8, `src/core/store/prune.ts`), so the file stored a result at run end and the prune deleted it later.
- `storedNothing`: every other file: cut by a cancel or a timeout, withheld, replaced at its key by a later run, or in a run with no report (node:test, pytest) that holds no result of it.

`keptShare` is `storedNow` plus `prunedWithWorktree`, of the files picked: the C3 figure. `keptShareNow` is `storedNow` alone: the count before 2026-10-24, which read the 2026-10-23 squeal C3 as 44% while about 74% completed. `all`, `live` and `removed` split the runs by whether their worktree still exists; each gives `files` (C3) and `recordedSeconds` (the units of `stored-nothing.md`: the report's durations; a file the run cut counts the run's wall when its log names it, else 0).

Two limits, so read `live` beside `all`:

- The prune's share counts every completed file of a removed worktree. In live worktrees, `liveCompletedStoredNothing` of the completed files stored nothing (inputs changed during the run, replaced); the prune's share can be too large by about that share of itself (0.6 to 8.5% in the copies of 2026-10-23).
- A removed worktree's run that kept no result under a live key is deleted with its log before any copy sees it, and every such run that stored nothing is among them. So `removed` leans toward stored work, more so the later the copy. On 2026-10-23 the 72 hours of `stored-nothing.md` lost 580 of squeal's 1,696 runs between 13:25Z and 17:01Z; a third to 44% of the lost seconds had stored nothing, against 18% in the runs that remain (inferred: the two copies subtracted). `live` is exact: the prune keeps a live worktree's results and runs for 7 days. Copy the stores at the start of step 3.

## Checking the count against 011-148

Run 011-148's `fate.mjs` and `sum.mjs` (`../stored-nothing/`) and `waste.mjs` on the same copies and window. `fate.mjs` ends its window at the copy's last run start and prints it as `to` in its first line; give that time to `waste.mjs`:

```sh
P=<this folder>; S=<scratch>   # copies as in step 3
nice -n 10 node $P/../stored-nothing/fate.mjs $S/squeal/store.sqlite 72 $S/fate-squeal.jsonl '' $S/squeal/runs | head -1
nice -n 10 node $P/waste.mjs $S/squeal/store.sqlite 72 $S/squeal/runs <to>
for f in all live removed; do node $P/../stored-nothing/sum.mjs $S/fate-squeal.jsonl $f; done
```

`sum.mjs`'s rows `stored` and `ended, worktree removed since (results pruned)` are `storedNow` and `prunedWithWorktree`; its `stored nothing` line is their complement, `prunedWithWorktree` plus `storedNothing`. On copies taken 2026-10-23 17:01:19Z to 17:01:28Z, recorded seconds over the 72 hours to the last run start:

| | picked | stored now | pruned with the worktree | stored nothing |
|---|---|---|---|---|
| squeal, `fate.mjs` + `sum.mjs` | 172,484 | 96,686 (56.1%) | 46,161 (26.8%) | 29,636 (17.2%) |
| squeal, `waste.mjs` | 172,484 | 96,686 (56.1%) | 46,161 (26.8%) | 29,637 (17.2%) |
| cezar, `fate.mjs` + `sum.mjs` | 254,697 | 179,870 (70.6%) | 31,349 (12.3%) | 43,477 (17.1%) |
| cezar, `waste.mjs` | 254,697 | 179,870 (70.6%) | 31,326 (12.3%) | 43,500 (17.1%) |

They agree within 0.1%; the 23 s in cezar are one file its report withheld, which `waste.mjs` does not count as pruned. In files: squeal 29,981 picked, 14,811, 7,664 and 7,506 in both; cezar 16,354 picked, 10,661 stored now in both, 2,657 pruned against `sum.mjs`'s 2,658. `stored-nothing.md`'s own figures (copies of 13:25Z, deleted since) cannot be read again: its windows now hold 1,116 of its 1,696 squeal runs and 1,223 of its 2,326 cezar runs (the second limit above).

## Verdict, report and done

- **RESOLVED**: C1 to C5 are all met and measured today, and yesterday's results file also says all five met.
- **NOT YET**: a criterion is measured and not met. For each one, give the evidence of its cause (the process trees, the worktrees that share little and why, the runs that stored nothing) and a proposed board row: title, owning spec, one-line done-when. Mark a criterion that is worse than its baseline as a regression.
- **INCOMPLETE**: a criterion could not be measured (an eval run, an unreadable store, no sar file). The day does not count toward RESOLVED.

Write `../../host-load/<YYYY-MM-DD>.md` (the run's local date): the verdict as its first line, the criteria table with today's value, target, baseline and met or not, the context figures, the causes and proposed rows. Commit it alone on your branch with the message `docs(011): host load <date>: <verdict>`, then `git fetch origin`, `git rebase origin/main` and `git push origin HEAD:main`; after a rejected push, fetch, rebase and push once more. It is a docs commit and needs no review.

Publish one HTML page with the same content (and yesterday's 10-minute samples of idle and `%nice` as a chart) with the Cezar CLI's `artifact publish <path>`; your session's instructions give the CLI's full command.

Your final message starts with the verdict, then the criteria in one line each, the artifact link and the commit SHA. On RESOLVED, first pause this automation: find its id with the Cezar CLI's `automation list` (the name starts "Host load daily measurement") and run its `automation pause <id>`. Then call `cezar_done`. A pause is the only change you make to the automation.
