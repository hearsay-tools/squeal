# 011-186: the daily measurement names the process trees behind its samples

Worker 2dc2e2e1, from main at e65bfa813, 2026-10-24. Shape: slice (probe and runbook). No product change. Coordinator 04a258b0 agreed to the two `analyze.py` fixes and chose step 4 only (answers to this worker's three requests, 2026-10-24, 20:00Z to 20:05Z).

## Answers

1. **Step 4 runs the tree sampler beside `sample.py`.** The runbook (`../../research/probes/host-load/README.md`, step 4 and "Who made the load") runs `sample-trees.py … 5 20 1` and `sample.py 20` in one command, then `analyze.py` and `analyze-trees.py`. C1's cause names the largest trees of each sample and says whether the sample was saturated. On an eval day the daily takes the tree samples only.
2. **Two trials on this host name the trees of their samples** (section 2). `analyze-trees.py`'s Squeal share agrees with the fixed `analyze.py`: 29 and 28%, 56 and 56%.
3. **`analyze.py` had two defects, and C2 read wrong in both directions** (section 3). It counted a process's whole life when the process ended inside the window (trial 1: 69% where 28% is right), and it missed every daemon of the Codex plugin (trial 2: 34% where 56% is right). Both are fixed in their own commits.
4. **The 2026-10-21 baseline (70%) cannot be derived again** (section 4). Its raw sample is gone, and its report keeps owner totals only. Its own text says the total counts the pre-window CPU of children that ended in the window.

## 1. Files

| File | What it is |
|---|---|
| `research/probes/host-load/sample-trees.py` | 011-181's sampler (`011-181/sample-trees.py`) with: an end after `LINES` lines; per tree in each line, the nice values of its processes that used CPU; per agent session, its nice and its role; the measuring session's whole agent tree as `sampler`; `other` trees by the top's program (`node <script>` by the script), not by `comm` (cezarion's `comm` is `MainThread`). Line values are lists: `squeal`, `agents`, `other` `[cores, nice]`; `tests` `[cores, procs, nice]` (011-181: `[cores, procs]`). 011-181's `analyze-samples.py` does not read the new lines. |
| `research/probes/host-load/analyze-trees.py` | Per line: busy, idle share, saturated (idle under 10%), then the five largest trees of each kind at 0.1 core or more, then one JSON line. |
| `research/probes/host-load/analyze.py` | The two fixes of section 3. |
| `research/probes/host-load/README.md` | Step 4; C1's source; C2's baseline note; "Who made the load"; "`analyze.py` before row 011-186" with the bridge command; the verdict's cause rule. |
| `results/` | Trials 1 and 2: `sN-trees.jsonl` (the sampler's output: cwds, cleaned runner commands, roles, no argv of an agent), `sN-analyze-trees.txt`, and `analyze.py`'s output before the fixes, after the first, and after both. The `sample.py` files stay out: they hold every process's command line. |

## 2. Trials

In this worker's scratch (`t/2dc2e2e1/trial/`), with the runbook's command. This worker's own daemon was running and shows in trial 2 at 0.06 cores; a daily stops its own first.

```sh
P=docs/specifications/011-core/research/probes/host-load   # absolute in the run
timeout 60 python3 -I $P/sample-trees.py $S/sN-trees.jsonl 5 20 1 & python3 -I $P/sample.py 20 $S/sN.json; wait
python3 -I $P/analyze.py $S/sN.json
python3 -I $P/analyze-trees.py $S/sN-trees.jsonl
```

Trial 2, 2026-10-24 20:03:16Z (load 25.52 at the start, no eval run), `analyze-trees.py`:

```
2026-10-24T20:03:36Z 20.1 s: busy 11.95 of 24 cores (idle 50%), %nice 4.02, %system 4.08; the trees explain 11.07
  kind    cores  nice   project task      role (agent)            what
  squeal   2.95  0,10   cezar   0deb3943  dev-flow (claude)       daemon cezar/.ai/cezar/worktrees/0deb3943-5cf3-4e43-a9ae-7b1200ec5834
  squeal   1.36  0,10   cezar   9a1cf62d  ? (codex)               daemon cezar/.ai/cezar/worktrees/9a1cf62d-b30d-4a52-a355-df62c8f2c62c
  squeal   0.78  0,10   squeal  2a0b2b5c  ? (codex)               daemon squeal/.ai/cezar/worktrees/2a0b2b5c-6481-4e62-9713-94d5889ffe60
  squeal   0.66  0,10   squeal  52e58f23  coordinator (claude)    daemon squeal/.ai/cezar/worktrees/52e58f23-d8e7-49ce-9ca6-5b9dfee2b5ac
  squeal   0.32  0,10   tmp     -         -                       daemon /tmp/squeal-e2e-FRBPlf/repo
  test     1.92  0,10   squeal  2a0b2b5c  ? (codex)               vitest, 17 procs via flock, in squeal/.ai/cezar/worktrees/2a0b2b5c-6481-4e62-9713-94d5889ffe60: node node_modules/.bin/vitest run --maxWorkers=4
  agent    0.32  0      cezar   0deb3943  dev-flow (claude)       agent session
  other    1.07  0      -       -         -                       cezarion
  other    0.42  10     -       -         -                       agent-browser-linux-x64
```

Its JSON line: `squealShareOfBusy` 56, `coresByKind` squeal 6.74, test 1.95, agent 0.62, other 1.55, sampler 0.13. The test tree is a locked full run (`via flock`, `--maxWorkers=4`) in a Codex session's worktree: a reviewer's, by the form of its command (CLAUDE.md); its argv names no role.

Trial 1, 2026-10-24 19:59:24Z (load 14.88): busy 12.89, idle 46%, the trees explain 11.89. Largest trees: a test tree of 6.34 cores, the coordinator `52e58f23`'s integration run (`vitest run --maxWorkers=4 test/code test/keys …` in `t/52e58f23/int-015b`, nice 0 and 10); squeal cezar `0deb3943` (dev-flow) 2.75; squeal cezar `9a1cf62d` (Codex) 0.40. `squealShareOfBusy` 29.

Neither sample was saturated. Both counted for C2 (at least 6 busy cores).

## 3. The two `analyze.py` fixes

| Squeal's share of busy | before the fixes | after the first | after both | `analyze-trees.py` |
|---|---|---|---|---|
| Trial 1, 19:59:24Z | 69% (8.9 cores) | 25% (3.2) | 28% (3.6) | 29% (3.68) |
| Trial 2, 20:03:16Z | 35% (4.2) | 34% (4.1) | 56% (6.7) | 56% (6.74) |

- **First fix: a gone process's life before the window.** A process that ends inside the window adds its whole life to its reaper's children's time. `analyze.py` took the growth of the reaper's own + children's time and did not take off the part before the window. In trial 1, eight cezar test processes under daemon `0deb3943` ended inside the window. Their CPU before it was 107.3 s, 5.36 cores over 20 s. So the tree read 8.10 cores; it used 2.75 (`sample-trees.py`: 2.75). The fix takes each gone process's own + children's time at the window's start off its nearest ancestor that is alive at the end: the rule `sample-trees.py` uses. Commit `fix(011-186): analyze.py does not count a gone process's life before the window (coordinator agreed)`.
- **Second fix: the Codex plugin's daemons.** `analyze.py` matched `squeal/<version>/dist/cli/squeal.mjs daemon`. The Claude Code plugin's path has that form (`~/.claude/plugins/cache/hearsay/squeal/0.1.295/dist/…`); the Codex plugin's does not (`~/.codex/plugins/data/squeal-hearsay/versions/0.1.296/dist/…`), nor a checkout's `dist`. In trial 2 the two Codex daemons used 2.14 cores and a `/tmp` e2e fixture daemon without a version used 0.32. The regex is now `(?:/(\d+\.\d+\.\d+))?/dist/cli/squeal\.mjs daemon (\S+)`; a daemon without a version prints `v?`. Commit `fix(011-186): analyze.py counts the Codex plugin's daemons (coordinator agreed)`.

The first error grows with the test processes that end inside the window; the second with the CPU of Codex sessions' daemons. So the two can cancel or add, and the C2 values of 2026-10-23 (62%, 12%, 69%) cannot be corrected after the fact. The runbook asks the next daily to print the old script's figure beside the new one once.

## 4. The 2026-10-21 baseline

The question: can the baseline (Squeal 70% of busy CPU) be derived again from any kept raw samples, without running anything outside `/proc` reads? **No.**

- `measured` The report is artifact `7f6a77e0` of task 3800fd79 (`index.html`, built 2026-10-21 18:26Z from `t/3800fd79/report/`). It says: "I recorded every process for 20 seconds and added up the CPU of each process tree, including children that ended inside the window. The total is 25.3 cores, a little more than 24, because a child that started before the window and ended inside it counts in full." Its 70% is 17.5 of 25.3: the denominator is the trees' total, not `/proc/stat`'s busy. The same page gives idle 3% at 20:06, so busy was at most about 23.3 cores.
- `measured` The raw sample is gone: `t/3800fd79/` does not exist. The artifact keeps only the owners' totals (`DATA.owners`): cezar `007cdd17` 11.14, an integration full-suite check 4.40, squeal `716a6766` 3.56, cezar `2686d16a` 2.12, the cockpit and agent sessions 1.87, short-lived processes adopted by systemd 1.30, 15 other Squeal daemons 0.70, the rest 0.20. Without each process's times at both ends, the part before the window cannot be taken off.
- `measured` No other raw sample is kept. Of the files over 200 KB changed since 2026-10-20 under `squeal/.ai/cezar/t/`, `cezar/.ai/cezar/t/` and `/tmp` (depth 4), only this row's two trials have `sample.py`'s `cpu0` key. The 2026-10-23 daily's three samples are not among them; the 2026-10-24 daily took none (eval run).
- `inferred` The trees' total exceeds the busy CPU by at least 2.0 cores (25.3 against at most 23.3), and by more if the trees explained less than all of busy (this row's trials: 92 to 93%). Which trees hold the excess is not known. With no error in Squeal's trees, 17.5 of 23.3 is 75%; each core of error in them takes about 4 points off. Trial 1's error was 5.36 of 8.10 cores in one Squeal tree, so the true share could be far lower.
- `inferred` The report's script was not `analyze.py` (that came on 2026-10-22, `6dd4608d3`). Its daemon table lists six Codex daemons and its owners count "15 other Squeal daemons", so the second defect may not apply to it. Which install path those Codex daemons had is not known.

