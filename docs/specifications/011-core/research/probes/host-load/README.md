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
4. **Live samples.** Take three 20-second samples at least 10 minutes apart. Each runs the tree sampler beside `sample.py` in one command, so both read the same 20 seconds:

   ```sh
   timeout 60 python3 -I sample-trees.py <scratch>/sN-trees.jsonl 5 20 1 & python3 -I sample.py 20 <scratch>/sN.json; wait
   python3 -I analyze.py <scratch>/sN.json
   python3 -I analyze-trees.py <scratch>/sN-trees.jsonl
   ```

   Keep the scratch files out of the repository. A sample counts for C2 when its `busyCores` is at least a quarter of the CPUs (6 on 24). If an eval run is active, run only `sample-trees.py` and `analyze-trees.py`: C2 is then not measured, and C1's cause still names the trees. The next section says what `analyze-trees.py` prints.
5. **Daemons and memory.** From `squeal ps`: each flagged daemon (older, root-gone, install-gone, not-installed) and how long it has been up; the daemons' total resident memory. From `free -b`: swap used and total. List niced processes adopted by `systemd --user` or init that carry the variable name `SQUEAL_OBSERVE`, with their age (report only; cezar's own leaks are hearsay-tools/cezarion#1448 and #1449).
6. **Yesterday's result.** Read the newest earlier file in `../../host-load/`.

## Criteria

The problem is resolved when all five criteria are met on two measured days in a row. Baselines are from 2026-10-21 (the report and sar `sa21`) unless the row says otherwise. `sa21` leaves the host on about 2026-10-28, so the numbers below are the baseline from then on.

| | Criterion | Target | Baseline 2026-10-21 | Source |
|---|---|---|---|---|
| C1 | The host is rarely saturated, or Squeal is not why | 10-minute samples with idle under 10%: at most 5% of the day; or, when more, Squeal-run tests (`%nice`) are at most 20% of the busy CPU in those samples | 16.8% of samples saturated; `%nice` 36.4% of busy CPU in them. 19 October, before the load: 0% | step 2, `saturatedShare`, `niceShareOfBusyWhenSaturated`; the cause: step 4's trees |
| C2 | Squeal is a minor share of the busy CPU | Mean `squealShareOfBusy` of the counted samples at most 35%; met as "quiet" when fewer than two samples count | 70% (17.5 of 25.3 cores, one sample at load 51.9), read before the fixes of row 011-186 (below) | step 4, `analyze.py` |
| C3 | Saves waste few test runs | In each project with at least 1,000 files picked in 24 h, at least 78% of picked files store a result at run end, leaving out a file that never started and that a later run picked (`all.files.keptShareStarted`; the human, 2026-10-24) | squeal 60%, cezar 76% (design 011-82 expects about 81% and 78%), counted by the results that still existed: compare `all.files.keptShareNow` with them for a regression | step 3, `waste.mjs` |
| C4 | Worktrees share results | In each project with at least 3 counted worktrees, `medianSharedShare` at least 50% | squeal about 0% (3 of 5 worktrees shared 0%), cezar about 43% | step 3, `share.mjs` |
| C5 | No stale daemons; memory has room | No flagged daemon up more than 1 hour; daemons' total resident memory at most 8 GiB; swap under 90% used | 5 older daemons; 10.3 to 13.7 GiB; swap 4.0 of 4.0 GiB | step 5 |

Report these too, without a target: yesterday's mean idle (baseline 40.0%; 75.4% on 19 October), mean `%nice` (22.4%; 9.2%), mean `%system` (19.1%; 7.7%), holders per key, the number of live worktrees per project, files picked per project in 24 h (`all.files.picked`), and per project the prune's share (`all.files.prunedShare`), the live worktrees' `live.files.keptShare`, and `all.files.neverStarted`, `all.files.handedOver` and `all.files.keptShare` (the C3 figure until 2026-10-24; below), and from `cancelled`, per cause, `cut` and `cutSeconds` (row 011-177). They show whether the day was comparable: a day with far more work can miss C1 for reasons outside Squeal.

## Who made the load: `analyze-trees.py`

Row 011-186. `sample-trees.py` is 011-181's sampler (`011-181/sample-trees.py`) with four additions: it ends after LINES lines; each tree carries the nice values of its processes that used CPU; each agent session carries its role; and the measuring session's whole tree counts as `sampler`. Its docstring has the rules. It reads `/proc` only. In step 4 it writes one 20-second line and ends; `timeout 60` only guards it. For each sample `analyze-trees.py` prints the busy cores, the idle share and whether the sample is saturated (idle under 10% of the CPUs, as C1 counts a sar sample). Then it prints the five largest trees of each kind at 0.1 core or more:

