# 011-84 probes

Read-only, 2026-10-21, on the shared 24-CPU host, installed Squeal 0.1.245. Each store was opened `mode=ro` in one read transaction. `squeal ps --json`, which the brief allows, is the only command that reached a live daemon. Nothing was written to a store, no process was signalled, no clone was made, no daemon was started and no test was run. Run each script with `python3 -I`.

| File | What it is | Load |
| --- | --- | --- |
| `drains.py` | Every drain the stores' notes record (`notes.<wt>` in `meta`: the drain's start note to the next `daemon stopped:` note), the runs started inside it, slow or fast by the root's `slow.include`, and how many of their results a later lookup read (`last_used_at` more than 60 s after `recorded_at`). Usage: `drains.py <common-dir>...` | |
| `drains-20261021T2050Z.txt` | Its output for the cezar and squeal stores | 34.4 |
| `drains-0822.py` | The runs and results of the four drains `014-ps/research/should-not-be-up.md` 2 saw at 08:22:38Z, each in the 60 min after the departure the scan read. A removed worktree keeps its runs and results in the store, not its notes | |
| `drains-0822-*.txt` | Its output | 19.0 |
| `quiet.py` | `squeal ps --json` and the stores, sampled: per daemon its sessions, the minutes since its last revision or consumer touch ("quiet"), since its last run, its slow lane's state, its tiers, pending files, permits and memory, and which "unused" option (A today, B waiting is no use, C the backlog is no use) would stop it. Usage: `quiet.py <samples> <interval-s>` | |
| `quiet-20261021T2053Z.txt` | 12 samples, 20:53 to 21:13Z | in each header |
| `ps-20261021T2048Z.json` | One raw `squeal ps --json` (exit 1: flags present); `.load` is `/proc/loadavg` beside it | 37.6 |

Limits: notes keep the newest 20 per worktree and go with a removed worktree; a status read moves no `last_used_at`; "quiet" cannot see a socket request. The design's section 7 lists the rest.
