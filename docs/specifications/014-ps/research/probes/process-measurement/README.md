# Probes for 014-02 process measurement (throwaway)

Throwaway scripts for `../../process-measurement.md`. They are not product code and nothing imports them. Every script only reads `/proc` and `/sys`. None connects to a socket, signals, renices or writes another process's files. Run with Node 24 on Linux.

| Script | What it measures | Log |
|---|---|---|
| `snapshot.mjs [ms] [--no-smaps] [--json]` | One snapshot of every Squeal daemon of the user, its test processes and the host, with each step's cost | `logs/snapshot-1.txt`, `snapshot-2.json`, `snapshot-3-nosmaps.json` |
| `cpu-intervals.mjs [s]` | Instant CPU at 0.5, 1 and 2 s windows against the centred 10 s reading; lifetime average against the last 10 s | `logs/cpu-intervals-1.txt`, `-2.txt` |
| `threads.mjs` | Whether worker threads (as Vitest 4.1.10's threads pool makes them) are told apart in `/proc/<pid>/task` | `logs/threads.txt` |
| `smaps-breakdown.mjs <pid>` | A daemon's memory by mapping kind from full `smaps`, and the read's cost | `logs/smaps-breakdown-3704612.json`, `smaps-anon-sizes-3704612.json` |
| `v8-pages.mjs` | Whether the JS heap shows as 256 KiB anonymous mappings | `logs/v8-pages.txt` |
| `cost.mjs [rounds]` | Cost of each `/proc` read, sync against async, all processes against a filtered set | `logs/cost.txt` |
| `smaps-parallel.mjs` | `smaps_rollup` serial against four worker threads | `logs/smaps-parallel.txt` |

`logs/parallelism.txt` holds a shell run: `os.availableParallelism()` plain, under `taskset -c 0-3`, and in a transient `systemd-run --user --scope -p CPUQuota=200%` scope that ended with its process.