- `squeal`: a Squeal daemon's tree, by its root.
- `test`: a test runner outside Squeal, by its topmost runner process, with its command, its cwd and `via flock` for a locked full run.
- `agent`: the rest of an agent session's tree.
- `other`: the rest, by the name of the top process.

Each line gives the cores, the nice values, the project, the task (the worktree's id8), the role and the agent kind. The role is the session's skill, from its argv's `Selected skill: /<name>` (Cezar's Claude sessions). A squeal tree takes the role of the agent session in its worktree; a test tree takes its own session's. `?` is a session whose argv names no skill, as every Codex session: name it by its task. The measuring session's own tree, with its `sample.py`, is `sampler` and is in no other kind. The JSON line after the trees gives `busyCores`, `idlePct`, `saturated`, `squealShareOfBusy`, `coresByKind` and `top`. Its `squealShareOfBusy` agrees with `analyze.py`'s within a few points (28 and 29%, 56 and 56% in the trials of `../../../tasks/011-186/notes.md`); report a larger gap.

C1's cause names these trees: for each sample, the largest trees of each kind, and whether the sample was saturated. The trees are today's samples, and C1 counts yesterday's sar samples. So the trees name who loads the host at the hour of the measurement, not who made yesterday's saturated blocks; say so beside them.

## `analyze.py` before row 011-186

Two fixes of 2026-10-24 change C2's figure. Their commits are `fix(011-186): analyze.py does not count a gone process's life before the window` and `fix(011-186): analyze.py counts the Codex plugin's daemons`.

- Before the first fix, a process that ended inside the window added its whole life to its reaper's tree, not only its seconds in the window, so Squeal read high. In the trial at 19:59:24Z, cezar `0deb3943`'s tree read 8.10 cores; it used 2.75 in the window. `squealShareOfBusy` read 69%, against 25% after the fix.
- Before the second fix, `analyze.py` matched only `squeal/<version>/dist/cli/squeal.mjs daemon`. It counted no daemon of the Codex plugin (`squeal-hearsay/versions/<version>/dist`) and none from a checkout's `dist`, so Squeal read low. In the trial at 20:03:16Z it read 34% after the first fix and 56% after both (the trees: 56%); the two Codex daemons there used 2.14 cores.

So C2's values before the fixes, and its 70% baseline, read high or low by how many test processes ended in each window and how many Codex sessions ran. Do not compare them with later values. The next daily reports the old script's figure beside the new one once, for each sample, so the series has a bridge:

```sh
F=$(git log -1 --format=%H --grep="^fix(011-186): analyze.py does not count")
git show "$F^:docs/specifications/011-core/research/probes/host-load/analyze.py" > <scratch>/analyze-old.py
python3 -I <scratch>/analyze-old.py <scratch>/sN.json | tail -1
```

## How `waste.mjs` counts C3

Row 011-155, from `../../stored-nothing.md` finding 1. It reads the runs that started in the `<hours>` before `[end]` (an ISO time, default now) and ended. Each file a run picked is one of three:

- `storedNow`: the run still holds a result of the file.
- `prunedWithWorktree`: the run's worktree is removed since, and its `report.json` completed the file and did not withhold it. The prune deletes a removed worktree's results unless a live worktree holds the key (001 D8, `src/core/store/prune.ts`), so the file stored a result at run end and the prune deleted it later.
- `storedNothing`: every other file: cut by a cancel or a timeout, withheld, replaced at its key by a later run, or in a run with no report (node:test, pytest) that holds no result of it.

`keptShare` is `storedNow` plus `prunedWithWorktree`, of the files picked: the C3 figure until 2026-10-24. `keptShareNow` is `storedNow` alone: the count before 2026-10-24, which read the 2026-10-23 squeal C3 as 44% while about 74% completed. `all`, `live` and `removed` split the runs by whether their worktree still exists; each gives `files` (C3) and `recordedSeconds` (the units of `stored-nothing.md`: the report's durations; a file the run cut counts the run's wall when its log names it, else 0).

Two limits, so read `live` beside `all`:

- The prune's share counts every completed file of a removed worktree. In live worktrees, `liveCompletedStoredNothing` of the completed files stored nothing (inputs changed during the run, replaced); the prune's share can be too large by about that share of itself (0.6 to 8.5% in the copies of 2026-10-23).
- A removed worktree's run that kept no result under a live key is deleted with its log before any copy sees it, and every such run that stored nothing is among them. So `removed` leans toward stored work, more so the later the copy. On 2026-10-23 the 72 hours of `stored-nothing.md` lost 580 of squeal's 1,696 runs between 13:25Z and 17:01Z; a third to 44% of the lost seconds had stored nothing, against 18% in the runs that remain (inferred: the two copies subtracted). `live` is exact: the prune keeps a live worktree's results and runs for 7 days. Copy the stores at the start of step 3.