So the first daily after these fixes gives the first C2 value on the corrected count; the 70% stays in the table as the old count's baseline.

## 5. Decisions the spec did not settle

- **The role rule.** A Cezar Claude session's argv carries `Selected skill: /<name>` in its appended system prompt; the role is that name as it stands (`worker`, `dev-flow`, `coordinator`, `reviewer`, `researcher`). A cwd in `t/<id8>/int*` gives `coordinator` (011-181's `classify.py` rule). The sampler reads only that name and prints no agent argv. A Codex session (`codex app-server` under `cezarion serve`) gets its prompt over its protocol, so its argv names no role: the summary prints `?` and the task id8. Reading the transcripts for it would break "read `/proc` only".
- **`LINES`, not the brief's `timeout 25`.** The sampler writes its line after its fourth 5-second snapshot, at 20 s plus four snapshot times. A kill at 25 s loses the line when a snapshot takes over 1.25 s, which is most likely on a saturated host. With `LINES` 1 it ends by itself; `timeout 60` only guards it. Here a snapshot of about 550 processes took 0.02 s.
- **The measuring session's tree is `sampler`.** `sample.py` polls `/proc` every 20 ms beside the tree sampler, under the same agent session; the rules leave the session out of every count. Trials: 0.13 cores for both samplers and the session.
- **Eval days take tree samples** (coordinator, answer (a)): they read `/proc` only, and the 2026-10-24 daily could not say who loaded the host because it took none.

