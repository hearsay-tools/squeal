# Probe 011-139: permits and cores on a busy host (throwaway)

Throwaway. These scripts measured `../../../host-load/011-139.md` once, on 2026-10-24, and are not maintained. They read `/proc`, `/proc/locks`, the pool directory's mark files, store copies and copies of run reports. They never open a permit file (`pool.<i>.lock`), a live store or a daemon socket.

| File | What it does |
|---|---|
| `sample-pool.py INTERVAL COUNT OUT.jsonl` | One line per interval: load, host busy and `%nice` cores (`/proc/stat`), and per Squeal daemon its root, worktree id, tree CPU, test processes, nice, permits held (POSIX locks on the permit inodes, by pid) and its mark. |
| `analyze-pool.py OUT.jsonl [SLOTS] [EXCLUDE_WID...]` | One line per sample, then a JSON summary of the samples with 18 or more busy cores. |
| `bins.py OUT.jsonl [EXCLUDE_WID...]` | The same samples in 5-minute bins, as the Markdown table in the findings file. |
| `width-cost.py STORE RUNS HOURS [END]` | C4 step 5's wall estimate, `sum / W + (1 − 1/W) × longest`, of each run's recorded file durations at the widths a cap would leave. |
| `samples-2026-10-24.txt` | `analyze-pool.py`'s output on the run of 11:36:26Z to 12:36:11Z, excluding this session's worktree (`bcce6c5d81cda799`). |
| `width-cost-squeal.json`, `width-cost-cezar.json` | `width-cost.py` on store copies of 11:33:10Z, 24 h. |

Run as `cd /tmp && python3 -I <this folder>/sample-pool.py 8 450 <scratch>/samples.jsonl`. Keep the samples, store copies and report copies out of the repository.

Limits:

- Tree CPU is per interval, from each process's own and reaped children's time. A process that ended inside the tree has its counted time taken off again, since its reaper's `cutime` takes its whole life. A process re-parented out of the tree before it ends makes its daemon's interval read low, even below 0. One sample reads −3.2 cores; `analyze-pool.py` and `bins.py` count a negative edit figure as 0.
- An edit's tier is a daemon with test processes, no permit, and a mark with `want` 0 or no fresh mark. A daemon that holds permits and runs an edit's tier beside them shows its edit workers only as its test processes beyond its permits.
- `width-cost.py` splits runs by size only: a run of at most 4 files can be an edit's tier or a small backlog tier. The model keeps each file's recorded duration fixed, so on a saturated host it overstates what fewer workers cost (see the findings file).