### Files that never started (row 011-138)

Since 2026-10-24 C3 reads `keptShareStarted` (the human): a file that never started cost no run time, and one that a later run picked lost no result. Beside `keptShare`, each `files` gives three fields from the logs of the cancelled runs (a report `failure` that starts `run cancelled`), from `../../../tasks/011-138/notes.md`:

- `neverStarted`: a file the run picked that its `vitest.log` never names: no module end (`MODULE`), no test line (`PASS`, `FAIL`, `SKIP`) and no console line (`[stdout] <file>: `). The file did not start, so it cost no run time, and it is always in `storedNothing`. A cancelled run with no `vitest.log` (node:test, pytest) counts no file as never started.
- `handedOver`: of the `neverStarted` files, those that a later run of the same worktree in the copy picked.
- `keptShareStarted`: `keptShare` with the `handedOver` files out of the files picked, the C3 figure. It reads a file that never started and ran later as not lost. It is a lower bound: a run cancelled just before the copy has no later run yet.

`recordedSeconds` has none of these fields. `cancelled` gives per cancel cause (the failure's first line), over all runs: the runs, `withoutLog`, the files picked, `neverEnded`, `cut`, `cutSeconds`, `neverStarted` and `handedOver`. Since row 011-177 (`../../../tasks/011-177/notes.md`), a module ended only when its `MODULE` line comes before the log's cancel note (`squeal: run cancelled: …`):

- `cut`: a file the run picked that its `vitest.log` names, that the report did not complete, and whose module did not end before the note: it started and the cancel cut it. A module that ends after the note ended in the grace with its remaining tests skipped, and the report drops it (`../../../tasks/011-136/notes.md`, F1). The report's `completedFiles` keeps a step-down's whole module, which 011-137 completes from the grace, out of `cut`.
- `cutSeconds`: the seconds of the `cut` files, each file's module duration in the nearest later run of its worktree that reports one, at most the cancelled run's wall; the wall when no later run reports it. This is the high bound of 011-136's `probes/cut.mjs`.
- `neverEnded`: a file whose module did not end before the note and that the report did not complete, so `cut` plus `neverStarted`. Before row 011-177 it read a module that ended in the grace as ended, and `neverEnded` minus `neverStarted` gave 15 and 0 where 95 and 40 were cut (011-136, 24 hours to 2026-10-24T09:22Z).

`handedOver` is a lower bound for two causes. The prune deletes a removed worktree's later runs that kept no result (the second limit above), so in `removed` some successors are not in the copy. A run cancelled just before the copy can have no later run yet; that is the only cause in `live`. On the ten step-down runs of 22 and 23 October, `cancelled` gives 1,315 files picked, 580 never ended (as counted before row 011-177), 569 never started and 328 handed over. Of the other 241, 191 are in two tiers whose worktrees have no later run in the copy, and 50 are in one tier whose worktree's later runs did not pick them.

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
- **NOT YET**: a criterion is measured and not met. For each one, give the evidence of its cause and a proposed board row: title, owning spec, one-line done-when. The evidence for C1 is step 4's trees (above: "Who made the load"); for C4, the worktrees that share little and why; for C3, the runs that stored nothing. Mark a criterion that is worse than its baseline as a regression.
- **INCOMPLETE**: a criterion could not be measured (an eval run, an unreadable store, no sar file). The day does not count toward RESOLVED.

Write `../../host-load/<YYYY-MM-DD>.md` (the run's local date): the verdict as its first line, the criteria table with today's value, target, baseline and met or not, the context figures, the causes and proposed rows. Commit it alone on your branch with the message `docs(011): host load <date>: <verdict>`, then `git fetch origin`, `git rebase origin/main` and `git push origin HEAD:main`; after a rejected push, fetch, rebase and push once more. It is a docs commit and needs no review.

Publish one HTML page with the same content (and yesterday's 10-minute samples of idle and `%nice` as a chart) with the Cezar CLI's `artifact publish <path>`; your session's instructions give the CLI's full command.

Your final message starts with the verdict, then the criteria in one line each, the artifact link and the commit SHA. On RESOLVED, first pause this automation: find its id with the Cezar CLI's `automation list` (the name starts "Host load daily measurement") and run its `automation pause <id>`. Then call `cezar_done`. A pause is the only change you make to the automation.