## 6. Limits and residue

- The trees are today's samples, at about 09:00. C1 counts yesterday's sar samples, so the trees name who loads the host at the measurement, not who made yesterday's saturated blocks. The runbook says so; proposed row 1 closes it.
- Squeal's own suite starts real daemons in `/tmp` fixtures, which detach to `systemd --user`. Both scripts count them as Squeal (project `tmp`), so C2 counts a test run's fixtures as Squeal's load. Trial 2: `/tmp/squeal-e2e-FRBPlf/repo` 0.32 cores (its origin not traced), and `/tmp/squeal-vitest-1211445-…` 0.11 cores, whose name carries the pid of the locked full run's Vitest (1211445, `results/s2-trees.jsonl`). Proposed row 2.
- `analyze.py` counts a daemon whose direct parent is not a daemon. A daemon deeper inside another daemon's tree would count twice; not seen in the trials (both fixture daemons had parent `systemd --user`). `sample-trees.py` keeps the outer daemon.
- In `sample-trees.py`, a daemon under a test tree outside Squeal takes the `squeal` kind, not the test's (011-181's rule, kept). Not seen in the trials.
- Step 1's `pgrep -af 'evals/bin/run-'` matches the measuring session's own shell, whose command line holds the pattern. In this worker's trial 2 it printed this session's bash (pid 1258240). `pgrep -af '[e]vals/bin/run-'` does not match itself. Step 1 is outside this row's seam; not changed.
- Agent trees under 0.05 core go into one `rest` bucket ("agents under 0.05 core each").
- `sample-trees.py`'s window starts about 0.1 s after `sample.py`'s, after its first snapshot, and lasts about 20.1 s. The two Squeal shares agreed within 1 point in both trials.

## 7. Proposed rows

| Title | Owning spec | Done when |
|---|---|---|
| 1. The daily names the trees behind yesterday's saturated sar samples | 011 (research probes) | A tree sampler runs between two dailies, one line per 10 minutes as sar, and the daily's C1 cause names the trees of each saturated sar sample of yesterday. |
| 2. C2 counts a test fixture's Squeal daemon as its test run's load | 011 (research probes; the criterion is the human's) | `analyze.py` and `analyze-trees.py` give a daemon whose root is under `/tmp` to the test tree that made it (by the pid in its folder name, or as `fixture`), and C2 leaves it out of Squeal's cores. |

Host cost of row 1: a process that outlives the session that starts it, for example `systemd-run --user --scope -q --unit=host-load-trees nice -n 10 timeout 25h python3 -I sample-trees.py <dir>/trees-<date>.jsonl 5 600`, so a cezar restart does not end it (011-181's README: its first start died with `cezar.service`). It needs a lasting directory outside the daily's task scratch, which goes with the task. 011-181's sampler (`5 60`) measured now: 77.7 CPU s in 5.89 h (0.004 cores) at nice 10, 143 MiB resident (its argv cache), 0.87 MB of lines and events in 5.89 h, about 3.6 MB a day; at one line per 10 minutes the events dominate the size. The daily would delete files older than two days.
